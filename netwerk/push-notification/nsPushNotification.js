/* -*- Mode: Javascript; tab-width: 2; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set sw=2 ts=2 autoindent cindent expandtab: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * @section push-prefs The preference used by nsPushNotification.
 *
 * There are some preferences been used to control nsPushNotification.
 * They are in branch "network.push-notification".
 *
 *  - notification-server is the URL, in websocket, of the push server.
 *
 *  - user-agent-token-server is the URL, in HTTP, for getting a token
 *    for a new device.
 *
 * - receiver-port is the port, in UDP, that the push server uses it
 *   for waking up.
 *
 * @section push-observer-topics The topics of observer service.
 *
 * nsPushNotification will notify on "moz-push-notification" topic for
 * both "ready" and "shutdown".  "ready" is sent for
 * nsPushNotification being ready for serving.  "shutdown" is for
 * being stop serving.
 *
 * @section push-system-messages System messages.
 *
 * nsPushNotification sends a system message with the type
 * "push-notification" to the corresponding application for every
 * received notification.
 */

"use strict";

const kDefaultReceiverPort = 5000
const kPUSHNOTIFICATION_CID =
  Components.ID("{b2138a49-ba0b-4465-a700-d5dfe582c9b9}");

const kPUSHNOTIFICATION_TOPIC = "moz-push-notification";
const kPUSHNOTIFICATION_NOTIFY_TOPIC = "moz-push-notify";

const kPUSHNOTIFICATION_PREF_BRANCH = "network.push-notification.";
const kNS_NETWORK_PROTOCOL_CONTRACTID_PREFIX =
  "@mozilla.org/network/protocol;1?name=";
const kWS_CONTRACTID = kNS_NETWORK_PROTOCOL_CONTRACTID_PREFIX + "ws";
const kWSS_CONTRACTID = kNS_NETWORK_PROTOCOL_CONTRACTID_PREFIX + "wss";

const kDB_DB_NAME = "push-notification-info";
const kDB_UA_STORE_NAME = "ua-registration"; // name of data store for UA
const kDB_WA_STORE_NAME = "wa-registrations"; // name of data store for WA

const kSYSTEMMESSAGEINTERNAL_CONTRACTID =
  "@mozilla.org/system-message-internal;1";


const {classes: Cc,
       interfaces: Ci,
       utils: Cu,
       results: Cr,
       Constructor: CC} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");


// Constructors
const ScriptableInputStream = CC("@mozilla.org/scriptableinputstream;1",
                                 "nsIScriptableInputStream",
                                 "init");
const XMLHttpRequest = CC("@mozilla.org/xmlextras/xmlhttprequest;1",
                          "nsIXMLHttpRequest");


function log(msg) { dump("nsPushNotification: " + msg + "\n"); }

function extend(obj, ext) {
  for (let key in ext) {
    obj[key] = ext[key];
  }
}

let gThreadManager = null;
let gGlobal = this;             // global object for IndexedDB manager
var indexedDB = null;
let gToAppDirectly = true;

/**
 * Register user agent.
 */
function slaveRegisterUA(master, request) {
  this.master = master;
  this.ip = master.ip;
  this.port = master.port;
  this.request = request;
}

slaveRegisterUA.prototype = {
  ip: null,                     // IP address of UDP wakeup port
  port: null,                   // Port number of weakup port
  request: null,                // User's request object

  retrieveUAToken: function retrieveUAToken() {
    log("registerUA::retrieveUAToken " + this.master.uatokenURL);
    let self = this;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", this.master.uatokenURL, true);
    xhr.onreadystatechange = function statechange(e) {
      log("registerUA::retrieveUAToken readystate=" + xhr.readyState +
          ", status=" + xhr.status);
      if (xhr.readyState == 4) {
        if (xhr.status == 200) {
          self.master.uatoken = xhr.responseText.trim();
          self.connectUAReal();
        } else {
          self.doError();
        }
      }
    };
    xhr.send();
  },

  createWS: function createWS(listener) {
    log("registerUA::createWS " + this.master.nsURL);
    let uri = Cc["@mozilla.org/network/standard-url;1"].
      createInstance(Ci.nsIURI);
    let manifestURL = "http://test.example.com/test";
    uri.spec = this.master.nsURL;
    let pref = this.master.nsURL.substring(0, 3);
    let ws;
    if (pref == "ws:") {
      ws = Cc[kWS_CONTRACTID].createInstance(Ci.nsIWebSocketChannel);
    } else if (pref == "wss") {
      ws =  Cc[kWSS_CONTRACTID].createInstance(Ci.nsIWebSocketChannel);
    } else {
      throw "Invalid URL";
    }

    ws.protocol = "push-notification";
    ws.asyncOpen(uri, this.master.nsURL, listener, null);
    return ws;
  },

  connectUAReal: function connectUAReal() {
    // This websocket is owned by the master.
    // All callbacks will relayed by the master to the slave.
    this.master.ws = this.createWS(this.master);
  },

  start: function start() {
    log("registerUA::start");
    let self = this;
    if (this.master.ws) {
      log("there is already one connection");
      DispatchToMain(function () {
        self.doErrorNoClose();
      });
      return;
    }

    if (!this.master.uatoken) {
      this.retrieveUAToken();
    } else {
      this.connectUAReal();
    }
  },

  // private
  doSuccess: function doSuccess() {
    log("registerUA::doSuccess call handleSuccess");

    // Let slaveNotificationReceiver to handle notifications.
    let receiver = new slaveNotificationReceiver(this.master);
    this.master.installSavedSlave(receiver);

    if (this.request.onSuccess) {
      try {
        this.request.onSuccess.handleSuccess();
      } catch(e) {
        log("Exception: " + e);
      }
      log("return from handleSuccess");
    }

    this.master.finishSlave();
  },

  doErrorNoClose: function doErrorNoClose() {
    if (this.request.onError) {
      this.request.onError.handleError();
    }

    this.master.finishSlave();
  },

  doError: function doError() {
    if (this.master.ws) {
      this.master.ws.close(0, "invalid status");
    }
    this.master.ws = null;
    this.doErrorNoClose();
  },

  // nsIWebSocketListener; relayed by the master.

  // Relayed from nsPushNotification::onStart()
  onStart: function onStart(context) {
    log("registerUA::onStart");
    let msg = {
      messageType: "registerUA",
      data: {
        uatoken: this.master.uatoken,
        "interface": {
          ip: this.ip,
          port: this.port
        }
      }
    };
    this.master.ws.sendMsg(JSON.stringify(msg));
  },

  onStop: function onStop(status) {
    log("onStop " + status);
    this.doError();
  },

  // Relayed from nsPushNotification::onMessageAvailable()
  onMessageAvailable: function onMessageAvailable(context, msg) {
    log("registerUA::onMessageAvailable");
    let msgobj = JSON.parse(msg);
    if (msgobj.status == "REGISTERED") {
      // nsIPushNotificationUASuccessCallback
      this.doSuccess();
    } else {
      this.doError();
    }
  },

};


/**
 * Handle notification from the notification server.
 */
function slaveNotificationReceiver(master) {
  this.master = master;
}

slaveNotificationReceiver.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

  onMessageAvailable: function onMessageAvailable(context, msg) {
    log("slaveNotificationReceiver::onMessageAvailable");
    log(msg);
    let msgo = JSON.parse(msg);

    if (!Array.isArray(msgo)) {
      msgo = [msgo];
    }

    try {
      let self = this;
      msgo.forEach(function (msg_item) {
        let handler =
          self['handle_msg_' + msg_item.messageType].bind(self);
        handler(msg_item);
      });
    } catch(e) {
      log("Exception: " + e );
    }
  },

  handle_msg_notification: function handle_msg_notification(msg) {
    let self = this;

    function gotReceiverInfo(event) {
      if (this.result) {
        let {pageURL: pageURL, manifestURL: manifestURL} = this.result;
        self.notify(pageURL, manifestURL, msg);
      } else {
        log("Drop notification: " + msg);
      }
    };

    this.master.recallWAURL(msg.url, gotReceiverInfo);
  },

  notify: function notify(pageURL, manifestURL, msg) {
    log("slaveNotificationReceiver.notify: " + pageURL + ", " +
        manifestURL + ", " + JSON.stringify(msg));

    if (gToAppDirectly) {
      this.notifyApp(pageURL, manifestURL, msg);
      return;
    }

    let data = msg.message;
    let cookie = JSON.stringify({pageURL: pageURL,
                                 manifest: manifestURL,
                                 msg: msg});

    let AlertsService = Cc["@mozilla.org/alerts-service;1"].
      getService(Ci.nsIAlertsService);
    log(AlertsService);
    AlertsService.showAlertNotification("",
                                        data.title,
                                        data.description,
                                        true,
                                        cookie,
                                        this,
                                        "");
  },

  notifyApp: function notifyApp(pageURL, manifestURL, msg) {
    this.notifyAppSystemMessage(pageURL, manifestURL, msg);
    this.notifyAppObserver(pageURL, manifestURL, msg);
  },

  notifyAppSystemMessage: function notifyAppSystemMessage(pageURL,
                                                          manifestURL,
                                                          msg) {
    let smi = Cc[kSYSTEMMESSAGEINTERNAL_CONTRACTID].
      getService(Ci.nsISystemMessagesInternal);

    let pageURI = Services.io.newURI(pageURL, null, null);
    let manifestURI = Services.io.newURI(manifestURL, null, null);
    smi.sendMessage("push-notification", msg, pageURI, manifestURI);
  },

  notifyAppObserver: function notifyAppObserver(pageURL, manifestURI, msg) {
    let obs = Cc["@mozilla.org/observer-service;1"].
      getService(Ci.nsIObserverService);
    let fullmsg = {pageURL: pageURL, manifestURI: manifestURI, message: msg};
    obs.notifyObservers(this,
                        kPUSHNOTIFICATION_NOTIFY_TOPIC,
                        JSON.stringify(fullmsg));
  },

  // interface nsIAlertsService
  observe: function observe(subject, topic, cookie) {
    let {pageURL: pageURL, manifest: manifest, msg: msg} = JSON.parse(cookie);
    this.notifyApp(pageURL, manifest, msg);
  },
};

/**
 * Register WEB application
 *
 * Only check database for the pushing URL if watoken is absent.
 */
function slaveRegisterWA(master, pageURL, manifestURL, watoken, request) {
  this.master = master;
  this.pageURL = pageURL;
  this.manifestURL = manifestURL;
  this.watoken = watoken;
  this.request = request;

  this.msgqueue = [];
}

slaveRegisterWA.prototype = new slaveNotificationReceiver();

extend(slaveRegisterWA.prototype, {
  master: null,
  pageURL: null,
  manifestURL: null,
  watoken: null,
  request: null,

  // queue all messages until registration is finished.
  msgqueue: null,

  start: function start() {
    log("slaveRegisterWA::start");

    let self = this;
    let request = {
      QueryInterface: XPCOMUtils.generateQI([Ci.nsIPushNotificationWARequest]),

      onSuccess: {
        handleSuccess: function (url) {
          self.doSuccessNoRemember(url);
        }
      },
      onError: {
        handleError: function () {
          if (self.watoken) {
            self.sendRegisterWA();
          } else {
            self.doError();
          }
        }
      }
    };

    this.master.recallWA(this.manifestURL, this.watoken, request);
  },

  sendRegisterWA: function sendRegisterWA() {
    log("slaveRegisterWA::sendRegisterWA");

    if (!this.master.ws) {
      log("no websocket connection!");
      let self = this;
      DispatchToMain(function () {
        self.doError();
      });
      return;
    }

    let msg = {
      messageType: "registerWA",
      data: {
        uatoken: this.master.uatoken,
        watoken: this.watoken,
      }
    };

    let outmsg = JSON.stringify(msg);
    this.master.ws.sendMsg(outmsg);
  },

  // private

  // dispatch queued messages
  dispatchQueue: function dispatchQueue() {
    let self = this;
    this.msgqueue.forEach(function(msg) {
      self.master.currentSlave.handle_msg_notification(msg);
    });
    this.msgqueue.splice(0, this.msgqueue.length);
  },

  doSuccessNoRemember: function doSuccess(url) {
    if (this.request.onSuccess) {
      // nsIPushNotificationSuccessCallback
      this.request.onSuccess.handleSuccess(url);
    }

    this.master.finishSlave();
    this.dispatchQueue();
  },

  doSuccess: function doSuccess(url) {
    this.master.rememberWA(this.pageURL, this.manifestURL, this.watoken, url);
    this.doSuccessNoRemember(url);
  },

  doError: function doError() {
    this.master.currentSlave = null;
    if (this.request.onError) {
      this.request.onError.handleError();
    }

    this.master.finishSlave();
    this.dispatchQueue();
  },

  handle_msg_registerWA: function handle_msg_registerWA(msg) {
    if (msg.status == "REGISTERED") {
      this.doSuccess(msg.url);
    } else {
      this.doError();
    }
  },

  handle_msg_notification: function handle_msg_notification(msg) {
    this.msgqueue.push(msg);
  }
});


/**
 * Push notification service.
 *
 * nsPushNotification manages all requests for push-notification
 * service.  Applications start push-notification by registering
 * him-self with nsPushNotification.  The applicaton will receive a
 * public URL generated by the notification server and a token
 * generated by nsPushNotification if the registering is success.
 *
 * The public URL and the token are sent to the application server by
 * the application it-self.  The application server use the public URL
 * as a gateway to deliver notifications, if there are, to the device
 * running the application.  The notification server, provided by the
 * operator, is responsible for forwarding notifications passed to the
 * public URL.  The NotificationReceiver is responsible for receiving
 * notifications from the server.  The reciever, in turn, delivers the
 * notification to the respective application by inspecting the token
 * in the notification.  In an other word, the token returned by
 * nsPushNotification are used to identify and authenticate an
 * application.
 *
 * The tokens are long random strings that is unique for all
 * applications on a device.  It must be big and random enough to
 * avoid brute force.
 */
function nsPushNotification() {
  if (!gThreadManager) {
    gThreadManager = Cc["@mozilla.org/thread-manager;1"].getService();
  }
  this.init();
}

nsPushNotification.prototype = {
  classID:   kPUSHNOTIFICATION_CID,
  classInfo: XPCOMUtils.generateCI({classID: kPUSHNOTIFICATION_CID,
                                    classDescription: "PushNotification",
                                    interfaces: [Ci.nsIPushNotification,
                                                 Ci.nsIWebSocketListener]}),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIPushNotification,
                                         Ci.nsIWebSocketListener]),

  storeReady: false,
  requestQueue: null,

  ws: null,
  currentSlave: null,           // slave object for running a task
  savedSlave: null,

  // maintain requestQueue
  // ============================================================

  /* To make sure only one request are performed in any instant, all
   * requests are pushed into requestQueue.  Then, requests in the
   * queue are executed one by one.
   *
   * We call the object represent a request a slave.  The slaves are
   * reponsible for handling messages from push-notification server.
   * For different type of requests, we add different types of slaves
   * into the queue.  So, slaves are both state and behavior.  By
   * installing different types of slaves, nsPushNotification change
   * its state and behavior.
   */

  callFirstSlave: function callFirstSlave() {
    this.currentSlave = this.requestQueue[0];
    this.currentSlave.start();
  },

  addSlave: function addSlave(slave) {
    this.requestQueue.push(slave);
    if (this.requestQueue.length == 1 && this.isReady()) {
      this.savedSlave = this.currentSlave;
      this.currentSlave = this.requestQueue[0];
      this.currentSlave.start();
    }
  },

  finishSlave: function finishSlave() {
    this.requestQueue.splice(0, 1);
    if (this.requestQueue.length) {
      this.currentSlave = this.requestQueue[0];
      this.currentSlave.start();
    } else {
      this.currentSlave = this.savedSlave;
    }
  },

  installSavedSlave: function installSavedSlave(slave) {
    this.savedSlave = slave;
  },

  // Data store relative attributes
  // ============================================================

  /**
   * Indexed DB saving information of UA and WA.
   *
   * There are two stores in the DB.  One is for saving information of
   * registered APPs (kDB_WA_STORE_NAME), another is for information
   * of user-agent itself (kDB_UA_STORE_NAME).
   */
  db: null,

  /*
   * Every registered WA own an object in the store for WA.
   * The object are in the following format.
   *   {
   *     manifestURL: "http://....",
   *     pageURL: "http://....",
   *     token: "<Web Application token>",
   *     URL: "http://URL for web server to push messages"
   *   }
   */
  get store() {                 // data store for info. of WA
    let transaction =
      this.db.transaction([kDB_WA_STORE_NAME], "readwrite");
    let store = transaction.objectStore(kDB_WA_STORE_NAME);
    return store;
  },

  get tokens() {                // indexed by WA token
    let transaction =
      this.db.transaction([kDB_WA_STORE_NAME], "readonly");
    let store = transaction.objectStore(kDB_WA_STORE_NAME);
    let tokens = store.index("tokens");
    return tokens;
  },

  get URLs() {                  // indexed by push URL
    let transaction =
      this.db.transaction([kDB_WA_STORE_NAME], "readonly");
    let store = transaction.objectStore(kDB_WA_STORE_NAME);
    let URLs = store.index("URLs");
    return URLs;
  },

  get ua_store() {              // data store for info. of UA
    let transaction =
      this.db.transaction([kDB_UA_STORE_NAME], "readonly");
    let store = transaction.objectStore(kDB_UA_STORE_NAME);
    return store;
  },

  get ua_store_wr() {           // read-write version of store for UA
    let transaction =
      this.db.transaction([kDB_UA_STORE_NAME], "readwrite");
    let store = transaction.objectStore(kDB_UA_STORE_NAME);
    return store;
  },

  initStoreSchema: function initStoreSchema() {
    let store = this.db.createObjectStore(kDB_WA_STORE_NAME,
                                          { keyPath: "manifestURL" });
    store.createIndex("tokens", "token", { unique: true });
    store.createIndex("URLs", "URL", { unique: true });
    let store = this.db.createObjectStore(kDB_UA_STORE_NAME,
                                          { keyPath: "key" });
  },

  /* Restore user-agent data from data store.
   *
   * The store for UA contain only one object in
   *     {key: "UAToken", value: "token value"}
   * format.
   */
  restoreUAData: function restoreUAData() {
    log("restoreUAData");

    let self = this;
    let store = this.ua_store;

    let req = store.get("UAToken");
    req.onsuccess = function (event) {
      log("restoreUAData onsuccess");
      if (this.result) {
        self.uatoken = this.result.value;
      } else {
        self.uatoken = null;
      }
      self.doStoreReady();
    };
    req.onerror = function (event) {
      log("restoreUAData onerror");
      self.uatoken = null;
      self.doStoreReady();
    };
  },

  saveUAData: function saveUAData() {
    let self = this;
    let store = this.ua_store_wr;

    let req = store.put({key: "UAToken", value: self.uatoken},
                        "UAToken");
    req.onerror = function (event) {
      log("fails on saveUAData: " + event.errorCode);
    }
  },

  rememberWA: function rememberWA(pageURL, manifestURL, watoken, url) {
    let self = this;
    let store = this.store;

    let req = store.put({manifestURL: manifestURL,
                         pageURL: pageURL,
                         token: watoken,
                         URL: url});
    req.onsuccess = function (event) {
      log("addWAData onsuccess");
    };
    req.onerror = function (event) {
      log("addWAData onerrror " + event);
    };
  },

  forgetWA: function forgetWA(manifestURL) {
    let req = this.store.delete(manifestURL);

    req.onerror = function (event) {
      log("removeWAData onerror " + event);
    };
  },

  /**
   * Retreieve the pushing URL from the datastore.
   *
   * @param manifestURL
   *        query WA info with manifestURL if it is not null.
   *        Or query WA info with watoek.
   * @param watoken
   *        is the token of the WA.
   */
  recallWA: function recallWA(manifestURL, watoken, request) {
    function callback(event) {
      if (this.result && ((!watoken) ||
                          this.result.token == watoken)) {
        if (request.onSuccess) {
          request.onSuccess.handleSuccess(this.result.URL);
        }
      } else {
        if (request.onError) {
          request.onError.handleError();
        }
      }
    };
    this.recallWAInternal(manifestURL, watoken,  callback);
  },

  /**
   * Recall information of an WEB Application stored in the DB.
   *
   * @param manifestURL
   *        is manifes of WA to recall if it is not null or empty.
   * @param watoken
   *        is token of WA to recall if it is not null or empty.
   * @param callback
   *        is a callback function with one argument that is an event
   *        passed from IndexedDB.
   *
   * Only one of manifestURL or watoken should be passed (not null) as
   * the key for retrieving information.
   */
  recallWAInternal: function recallWAInternal(manifestURL, watoken, callback) {
    let req = manifestURL ?
      this.store.get(manifestURL) : this.tokens.get(watoken);
    req.onsuccess = callback;
  },

  recallWAURL: function recallWAURL(pushURL, callback) {
    let req = this.URLs.get(pushURL);
    req.onsuccess = callback;
  },

  // Init store for saving registration info.
  initStore: function initStore() {
    // Init indexedDB
    if (!indexedDB) {
      let idbMgr = Cc["@mozilla.org/dom/indexeddb/manager;1"].
        getService(Ci.nsIIndexedDatabaseManager);
      idbMgr.initWindowless(gGlobal);
      // indexedDB is ready
    }

    let request = indexedDB.open(kDB_DB_NAME);
    let self = this;
    request.onerror = function(event) {
      log("Can not open DB.");
    };

    request.onupgradeneeded = function(event) {
      log("upgrade DB");
      self.db = request.result;
      self.initStoreSchema();
    };
    request.onsuccess = function(event) {
      log("open DB onsuccess");
      self.db = request.result;

      self.restoreUAData();
    };
  },

  // ============================================================
  init: function init() {
    log("init");
    this.requestQueue = [];

    this.initStore();
    this.readPrefs();
    this.monitorPrefChange();
  },

  monitorPrefChange: function monitorPrefChange() {
    let prefService = Cc["@mozilla.org/preferences-service;1"].
      getService(Ci.nsIPrefBranch);
    let self = this;
    let prefObserver = {
      QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

      observe: function observe(subject, topic, data) {
        self.readPrefs();
      }
    };
    prefService.addObserver(kPUSHNOTIFICATION_PREF_BRANCH,
                            prefObserver,
                            false);

    let observice = Cc["@mozilla.org/observer-service;1"].
      getService(Ci.nsIObserverService);
    observice.addObserver(prefObserver, "profile-do-change", false);
  },

  readPrefs: function readPrefs() {
    let branch = Services.prefs.getBranch(kPUSHNOTIFICATION_PREF_BRANCH);
    try {
      let nsURL = branch.getCharPref("notification-server");
      this.nsURL = nsURL;
    } catch (e) {
    }
    try {
      let uatokenURL = branch.getCharPref("user-agent-token-server");
      this.uatokenURL = uatokenURL;
    } catch (e) {
    }

    // receiver port: optional
    let receiverPort = kDefaultReceiverPort;
    try {
      receiverPort = branch.getIntPref("receiver-port");
    } catch (e) {
    }
    this.receiverPort = receiverPort;
  },

  // nsIPushNotification

  nsURL: "ws://example.com:8080/", // URI of the notification server

  uatokenURL: "http://example:8080/", // URI for retrieving the UA token

  receiverPort: 0,

  uatoken: null,

  get connected() {
    return !!this.ws;
  },

  // should be renamed to connectUA
  registerUA: function registerUA() {
    log("registerUA");

    let request = {
      QueryInterface: XPCOMUtils.generateQI([Ci.nsIPushNotificationUARequest]),

      onSuccess: null,
      onError: null,
    };

    let slave = new slaveRegisterUA(this, request);
    this.addSlave(slave);

    return request;
  },

  closeUA: function closeUA() {
    if (this.ws) {
      this.ws.close(0, "close the connection to notification server");
      this.ws = null;
      this.currentSlave = null;
    }
  },

  registerWA: function registerWA(pageURL, manifestURL, watoken) {
    let request = {
      QueryInterface: XPCOMUtils.generateQI([Ci.nsIPushNotificationWARequest]),

      onSuccess: null,
      onError: null,
    };

    let slave = new slaveRegisterWA(this,
                                    pageURL,
                                    manifestURL,
                                    watoken,
                                    request);
    this.addSlave(slave);

    return request;
  },

  // Remove the entry from notification server.
  unregisterWA: function unregisterWA(manifestURL) {
    throw "Not implementd";
  },

  getCurrentPushURL: function getCurrentPushURL(manifestURL) {
    return this.registerWA(null, manifestURL, null /* check only database */);
  },

  // Private functions

  isReady: function isReady() {
    return this.storeReady;
  },

  // The code is ran when the service is ready.
  doReady: function doReady() {
    if (!this.isReady()) {
      return;
    }
    log("doReady");
    let isEmpty = this.requestQueue.length == 0;
    let obs = Cc["@mozilla.org/observer-service;1"].
      getService(Ci.nsIObserverService);
    obs.notifyObservers(this, kPUSHNOTIFICATION_TOPIC, "ready");
    if (!isEmpty) {
      this.callFirstSlave();
    }
  },

  // The code is ran before the shutdown of the service.
  doShutdown: function doShutdown() {
    let obs = Cc["@mozilla.org/observer-service;1"].
      getService(Ci.nsIObserverService);
    obs.notifyObservers(this, kPUSHNOTIFICATION_TOPIC, "shutdown");
  },

  doStoreReady: function doStoreReady() {
    log("doStoreReady");
    this.storeReady = true;
    this.doReady();
  },

  // nsIWebSocketListener

  /* All following functions only a bridge to relay message to the
   * current slave.
   */

  onStart: function onStart(context) {
    let slave = this.currentSlave;
    if (slave && slave.onStart) {
      slave.onStart(context);
    }
  },

  onStop: function onStop(context, statusCode) {
    log("onStop");
    let slave = this.currentSlave;
    if (slave && slave.onStop) {
      slave.onStop(statusCode);
    }
    this.ws = null;
    this.currentSlave = null;
  },

  onMessageAvailable: function onMessageAvailable(context, msg) {
    let slave = this.currentSlave;
    if (slave && slave.onMessageAvailable) {
      slave.onMessageAvailable(context, msg);
    }
  },

  onBinaryMessageAvailable: function onBinaryMessageAvailable(context,
                                                              msg) {
  },

  onAcknowledge: function onAcknowledge(context, size) {
    log("onAcknowledge " + size);
  },

  onServerClose: function onServerClose(context, code, reason) {
    log("onServerClose: closed by remote server");
    this.ws = null;
    this.currentSlave = null;
  },

};

function DispatchToMain(callback, name) {
  let result = new MainRunner(callback, name);
  gThreadManager.mainThread.dispatch(result,
                                     Ci.nsIThread.DISPATCH_NORMAL);
}

function MainRunner(callable, name) {
  this.callable = callable;
  this.name = name;
  if (!this.name) {
    this.name = "<unknown>";
  }
}

MainRunner.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIRunnable]),

  run: function run() {
    try {
      this.callable();
    } catch(e) {
      log(this.name + " Exception: " + e);
    }
  },
};


const NSGetFactory = XPCOMUtils.generateNSGetFactory([nsPushNotification]);

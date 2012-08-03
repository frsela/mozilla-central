/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let DEBUG = true;
if (DEBUG) {
  debug = function (s) {
    dump("-*- NetworkPoliciesService: " + s + "\n");
  };
} else {
  debug = function (s) {};
}

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

let EXPORTED_SYMBOLS = ["NetworkPoliciesService"];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
//Cu.import("resource://gre/modules/NetworkPoliciesDB.jsm");

const NET_NETWORKPOLICIESSSERVICE_CONTRACTID = "@mozilla.org/network/networkpoliciessservice;1";
const NET_NETWORKPOLICIESSSERVICE_CID = Components.ID("{b82a7470-9e20-4b8b-89d7-bb775eb7904b}");

const TOPIC_INTERFACE_REGISTERED = "network-interface-registered";
const NETWORK_TYPE_WIFI = Ci.nsINetworkInterface.NETWORK_TYPE_WIFI;
const NETWORK_TYPE_MOBILE = Ci.nsINetworkInterface.NETWORK_TYPE_MOBILE;
/*
XPCOMUtils.defineLazyServiceGetter(this, "gIDBManager",
                                   "@mozilla.org/dom/indexeddb/manager;1",
                                   "nsIIndexedDatabaseManager");
*/
XPCOMUtils.defineLazyGetter(this, "ppmm", function() {
  return Cc["@mozilla.org/parentprocessmessagemanager;1"].getService(Ci.nsIFrameMessageManager);
});

let myGlobal = this;

let NetworkPoliciesService = {
  init: function() {
    debug("Service started");

    Services.obs.addObserver(this, "xpcom-shutdown", false);
    Services.obs.addObserver(this, TOPIC_INTERFACE_REGISTERED, false);
    Services.obs.addObserver(this, "profile-after-change", false);

    this.connections = [];
    this.connections[NETWORK_TYPE_WIFI] = "wifi";
    this.connections[NETWORK_TYPE_MOBILE] = "mobile";

    this.messages = ["NetworkPolicies:Get", "NetworkPolicies:Set"];
    this.messages.forEach(function(msgName) {
      ppmm.addMessageListener(msgName, this);
    }, this);
/*
    var idbManager = Components.classes["@mozilla.org/dom/indexeddb/manager;1"].getService(Ci.nsIIndexedDatabaseManager);
    idbManager.initWindowless(myGlobal);
    this._db = new NetworkPoliciesDB(myGlobal);
    this._db.init(myGlobal);

    try {
      let hosts = Services.prefs.getCharPref("dom.mozNetworkPolicies.whitelist")
      hosts.split(",").forEach(function(aHost) {
        if (aHost)
          Services.perms.add(Services.io.newURI(aHost, null, null), "networkpolicies-manage",
                             Ci.nsIPermissionManager.ALLOW_ACTION);
      });
    } catch(e) { debug(e); }
*/
  },

  receiveMessage: function(aMessage) {
    debug("receiveMessage " + aMessage.name);
    let msg = aMessage.json;
    switch (aMessage.name) {
      case "NetworkPolicies:Get":
        this.getPolicy(msg);
        break;
      case "NetworkPolicies:Set":
        this.setPolicy(msg);
        break;
    }
  },

  observe: function observe(subject, topic, data) {
    if (topic == TOPIC_INTERFACE_REGISTERED) {
      let network = subject.QueryInterface(Ci.nsINetworkInterface);
      debug("Network " + network.name + " of type " + network.type + " registered");
      this.updateStats(network.type);
      return;
    }
    if (topic == "xpcom-shutdown") {
      debug("Service shutdown");

      this.messages.forEach((function(msgName) {
        ppmm.removeMessageListener(msgName, this);
      }).bind(this));

      Services.obs.removeObserver(this, "xpcom-shutdown");
      Services.obs.removeObserver(this, "profile-after-change");
      this.timer.cancel();
      this.timer = null;

      if (this._db){
        this._db.close();
      }
      this._db = null;
    }
  },

  get connectionTypes() {
    debug("connectionTypes");
    let connTypes = [];
    for (let index in this.connections){
      connTypes.push(this.connections[index]);
    }

    return connTypes;
  },

  setPolicy: function setPolicy(msg) {
    debug("setPolicy for: " + JSON.stringify(msg));
    let _policy = msg.data;
    let aErrorMsg = "";

    // TODO: Validate input data
    if(_policy == null) {
      aErrorMsg = "Policy not valid";
    }
    if(typeof(_policy) != "object") {
      aErrorMsg = "Policy shall be a NetworkPoliciesPolicy object";
    }
    if(aErrorMsg != "") {
      ppmm.sendAsyncMessage("NetworkPolicies:Set:Return:KO", { id: msg.id, errorMsg: aErrorMsg });
      return;
    }

    // TODO: Set new policy
    ppmm.sendAsyncMessage("NetworkPolicies:Set:Return:OK", { id: msg.id, policy: _policy });
  },

  getPolicy: function getPolicy(msg) {
    debug("getPolicy for: " + JSON.stringify(msg));
    let _appName = msg.data;
    let aErrorMsg = "";

    // TODO: Validate input data
    if(typeof(_appName) != "string") {
      aErrorMsg = "Application name shall be a string";
    }_appName
    if(aErrorMsg != "") {
      ppmm.sendAsyncMessage("NetworkPolicies:Get:Return:KO", { id: msg.id, errorMsg: aErrorMsg });
      return;
    }

    // TODO: Get policy
    let _policy =  {
      app: _appName,
      allowNetworkAccess: true,
      policies: [
        {
          connectionType: "wifi",
          allowed: true,
          prefered: true,
          max: 1000
        },
        {
          connectionType: "mobile",
          allowed: true,
          prefered: false,
          max: 400
        }
      ]
    };

    ppmm.sendAsyncMessage("NetworkPolicies:Get:Return:OK", { id: msg.id, policy: _policy });
  }
};

NetworkPoliciesService.init();

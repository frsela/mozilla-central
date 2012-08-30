/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// set to true to see debug messages
const DEBUG = false;

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

let EXPORTED_SYMBOLS = ["NetworkPoliciesService"];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/NetworkPoliciesDB.jsm");

const NET_NETWORKPOLICIESSSERVICE_CONTRACTID =
  "@mozilla.org/network/networkpoliciessservice;1";
const NET_NETWORKPOLICIESSSERVICE_CID =
  Components.ID("{b82a7470-9e20-4b8b-89d7-bb775eb7904b}");

const TOPIC_INTERFACE_REGISTERED = "network-interface-registered";
const NETWORK_TYPE_WIFI = Ci.nsINetworkInterface.NETWORK_TYPE_WIFI;
const NETWORK_TYPE_MOBILE = Ci.nsINetworkInterface.NETWORK_TYPE_MOBILE;

const CACHE_MAX_SIZE = 100;

XPCOMUtils.defineLazyServiceGetter(this, "gIDBManager",
                                   "@mozilla.org/dom/indexeddb/manager;1",
                                   "nsIIndexedDatabaseManager");

XPCOMUtils.defineLazyServiceGetter(this, "ppmm",
                                   "@mozilla.org/parentprocessmessagemanager;1",
                                   "nsIMessageListenerManager");

let myGlobal = this;

// NetworkPoliciesCache
let NetworkPoliciesCache = {
  policiesCache: null,
  cacheCounter: 0,

  init: function() {
    debug("NetworkPoliciesCache: init");
    this.policiesCache = Object.create(null);
  },

  write: function write(policyKey, policyValue) {
    debug("NetworkPoliciesCache: write");

    if (this.policiesCache[policyKey]) {
      debug("NetworkPoliciesCache: Update cache for " + policyKey);
      this.policiesCache[policyKey].value = policyValue;
    } else {
      debug("NetworkPoliciesCache: Add " + policyKey + " in cache");
      this.policiesCache[policyKey] = { value: policyValue,
                                        timestamp: Date.now(),
                                        queries: 1 };
      this.cacheCounter++;
      if (this.cacheCounter > CACHE_MAX_SIZE) {
        this.freeCache();
      }
    }
  },

  read: function read(policyKey) {
    debug("NetworkPoliciesCache: read");
    if (!this.policiesCache[policyKey]) {
      debug("NetworkPoliciesCache: Not found ! ");
      return null;
    }

    this.policiesCache[policyKey].queries++;
    debug("NetworkPoliciesCache: found ! - Readed " +
          this.policiesCache[policyKey].queries + " times. Value = " +
          JSON.stringify(this.policiesCache[policyKey].value));
    return this.policiesCache[policyKey].value;
  },

  free: function free() {
    debug("NetworkPoliciesCache: free");
    debug(JSON.stringify(this.policiesCache));

    let time = Date.now();
    debug("NetworkPoliciesCache: Free time threshold: " + time);
    let cacheInvalidationFactor = 0;
    let itemId = null;
    for (let i in this.policiesCache) {
      let itemCII = (time - this.policiesCache[i].timestamp) /
                    this.policiesCache[i].queries;
      debug("Cache Invalidation Index for " + i + ": " + itemCII);
      if (itemCII > cacheInvalidationFactor) {
        cacheInvalidationFactor = itemCII;
        itemId = i;
      }
    }

    if (itemId) {
      delete this.policiesCache[itemId];
      this.cacheCounter--;
    }

    debug(JSON.stringify(this.policiesCache));
  }
}

// NetworkPoliciesService
let NetworkPoliciesService = {
  defaultPolicyName: "__default_policy__",
  interfacePolicyName: "__interface_policy__",

  init: function() {
    debug("Service started");

    Services.obs.addObserver(this, "xpcom-shutdown", false);
    Services.obs.addObserver(this, TOPIC_INTERFACE_REGISTERED, false);
    Services.obs.addObserver(this, "profile-after-change", false);

    this.connections = [];
    this.connections[NETWORK_TYPE_WIFI] = "wifi";
    this.connections[NETWORK_TYPE_MOBILE] = "mobile";

    this.messages = [
      "NetworkPolicies:GetConnectionTypes",
      "NetworkPolicies:GetDefaultPolicyName",
      "NetworkPolicies:GetInterfacePolicyName",
      "NetworkPolicies:GetAll",
      "NetworkPolicies:Get",
      "NetworkPolicies:Set"
    ];
    this.messages.forEach(function(msgName) {
      ppmm.addMessageListener(msgName, this);
    }, this);

    var idbManager = Cc["@mozilla.org/dom/indexeddb/manager;1"].getService(
      Ci.nsIIndexedDatabaseManager);
    idbManager.initWindowless(myGlobal);
    this._db = new NetworkPoliciesDB(myGlobal);
    this._db.init(myGlobal);

    NetworkPoliciesCache.init();
  },

  receiveMessage: function(aMessage) {
    debug("receiveMessage " + aMessage.name);
    let msg = aMessage.json;
    let target = aMessage.target.QueryInterface(Ci.nsIMessageSender);
    switch (aMessage.name) {
      case "NetworkPolicies:GetConnectionTypes":
        return this.connectionTypes;

      case "NetworkPolicies:GetDefaultPolicyName":
        return this.defaultPolicyName;

      case "NetworkPolicies:GetInterfacePolicyName":
        return this.interfacePolicyName;

      case "NetworkPolicies:Get":
        if (aMessage.sync) {
          return this.getPolicySync(msg);
        }

        // Async
        if (msg.data == "") {        // All policies?
          this.getAllPolicies(msg,  target);
        } else {
          this.getPolicy(msg, target);
        }
        break;

      case "NetworkPolicies:Set":
        this.setPolicy(msg, target);
        break;
    }
  },

  observe: function observe(subject, topic, data) {
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

  setPolicy: function setPolicy(msg, target) {
    debug("setPolicy for: " + JSON.stringify(msg));
    let policy = msg.data;
    let aErrorMsg = "";

    // TODO: Validate input data
    if (policy == null) {
      aErrorMsg = "Policy not valid";
    }
    if (typeof(policy) != "object") {
      aErrorMsg = "Policy shall be a NetworkPoliciesPolicy object";
    }
    if (aErrorMsg != "") {
      target.sendAsyncMessage("NetworkPolicies:Set:Return:KO",
                              { id: msg.id, errorMsg: aErrorMsg });
      return;
    }

    this._db.addPolicy(
      policy,
      function(success, result) {
        if (success) {
          target.sendAsyncMessage("NetworkPolicies:Set:Return:OK",
                                  { id: msg.id, policy: result });

          // Update cache
          NetworkPoliciesCache.write(policy.app, policy);
        } else {
          target.sendAsyncMessage("NetworkPolicies:Set:Return:KO",
                                  { id: msg.id, errorMsg: result });
        }
      }.bind(this)
    );
  },

  getPolicy: function getPolicy(msg, target) {
    debug("getPolicy for: " + JSON.stringify(msg));
    let appName = msg.data;

    let aErrorMsg = "";

    // TODO: Validate input data
    if (typeof(appName) != "string") {
      aErrorMsg = "Application name shall be a string";
    }
    if (aErrorMsg != "") {
      target.sendAsyncMessage("NetworkPolicies:Get:Return:KO",
                              { id: msg.id, errorMsg: aErrorMsg });
      return;
    }

    if (NetworkPoliciesCache.read(appName)) {
      debug("Return policy from cache");
      target.sendAsyncMessage("NetworkPolicies:Get:Return:OK",
                              { id: msg.id,
                                policy: NetworkPoliciesCache.read(appName) });
    } else {
      this._db.findPolicy(
        appName,
        function(success, result) {
          if (success) {
            if (!result && appName != this.defaultPolicyName) {
              // Not found, Recover default policy
              debug("Not found policies for " + appName + ". Get default one");
              msg.data = this.defaultPolicyName;
              msg.realAppName = appName;
              this.getPolicy(msg,target);
              return;
            }

            target.sendAsyncMessage("NetworkPolicies:Get:Return:OK",
                                    { id: msg.id, policy: result });

            // Adding policy into cache
            // If response is the default policy, we got the real application name
            if (appName == this.defaultPolicyName && msg.realAppName) {
              appName = msg.realAppName;
            }
            NetworkPoliciesCache.write(appName, result);
          } else {
            target.sendAsyncMessage("NetworkPolicies:Get:Return:KO",
                                    { id: msg.id, errorMsg: result });
          }
        }.bind(this)
      );
    }
  },

  getPolicySync: function getSync(msg) {
    debug("getPolicy synchronous for: " + JSON.stringify(msg));
    return NetworkPoliciesCache.read(msg.data);
  },

  getAllPolicies: function getAllPolicies(msg, target) {
    debug("getAllPolicies");
    this._db.getAllPolicies(
      function(success, aResult) {
        if (success) {
          // Update cache for all
          for (let policy in aResult) {
            NetworkPoliciesCache.write(aResult[policy].app, aResult[policy]);
          }

          // notify result
          target.sendAsyncMessage("NetworkPolicies:Get:Return:OK",
                                  { id: msg.id, policies: aResult });
        } else {
          target.sendAsyncMessage("NetworkPolicies:Get:Return:KO",
                                  { id: msg.id, errorMsg: aResult });
        }
      }
    );
  }
};

NetworkPoliciesService.init();

let debug;
if (DEBUG) {
  debug = function (s) {
    dump("-*- NetworkPoliciesService: " + s + "\n");
  };
} else {
  debug = function (s) {};
}

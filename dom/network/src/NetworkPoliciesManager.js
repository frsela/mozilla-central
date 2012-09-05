/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict"

// set to true to see debug messages
const DEBUG = false;

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/DOMRequestHelper.jsm");
Cu.import("resource://gre/modules/NetworkPoliciesService.jsm");

XPCOMUtils.defineLazyGetter(this, "cpmm", function() {
  return Cc["@mozilla.org/childprocessmessagemanager;1"]
         .getService(Ci.nsISyncMessageSender);
});

const nsIClassInfo = Ci.nsIClassInfo;

// NetworkPolicyConnection
const NETWORKPOLICYCONNECTION_CONTRACTID =
  "@mozilla.org/networkPolicyConnection;1";
const NETWORKPOLICYCONNECTION_CID        =
  Components.ID("{87f201d2-3baf-49a4-82cb-ad20961b5e17}");
const nsIDOMMozNetworkPolicyConnection   =
  Ci.nsIDOMMozNetworkPolicyConnection;

function NetworkPolicyConnection(policyConnection) {
  debug("NetworkPolicyConnection Constructor");
  this.connectionType = policyConnection.connectionType || null;
  this.allowed = policyConnection.allowed || false;
  this.prefered = policyConnection.prefered || false;
  this.max = policyConnection.max || 0;
}

NetworkPolicyConnection.prototype = {
  classID : NETWORKPOLICYCONNECTION_CID,
  QueryInterface : XPCOMUtils.generateQI([nsIDOMMozNetworkPolicyConnection,
                                         Ci.nsIDOMGlobalPropertyInitializer]),
  classInfo : XPCOMUtils.generateCI({classID: NETWORKPOLICYCONNECTION_CID,
                                     contractID: NETWORKPOLICYCONNECTION_CONTRACTID,
                                     classDescription: "NetworkPolicyConnection",
                                     interfaces: [nsIDOMMozNetworkPolicyConnection],
                                     flags: nsIClassInfo.DOM_OBJECT})
}

// NetworkPolicy
const NETWORKPOLICY_CONTRACTID = "@mozilla.org/networkPolicy;1";
const NETWORKPOLICY_CID =
  Components.ID("{9084e8d8-8c28-4017-a843-5dad38f18daf}");
const nsIDOMMozNetworkPolicy = Ci.nsIDOMMozNetworkPolicy;

function NetworkPolicy(policy) {
  debug("NetworkPolicy Constructor");
  if (policy == null) {
    this.app = "";
    this.allowNetworkAccess = false;
    this.policies = [];
    return;
  }

  this.app = policy.app || "";
  this.allowNetworkAccess = policy.allowNetworkAccess || false;
  this.addPolicies(policy.policies || []);
}

NetworkPolicy.prototype = {
  addPolicies: function(aPolicies) {
    let policies = [];
    for (let i in aPolicies) {
      policies.push(new NetworkPolicyConnection(aPolicies[i]));
    }
    this.policies = policies;
  },

  classID : NETWORKPOLICY_CID,
  QueryInterface : XPCOMUtils.generateQI([nsIDOMMozNetworkPolicy,
                                         Ci.nsIDOMGlobalPropertyInitializer]),
  classInfo : XPCOMUtils.generateCI({classID: NETWORKPOLICY_CID,
                                     contractID: NETWORKPOLICY_CONTRACTID,
                                     classDescription: "NetworkPolicy",
                                     interfaces: [nsIDOMMozNetworkPolicy],
                                     flags: nsIClassInfo.DOM_OBJECT})
}

// NetworkPoliciesManager
const NETWORKPOLICIESMANAGER_CONTRACTID =
  "@mozilla.org/networkPoliciesManager;1";
const NETWORKPOLICIESMANAGER_CID =
  Components.ID("{d7dcbc77-edf4-40c8-9497-4dca4cf750c7}");
const nsIDOMMozNetworkPoliciesManager =
  Ci.nsIDOMMozNetworkPoliciesManager;

function NetworkPoliciesManager() {
  debug("NetworkPoliciesManager Constructor");
}

NetworkPoliciesManager.prototype = {
  __proto__: DOMRequestIpcHelper.prototype,

  checkPrivileges: function() {
    if (!this.hasPrivileges) {
      throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    }
  },

  get connectionTypes() {
    debug("get connectionTypes");
    this.checkPrivileges();

    return cpmm.sendSyncMessage("NetworkPolicies:GetConnectionTypes")[0];
  },

  get defaultPolicyName() {
    debug("get defaultPolicyName: " +
          JSON.stringify(NetworkPoliciesService.defaultPolicyName));
    this.checkPrivileges();

    return cpmm.sendSyncMessage("NetworkPolicies:GetDefaultPolicyName")[0];
  },

  get interfacePolicyName() {
    debug("get interfacePolicyName: " +
          JSON.stringify(NetworkPoliciesService.interfacePolicyName));
    this.checkPrivileges();

    return cpmm.sendSyncMessage("NetworkPolicies:GetInterfacePolicyName")[0];
  },

  set: function(policy) {
    debug("set new policy: " + JSON.stringify(policy));
    this.checkPrivileges();

    let req = this.createRequest();
    cpmm.sendAsyncMessage("NetworkPolicies:Set", {data: policy,
                                                  id: this.getRequestId(req)});
    return req;
  },

  get: function(appName) {
    debug("get policy for: " + appName);
    this.checkPrivileges();

    let req = this.createRequest();
    cpmm.sendAsyncMessage("NetworkPolicies:Get", {data: appName,
                                                  id: this.getRequestId(req)});
    return req;
  },

  getSync: function(appName) {
    debug("get policy (synchronously) for: " + appName);
    this.checkPrivileges();

    return cpmm.sendSyncMessage("NetworkPolicies:Get", {data: appName})[0];
  },

  receiveMessage: function(aMessage) {
    debug("receiveMessage: " + aMessage.name);
    let msg = aMessage.json;
    let req = null;

    switch (aMessage.name) {
      case "NetworkPolicies:Set:Return:OK":
      case "NetworkPolicies:Get:Return:OK":
        req = this.takeRequest(msg.id);
        if (req) {
          debug(JSON.stringify(msg));
          if (msg.policy) {
            let policy = new NetworkPolicy(msg.policy);
            debug("firing success: " + JSON.stringify(policy));
            Services.DOMRequest.fireSuccess(req, policy);
          } else {
            let policies = [];
            for (let policy in msg.policies) {
              policies.push(new NetworkPolicy(msg.policies[policy]));
            }
            debug("firing success: " + JSON.stringify(policies));
            Services.DOMRequest.fireSuccess(req, policies);
          }
        } else {
          debug("setPolicy: No request !")
        }
        break;

      case "NetworkPolicies:Set:Return:KO":
      case "NetworkPolicies:Get:Return:KO":
        req = this.takeRequest(msg.id);
        if (req) {
          debug("firing error: " + msg.errorMsg);
          Services.DOMRequest.fireError(req, msg.errorMsg);
        }
        break;

      default:
	debug("Wrong message: " + aMessage.name);
    }
    this.removeRequest(msg.id);
  },

  init: function(aWindow) {
    debug("init");

    // Set navigator.mozNetworkPolicies to null.
    if (!Services.prefs.getBoolPref("dom.mozNetworkPolicies.enabled")){
      return null;
    }

    this.initHelper(aWindow, ["NetworkPolicies:Get:Return:OK",
                              "NetworkPolicies:Get:Return:KO",
                              "NetworkPolicies:Set:Return:OK",
                              "NetworkPolicies:Set:Return:KO"]);

    let principal = aWindow.document.nodePrincipal;

    let secMan = Services.scriptSecurityManager;
    let perm = principal == secMan.getSystemPrincipal() ?
                 Ci.nsIPermissionManager.ALLOW_ACTION :
                 Services.perms.testExactPermission(principal.URI,
                                                    "networkpolicies-manage");

    // Only pages with perm set can use the netstats.
    this.hasPrivileges = perm == Ci.nsIPermissionManager.ALLOW_ACTION;
    debug("Has privileges: " + this.hasPrivileges);
  },

  // Called from DOMRequestIpcHelper
  uninit: function uninit() {
    debug("uninit");
  },

  classID : NETWORKPOLICIESMANAGER_CID,
  QueryInterface : XPCOMUtils.generateQI([nsIDOMMozNetworkPoliciesManager,
                                         Ci.nsIDOMGlobalPropertyInitializer]),
  classInfo : XPCOMUtils.generateCI({classID: NETWORKPOLICIESMANAGER_CID,
                                     contractID: NETWORKPOLICIESMANAGER_CONTRACTID,
                                     classDescription: "NetworkPoliciesManager",
                                     interfaces: [nsIDOMMozNetworkPoliciesManager],
                                     flags: nsIClassInfo.DOM_OBJECT})
}

const NSGetFactory = XPCOMUtils.generateNSGetFactory(
                       [NetworkPoliciesManager,
                        NetworkPolicy,
                        NetworkPolicyConnection])

let debug;
if (DEBUG) {
  debug = function (s) {
    dump("-*- NetworkPoliciesManager: " + s + "\n");
  };
} else {
  debug = function (s) {};
}

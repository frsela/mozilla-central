/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict"

/* static functions */
let DEBUG = true;
if (DEBUG) {
  debug = function (s) { dump("-*- NetworkPoliciesManager: " + s + "\n"); }
} else {
  debug = function (s) {}
}

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/DOMRequestHelper.jsm");
Cu.import("resource://gre/modules/NetworkPoliciesService.jsm");

XPCOMUtils.defineLazyGetter(Services, "DOMRequest", function() {
  return Cc["@mozilla.org/dom/dom-request-service;1"].getService(Ci.nsIDOMRequestService);
});

XPCOMUtils.defineLazyGetter(this, "cpmm", function() {
  return Cc["@mozilla.org/childprocessmessagemanager;1"].getService(Ci.nsIFrameMessageManager);
});

const nsIClassInfo                      = Ci.nsIClassInfo;

// NetworkPoliciesPolicyConnection & NetworkPoliciesPolicy are not directly instantiated. They are used as interfaces.

// NetworkPoliciesPolicyConnection
const NETWORKPOLICIESPOLICYCONNECTION_CONTRACTID = "@mozilla.org/networkPoliciesPolicyConnection;1";
const NETWORKPOLICIESPOLICYCONNECTION_CID        = Components.ID("{87f201d2-3baf-49a4-82cb-ad20961b5e17}");
const nsIDOMMozNetworkPoliciesPolicyConnection   = Ci.nsIDOMMozNetworkPoliciesPolicyConnection;

function NetworkPoliciesPolicyConnection(policyConnection) {
  debug("NetworkPoliciesPolicyConnection Constructor");
  this.connectionType = policyConnection.connectionType || null;
  this.allowed = policyConnection.allowed || false;
  this.prefered = policyConnection.prefered || false;
  this.max = policyConnection.max || 0;
}

NetworkPoliciesPolicyConnection.prototype = {
  get connectionType() {
    return this._connectionType;
  },

  set connectionType(aConnectionType) {
    this._connectionType = aConnectionType;
  },

  get allowed() {
    return this._allowed;
  },

  set allowed(aAllowed) {
    this._allowed = aAllowed;
  },

  get prefered() {
    return this._prefered;
  },

  set prefered(aPrefered) {
    this._prefered = aPrefered;
  },

  get max() {
    return this._max;
  },

  set max(aMax) {
    this._max = aMax;
  },

  classID : NETWORKPOLICIESPOLICYCONNECTION_CID,
  QueryInterface : XPCOMUtils.generateQI([nsIDOMMozNetworkPoliciesPolicyConnection, Ci.nsIDOMGlobalPropertyInitializer]),
  classInfo : XPCOMUtils.generateCI({classID: NETWORKPOLICIESPOLICYCONNECTION_CID,
                                     contractID: NETWORKPOLICIESPOLICYCONNECTION_CONTRACTID,
                                     classDescription: "NetworkPoliciesPolicyConnection",
                                     interfaces: [nsIDOMMozNetworkPoliciesPolicyConnection],
                                     flags: nsIClassInfo.DOM_OBJECT})
}

// NetworkPoliciesPolicy
const NETWORKPOLICIESPOLICY_CONTRACTID  = "@mozilla.org/networkPoliciesPolicy;1";
const NETWORKPOLICIESPOLICY_CID         = Components.ID("{9084e8d8-8c28-4017-a843-5dad38f18daf}");
const nsIDOMMozNetworkPoliciesPolicy    = Ci.nsIDOMMozNetworkPoliciesPolicy;

function NetworkPoliciesPolicy(policy) {
  debug("NetworkPoliciesPolicy Constructor");
  if(policy == null) {
    this.app = "";
    this.allowNetworkAccess = false;
    this.policies = [];
    return;
  }

  this.app = policy.app || "";
  this.allowNetworkAccess = policy.allowNetworkAccess || false;
  this.policies = policy.policies || [];
}

NetworkPoliciesPolicy.prototype = {
  get app() {
    return this._app;
  },

  set app(aApp) {
    this._app = aApp;
  },

  get allowNetworkAccess() {
    return this._allowNetworkAccess;
  },

  set allowNetworkAccess(aAllowNetworkAccess) {
    this._allowNetworkAccess = aAllowNetworkAccess;
  },

  get policies() {
    return this._policies;
  },

  set policies(aPolicies) {
    let policies = [];
    for (let i in aPolicies) {
      policies.push(new NetworkPoliciesPolicyConnection(aPolicies[i]));
    }
    this._policies = policies;
  },

  classID : NETWORKPOLICIESPOLICY_CID,
  QueryInterface : XPCOMUtils.generateQI([nsIDOMMozNetworkPoliciesPolicy, Ci.nsIDOMGlobalPropertyInitializer]),
  classInfo : XPCOMUtils.generateCI({classID: NETWORKPOLICIESPOLICY_CID,
                                     contractID: NETWORKPOLICIESPOLICY_CONTRACTID,
                                     classDescription: "NetworkPoliciesPolicy",
                                     interfaces: [nsIDOMMozNetworkPoliciesPolicy],
                                     flags: nsIClassInfo.DOM_OBJECT})
}

// NetworkPoliciesManager
const NETWORKPOLICIESMANAGER_CONTRACTID = "@mozilla.org/networkPoliciesManager;1";
const NETWORKPOLICIESMANAGER_CID        = Components.ID("{d7dcbc77-edf4-40c8-9497-4dca4cf750c7}");
const nsIDOMMozNetworkPoliciesManager   = Ci.nsIDOMMozNetworkPoliciesManager;

function NetworkPoliciesManager() {
  debug("NetworkPoliciesManager Constructor");
}

NetworkPoliciesManager.prototype = {
  __proto__: DOMRequestIpcHelper.prototype,

  get installedApplications() {
    debug("get installedApplications: " + JSON.stringify(NetworkPoliciesService.installedApplications));
    return NetworkPoliciesService.installedApplications;
  },

  get connectionTypes() {
    debug("get connectionTypes: " + JSON.stringify(NetworkPoliciesService.connectionTypes));
    return NetworkPoliciesService.connectionTypes;
  },

  set: function(policy) {
    debug("set new policy: " + JSON.stringify(policy));
    let request = this.createRequest();
    cpmm.sendAsyncMessage("NetworkPolicies:Set", {data: policy,
                                                  id: this.getRequestId(request)});
    return request;
  },

  get: function(appName) {
    debug("get policy for: " + appName);
    let request = this.createRequest();
    cpmm.sendAsyncMessage("NetworkPolicies:Get", {data: appName,
                                                  id: this.getRequestId(request)});
    return request;
  },

  receiveMessage: function(aMessage) {
    debug("receiveMessage: " + aMessage.name);
    let msg = aMessage.json;
    let req = null;
    
    switch(aMessage.name) {
      case "NetworkPolicies:Set:Return:OK":
      case "NetworkPolicies:Get:Return:OK":
        req = this.takeRequest(msg.id);
        if(req) {
          let _policy = new NetworkPoliciesPolicy(msg.policy);
          debug("firing success: " + JSON.stringify(_policy));
          Services.DOMRequest.fireSuccess(req, _policy);
        } else {
          debug("setPolicy: No request !")
        }
        break;

      case "NetworkPolicies:Set:Return:KO":
      case "NetworkPolicies:Get:Return:KO":
        req = this.takeRequest(msg.id);
        if(req) {
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
/*
    // Set navigator.mozNetworkPolicies to null.
    if (!Services.prefs.getBoolPref("dom.mozNetworkPolicies.enabled")){
      return null;
    }
*/
    this.initHelper(aWindow, ["NetworkPolicies:Get:Return:OK", "NetworkPolicies:Get:Return:KO",
                              "NetworkPolicies:Set:Return:OK", "NetworkPolicies:Set:Return:KO"]);
/*
    let principal = aWindow.document.nodePrincipal;
    let secMan = Cc["@mozilla.org/scriptsecuritymanager;1"].getService(Ci.nsIScriptSecurityManager);

    let perm = principal == secMan.getSystemPrincipal() ?
                 Ci.nsIPermissionManager.ALLOW_ACTION :
                 Services.perms.testExactPermission(principal.URI, "networkpolicies-manager");

    // Only pages with perm set can use the netstats.
    this.hasPrivileges = perm == Ci.nsIPermissionManager.ALLOW_ACTION;
    debug("has privileges :" + this.hasPrivileges);
*/
  },

  // Called from DOMRequestIpcHelper
  uninit: function uninit() {
    debug("uninit");
  },

  classID : NETWORKPOLICIESMANAGER_CID,
  QueryInterface : XPCOMUtils.generateQI([nsIDOMMozNetworkPoliciesManager, Ci.nsIDOMGlobalPropertyInitializer]),
  classInfo : XPCOMUtils.generateCI({classID: NETWORKPOLICIESMANAGER_CID,
                                     contractID: NETWORKPOLICIESMANAGER_CONTRACTID,
                                     classDescription: "NetworkPoliciesManager",
                                     interfaces: [nsIDOMMozNetworkPoliciesManager],
                                     flags: nsIClassInfo.DOM_OBJECT})
}

const NSGetFactory = XPCOMUtils.generateNSGetFactory(
                       [NetworkPoliciesManager, NetworkPoliciesPolicy, NetworkPoliciesPolicyConnection])

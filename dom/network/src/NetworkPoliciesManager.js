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

XPCOMUtils.defineLazyGetter(Services, "DOMRequest", function() {
  return Cc["@mozilla.org/dom/dom-request-service;1"].getService(Ci.nsIDOMRequestService);
});

XPCOMUtils.defineLazyGetter(this, "cpmm", function() {
  return Cc["@mozilla.org/childprocessmessagemanager;1"].getService(Ci.nsIFrameMessageManager);
});

const nsIClassInfo                      = Ci.nsIClassInfo;

// NetworkPoliciesPolicy & NetworkPoliciesPolicyConnection are not directly instantiated. They are used as interfaces.

// NetworkPoliciesPolicyConnection
const NETWORKPOLICIESPOLICYCONNECTION_CONTRACTID = "@mozilla.org/networkPoliciesPolicyConnection;1";
const NETWORKPOLICIESPOLICYCONNECTION_CID        = Components.ID("{87f201d2-3baf-49a4-82cb-ad20961b5e17}");
const nsIDOMMozNetworkPoliciesPolicyConnection   = Ci.nsIDOMMozNetworkPoliciesPolicyConnection;

function NetworkPoliciesPolicyConnection() {
  debug("NetworkPoliciesPolicyConnection Constructor");
}

NetworkPoliciesPolicyConnection.prototype = {
  get connectionType() {
    return "wifi";
  },

  get allowed() {
    return true;
  },

  get prefered() {
    return false;
  },

  get max() {
    return 1000;
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


function NetworkPoliciesPolicy() {
  debug("NetworkPoliciesPolicy Constructor");
}

NetworkPoliciesPolicy.prototype = {
  get app() {
    return "uno";
  },

  get allowNetworkAccess() {
    return true;
  },

  get policies() {
    let policies = [];
    policies.push(new NetworkPoliciesPolicyConnection());
    policies.push(new NetworkPoliciesPolicyConnection());
    return policies;
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
  this._connectionTypes = [ "wifi", "mobile" ];
}

NetworkPoliciesManager.prototype = {
  __proto__: DOMRequestIpcHelper.prototype,

  get installedApplications() {
    debug("get installedApplications");
    // TODO: Recover apps.
    return ['uno', 'dos'];
  },

  get connectionTypes() {
    debug("get connectionTypes: " + JSON.stringify(this._connectionTypes));
    return this._connectionTypes;
  },
/*
  get defaultPolicies() {
    debug("get defaultPolicies");
    return null;
  },
*/

  set: function(policy) {
    debug("set new policy: " + policy);
    if(typeof(policy) != "object") {
      return false;
    }

    debug(JSON.stringify(policy));
    if(!policy.app || policy.app == "") {
      debug("default policy");
    }
    return true;
  },

  get: function(appName) {
    debug("get policy for: " + appName);
    return new NetworkPoliciesPolicy();
  },

  init: function(aWindow) {
    debug("init");
/*
    // Set navigator.mozNetworkPolicies to null.
    if (!Services.prefs.getBoolPref("dom.mozNetworkStats.enabled")){
      return null;
    }

    this.initHelper(aWindow, ["NetworkPolicies:Get:Return:OK", "NetworkPolicies:Get:Return:KO",
                              "NetworkPolicies:Clear:Return:OK", "NetworkPolicies:Clear:Return:KO"]);

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

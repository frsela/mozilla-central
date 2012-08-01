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
const NETWORKPOLICIESMANAGER_CONTRACTID = "@mozilla.org/networkPoliciesManager;1";
const NETWORKPOLICIESMANAGER_CID        = Components.ID("{3d2bdc60-afe5-11e1-8477-00265511db40}");
const nsIDOMMozNetworkPoliciesManager   = Ci.nsIDOMMozNetworkPoliciesManager;

// NetworkPolicies is not directly instantiated. It is used as interface.

function NetworkPoliciesManager() {
  debug("NetworkPoliciesManager Constructor");
}

NetworkPoliciesManager.prototype = {
  __proto__: DOMRequestIpcHelper.prototype,

  get test() {
    return true;
  },

  init: function(aWindow) {
    // Set navigator.mozNetworkPolicies to null.
//    if (!Services.prefs.getBoolPref("dom.mozNetworkStats.enabled")){
//      return null;
//    }

//    this.initHelper(aWindow, ["NetworkPolicies:Get:Return:OK", "NetworkPolicies:Get:Return:KO",
//                              "NetworkPolicies:Clear:Return:OK", "NetworkPolicies:Clear:Return:KO"]);

//    let principal = aWindow.document.nodePrincipal;
//    let secMan = Cc["@mozilla.org/scriptsecuritymanager;1"].getService(Ci.nsIScriptSecurityManager);
/*
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
    debug("uninit call");
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
                       [NetworkPoliciesManager])

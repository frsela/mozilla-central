/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict"

/* static functions */
let DEBUG = true;
if (DEBUG) {
  debug = function (s) { dump("-*- NetworkPolicies: " + s + "\n"); }
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

const nsIClassInfo            = Ci.nsIClassInfo;
const NETWORKPOLICIES_CONTRACTID = "@mozilla.org/networkpolicies;1";
const NETWORKPOLICIES_CID     = Components.ID("{3d2bdc60-afe5-11e1-8477-00265511db39}");
const nsIDOMMozNetworkPolicies= Ci.nsIDOMMozNetworkPolicies;

// NetworkPolicies is not directly instantiated. It is used as interface.

function MozNetworkPolicies(aProp) { debug("NetworkPolicies Constructor"); }

MozNetworkPolicies.prototype = {
  __proto__: DOMRequestIpcHelper.prototype,

  getTest: function() {
    return true;
  },

  init: function(aWindow) {
    // Set navigator.mozNetworkPolicies to null.
//    if (!Services.prefs.getBoolPref("dom.mozNetworkStats.enabled")){
//      return null;
//    }

    this.initHelper(aWindow, ["MozNetworkPolicies:Get:Return:OK", "MozNetworkPolicies:Get:Return:KO",
                              "MozNetworkPolicies:Clear:Return:OK", "MozNetworkPolicies:Clear:Return:KO"]);

    let principal = aWindow.document.nodePrincipal;
    let secMan = Cc["@mozilla.org/scriptsecuritymanager;1"].getService(Ci.nsIScriptSecurityManager);
/*
    let perm = principal == secMan.getSystemPrincipal() ?
                 Ci.nsIPermissionManager.ALLOW_ACTION :
                 Services.perms.testExactPermission(principal.URI, "networkpolicies-manager");
*/
    // Only pages with perm set can use the netstats.
    this.hasPrivileges = perm == Ci.nsIPermissionManager.ALLOW_ACTION;
    debug("has privileges :" + this.hasPrivileges);
  },

  // Called from DOMRequestIpcHelper
  uninit: function uninit() {
    debug("uninit call");
  },

  classID : NETWORKPOLICIES_CID,
  classInfo : XPCOMUtils.generateCI({classID: NETWORKPOLICIES_CID,
                                     contractID: NETWORKPOLICIES_CONTRACTID,
                                     classDescription: "NetworkPolicies",
                                     interfaces: [nsIDOMMozNetworkPolicies],
                                     flags: nsIClassInfo.DOM_OBJECT}),

  QueryInterface : XPCOMUtils.generateQI([nsIDOMMozNetworkPolicies])
}


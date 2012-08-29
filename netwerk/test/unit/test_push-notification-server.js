/* -*- Mode: Javascript; tab-width: 2; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set sw=2 ts=2 autoindent cindent expandtab: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Make basic functions of nsPushNotification are work.
 *
 * STEPS:
 *  - registerUA() to register with ns server
 *  - registerUA() again for fail to make sure awaring existing connection.
 *  - registerWA() to register an app with notification server.
 *  - registerWA() again to make sure the same URL.
 */

"use strict";

const {classes: Cc,
       interfaces: Ci,
       utils: Cu,
       results: Cr,
       Constructor: CC} = Components;

const kPUSHNOTIFICATION_TOPIC = "moz-push-notification";
const kPUSHNOTIFICATION_NOTIFY_TOPIC = "moz-push-notify";

const kPUSHNOTIFICATION_PREF_BRANCH = "network.push-notification.";

const kNOTIFICATION_SERVER_URL = "ws://10.0.0.1:8080/";
const kUA_TOKEN_SERVER_URL = "http://10.0.0.1:8080/token";
const kPUBLIC_PUSH_URL_PREFIX = "http://10.0.0.1:8081/notify/";

const kNOTIFICATION_RECEIVER_PORT = 5000;

const kORIGIN = "http://test.example.org";
const kMANIFEST = "http://test.example.org/manifest";
const kWATOKEN = "f82d7a74d20cde480d44ee32f24743a8";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://testing-common/httpd.js");

Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://services-common/utils.js");

var gPushNotification;
var gFakeServer;
var gNotificationPublicURL;

function registerUA() {
  let request = gPushNotification.registerUA();
  request.onSuccess = function () {
    registerWA();
  };
  request.onError = function () {
    do_test_finished();
    do_throw("registerUA() error");
  };
}
// XXXX: registerUA twice induce an error

function sha256(msg) {
  let hasher = Cc["@mozilla.org/security/hash;1"]
    .createInstance(Ci.nsICryptoHash);
  hasher.init(hasher.SHA256);

  let bin = CryptoUtils.digestUTF8(msg, hasher);
  let txt = CommonUtils.bytesAsHex(bin);
  return txt;
}

function registerWA() {
  let request = gPushNotification.registerWA(kORIGIN, kMANIFEST, kWATOKEN);
  request.onSuccess = function (url) {
    let push_url = kPUBLIC_PUSH_URL_PREFIX + sha256(kWATOKEN + "undefined");
    do_check_eq(url, push_url);
    registerWA_again();
  };
  request.onError = function () {
    do_test_finished();
    do_throw("registerWA error");
  };
}

function registerWA_again() {
  let request = gPushNotification.registerWA(kORIGIN, kMANIFEST, kWATOKEN);
  request.onSuccess = function (url) {
    let push_url = kPUBLIC_PUSH_URL_PREFIX + sha256(kWATOKEN + "undefined");
    do_check_eq(url, push_url);
    //do_test_finished();
    send_notification(push_url);
  };
  request.onError = function () {
    do_test_finished();
    do_throw("registerWA error");
  };
}

function send_notification(push_url) {
  var notify_count = 0;         // number of notification received (2 expected)

  let notify_observer = {
	  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

	  observe: function observe(aSubject, aTopic, aData) {
      if (aTopic != kPUSHNOTIFICATION_NOTIFY_TOPIC) {
        do_throw("wrong topic: " + aTopic);
      }

      let notify = JSON.parse(aData);
      do_check_eq(notify.pageURL, kORIGIN);
      do_check_eq(notify.manifestURI, kMANIFEST);
      do_check_eq(notify.message.id, 1234);

      notify_count = notify_count + 1;
      if (notify_count == 2) {
        do_test_finished();
      }
    },
  };

  let obs = Cc["@mozilla.org/observer-service;1"].
    getService(Ci.nsIObserverService);
  obs.addObserver(notify_observer, kPUSHNOTIFICATION_NOTIFY_TOPIC, false);

  let msg = {"messageType": "notification",
             "id": 1234,
             "message": "Hola",
             "signature": "",
             "ttl": 0,
             "timestamp": "SINCE_EPOCH_TIME",
             "priority": 1};

  var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
            .createInstance(Ci.nsIXMLHttpRequest);
  xhr.open("POST", push_url, true);
  xhr.send(JSON.stringify(msg));

  xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
    .createInstance(Ci.nsIXMLHttpRequest);
  xhr.open("POST", push_url, true);
  xhr.send(JSON.stringify(msg));

  dump("sent 2 notification to " + push_url + "\n");
}

function run_test() {
  let ready_observer = {
	  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

	  observe: function observe(aSubject, aTopic, aData) {
      do_print("ready_observer\n");
      if (aData == "ready") {
        try {
          registerUA();
        } catch (e) {
          do_print("exception: " + e);
        }
      }
    },
  };

  do_get_profile();

  let obs = Cc["@mozilla.org/observer-service;1"].
    getService(Ci.nsIObserverService);
  obs.addObserver(ready_observer, kPUSHNOTIFICATION_TOPIC, false);

  let prefB = Services.prefs.getBranch(kPUSHNOTIFICATION_PREF_BRANCH);
  prefB.setCharPref("notification-server", kNOTIFICATION_SERVER_URL);
  prefB.setCharPref("user-agent-token-server", kUA_TOKEN_SERVER_URL);
  prefB.setIntPref("receiver-port", kNOTIFICATION_RECEIVER_PORT);

  gPushNotification =
    Cc["@mozilla.org/network/push-notification;1"].
    getService(Ci.nsIPushNotification);

  do_test_pending();
}

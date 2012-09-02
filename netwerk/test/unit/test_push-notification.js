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
const kPUSHNOTIFICATION_PREF_BRANCH = "network.push-notification.";
const kNOTIFICATION_SERVER_URL = "ws://localhost:9988/netwerk/test/unit/file_push_server";
const kUA_TOKEN_SERVER_URL = "http://localhost:4444/uatoken_server";
const kNOTIFICATION_RECEIVER_PORT = 5000;
const kPUSH_URL = "http://push.example.com/push";

const kORIGIN = "http://test.example.org";
const kMANIFEST = "http://test.example.org/manifest";
const kWATOKEN = "f82d7a74d20cde480d44ee32f24743a8";
const kUATOKEN = "42a1a133f6eb67a3c0c09994378d5e15";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://testing-common/httpd.js");

var gPushNotification;
var gFakeServer;
var gNotificationPublicURL;

function handle_uatoken_server(metadata, response) {
  do_print("handle_uatoken_server\n");
  response.setHeader("content-type", "text/plain");
  response.write(kUATOKEN);
}

function initHttpServer() {
  let httpServer = new HttpServer();
  httpServer.registerPathHandler("/uatoken_server", handle_uatoken_server);
  httpServer.start(4444);
}

function registerUA() {
  let request = gPushNotification.registerUA();
  request.onSuccess = function () {
    registerUA_again();
  };
  request.onError = function () {
    do_test_finished();
    do_throw("registerUA() error");
  };
}

function registerUA_again() {
  let request = gPushNotification.registerUA();
  request.onSuccess = function () {
    do_test_finished();
    do_throw("registerUA() should be error");
  };
  request.onError = function () {
    registerWA();
  };
}

function registerWA() {
  let request = gPushNotification.registerWA(kORIGIN, kMANIFEST, kWATOKEN);
  request.onSuccess = function (url) {
    do_check_eq(url, kPUSH_URL);
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
    do_check_eq(url, kPUSH_URL);
    do_test_finished();
  };
  request.onError = function () {
    do_test_finished();
    do_throw("registerWA error");
  };
}

function run_test() {
  let observer = {
	  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

	  observe: function observe(aSubject, aTopic, aData) {
      do_print("observer\n");
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

  initHttpServer();

  let obs = Cc["@mozilla.org/observer-service;1"].
    getService(Ci.nsIObserverService);
  obs.addObserver(observer, kPUSHNOTIFICATION_TOPIC, false);

  let prefB = Services.prefs.getBranch(kPUSHNOTIFICATION_PREF_BRANCH);
  prefB.setCharPref("notification-server", kNOTIFICATION_SERVER_URL);
  prefB.setCharPref("user-agent-token-server", kUA_TOKEN_SERVER_URL);
  prefB.setIntPref("receiver-port", kNOTIFICATION_RECEIVER_PORT);

  gPushNotification =
    Cc["@mozilla.org/network/push-notification;1"].
    getService(Ci.nsIPushNotification);

  do_test_pending();
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ['NetworkPoliciesDB'];

let DEBUG = true;
if (DEBUG) {
  debug = function (s) { dump("-*- NetworkPoliciesDB: " + s + "\n"); }
} else {
  debug = function (s) {}
}

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/IndexedDBHelper.jsm");

const DB_NAME = "net_policies";
const DB_VERSION = 1;
const STORE_NAME = "net_policies";

function NetworkPoliciesDB(aGlobal) {
  debug("Constructor");
}

NetworkPoliciesDB.prototype = {
  __proto__: IndexedDBHelper.prototype,

  upgradeSchema: function upgradeSchema(aTransaction, aDb, aOldVersion, aNewVersion) {
    debug("upgrade schema from: " + aOldVersion + " to " + aNewVersion + " called!");
    let db = aDb;
    let objectStore;
    for (let currVersion = aOldVersion; currVersion < aNewVersion; currVersion++) {
      if (currVersion == 0) {
        /**
         * Create the initial database schema.
         */
        objectStore = db.createObjectStore(STORE_NAME, { keyPath: "app" });

        objectStore.createIndex("app",                "app",                   { unique: true });
        objectStore.createIndex("allowNetworkAccess", "allowNetworkAccess",    { unique: false });

        objectStore.createIndex("policies",           "policies",              { unique: false, multiEntry: true });

        debug("Created object stores and indexes");
      }
    }
  },

  makeImport: function makeImport(aPolicy) {
    let policy = {
      app:                 aPolicy.app,
      allowNetworkAccess:  aPolicy.allowNetworkAccess,
      policies:            aPolicy.policies,
    }
    return policy;
  },

  addPolicy: function addPolicy(aPolicy, successCb, errorCb) {
    let policy = this.makeImport(aPolicy);

    this.newTxn("readwrite", function(txn, store) {
      debug("Going to store " + JSON.stringify(policy));

      if (!txn.result)
        txn.result = {};

      store.put(policy).onsuccess = function(event){
        txn.result = policy;
      }

    }.bind(this), successCb, errorCb);
  },

  clearPolicies: function clearPolicies(aSuccessCb, aErrorCb) {
    this.newTxn("readwrite", function (txn, store) {
      debug("Going to clear all!");
      store.clear();
    }, aSuccessCb, aErrorCb);
  },

  findPolicy: function findPolicy(aAppId, aSuccessCb, aFailureCb) {
    debug("Find: application:" + aAppId);

    this.newTxn("readonly", function (txn, store) {
      if (!txn.result)
        txn.result = {};

      store.get(aAppId).onsuccess = function onsuccess(event){
        txn.result = event.target.result;
      }.bind(this);

    }.bind(this), aSuccessCb, aFailureCb);
  },

  deletePolicy: function deletePolicy(aAppId, aSuccessCb, aFailureCb) {
    debug("Delete: application:" + aAppId);

    this.newTxn("readwrite", function (txn, store) {
      if (!txn.result)
        txn.result = {};

      store.delete(aAppId).onsuccess = function onsuccess(event){
        txn.result = aAppId;
      }.bind(this);

    }.bind(this), aSuccessCb, aFailureCb);
  },

  init: function init(aGlobal) {
      this.initDBHelper(DB_NAME, DB_VERSION, STORE_NAME, aGlobal);
  }
};


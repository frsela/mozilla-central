/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// set to true to see debug messages
const DEBUG = false;

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

const EXPORTED_SYMBOLS = ['NetworkPoliciesDB'];

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

  dbNewTxn: function dbNewTxn(txn_type, callback, txnCb) {
    function successCb(result) {
      txnCb(true, result);
    }
    function errorCb(error) {
      txnCb(false, error);
    }
    return this.newTxn(txn_type, callback, successCb, errorCb);
  },

  upgradeSchema: function upgradeSchema(aTransaction, aDb, aOldVersion,
                                        aNewVersion) {
    debug("upgrade schema from: " + aOldVersion + " to " + aNewVersion);
    let db = aDb;
    let objectStore;
    for (let currVersion = aOldVersion; currVersion < aNewVersion; currVersion++) {
      if (currVersion == 0) {
        /**
         * Create the initial database schema.
         */
        objectStore = db.createObjectStore(STORE_NAME, { keyPath: "app" });

        objectStore.createIndex("app",
                                "app",
                                { unique: true }
                    );
        objectStore.createIndex("allowNetworkAccess",
                                "allowNetworkAccess",
                                { unique: false }
                    );
        objectStore.createIndex("policies",
                                "policies",
                                { unique: false, multiEntry: true }
                    );
        debug("Created object stores and indexes");
      }
    }
  },

  makeImport: function makeImport(aPolicy) {
    if (aPolicy.app == null ||
        aPolicy.allowNetworkAccess == null ||
        aPolicy.policies == null
    ) {
      return null;
    }
    let policy = {
      app:                 aPolicy.app,
      allowNetworkAccess:  aPolicy.allowNetworkAccess,
      policies:            aPolicy.policies,
    }
    return policy;
  },

  addPolicy: function addPolicy(aPolicy, resultCb) {
    let policy = this.makeImport(aPolicy);
    if (policy == null) {
      errorCb("Policy definition error");
      return;
    }

    this.dbNewTxn("readwrite", function(txn, store) {
      debug("Going to store " + JSON.stringify(policy));

      if (!txn.result) {
        txn.result = {};
      }

      store.put(policy).onsuccess = function(event){
        txn.result = policy;
      }

    }.bind(this), resultCb);
  },

  clearPolicies: function clearPolicies(resultCb) {
    this.dbNewTxn("readwrite", function (txn, store) {
      debug("Going to clear all!");
      store.clear();
    }, resultCb);
  },

  findPolicy: function findPolicy(aAppId, resultCb) {
    debug("Find: application:" + aAppId);

    this.dbNewTxn("readonly", function (txn, store) {
      if (!txn.result) {
        txn.result = {};
      }

      store.get(aAppId).onsuccess = function onsuccess(event){
        txn.result = event.target.result;
      }.bind(this);

    }.bind(this), resultCb);
  },

  deletePolicy: function deletePolicy(aAppId, resultCb) {
    debug("Delete: application:" + aAppId);

    this.dbNewTxn("readwrite", function (txn, store) {
      if (!txn.result) {
        txn.result = {};
      }

      store.delete(aAppId).onsuccess = function onsuccess(event){
        txn.result = aAppId;
      }.bind(this);

    }.bind(this), resultCb);
  },

  getAllPolicies: function getAllPolicies(resultCb) {
    debug("getAllPolicies");

    this.dbNewTxn("readonly", function (txn, store) {
      if (!txn.result) {
        txn.result = [];
      }

      store.mozGetAll().onsuccess = function onsuccess(event) {
        txn.result = event.target.result;
        debug("getAllPolicies - request successful. Record count: " +
              txn.result.length + " = " + JSON.stringify(txn.result)
             );
      }
    }, resultCb);
  },

  init: function init(aGlobal) {
      this.initDBHelper(DB_NAME, DB_VERSION, STORE_NAME, aGlobal);
  }
};

let debug;
if (DEBUG) {
  debug = function (s) {
    dump("-*- NetworkPoliciesDB: " + s + "\n");
  };
} else {
  debug = function (s) {};
}

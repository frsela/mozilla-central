/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/*
 * Tests the persistence of the "disable protection" option for Mixed Content
 * Blocker in child tabs (bug 906190).
 */

requestLongerTimeout(2);

// We use the different urls for testing same origin checks before allowing
// mixed content on child tabs.
const gHttpTestRoot1 = "https://test1.example.com/browser/browser/base/content/test/general/";
const gHttpTestRoot2 = "https://test2.example.com/browser/browser/base/content/test/general/";

/**
 * For all tests, we load the pages over HTTPS and test both:
 *   - |CTRL+CLICK|
 *   - |RIGHT CLICK -> OPEN LINK IN TAB|
 */
function* doTest(parentTabSpec, childTabSpec, testTaskFn, waitForMetaRefresh) {
  yield BrowserTestUtils.withNewTab({
    gBrowser,
    url: parentTabSpec,
  }, function* (browser) {
    // As a sanity check, test that active content has been blocked as expected.
    yield assertMixedContentBlockingState(gBrowser, {
      activeLoaded: false, activeBlocked: true, passiveLoaded: false,
    });

    // Disable the Mixed Content Blocker for the page, which reloads it.
    let promiseReloaded = BrowserTestUtils.browserLoaded(browser);
    gIdentityHandler.disableMixedContentProtection();
    yield promiseReloaded;

    // Wait for the script in the page to update the contents of the test div.
    let testDiv = content.document.getElementById('mctestdiv');
    yield promiseWaitForCondition(
      () => testDiv.innerHTML == "Mixed Content Blocker disabled");

    // Add the link for the child tab to the page.
    let mainDiv = content.document.createElement("div");
    mainDiv.innerHTML =
      '<p><a id="linkToOpenInNewTab" href="' + childTabSpec + '">Link</a></p>';
    content.document.body.appendChild(mainDiv);

    // Execute the test in the child tabs with the two methods to open it.
    for (let openFn of [simulateCtrlClick, simulateContextMenuOpenInTab]) {
      let promiseTabLoaded = waitForSomeTabToLoad();
      openFn(browser);
      yield promiseTabLoaded;
      gBrowser.selectTabAtIndex(2);

      if (waitForMetaRefresh) {
        yield waitForSomeTabToLoad();
      }

      yield testTaskFn();

      gBrowser.removeCurrentTab();
    }
  });
}

function simulateCtrlClick(browser) {
  BrowserTestUtils.synthesizeMouseAtCenter("#linkToOpenInNewTab",
                                           { ctrlKey: true, metaKey: true },
                                           browser);
}

function simulateContextMenuOpenInTab(browser) {
  BrowserTestUtils.waitForEvent(document, "popupshown", false, event => {
    // These are operations that must be executed synchronously with the event.
    document.getElementById("context-openlinkintab").doCommand();
    event.target.hidePopup();
    return true;
  });
  BrowserTestUtils.synthesizeMouseAtCenter("#linkToOpenInNewTab",
                                           { type: "contextmenu", button: 2 },
                                           browser);
}

// Waits for a load event somewhere in the browser but ignore events coming
// from <xul:browser>s without a tab assigned. That are most likely browsers
// that preload the new tab page.
function waitForSomeTabToLoad() {
  return new Promise(resolve => {
    gBrowser.addEventListener("load", function onLoad(event) {
      let tab = gBrowser._getTabForContentWindow(event.target.defaultView.top);
      if (tab) {
        gBrowser.removeEventListener("load", onLoad, true);
        resolve();
      }
    }, true);
  });
}

/**
 * Ensure the Mixed Content Blocker is enabled.
 */
add_task(function* test_initialize() {
  yield new Promise(resolve => SpecialPowers.pushPrefEnv({
    "set": [["security.mixed_content.block_active_content", true]],
  }, resolve));
});

/**
 * 1. - Load a html page which has mixed content
 *    - Doorhanger to disable protection appears - we disable it
 *    - Load a subpage from the same origin in a new tab simulating a click
 *    - Doorhanger should >> NOT << appear anymore!
 */
add_task(function* test_same_origin() {
  yield doTest(gHttpTestRoot1 + "file_bug906190_1.html",
               gHttpTestRoot1 + "file_bug906190_2.html", function* () {
    // The doorhanger should appear but activeBlocked should be >> NOT << true,
    // because our decision of disabling the mixed content blocker is persistent
    // across tabs.
    yield assertMixedContentBlockingState(gBrowser, {
      activeLoaded: true, activeBlocked: false, passiveLoaded: false,
    });

    is(content.document.getElementById('mctestdiv').innerHTML,
       "Mixed Content Blocker disabled", "OK: Executed mixed script");
  });
});

/**
 * 2. - Load a html page which has mixed content
 *    - Doorhanger to disable protection appears - we disable it
 *    - Load a new page from a different origin in a new tab simulating a click
 *    - Doorhanger >> SHOULD << appear again!
 */
add_task(function* test_different_origin() {
  yield doTest(gHttpTestRoot1 + "file_bug906190_2.html",
               gHttpTestRoot2 + "file_bug906190_2.html", function* () {
    // The doorhanger should appear and activeBlocked should be >> TRUE <<,
    // because our decision of disabling the mixed content blocker should only
    // persist if pages are from the same domain.
    yield assertMixedContentBlockingState(gBrowser, {
      activeLoaded: false, activeBlocked: true, passiveLoaded: false,
    });

    is(content.document.getElementById('mctestdiv').innerHTML,
       "Mixed Content Blocker enabled", "OK: Blocked mixed script");
  });
});

/**
 * 3. - Load a html page which has mixed content
 *    - Doorhanger to disable protection appears - we disable it
 *    - Load a new page from the same origin in a new tab simulating a click
 *    - Redirect to another page from the same origin using meta-refresh
 *    - Doorhanger should >> NOT << appear again!
 */
add_task(function* test_same_origin_metarefresh_same_origin() {
  // file_bug906190_3_4.html redirects to page test1.example.com/* using meta-refresh
  yield doTest(gHttpTestRoot1 + "file_bug906190_1.html",
               gHttpTestRoot1 + "file_bug906190_3_4.html", function* () {
    // The doorhanger should appear but activeBlocked should be >> NOT << true!
    yield assertMixedContentBlockingState(gBrowser, {
      activeLoaded: true, activeBlocked: false, passiveLoaded: false,
    });

    is(content.document.getElementById('mctestdiv').innerHTML,
       "Mixed Content Blocker disabled", "OK: Executed mixed script");
  }, true);
});

/**
 * 4. - Load a html page which has mixed content
 *    - Doorhanger to disable protection appears - we disable it
 *    - Load a new page from the same origin in a new tab simulating a click
 *    - Redirect to another page from a different origin using meta-refresh
 *    - Doorhanger >> SHOULD << appear again!
 */
add_task(function* test_same_origin_metarefresh_different_origin() {
  yield doTest(gHttpTestRoot2 + "file_bug906190_1.html",
               gHttpTestRoot2 + "file_bug906190_3_4.html", function* () {
    // The doorhanger should appear and activeBlocked should be >> TRUE <<.
    yield assertMixedContentBlockingState(gBrowser, {
      activeLoaded: false, activeBlocked: true, passiveLoaded: false,
    });

    is(content.document.getElementById('mctestdiv').innerHTML,
       "Mixed Content Blocker enabled", "OK: Blocked mixed script");
  }, true);
});

/**
 * 5. - Load a html page which has mixed content
 *    - Doorhanger to disable protection appears - we disable it
 *    - Load a new page from the same origin in a new tab simulating a click
 *    - Redirect to another page from the same origin using 302 redirect
 */
add_task(function* test_same_origin_302redirect_same_origin() {
  // the sjs files returns a 302 redirect- note, same origins
  yield doTest(gHttpTestRoot1 + "file_bug906190_1.html",
               gHttpTestRoot1 + "file_bug906190.sjs", function* () {
    // The doorhanger should appear but activeBlocked should be >> NOT << true.
    // Currently it is >> TRUE << - see follow up bug 914860
    ok(!gIdentityHandler._identityBox.classList.contains("mixedActiveBlocked"),
       "OK: Mixed Content is NOT being blocked");

    is(content.document.getElementById('mctestdiv').innerHTML,
       "Mixed Content Blocker disabled", "OK: Executed mixed script");
  });
});

/**
 * 6. - Load a html page which has mixed content
 *    - Doorhanger to disable protection appears - we disable it
 *    - Load a new page from the same origin in a new tab simulating a click
 *    - Redirect to another page from a different origin using 302 redirect
 */
add_task(function* test_same_origin_302redirect_different_origin() {
  // the sjs files returns a 302 redirect - note, different origins
  yield doTest(gHttpTestRoot2 + "file_bug906190_1.html",
               gHttpTestRoot2 + "file_bug906190.sjs", function* () {
    // The doorhanger should appear and activeBlocked should be >> TRUE <<.
    yield assertMixedContentBlockingState(gBrowser, {
      activeLoaded: false, activeBlocked: true, passiveLoaded: false,
    });

    is(content.document.getElementById('mctestdiv').innerHTML,
       "Mixed Content Blocker enabled", "OK: Blocked mixed script");
  });
});

/**
 * 7. - Test memory leak issue on redirection error. See Bug 1269426.
 */
add_task(function* test_bad_redirection() {
  // the sjs files returns a 302 redirect - note, different origins
  yield doTest(gHttpTestRoot2 + "file_bug906190_1.html",
               gHttpTestRoot2 + "file_bug906190.sjs?bad-redirection=1", function* () {
    // Nothing to do. Just see if memory leak is reported in the end.
    ok(true, "Nothing to do");
  });
});

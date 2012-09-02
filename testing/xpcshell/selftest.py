#!/usr/bin/env python
#
# Any copyright is dedicated to the Public Domain.
# http://creativecommons.org/publicdomain/zero/1.0/
#

from __future__ import with_statement
import sys, os, unittest, tempfile, shutil
from StringIO import StringIO
from xml.etree.ElementTree import ElementTree

from runxpcshelltests import XPCShellTests

objdir = os.path.abspath(os.environ["OBJDIR"])
xpcshellBin = os.path.join(objdir, "dist", "bin", "xpcshell")
if sys.platform == "win32":
    xpcshellBin += ".exe"

SIMPLE_PASSING_TEST = "function run_test() { do_check_true(true); }"
SIMPLE_FAILING_TEST = "function run_test() { do_check_true(false); }"

class XPCShellTestsTests(unittest.TestCase):
    """
    Yes, these are unit tests for a unit test harness.
    """
    def setUp(self):
        self.log = StringIO()
        self.tempdir = tempfile.mkdtemp()
        self.x = XPCShellTests(log=self.log)

    def tearDown(self):
        shutil.rmtree(self.tempdir)

    def writeFile(self, name, contents):
        """
        Write |contents| to a file named |name| in the temp directory,
        and return the full path to the file.
        """
        fullpath = os.path.join(self.tempdir, name)
        with open(fullpath, "w") as f:
            f.write(contents)
        return fullpath

    def writeManifest(self, tests):
        """
        Write an xpcshell.ini in the temp directory and set
        self.manifest to its pathname. |tests| is a list containing
        either strings (for test names), or tuples with a test name
        as the first element and manifest conditions as the following
        elements.
        """
        testlines = []
        for t in tests:
            testlines.append("[%s]" % (t if isinstance(t, basestring)
                                       else t[0]))
            if isinstance(t, tuple):
                testlines.extend(t[1:])
        self.manifest = self.writeFile("xpcshell.ini", """
[DEFAULT]
head =
tail =

""" + "\n".join(testlines))

    def prepareWebsocket(self):
        import shutil

        mochitest = os.path.join(os.path.dirname(__file__),
                                 os.path.pardir,
                                 'mochitest')

        # copy pywebsocket_wrapper.py
        pywebsocket_wrapper = os.path.join(mochitest,
                                           'pywebsocket_wrapper.py')
        mochitest_dst = os.path.join(self.tempdir, 'pywebsocket_wrapper.py')
        shutil.copyfile(pywebsocket_wrapper, mochitest_dst)

        # copy pywebsocket/
        pywebsocket = os.path.join(mochitest, 'pywebsocket')
        pywebsocket_dst = os.path.join(self.tempdir, 'pywebsocket')
        shutil.copytree(pywebsocket, pywebsocket_dst)
        pass

    def assertTestResult(self, expected, shuffle=False, xunitFilename=None):
        """
        Assert that self.x.runTests with manifest=self.manifest
        returns |expected|.
        """
        self.assertEquals(expected,
                          self.x.runTests(xpcshellBin,
                                          manifest=self.manifest,
                                          mozInfo={},
                                          shuffle=shuffle,
                                          testsRootDir=self.tempdir,
                                          xunitFilename=xunitFilename),
                          msg="""Tests should have %s, log:
========
%s
========
""" % ("passed" if expected else "failed", self.log.getvalue()))

    def _assertLog(self, s, expected):
        l = self.log.getvalue()
        self.assertEqual(expected, s in l,
                         msg="""Value %s %s in log:
========
%s
========""" % (s, "expected" if expected else "not expected", l))

    def assertInLog(self, s):
        """
        Assert that the string |s| is contained in self.log.
        """
        self._assertLog(s, True)

    def assertNotInLog(self, s):
        """
        Assert that the string |s| is not contained in self.log.
        """
        self._assertLog(s, False)

    def testPass(self):
        """
        Check that a simple test without any manifest conditions passes.
        """
        self.writeFile("test_basic.js", SIMPLE_PASSING_TEST)
        self.writeManifest(["test_basic.js"])

        self.assertTestResult(True)
        self.assertEquals(1, self.x.testCount)
        self.assertEquals(1, self.x.passCount)
        self.assertEquals(0, self.x.failCount)
        self.assertEquals(0, self.x.todoCount)
        self.assertInLog("TEST-PASS")
        self.assertNotInLog("TEST-UNEXPECTED-FAIL")

    def testFail(self):
        """
        Check that a simple failing test without any manifest conditions fails.
        """
        self.writeFile("test_basic.js", SIMPLE_FAILING_TEST)
        self.writeManifest(["test_basic.js"])

        self.assertTestResult(False)
        self.assertEquals(1, self.x.testCount)
        self.assertEquals(0, self.x.passCount)
        self.assertEquals(1, self.x.failCount)
        self.assertEquals(0, self.x.todoCount)
        self.assertInLog("TEST-UNEXPECTED-FAIL")
        self.assertNotInLog("TEST-PASS")

    def testPassFail(self):
        """
        Check that running more than one test works.
        """
        self.writeFile("test_pass.js", SIMPLE_PASSING_TEST)
        self.writeFile("test_fail.js", SIMPLE_FAILING_TEST)
        self.writeManifest(["test_pass.js", "test_fail.js"])

        self.assertTestResult(False)
        self.assertEquals(2, self.x.testCount)
        self.assertEquals(1, self.x.passCount)
        self.assertEquals(1, self.x.failCount)
        self.assertEquals(0, self.x.todoCount)
        self.assertInLog("TEST-PASS")
        self.assertInLog("TEST-UNEXPECTED-FAIL")

    def testSkip(self):
        """
        Check that a simple failing test skipped in the manifest does
        not cause failure.
        """
        self.writeFile("test_basic.js", SIMPLE_FAILING_TEST)
        self.writeManifest([("test_basic.js", "skip-if = true")])
        self.assertTestResult(True)
        self.assertEquals(1, self.x.testCount)
        self.assertEquals(0, self.x.passCount)
        self.assertEquals(0, self.x.failCount)
        self.assertEquals(0, self.x.todoCount)
        self.assertNotInLog("TEST-UNEXPECTED-FAIL")
        self.assertNotInLog("TEST-PASS")

    def testKnownFail(self):
        """
        Check that a simple failing test marked as known-fail in the manifest
        does not cause failure.
        """
        self.writeFile("test_basic.js", SIMPLE_FAILING_TEST)
        self.writeManifest([("test_basic.js", "fail-if = true")])
        self.assertTestResult(True)
        self.assertEquals(1, self.x.testCount)
        self.assertEquals(0, self.x.passCount)
        self.assertEquals(0, self.x.failCount)
        self.assertEquals(1, self.x.todoCount)
        self.assertInLog("TEST-KNOWN-FAIL")
        # This should be suppressed because the harness doesn't include
        # the full log from the xpcshell run when things pass.
        self.assertNotInLog("TEST-UNEXPECTED-FAIL")
        self.assertNotInLog("TEST-PASS")

    def testUnexpectedPass(self):
        """
        Check that a simple failing test marked as known-fail in the manifest
        that passes causes an unexpected pass.
        """
        self.writeFile("test_basic.js", SIMPLE_PASSING_TEST)
        self.writeManifest([("test_basic.js", "fail-if = true")])
        self.assertTestResult(False)
        self.assertEquals(1, self.x.testCount)
        self.assertEquals(0, self.x.passCount)
        self.assertEquals(1, self.x.failCount)
        self.assertEquals(0, self.x.todoCount)
        # From the outer (Python) harness
        self.assertInLog("TEST-UNEXPECTED-PASS")
        self.assertNotInLog("TEST-KNOWN-FAIL")
        # From the inner (JS) harness
        self.assertInLog("TEST-PASS")

    def testReturnNonzero(self):
        """
        Check that a test where xpcshell returns nonzero fails.
        """
        self.writeFile("test_error.js", "throw 'foo'")
        self.writeManifest(["test_error.js"])

        self.assertTestResult(False)
        self.assertEquals(1, self.x.testCount)
        self.assertEquals(0, self.x.passCount)
        self.assertEquals(1, self.x.failCount)
        self.assertEquals(0, self.x.todoCount)
        self.assertInLog("TEST-UNEXPECTED-FAIL")
        self.assertNotInLog("TEST-PASS")

    def testMissingHeadFile(self):
        """
        Ensure that missing head file results in fatal error.
        """
        self.writeFile("test_basic.js", SIMPLE_PASSING_TEST)
        self.writeManifest([("test_basic.js", "head = missing.js")])

        raised = False

        try:
            # The actual return value is never checked because we raise.
            self.assertTestResult(True)
        except Exception, ex:
            raised = True
            self.assertEquals(ex.message[0:9], "head file")

        self.assertTrue(raised)

    def testMissingTailFile(self):
        """
        Ensure that missing tail file results in fatal error.
        """
        self.writeFile("test_basic.js", SIMPLE_PASSING_TEST)
        self.writeManifest([("test_basic.js", "tail = missing.js")])

        raised = False

        try:
            self.assertTestResult(True)
        except Exception, ex:
            raised = True
            self.assertEquals(ex.message[0:9], "tail file")

        self.assertTrue(raised)

    def testRandomExecution(self):
        """
        Check that random execution doesn't break.
        """
        manifest = []
        for i in range(0, 10):
            filename = "test_pass_%d.js" % i
            self.writeFile(filename, SIMPLE_PASSING_TEST)
            manifest.append(filename)

        self.writeManifest(manifest)
        self.assertTestResult(True, shuffle=True)
        self.assertEquals(10, self.x.testCount)
        self.assertEquals(10, self.x.passCount)

    def testXunitOutput(self):
        """
        Check that Xunit XML files are written.
        """
        self.writeFile("test_00.js", SIMPLE_PASSING_TEST)
        self.writeFile("test_01.js", SIMPLE_FAILING_TEST)
        self.writeFile("test_02.js", SIMPLE_PASSING_TEST)

        manifest = [
            "test_00.js",
            "test_01.js",
            ("test_02.js", "skip-if = true")
        ]

        self.writeManifest(manifest)

        filename = os.path.join(self.tempdir, "xunit.xml")

        self.assertTestResult(False, xunitFilename=filename)

        self.assertTrue(os.path.exists(filename))
        self.assertTrue(os.path.getsize(filename) > 0)

        tree = ElementTree()
        tree.parse(filename)
        suite = tree.getroot()

        self.assertTrue(suite is not None)
        self.assertEqual(suite.get("tests"), "3")
        self.assertEqual(suite.get("failures"), "1")
        self.assertEqual(suite.get("skip"), "1")

        testcases = suite.findall("testcase")
        self.assertEqual(len(testcases), 3)

        for testcase in testcases:
            attributes = testcase.keys()
            self.assertTrue("classname" in attributes)
            self.assertTrue("name" in attributes)
            self.assertTrue("time" in attributes)

        self.assertTrue(testcases[1].find("failure") is not None)
        self.assertTrue(testcases[2].find("skipped") is not None)

    def testWebsocket(self):
        self.prepareWebsocket()

        manifest = [("test_websocket.js", "websocket =", "")]
        self.writeManifest(manifest)

        self.writeFile("file_websocket_test_wsh.py", '''
def web_socket_do_extra_handshake(request):
  request.ws_protocol = request.ws_requested_protocols[0]

  if (request.ws_protocol == 'error'):
      raise ValueError('Error')
  pass
def web_socket_transfer_data(req):
  pass
''')

        self.writeFile("test_websocket.js",
                       '''
const {classes: Cc,
       interfaces: Ci,
       utils: Cu,
       results: Cr,
       Constructor: CC} = Components;

const kWS_CONTRACTID = "@mozilla.org/network/protocol;1?name=ws";
const kWS_URL = "ws://localhost:9988/file_websocket_test";

function createWS(listener) {
  ws = Cc[kWS_CONTRACTID].createInstance(Ci.nsIWebSocketChannel);
  let uri = Cc["@mozilla.org/network/standard-url;1"].
    createInstance(Ci.nsIURI);
  uri.spec = kWS_URL;

  ws.protocol = "test";
  ws.asyncOpen(uri, kWS_URL, listener, null);
}

let make_sure_websocket_connected = {
  onStart: function onStart(context) {
    do_test_finished();
  },
  onStop: function onStop(context, status) {
    if (status) do_throw("connecting error");
    do_test_finished();
  },
  onMessageAvailable: function (context, msg) {},
  onBinaryMessageAvailable: function (contxt, msg) {},
  onAcknowledge: function (context, size) {},
  onServerClose: function (context, code, reason) {}
};

function run_test() {
  do_test_pending();
  let ws = createWS(make_sure_websocket_connected);
}
''')

        self.assertTestResult(True)
        self.assertEquals(self.x.testCount, 1)
        self.assertEquals(self.x.passCount, 1)
        pass

if __name__ == "__main__":
    unittest.main()

# -*- tab-width: 4; indent-tabs-mode: nil; py-indent-offset: 4 -*-
# vim: set sw=4 ts=4 autoindent cindent expandtab:

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this file,
# You can obtain one at http://mozilla.org/MPL/2.0/.

from mozprocess.processhandler import ProcessHandlerMixin
import sys
import os
import logging

class ProcessHandlerLogger(ProcessHandlerMixin):
    '''Pass the output of child process to a logging.Logger.

    It call Logger.info() for every line from the output of child process.
    '''

    def __init__(self, cmd, log, env):
        assert isinstance(log, logging.Logger)

        outputLine = [lambda line: log.info('%s', line)]
        super(ProcessHandlerLogger, self).__init__(cmd,
                                             env=env,
                                             processOutputLine=outputLine)
        pass
    pass


class WebSocketServer(object):
    "Class which encapsulates the mod_pywebsocket server"

    def __init__(self, port, scriptdir, env, log, interactive):
        self.port = port
        self._scriptdir = scriptdir
        self.env = env
        self.log = log
        self.interactive = interactive
        pass

    def start(self):
        # Invoke pywebsocket through a wrapper which adds special
        # SIGINT handling.
        #
        # If we're in an interactive debugger, the wrapper causes the
        # server to ignore SIGINT so the server doesn't capture a
        # ctrl+c meant for the debugger.
        #
        # If we're not in an interactive debugger, the wrapper causes
        # the server to die silently upon receiving a SIGINT.
        scriptPath = 'pywebsocket_wrapper.py'
        script = os.path.join(self._scriptdir, scriptPath)

        cmd = [sys.executable, script]
        if self.interactive:
            cmd.append('--interactive')
            pass
        cmd.extend(['-p', str(self.port), '-w', self._scriptdir])
        cmd.extend(['-l', os.path.join(self._scriptdir, "websock.log")])
        cmd.extend(['--log-level=debug', '--allow-handlers-outside-root-dir'])

        self._process = ProcessHandlerLogger(cmd, self.log, self.env)
        self._process.run()
        pid = self._process.pid
        self.log.info("INFO | runtests.py | Websocket server pid: %d", pid)
        pass

    def stop(self):
        self._process.kill()
        self._process = None
        pass

    def __del__(self):
        if self._process:
            self._process.kill()
            pass
        pass
    pass

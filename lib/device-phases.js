/*
  Copyright 2015 Google Inc. All Rights Reserved.
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
      http://www.apache.org/licenses/LICENSE-2.0
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var spawn = require('child_process').spawn;
var exec = Promise.promisify(require('child_process').exec);
var http = require('http');
var path = require('path');
var expandHomeDir = require('expand-home-dir');

var StringDecoder = require('string_decoder').StringDecoder;

var types = require('../core/types');
var options = require('../core/options');

var phase = require('../core/register').phase;

function expandPath(p) {
  return path.resolve(expandHomeDir(path.normalize(p)));
}

// update PYTHONPATH for all telemetry invocations
if (options.chromium !== undefined) {
  chromium_path = expandPath(options.chromium);
  console.log("chromium path=%s", chromium_path);
  process.env.PYTHONPATH += path.delimiter + chromium_path + '/tools/perf';
  process.env.PYTHONPATH += path.delimiter + chromium_path + '/tools/telemetry';
  process.env.PYTHONPATH += path.delimiter + chromium_path + '/tools';
}

function telemetryTask(pyScript, pyArgs) {
  return getBrowser().then(function(resolveLock) {
    return _telemetryTask(pyScript, pyArgs).then(function(result) {
      resolveLock();
      return result;
    });
  });
}

function _telemetryTask(pyScript, pyArgs) {
  return new Promise(function(resolve, reject) {
    var result = "";
    pyScript = path.join(__dirname, '../telemetry/' + pyScript);
    var task = spawn('python', [pyScript].concat(pyArgs));
    task.stdout.on('data', function(data) { result += data; });
    task.stderr.on('data', function(data) { console.log('stderr: ' + data); });
    task.on('close', function(code) {
      resolve(JSON.parse(result))
    });
  });
}

function BrowserWrapper(url, options, resolve) {
  console.log(options);
  var cmd = ['telemetry/newBrowser.py', '--browser=' + options.browser, '--chromium', chromium_path];
  if (options.perf) {
    cmd.push('--perf');
  }
  cmd.push('--', '--disable-web-security' );
  this.task = spawn('python', cmd);
  this.url = url;
  this.data = undefined;
  this.processResult = this.defaultProcessResult;
  this.task.stdout.on('data', function(data) { this.processResult(data); }.bind(this) );
  this.task.stderr.on('data', function(data) { console.log('stderr: ' + data); });
  this.task.on('close', function(code) { resolve(); });
}

BrowserWrapper.prototype = {
  waitForOK: function() {
    var promise = new Promise(function(resolve, reject) {
      this.processResult = function(data) {
        data = new StringDecoder('utf8').write(data);
        if (data == 'OK') {
          resolve(this);
        } else {
          reject();
        }
        this.processResult = this.defaultProcessResult;
      }
    }.bind(this));
    return promise;
  },
  waitForData: function() {
    var promise = new Promise(function(resolve, reject) {
      this.processResult = function(data) {
        filename = new StringDecoder('utf8').write(data).trim();
        return fs.readFileAsync(filename).then(function (data) {
          this.task.stdin.write('done\n');
          this.data = data;
          resolve(this);
        }.bind(this));
      }
    }.bind(this));
    return promise;
  },
  defaultProcessResult: function() { },
  load: function() {
    this.task.stdin.write("load:" + this.url + '\n');
    return this.waitForOK();
  },
  startTracing: function(options) {
    var cmd = 'startTracing';
    if (options.filter !== "")
      cmd += ' filter:' + options.filter;
    cmd += '\n';
    this.task.stdin.write(cmd);
    return this.waitForOK();
  },
  endTracing: function() {
    this.task.stdin.write('endTracing\n');
    return this.waitForData();
  },
  close: function() {
    this.task.stdin.write('exit\n');
    return this.data == undefined ? this.url : this.data;
  },
  execJS: function(js) {
    js = '(' + js + ')()';
    this.task.stdin.write('exec:' + js.length + '\n');
    this.task.stdin.write(js);
    return this.waitForData();
  }
}

var browserLock = Promise.resolve();

/*
 * resolveStart fires when the lock is acquired, while resolveEnd fires when
 * it is released. So this method's returned promise gates on lock acquisition,
 * but the new browserLock that this method installs gates on lock release.
 */
function getBrowser() {
  return new Promise(function(resolveStart) {
    var newBrowserLock = new Promise(function(resolveEnd) {
      browserLock.then(function() {
        resolveStart(resolveEnd);
      });
    });
    browserLock = newBrowserLock;
  });
}

function adbPath() {
  var adb = options.adb || 'adb';
  return expandPath(adb);
}

function startADBForwarding(browser) {
  if (browser == 'system')
    return Promise.resolve();
  return exec(adbPath() + ' reverse tcp:8000 tcp:8000');
}

function stopADBForwarding(browser) {
  if (browser == 'system')
    return Promise.resolve();
  return exec(adbPath() + ' reverse --remove tcp:8000');
}

function startServing(data) {
  return http.createServer(function(req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(data);
  }).listen(8000, '127.0.0.1');
}

function stopServing(server) {
  server.close();
}

function hostedTelemetryTask(data, pyScript, pyArgs, options) {
  return getBrowser().then(function(resolveLock) {
    return startADBForwarding(options.browser).then(function() {
      var server = startServing(data);
      return _telemetryTask(pyScript, pyArgs).then(function(outData) {
        stopServing(server);
        return stopADBForwarding(options.browser).then(function() {
          resolveLock();
          return Promise.resolve(outData);
        });
      });
    });
  });
}

module.exports.fetch = phase({input: types.string, output: types.JSON, arity: '1:1', async: true, parallel: 1},
  function(url) {
    return telemetryTask('save.py', ['--browser=' + this.options.browser, '--', url]);
  },
  {browser: 'system'});

module.exports.fetchWithInlineStyle = phase({input: types.string, output: types.JSON, arity: '1:1', async: true, parallel: 1},
  function(url) {
    return telemetryTask('save-no-style.py', ['--browser=' + this.options.browser, '--', url]);
  },
  {browser: 'system'});

module.exports.traceURL = phase({input: types.string, output: types.JSON, arity: "1:1", async: true, parallel: 1},
  function(url) {
    return telemetryTask('perf.py', ['--browser=' + this.options.browser, '--', url]);
  },
  {browser: 'system'});

module.exports.trace = phase({input: types.string, output: types.JSON, arity: "1:1", async: true, parallel: 1},
    function(html) {
      return hostedTelemetryTask(html, 'perf.py', ['--browser=' + this.options.browser, '--', 'http://localhost:8000'], this.options);
    },
    {browser: 'system'});

module.exports.traceStyle = phase({input: types.string, output: types.JSON, arity: "1:1", async: true, parallel: 1},
    function(html) {
      return hostedTelemetryTask(html, 'style-perf.py', ['--browser=' + this.options.browser, '--', 'http://localhost:8000'], this.options);
    },
    {browser: 'system'}); 

module.exports.traceLayout = phase({input: types.string, output: types.JSON, arity: "1:1", async: true, parallel: 1},
    function(html) {
      return hostedTelemetryTask(html, 'layout-perf.py', ['--browser=' + this.options.browser, '--', 'http://localhost:8000'], this.options);
    },
    {browser: 'system'});

module.exports.browser = phase({input: types.string, output: types.Browser(types.string), arity: "1:1", async: true},
    function(url) {
      var options = this.options;
      return getBrowser().then(function(resolveEnd) {
        return new BrowserWrapper(url, options, resolveEnd);
      });
    },
    {browser: 'android-chromium', perf: false});

function typeVar(s) { return function(v) {
  if (!v[s]) {
    v[s] = types.newTypeVar();
  }
  return v[s];
}; }

function browserTypeVar(s) {
  return function(v) {
    return types.Browser(typeVar(s)(v));
  }; }

module.exports.closeBrowser = phase({input: browserTypeVar('a'), output: typeVar('a'), arity: "1:1"},
    function(browser) {
      return browser.close();
    });

var browserCommands = [{name: 'load', input: types.string, output: types.string},
                       {name: 'startTracing', input: types.string, output: types.string,
                          options: {'filter': ""}},
                       {name: 'endTracing', input: types.string, output: types.buffer}];
for (var i = 0; i < browserCommands.length; i++) {
  var cmd = browserCommands[i];
  options = cmd.options || {};
  (function(cmd) {
    module.exports[cmd.name] = phase({input: types.Browser(cmd.input), output: types.Browser(cmd.output), arity: "1:1", async: true, parallel: 1},
      function(browser) {
        return browser[cmd.name](this.options);
    }, options);
  })(cmd);
}


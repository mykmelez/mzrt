#!/usr/bin/env node

/* Copyright 2017 Mozilla
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License. */

'use strict';

// Polyfill Promise.prototype.finally().
require('promise.prototype.finally').shim();

// Require *pify* out of order so we can use it to promisify other modules.
const pify = require('pify');

const assert = require('assert');
const decompress = require('decompress');
const extract = require('extract-zip');
const fs = pify(require('fs-extra'));
const os = require('os');
const packageJson = require('../package.json');
const path = require('path');
const spawn = require('child_process').spawn;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${packageJson.name}-`));
const appDir = path.join(tempDir, process.platform === 'darwin' ? 'hello-world.app' : 'hello-world');

let exitCode = 0;

new Promise((resolve, reject) => {
  const child = spawn('node', [ path.join('bin', 'cli.js'), 'package', 'test/hello-world/' ]);

  child.stdout.on('data', data => {
    const output = data.toString('utf8');
    console.log(output.trim());
    // TODO: determine what package command should output and assert it does.
  });

  child.stderr.on('data', data => {
    const error = data.toString('utf8');
    console.error(error);
    reject(error);
  });

  child.on('exit', code => {
    assert.equal(code, 0);
    resolve();
  });
})
.then(() => {
  console.log('extracting package');

  if (process.platform === 'win32') {
    const source = path.join('dist', 'hello-world.zip');
    const destination = tempDir;
    // return decompress(source, destination);
    return pify(extract)(source, { dir: destination });
  }
  else if (process.platform === 'darwin') {
    const mountPoint = path.join(tempDir, 'volume');
    return new Promise((resolve, reject) => {
      const dmgFile = path.join('dist', 'hello-world.dmg');
      const child = spawn('hdiutil', ['attach', dmgFile, '-mountpoint', mountPoint, '-nobrowse']);
      child.on('exit', resolve);
      child.on('error', reject);
    })
    .then((code) => {
      assert.strictEqual(code, 0, 'app disk image (.dmg) attached');
      const source = path.join(mountPoint, 'hello-world.app');
      const destination = appDir;
      return fs.copy(source, destination);
    })
    .then(() => {
      return new Promise((resolve, reject) => {
        const child = spawn('hdiutil', ['detach', mountPoint]);
        child.on('exit', resolve);
        child.on('error', reject);
      });
    })
    .then((code) => {
      assert.strictEqual(code, 0, 'app disk image (.dmg) detached');
    });
  }
  else if (process.platform === 'linux') {
    const source = path.join('dist', 'hello-world.tgz');
    const destination = tempDir;
    return decompress(source, destination);
  }
})
.then(() => {
  console.log('running app');

  let executable, args = [], shell = false;

  switch (process.platform) {
    case 'win32':
      // TODO: invoke the launcher rather than the runtime.
      executable = path.join(appDir, 'firefox.exe');
      args = ['--app', path.win32.resolve(path.join(appDir, 'qbrt/application.ini')), '--new-instance'];
      shell = true;
      break;
    case 'darwin':
      executable = path.join(appDir, 'Contents', 'MacOS', 'hello-world');
      break;
    case 'linux':
      executable = path.join(appDir, 'hello-world');
      break;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: shell });

    let totalOutput = '';
    child.stdout.on('data', data => {
      const output = data.toString('utf8');
      totalOutput += output;
      console.log(output.trim());
    });

    child.stderr.on('data', data => {
      // Report error messages that Linux on Travis loves to excrete, such as:
      // GLib-GObject-CRITICAL **: g_object_unref: assertion 'object->ref_count > 0' failed
      console.error(data.toString('utf8').trim());
    });

    child.on('exit', (code, signal) => {
      assert.strictEqual(code, 0, 'app exited with success code');
      assert.strictEqual(totalOutput.trim(), 'console.log: Hello, World!');
      resolve();
    });
  });
})
.catch(error => {
  console.error(error);
  exitCode = 1;
})
.finally(() => {
  console.log('finalizing test');

  fs.removeSync(tempDir);
  process.exit(exitCode);
});

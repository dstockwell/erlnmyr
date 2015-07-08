var Promise = require('bluebird');
var exec = Promise.promisify(require('child_process').exec);
var types = require('../core/types');
var phase = require('../core/phase-register.js');

module.exports.readAndGunzipTwice = phase({
  input: types.string,
  output: types.string,
  arity: '1:1',
  async: true,
}, function(data) {
  return exec('zcat ' + data + ' | zcat', {maxBuffer: 60 * 1024 * 1024}).then(function(d) {
    return d[0];
  });
});

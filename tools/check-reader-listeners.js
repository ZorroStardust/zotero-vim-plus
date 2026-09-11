/* global require, __dirname, process, console */
// Run with: node tools/check-reader-listeners.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(process.argv[2] ||
  path.join(__dirname, '../content/zoteroVim.js'), 'utf8');
const reader = {
  _registeredListeners: [],
  registerEventListener(type, handler, pluginID) {
    this._registeredListeners.push({ type, handler, pluginID });
  },
  // Matches Zotero 9.0.6: passing undefined here removes unrelated listeners.
  unregisterEventListener(type, handler) {
    this._registeredListeners = this._registeredListeners.filter(
      x => x.type === type && x.handler === handler);
  },
  _unregisterEventListenerByPluginID(pluginID) {
    this._registeredListeners = this._registeredListeners.filter(x => x.pluginID !== pluginID);
  },
};
const context = vm.createContext({ Zotero: { Reader: reader, debug() {} } });
vm.runInContext(source, context);
const plugin = context.ZoteroVim;
plugin.id = 'vim-test';
const otherHandler = () => {};
reader.registerEventListener('renderToolbar', otherHandler, 'other-plugin');
reader.registerEventListener('renderTextSelectionPopup', otherHandler, 'other-plugin');
reader.registerEventListener('renderToolbar', otherHandler);
const unrelated = reader._registeredListeners.slice();
const owned = () => reader._registeredListeners.filter(x => x.pluginID === plugin.id);

plugin._registerReaderListeners();
plugin._registerReaderListeners();
assert.equal(owned().length, 2, 'registration is idempotent');
plugin.shutdown();
assert.deepEqual(reader._registeredListeners, unrelated, 'shutdown preserves other callbacks');
plugin.shutdown();
assert.deepEqual(reader._registeredListeners, unrelated, 'repeated shutdown is safe');

const register = reader.registerEventListener;
reader.registerEventListener = function (type, ...args) {
  if (type === 'renderTextSelectionPopup') throw new Error('Simulated partial registration');
  return register.call(this, type, ...args);
};
plugin._registerReaderListeners();
assert.equal(owned().length, 0, 'failed registration is rolled back');
assert.deepEqual(reader._registeredListeners, unrelated, 'rollback preserves other callbacks');
reader.registerEventListener = register;
plugin._registerReaderListeners();
assert.equal(owned().length, 2, 'registration can retry after failure');
plugin.shutdown();
assert.deepEqual(reader._registeredListeners, unrelated);

plugin.id = null;
plugin.shutdown();
assert.deepEqual(reader._registeredListeners, unrelated, 'missing ID does not remove callbacks');
console.log('Reader listener lifecycle checks passed.');

/* global require, __dirname, console */
// Reader history uses native view history, not a parallel plugin stack or marks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({
  Zotero: { debug() {} }, setTimeout() {}, clearTimeout() {},
  Components: { utils: { cloneInto: value => value } },
});
for (const name of ['zoteroVim.js', 'zoteroVimReader.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
}
const z = context.ZoteroVim;
const notices = [];
z._showStatus = (_state, text) => notices.push(text);
z._nativeEditableFocused = () => false;
z._smoothHoldSpecForEvent = () => null;
z._updateIndicator = () => {};
z._handleReaderSidebarAction = () => false;
const primaryWin = {};
const secondaryWin = {};
function view(win, locations = [1, 5, 12]) {
  const v = { _iframeWindow: win, position: locations.length - 1, calls: [],
    navigateBack() { this.calls.push('back'); if (this.position) this.position--; },
    navigateForward() {
      this.calls.push('forward'); if (this.position < locations.length - 1) this.position++;
    },
    get location() { return locations[this.position]; },
  };
  v._history = {
    get canNavigateBack() { return v.position > 0; },
    get canNavigateForward() { return v.position < locations.length - 1; },
  };
  return v;
}
function fixture() {
  const primary = view(primaryWin);
  const secondary = view(secondaryWin, [2, 8, 20]);
  const ir = { _primaryView: primary, _secondaryView: secondary, _lastView: primary };
  const reader = { _internalReader: ir };
  const state = { mode: 'normal', keyBuffer: '', countBuffer: '', lastAnnotationKey: 'A',
    marks: { a: { pageIndex: 99 } } };
  state.executeAction = (action, count) => z._executeAction(action, reader, state, primaryWin, count);
  return { primary, secondary, ir, reader, state };
}
function key(f, key, options = {}) {
  const event = { key, ...options, preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  z._onKeyDown(event, f.reader, f.state, primaryWin);
  return event;
}
let pass = 0;
function check(label, fn) { fn(); pass++; console.log('  ok  ' + label); }

check('Normal Ctrl+o/i traverse the native stack, not marks; counts stop at bounds', () => {
  const f = fixture();
  assert.equal(key(f, 'o', { ctrlKey: true }).prevented, true);
  assert.equal(f.primary.location, 5);
  assert.equal(f.state.lastAnnotationKey, null);
  assert.equal(key(f, 'i', { ctrlKey: true }).prevented, true);
  assert.equal(f.primary.location, 12);
  key(f, '9'); key(f, 'o', { ctrlKey: true });
  assert.equal(f.primary.location, 1);
  assert.deepEqual(f.primary.calls, ['back', 'forward', 'back', 'back']);
  key(f, '3'); key(f, 'i', { ctrlKey: true });
  assert.equal(f.primary.location, 12);
  assert.equal(f.state.countBuffer, '');
  assert.deepEqual(f.state.marks, { a: { pageIndex: 99 } });
  key(f, 'i', { ctrlKey: true });
  assert.match(notices.at(-1), /No later/);
});

check('split-pane navigation uses the key event pane even with stale native focus', () => {
  const f = fixture();
  z._navigateReaderHistory(f.reader, f.state, secondaryWin, false, 2);
  assert.equal(f.secondary.location, 2);
  assert.equal(f.primary.location, 12);
  assert.deepEqual(f.primary.calls, []);
  assert.deepEqual(f.secondary.calls, ['back', 'back']);
});

check('reading-mode active view and changing view stats are respected', () => {
  const f = fixture();
  const overlay = view(secondaryWin);
  f.ir._getActiveView = primary => primary ? f.primary : overlay;
  // Some wrappers expose history only via freshly updated view statistics.
  delete overlay._history;
  f.ir._state = { secondaryViewStats: { canNavigateBack: true } };
  overlay.navigateBack = function() {
    this.calls.push('back'); this.position--;
    f.ir._state.secondaryViewStats = { canNavigateBack: false };
  };
  z._navigateReaderHistory(f.reader, f.state, secondaryWin, false, 5);
  assert.deepEqual(overlay.calls, ['back']);
  assert.deepEqual(f.secondary.calls, []);
});

check('older reader-level API fallback and absent/empty histories are safe', () => {
  let called = 0;
  const state = { lastAnnotationKey: 'A' };
  z._navigateReaderHistory({ _internalReader: { navigateBack() { called++; } } }, state, {}, false);
  assert.equal(called, 1);
  assert.equal(state.lastAnnotationKey, null);
  z._navigateReaderHistory({}, state, {}, false);
  assert.match(notices.at(-1), /unavailable/);
  const f = fixture(); f.primary.position = 0;
  z._navigateReaderHistory(f.reader, f.state, primaryWin, false);
  assert.equal(f.state.lastAnnotationKey, 'A');
  assert.match(notices.at(-1), /No earlier/);
});

check('Insert and native form inputs keep Ctrl+o/i; configurable Insert exit saves comments', () => {
  const f = fixture(); f.state.mode = 'insert';
  for (const value of ['o', 'i']) assert.equal(key(f, value, { ctrlKey: true }).prevented, undefined);
  assert.deepEqual(f.primary.calls, []);
  f.state.mode = 'normal';
  const native = { key: 'o', ctrlKey: true, target: { tagName: 'INPUT' },
    preventDefault() { throw new Error('Native input consumed'); } };
  z._onKeyDown(native, f.reader, f.state, primaryWin);
  assert.deepEqual(f.primary.calls, []);
  let exited = 0;
  z._exitAnnotationInsert = () => { exited++; };
  z.getPref = (name, fallback) => name === 'bindings'
    ? JSON.stringify({ 'insert:escape': null, 'insert:ctrl+q': 'exitMode' }) : fallback;
  f.state.mode = 'insert';
  assert.equal(key(f, 'Escape').prevented, undefined);
  assert.equal(z._readerConsumesKey(f.state, 'escape'), false);
  assert.equal(key(f, 'q', { ctrlKey: true }).prevented, true);
  assert.equal(exited, 1);
});

async function checkAsync(label, fn) {
  await fn();
  pass++;
  console.log('  ok  ' + label);
}

checkAsync('gg/G explicitly commit a native history point before Ctrl+o/i', async () => {
  const f = fixture();
  let commits = 0;
  f.primary.navigateToNextPage = () => {};
  f.primary._pushHistoryPoint = async () => { commits++; };
  f.ir.navigateToLastPage = () => { f.primary.position = 2; };
  f.state.executeAction = (action, count) =>
    z._executeAction(action, f.reader, f.state, primaryWin, count);
  z._executeAction('lastPage', f.reader, f.state, primaryWin);
  assert.ok(f.state._readerHistoryPending);
  await f.state._readerHistoryPending;
  assert.equal(commits, 1);
  key(f, 'o', { ctrlKey: true });
  assert.equal(f.primary.location, 5);

  let finishNavigation;
  f.ir.navigate = () => new Promise(resolve => { finishNavigation = resolve; });
  z._executeAction('lastPage', f.reader, f.state, primaryWin, 2);
  const pending = f.state._readerHistoryPending;
  await Promise.resolve();
  assert.equal(commits, 1, 'counted jump must wait for native navigation');
  finishNavigation();
  await pending;
  assert.equal(commits, 2);
}).then(() => {
  console.log('Reader history checks passed (' + pass + ' cases).');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

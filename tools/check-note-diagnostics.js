/* global require, __dirname, console */
// Run with: node tools/check-note-diagnostics.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function target(extra = {}) {
  return Object.assign({
    listeners: [], style: {}, children: [], textContent: '',
    addEventListener(type, handler, capture = false) {
      this.listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, capture = false) {
      this.listeners = this.listeners.filter(l => l.type !== type
        || l.handler !== handler || l.capture !== capture);
    },
    setAttribute() {},
    appendChild(node) { this.children.push(node); },
    remove() { this.removed = true; },
    focus() { this.focused = true; },
    select() { this.selected = true; },
  }, extra);
}

function windowFixture() {
  const timers = new Map();
  let nextTimer = 0;
  const win = target({
    navigator: { platform: 'MacIntel' },
    setTimeout(callback, delay) {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearTimeout(id) { timers.delete(id); },
    flush(delay = 0) {
      for (const [id, timer] of Array.from(timers)) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    timers,
  });
  win.document = target({
    defaultView: win, body: target(), documentElement: target(),
    createElementNS() { return target(); },
    querySelector() { return win.editable || null; },
  });
  win.editable = target({ localName: 'div', ownerDocument: win.document,
    isContentEditable: true, id: 'PRIVATE_NOTE_ID', textContent: 'PRIVATE_NOTE_BODY' });
  win._currentEditorInstance = {
    _editorCore: { view: { state: { doc: {}, selection: { anchor: 3, head: 3 } } } },
  };
  win.MutationObserver = function (callback) {
    this.callback = callback;
    this.observe = (_element, options) => { this.connected = true; this.options = options; };
    this.disconnect = () => { this.connected = false; };
  };
  return win;
}

function fixture(version = '1.9.1pre3') {
  const mainWin = windowFixture();
  const noteWin = windowFixture();
  const context = vm.createContext({
    Zotero: { version: '10.0.4', debug() {} },
    Services: { appinfo: { platformVersion: '140.15.0' } },
    Components: { utils: { cloneInto: value => ({ ...value, cloned: true }) } },
    clearTimeout() {},
  });
  for (const name of ['zoteroVim.js', 'zoteroVimMain.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
  }
  const plugin = context.ZoteroVim;
  plugin.version = version;
  plugin.isNoteEditorVimEnabled = () => fixture.enabled;
  fixture.enabled = true;
  plugin._getActiveMainNoteEditorWindow = () => fixture.editor;
  fixture.editor = noteWin;
  plugin._isStandaloneNoteTabSelected = () => true;
  for (const name of ['_syncNoteCursorVisualState', '_syncNoteLineNumbers',
    '_clearNoteLineNumbers', '_noteCloseSearch', '_mainShowStatus']) plugin[name] = () => {};
  plugin._handleMainContextNoteNormalKey = event => {
    assert.equal(event.defaultPrevented, true);
    const selection = noteWin._currentEditorInstance._editorCore.view.state.selection;
    selection.anchor++;
    selection.head++;
    return true;
  };
  let clipboard = '';
  plugin._noteCopyText = value => { clipboard = value; return true; };
  vm.runInContext(fs.readFileSync(path.join(root, 'content',
    'zoteroVimNoteDiagnostics.js'), 'utf8'), context);
  const state = { _contextNoteMode: 'normal' };
  plugin._initNoteDiagnostics(mainWin, state);
  plugin._syncMainContextNoteListener(mainWin, state);
  return { plugin, mainWin, noteWin, state, clipboard: () => clipboard };
}

function event(noteWin, extra = {}) {
  return Object.assign({
    type: 'keydown', key: 'h', code: 'KeyH', view: noteWin, target: noteWin.editable,
    cancelable: true, defaultPrevented: false, cancelBubble: false,
    eventPhase: 1, isTrusted: true,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.cancelBubble = true; },
    stopImmediatePropagation() { this.cancelBubble = true; this.stopped = true; },
  }, extra);
}

function dispatch(noteWin, e) {
  for (const [node, capture] of [
    [noteWin, true], [noteWin.document, true],
    [noteWin.document, false], [noteWin, false],
  ]) {
    for (const listener of node.listeners.slice()) {
      if (listener.type === e.type && listener.capture === capture) listener.handler(e);
      if (e.stopped) return;
    }
  }
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ok  ' + label);
}

check('stable versions have no diagnostic UI or event observers', () => {
  const { state } = fixture('1.9.0');
  assert.equal(state._noteDiagnostics, undefined);
  const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
  assert.match(bootstrap, /if \(version === '1\.9\.1pre3'\)/);
});

check('recording is opt-in and has no mode/input side effects', () => {
  const { plugin, mainWin, noteWin, state } = fixture();
  dispatch(noteWin, event(noteWin));
  assert.equal(state._noteDiagnostics.records.length, 0);
  assert.equal(state._contextNoteMode, 'normal');
  plugin._startNoteDiagnostics(state);
  assert.equal(state._noteDiagnostics.active, true);
  assert.ok([...mainWin.timers.values()].some(timer => timer.delay === 60000));
});

check('real Normal handler cancels before motion and after-dispatch confirms it', () => {
  const { plugin, mainWin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  const e = event(noteWin);
  dispatch(noteWin, e);
  mainWin.flush();
  const rows = state._noteDiagnostics.records;
  const before = rows.find(r => r.stage === 'editor-window-capture');
  const after = rows.find(r => r.stage === 'note-handler-after');
  const final = rows.find(r => r.stage === 'editor-window-after-dispatch');
  assert.equal(before.defaultPrevented, false);
  assert.equal(after.defaultPrevented, true);
  assert.equal(after.selectionChanged, true);
  assert.equal(after.documentChanged, false);
  assert.equal(final.defaultPrevented, true);
  assert.equal(before.event, after.event);
  assert.equal(after.event, final.event);
  assert.equal(rows.some(r => r.stage === 'editor-document-capture'), false);
});

check('main forwarded events are distinct and do not execute another motion', () => {
  const { plugin, noteWin, mainWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  const e = event(noteWin, { view: mainWin, target: mainWin.editable });
  plugin._onMainKeyDown(e, mainWin, state);
  const after = state._noteDiagnostics.records.find(r => r.stage === 'main-handler-after');
  assert.equal(after.defaultPrevented, true);
  assert.equal(after.viewIsRegisteredEditor, false);
  assert.notEqual(after.eventView, after.registeredEditor);
  assert.equal(noteWin._currentEditorInstance._editorCore.view.state.selection.head, 3);
});

check('observers record native input before the runtime guard cancels it', () => {
  const { plugin, mainWin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  dispatch(noteWin, event(noteWin));
  const input = event(noteWin, {
    type: 'beforeinput', key: undefined, code: undefined, inputType: 'insertText', data: 'h',
  });
  dispatch(noteWin, input);
  assert.equal(input.defaultPrevented, true);
  assert.equal(input.cancelBubble, true);
  noteWin._currentEditorInstance._editorCore.view.state.doc = {};
  mainWin.flush();
  const rows = state._noteDiagnostics.records;
  assert.ok(rows.some(r => r.type === 'beforeinput' && r.dataMatchesLastNormalMotion));
  assert.ok(rows.some(r => r.documentChanged));
});

check('Insert keys, text data, DOM attributes and non-whitelisted codes are redacted', () => {
  const { plugin, mainWin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  state._contextNoteMode = 'insert';
  for (const key of 'PRIVATE') dispatch(noteWin, event(noteWin, { key, code: 'Key' + key }));
  dispatch(noteWin, event(noteWin, { type: 'input', data: 'PRIVATE_INPUT_DATA',
    inputType: 'PRIVATE_INPUT_TYPE', key: undefined }));
  state._contextNoteMode = 'normal';
  dispatch(noteWin, event(noteWin, { code: 'PRIVATE_CODE' }));
  plugin._copyNoteDiagnostics(state);
  mainWin.flush();
  const report = plugin._noteDiagnosticsReport(state);
  for (const secret of ['PRIVATE', 'KeyP', 'KeyR', 'KeyI', 'KeyV', 'KeyA', 'KeyT', 'KeyE']) {
    assert.equal(report.includes(secret), false, secret);
  }
  assert.ok(report.includes('[printable]'));
  assert.ok(report.includes('dataLength'));
  assert.equal(state._contextNoteMode, 'normal');
});

check('composition and noncancelable input remain native and report their flags', () => {
  const { plugin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  state._contextNoteMode = 'insert';
  for (const type of ['compositionstart', 'beforeinput', 'input', 'compositionend']) {
    const e = event(noteWin, { type, key: undefined, cancelable: false,
      isComposing: true, data: 'PRIVATE_IME_TEXT', inputType: 'insertCompositionText' });
    dispatch(noteWin, e);
    assert.equal(e.defaultPrevented, false);
  }
  assert.ok(state._noteDiagnostics.records.some(r => r.composing && !r.cancelable));
  assert.equal(plugin._noteDiagnosticsReport(state).includes('PRIVATE'), false);
});

check('disabled note Vim still has diagnostic observers without consuming keys', () => {
  const { plugin, mainWin, noteWin, state } = fixture();
  fixture.enabled = false;
  plugin._syncMainContextNoteListener(mainWin, state);
  plugin._startNoteDiagnostics(state);
  const e = event(noteWin);
  dispatch(noteWin, e);
  assert.equal(e.defaultPrevented, false);
  assert.ok(state._noteDiagnostics.records.some(r => r.vimEnabled === false));
  assert.equal(state._noteDiagnostics.records.some(r => r.key === 'h'), false);
});

check('mutation observations report counts/booleans without note contents', () => {
  const { plugin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  const observer = state._noteDiagnostics.observer;
  assert.equal(observer.options.cloned, true);
  noteWin._currentEditorInstance._editorCore.view.state.doc = {};
  observer.callback([{ type: 'characterData', target: noteWin.editable,
    oldValue: 'PRIVATE_NOTE_TEXT' }, { type: 'childList', addedNodes: [noteWin.editable] }]);
  const row = state._noteDiagnostics.records.find(r => r.kind === 'editor-mutation');
  assert.equal(row.characterDataRecords, 1);
  assert.equal(row.childListRecords, 1);
  assert.equal(row.documentChanged, true);
  assert.equal(plugin._noteDiagnosticsReport(state).includes('PRIVATE'), false);
});

check('Copy stops, flushes pending event flags and copies only the report', () => {
  const { plugin, mainWin, noteWin, state, clipboard } = fixture();
  plugin._startNoteDiagnostics(state);
  dispatch(noteWin, event(noteWin));
  plugin._copyNoteDiagnostics(state);
  assert.equal(state._noteDiagnostics.active, false);
  assert.equal(state._noteDiagnostics.pending.size, 0);
  assert.equal(mainWin.timers.size, 0);
  assert.ok(clipboard().includes('after-dispatch'));
  assert.ok(clipboard().includes('"pluginVersion": "1.9.1pre3"'));
});

check('clipboard failure provides a selectable local fallback', () => {
  const { plugin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  plugin._noteCopyText = () => false;
  plugin._copyNoteDiagnostics(state);
  assert.equal(state._noteDiagnostics.output.hidden, false);
  assert.equal(state._noteDiagnostics.output.selected, true);
});

check('record limits and timeouts stop without suppressing native events', () => {
  const { plugin, mainWin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  plugin.NOTE_DIAGNOSTICS_LIMIT = 6;
  dispatch(noteWin, event(noteWin));
  dispatch(noteWin, event(noteWin, { type: 'keyup' }));
  assert.equal(state._noteDiagnostics.active, false);
  assert.equal(state._noteDiagnostics.records.length, 6);
  assert.equal(state._noteDiagnostics.stoppedReason, 'record-limit');
  assert.equal(mainWin.timers.size, 0);
  plugin._startNoteDiagnostics(state);
  mainWin.flush(60000);
  assert.equal(state._noteDiagnostics.active, false);
  assert.equal(state._noteDiagnostics.stoppedReason, 'timeout');
});

check('editor rebinding and shutdown remove listeners, observers and pending timers', () => {
  const { plugin, mainWin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  dispatch(noteWin, event(noteWin));
  const replacement = windowFixture();
  fixture.editor = replacement;
  plugin._syncMainContextNoteListener(mainWin, state);
  assert.equal(noteWin.listeners.length, 0);
  assert.equal(noteWin.document.listeners.length, 0);
  assert.ok(replacement.listeners.length > 0);
  const panel = state._noteDiagnostics.panel;
  plugin._clearNoteDiagnostics(state);
  plugin._clearMainContextNoteListener(state);
  assert.equal(state._noteDiagnostics, null);
  assert.equal(panel.removed, true);
  assert.equal(mainWin.listeners.length, 0);
  assert.equal(mainWin.document.listeners.length, 0);
  assert.equal(replacement.listeners.length, 0);
  assert.equal(replacement.document.listeners.length, 0);
  assert.equal(mainWin.timers.size, 0);
});

check('Start resets the previous report and all records stay below the limit', () => {
  const { plugin, noteWin, state } = fixture();
  plugin._startNoteDiagnostics(state);
  dispatch(noteWin, event(noteWin));
  plugin._startNoteDiagnostics(state);
  assert.equal(state._noteDiagnostics.records.length, 1);
  assert.equal(state._noteDiagnostics.nextEvent, 0);
});

console.log('Note diagnostics checks passed (' + passed + ' cases).');

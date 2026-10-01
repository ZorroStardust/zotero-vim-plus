/* global require, __dirname, console */
// Run with: node tools/check-note-editing.js
// Exercise the real note key parser and editing primitives, without Zotero.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let copied = '';
let focusCalls = 0;
let tabActions = [];
const context = vm.createContext({
  Zotero: { debug() {} },
  Components: {
    classes: { '@mozilla.org/widget/clipboardhelper;1': {
      getService: () => ({ copyString(text) { copied = text; } }),
    } },
    interfaces: { nsIClipboardHelper: {} },
    utils: { cloneInto: value => value },
  },
  setTimeout: () => 1,
  clearTimeout() {},
});
const root = path.join(__dirname, '..');
for (const name of ['zoteroVim.js', 'zoteroVimMain.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
}
const plugin = context.ZoteroVim;
plugin.isNoteEditorVimEnabled = () => true;
plugin._syncNoteCursorVisualState = () => {};
plugin._mainShowStatus = () => {};
plugin._focusReaderContent = () => { focusCalls++; };
plugin._executeMainAction = action => { tabActions.push(action); };

function makeEditor(text = '', caret = 0) {
  const doc = { defaultView: {
    Event: function(type) { this.type = type; },
    navigator: { platform: 'Linux' },
  } };
  const el = {
    nodeType: 1, tagName: 'TEXTAREA', ownerDocument: doc,
    value: text, selectionStart: caret, selectionEnd: caret, inputEvents: 0,
    setSelectionRange(from, to) { this.selectionStart = from; this.selectionEnd = to; },
    setRangeText(value, from, to) {
      this.value = this.value.slice(0, from) + value + this.value.slice(to);
      this.setSelectionRange(from + value.length, from + value.length);
    },
    dispatchEvent(event) { if (event.type === 'input') this.inputEvents++; },
    focus() {},
  };
  doc.activeElement = el;
  return el;
}

function makeState(mode = 'normal') {
  return { _contextNoteMode: mode, _contextNoteKeyBuffer: '',
    _contextNoteCountBuffer: '', _contextNoteOperatorCountBuffer: '',
    _contextNoteMainBuffer: '', _contextNoteLastYank: '',
    _contextNoteRegisterType: 'character' };
}

function key(el, state, value, options = {}) {
  const event = { key: value, target: el, defaultPrevented: false, ...options,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  plugin._onMainContextNoteKeyDown(event, {}, state);
  return event;
}

function send(el, state, keys) {
  for (const value of keys) key(el, state, value);
}

let pass = 0;
function check(label, fn) {
  fn();
  pass++;
  console.log('  ok  ' + label);
}

check('diw deletes the current word without entering Insert', () => {
  for (const caret of [0, 2, 4]) {
    const el = makeEditor('hello world', caret);
    const state = makeState();
    send(el, state, 'diw');
    assert.equal(el.value, ' world');
    assert.equal(state._contextNoteMode, 'normal');
    assert.equal(state._contextNoteLastYank, 'hello');
  }
});

check('yiw copies the current word; ciw changes it and enters Insert', () => {
  const el = makeEditor('hello world', 2);
  const state = makeState();
  send(el, state, 'yiw');
  assert.equal(copied, 'hello');
  assert.equal(el.value, 'hello world');
  send(el, state, 'ciw');
  assert.equal(el.value, ' world');
  assert.equal(state._contextNoteMode, 'insert');
});

check('operator and motion counts multiply rather than concatenate', () => {
  const el = makeEditor('one two three four five six seven');
  const state = makeState();
  send(el, state, '2d3w');
  assert.equal(el.value, 'seven');
});

check('counts before or after d still work independently', () => {
  for (const command of ['3dw', 'd3w']) {
    const el = makeEditor('one two three four');
    send(el, makeState(), command);
    assert.equal(el.value, 'four');
  }
});

check('3d0 interprets zero as the line-start motion', () => {
  const el = makeEditor('hello world', 6);
  const state = makeState();
  send(el, state, '3d0');
  assert.equal(el.value, 'world');
  assert.equal(state._contextNoteCountBuffer, '');
});

check('w/e/W/E and b/B distinguish words, punctuation and WORDs', () => {
  for (const [motion, expected] of [['w', 3], ['e', 2], ['W', 8], ['E', 6]]) {
    const el = makeEditor('abc-def XYZ');
    send(el, makeState(), motion);
    assert.equal(el.selectionStart, expected, motion);
  }
  for (const [motion, expected] of [['b', 4], ['B', 0]]) {
    const el = makeEditor('abc-def XYZ', 6);
    send(el, makeState(), motion);
    assert.equal(el.selectionStart, expected, motion);
  }
});

check('0 goes to column zero while ^ and I skip indentation', () => {
  for (const [motion, expected] of [['0', 0], ['^', 3], ['I', 3]]) {
    const el = makeEditor('   hello', 6);
    const state = makeState();
    send(el, state, motion);
    assert.equal(el.selectionStart, expected, motion);
    assert.equal(state._contextNoteMode, motion === 'I' ? 'insert' : 'normal');
  }
});

check('de is inclusive and cw preserves the space following a word', () => {
  const deleted = makeEditor('hello world');
  send(deleted, makeState(), 'de');
  assert.equal(deleted.value, ' world');
  for (const [text, caret, expected] of [
    ['hello world', 0, ' world'], ['a word', 0, ' word'], ['hello world', 4, 'hell world'],
  ]) {
    const el = makeEditor(text, caret);
    send(el, makeState(), 'cw');
    assert.equal(el.value, expected);
  }
});

check('1G means the first line, bare G the last, and numbered gg works', () => {
  const el = makeEditor('one\ntwo\nthree', 2);
  const state = makeState();
  send(el, state, '1G');
  assert.equal(el.selectionStart, 0);
  send(el, state, 'G');
  assert.equal(el.selectionStart, 8);
  send(el, state, '2gg');
  assert.equal(el.selectionStart, 4);
});

check('dd removes a complete line, including empty and last lines', () => {
  for (const [text, caret, expected] of [
    ['one\ntwo\nthree', 5, 'one\nthree'], ['one\n\nthree', 4, 'one\nthree'],
    ['one\ntwo', 5, 'one'], ['', 0, ''],
  ]) {
    const el = makeEditor(text, caret);
    const state = makeState();
    send(el, state, 'dd');
    assert.equal(el.value, expected);
    assert.equal(state._contextNoteRegisterType, 'line');
    assert.ok(state._contextNoteLastYank.endsWith('\n'));
  }
});

check('yy followed by p/P puts whole lines below/above', () => {
  for (const [motion, expected] of [
    ['p', 'one\none\ntwo'], ['P', 'one\none\ntwo'], ['3p', 'one\none\none\none\ntwo'],
  ]) {
    const el = makeEditor('one\ntwo', 1);
    const state = makeState();
    send(el, state, 'yy' + motion);
    assert.equal(el.value, expected, motion);
  }
});

check('3p repeats characterwise text three times', () => {
  const el = makeEditor('ab');
  const state = makeState();
  state._contextNoteLastYank = 'x';
  send(el, state, '3p');
  assert.equal(el.value, 'axxxb');
});

check('x updates the character register so xp swaps adjacent characters', () => {
  const el = makeEditor('abcd');
  const state = makeState();
  send(el, state, 'xp');
  assert.equal(el.value, 'bacd');
  assert.equal(state._contextNoteRegisterType, 'character');
});

check('dj and d1G operate linewise', () => {
  const down = makeEditor('one\ntwo\nthree', 1);
  send(down, makeState(), 'dj');
  assert.equal(down.value, 'three');
  const up = makeEditor('one\ntwo\nthree', 5);
  send(up, makeState(), 'd1G');
  assert.equal(up.value, 'three');
});

check('o/O do not split trailing text and O always opens above', () => {
  for (const [motion, expected, caret] of [
    ['o', 'hello world\n\nsecond', 12], ['O', '\nhello world\nsecond', 0],
  ]) {
    const el = makeEditor('hello world\nsecond', 5);
    const state = makeState();
    send(el, state, motion);
    assert.equal(el.value, expected);
    assert.equal(el.selectionStart, caret);
    assert.equal(state._contextNoteMode, 'insert');
    assert.equal(el.inputEvents, 1);
  }
});

check('O at the start of the document does not resolve the last newline', () => {
  const el = makeEditor('first\nsecond', 0);
  send(el, makeState(), 'O');
  assert.equal(el.value, '\nfirst\nsecond');
  assert.equal(el.selectionStart, 0);
});

check('Normal J/K switch tabs once; Insert J/K remain printable', () => {
  tabActions = [];
  const el = makeEditor();
  const state = makeState();
  key(el, state, 'J', { shiftKey: true });
  key(el, state, 'K', { shiftKey: true });
  key(el, state, 'J', { shiftKey: true, repeat: true });
  assert.deepEqual(tabActions, ['mainPrevTab', 'mainNextTab']);
  for (const value of ['J', 'K']) {
    assert.equal(key(el, makeState('insert'), value, { shiftKey: true }).defaultPrevented, false);
  }
  assert.equal(tabActions.length, 2);
});

check('Insert Ctrl+Backspace passes through instead of moving focus', () => {
  focusCalls = 0;
  const event = key(makeEditor(), makeState('insert'), 'Backspace', { ctrlKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(focusCalls, 0);
});

check('composing Escape does not exit Insert or cancel the IME', () => {
  const state = makeState('insert');
  const event = key(makeEditor(), state, 'Escape', { isComposing: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(state._contextNoteMode, 'insert');
});

check('native undo/redo are used, and an empty history is not reported as success', () => {
  const el = makeEditor();
  const calls = [];
  el.ownerDocument.defaultView.doUndo = () => { calls.push('undo'); return true; };
  el.ownerDocument.defaultView.doRedo = () => { calls.push('redo'); return false; };
  assert.equal(plugin._noteUndoRedo(el), true);
  assert.equal(plugin._noteUndoRedo(el, true), false);
  assert.deepEqual(calls, ['undo', 'redo']);
});

check('older-editor undo bypasses Vim capture and uses the platform modifier', () => {
  for (const platform of ['Linux', 'MacIntel']) {
    const el = makeEditor();
    const doc = el.ownerDocument;
    doc.execCommand = () => false;
    doc.defaultView.navigator.platform = platform;
    doc.defaultView.KeyboardEvent = function(type, options) {
      return { type, target: el, defaultPrevented: false, ...options,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { throw new Error('Vim swallowed native undo'); },
      };
    };
    el.dispatchEvent = event => {
      plugin._onMainContextNoteKeyDown(event, {}, makeState());
      assert.equal(event.defaultPrevented, false);
      assert.equal(event.metaKey, platform === 'MacIntel');
      assert.equal(event.ctrlKey, platform !== 'MacIntel');
      event.preventDefault(); // ProseMirror keymap consumes undo
    };
    assert.equal(plugin._noteUndoRedo(el), true);
    el.dispatchEvent = () => {};
    assert.equal(plugin._noteUndoRedo(el), false);
  }
});

check('formatting descendants resolve to the editing host', () => {
  const host = { nodeType: 1, tagName: 'DIV', isContentEditable: true };
  const paragraph = { nodeType: 1, tagName: 'P', isContentEditable: true, parentElement: host };
  const bold = { nodeType: 1, tagName: 'STRONG', isContentEditable: true, parentElement: paragraph };
  assert.equal(plugin._resolveEditableFromTarget(bold), host);
});

check('character motions and deletion never split an emoji surrogate pair', () => {
  const el = makeEditor('a😀b', 1);
  const state = makeState();
  send(el, state, 'l');
  assert.equal(el.selectionStart, 3);
  send(el, state, 'h');
  assert.equal(el.selectionStart, 1);
  send(el, state, 'x');
  assert.equal(el.value, 'ab');
  assert.equal(state._contextNoteLastYank, '😀');
});

check('a forwarded main-window J cannot execute the note tab switch twice', () => {
  const originalIsSelected = plugin._isStandaloneNoteTabSelected;
  const originalSync = plugin._syncMainContextNoteListener;
  const originalNotes = context.Zotero.Notes;
  try {
    plugin._isStandaloneNoteTabSelected = () => true;
    plugin._syncMainContextNoteListener = () => {};
    context.Zotero.Notes = { getByTabID() {} };
    tabActions = [];
    const state = makeState();
    state._contextNoteEditorWin = {};
    const el = makeEditor();
    key(el, state, 'J', { shiftKey: true });
    const mainWin = {};
    const copy = { key: 'J', shiftKey: true, view: mainWin, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    };
    plugin._onMainKeyDown(copy, mainWin, state);
    assert.deepEqual(tabActions, ['mainPrevTab']);
    assert.equal(copy.defaultPrevented, true);
  } finally {
    plugin._isStandaloneNoteTabSelected = originalIsSelected;
    plugin._syncMainContextNoteListener = originalSync;
    context.Zotero.Notes = originalNotes;
  }
});

console.log('Note editing checks passed (' + pass + ' cases).');

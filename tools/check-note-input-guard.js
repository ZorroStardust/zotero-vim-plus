/* global require, __dirname, console */
// Run with: node tools/check-note-input-guard.js
// Reproduce issue #6's Gecko capture order and macOS character events even
// after keydown was canceled. No real user notes or runtime dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function target(extra = {}) {
  return Object.assign({
    listeners: [],
    addEventListener(type, handler, capture = false) {
      this.listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, capture = false) {
      this.listeners = this.listeners.filter(l => l.type !== type
        || l.handler !== handler || l.capture !== capture);
    },
  }, extra);
}

function fixture(type = 'note') {
  const context = vm.createContext({
    Zotero: { debug() {}, Reader: { getByTabID: () => null } },
    Services: { focus: {} },
    Components: { utils: { cloneInto: value => value } },
    clearTimeout() {}, setTimeout() { return 1; },
  });
  for (const name of ['zoteroVim.js', 'zoteroVimMain.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
  }
  const plugin = context.ZoteroVim;
  let enabled = true;
  plugin.isNoteEditorVimEnabled = () => enabled;
  for (const name of ['_syncNoteCursorVisualState', '_syncNoteLineNumbers',
    '_clearNoteLineNumbers', '_mainShowStatus']) plugin[name] = () => {};
  const noteWin = target({ location: { href: 'resource://zotero/note-editor/editor.html' },
    Event: function (type) { this.type = type; } });
  const noteDoc = target({ defaultView: noteWin, designMode: 'off',
    body: { getAttribute() { return null; } } });
  const editor = target({ nodeType: 1, tagName: 'TEXTAREA', ownerDocument: noteDoc,
    value: 'abcdef\nghijkl', selectionStart: 3, selectionEnd: 3,
    setSelectionRange(from, to) { this.selectionStart = from; this.selectionEnd = to; },
    setRangeText(text, from, to) {
      this.value = this.value.slice(0, from) + text + this.value.slice(to);
      this.setSelectionRange(from + text.length, from + text.length);
    },
    dispatchEvent() {}, focus() {},
  });
  noteDoc.activeElement = editor;
  noteDoc.querySelector = selector => selector === '.ProseMirror' ? null : editor;
  noteWin.document = noteDoc;
  const wrapper = { _iframe: { contentWindow: noteWin } };
  const mainWin = target({
    Zotero_Tabs: { selectedType: type, selectedID: 'note-1' },
    ZoteroPane: { itemPane: { mode: 'note' } },
    ZoteroContextPane: { collapsed: false, context: { mode: 'notes' }, activeEditor: wrapper },
  });
  mainWin.document = target({ defaultView: mainWin, activeElement: wrapper._iframe,
    querySelectorAll() { return []; },
    getElementById(id) { return id === 'zotero-note-editor' ? wrapper : null; },
  });
  context.Services.focus.focusedWindow = noteWin;
  context.Zotero.Notes = { getByTabID: () => ({ _iframeWindow: noteWin }) };
  const state = { _contextNoteMode: 'normal', _contextNoteKeyBuffer: '',
    _contextNoteMainBuffer: '', _contextNoteCountBuffer: '',
    _contextNoteOperatorCountBuffer: '', _contextNoteLastYank: '' };
  mainWin.document.addEventListener('keydown', event =>
    plugin._onMainKeyDown(event, mainWin, state), true);
  plugin._syncMainContextNoteListener(mainWin, state);

  function event(type, key, extra = {}) {
    return Object.assign({ type, key, code: key?.length === 1 ? 'Key' + key.toUpperCase() : key,
      shiftKey: /^[A-Z]$/.test(key || ''),
      view: noteWin, target: editor, cancelable: true, isTrusted: true,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; },
    }, extra);
  }
  function dispatch(e) {
    for (const node of [mainWin, mainWin.document, noteWin, noteDoc]) {
      for (const listener of node.listeners.slice()) {
        if (listener.type === e.type && listener.capture) listener.handler(e);
        if (e.stopped) return e;
      }
    }
    return e;
  }
  function key(value) {
    const down = dispatch(event('keydown', value));
    // Deliberately dispatch character events despite canceled keydown, just
    // as the reporter's real macOS diagnostic trace did.
    const press = value.length === 1 ? dispatch(event('keypress', value)) : null;
    const input = value.length === 1 ? dispatch(event('beforeinput', undefined,
      { inputType: 'insertText', data: value })) : null;
    if (input && !input.defaultPrevented) {
      editor.setRangeText(value, editor.selectionStart, editor.selectionEnd);
    }
    dispatch(event('keyup', value));
    return { down, press, input };
  }
  return { plugin, state, editor, noteWin, noteDoc, mainWin, event, dispatch, key,
    disable() { enabled = false; plugin._syncMainContextNoteListener(mainWin, state); } };
}

let passed = 0;
function check(label, fn) { fn(); passed++; console.log('  ok  ' + label); }

check('hjkl moves without inserting text in note tabs, reader sidebars and library notes', () => {
  for (const type of ['note', 'reader', 'library']) {
    const f = fixture(type);
    const original = f.editor.value;
    const start = f.editor.selectionStart;
    for (const value of 'hljjjkkl') {
      const { down, press, input } = f.key(value);
      assert.equal(down.defaultPrevented, true);
      assert.equal(press.defaultPrevented, true);
      assert.equal(input.defaultPrevented, true);
      assert.equal(f.editor.value, original);
    }
    assert.notEqual(f.editor.selectionStart, start);
  }
});

check('chrome capture does not consume the original event or perform the motion', () => {
  const f = fixture();
  const e = f.event('keydown', 'h');
  f.plugin._onMainKeyDown(e, f.mainWin, f.state);
  assert.equal(e.defaultPrevented, false);
  assert.equal(e.stopped, undefined);
  assert.equal(f.editor.selectionStart, 3);
  f.dispatch(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(f.editor.selectionStart, 2);
});

check('Insert-entry commands cannot leak their final command character', () => {
  for (const command of ['i', 'a', 'A', 'I', 'o', 'O', 'cw', 'ciw', 'c$', 'cj']) {
    const f = fixture();
    for (const value of command) {
      const result = f.key(value);
      assert.equal(result.press.defaultPrevented, true, command);
      assert.equal(result.input.defaultPrevented, true, command);
    }
    assert.equal(f.state._contextNoteMode, 'insert', command);
    const expected = f.editor.value;
    const pos = f.editor.selectionStart;
    const result = f.key('z');
    assert.equal(result.down.defaultPrevented, false, command);
    assert.equal(result.press.defaultPrevented, false, command);
    assert.equal(result.input.defaultPrevented, false, command);
    assert.equal(f.editor.value, expected.slice(0, pos) + 'z' + expected.slice(pos), command);
  }
});

check('the next Insert keydown clears consumed state even before the prior keyup', () => {
  const f = fixture();
  f.dispatch(f.event('keydown', 'i'));
  assert.ok(f.state._contextNoteConsumedInput);
  const e = f.dispatch(f.event('keydown', 'h'));
  assert.equal(e.defaultPrevented, false);
  assert.equal(f.state._contextNoteConsumedInput, null);
  assert.equal(f.dispatch(f.event('beforeinput', undefined,
    { inputType: 'insertText', data: 'h' })).defaultPrevented, false);
});

check('keyup and blur release consumed input state', () => {
  for (const type of ['keyup', 'blur']) {
    const f = fixture();
    f.dispatch(f.event('keydown', 'i'));
    f.dispatch(f.event(type, 'i'));
    assert.equal(f.state._contextNoteConsumedInput, null);
    assert.equal(f.dispatch(f.event('beforeinput', undefined,
      { inputType: 'insertText', data: 'x' })).defaultPrevented, false);
  }
});

check('keypress and beforeinput are independently guarded in Normal and Visual modes', () => {
  for (const mode of ['normal', 'visual', 'visual-line']) {
    const f = fixture();
    f.state._contextNoteMode = mode;
    assert.equal(f.dispatch(f.event('keypress', 'h')).defaultPrevented, true);
    for (const inputType of ['insertText', 'insertParagraph', 'deleteContentBackward']) {
      assert.equal(f.dispatch(f.event('beforeinput', undefined,
        { inputType, data: 'h' })).defaultPrevented, true);
    }
  }
});

check('Insert typing, Backspace, IME and native undo input remain untouched', () => {
  const f = fixture();
  f.state._contextNoteMode = 'insert';
  assert.equal(f.key('h').input.defaultPrevented, false);
  const g = fixture();
  g.dispatch(g.event('keydown', 'i'));
  const nextDoc = target({ querySelector() { return null; } });
  const nextWin = target({ document: nextDoc });
  g.plugin._getActiveMainNoteEditorWindow = () => nextWin;
  g.plugin._syncMainContextNoteListener(g.mainWin, g.state);
  assert.equal(g.state._contextNoteConsumedInput, null);
  assert.equal(g.noteWin.listeners.length, 0);
  assert.equal(g.noteDoc.listeners.length, 0);
  const count = nextWin.listeners.length;
  assert.equal(count, 5);
  g.plugin._syncMainContextNoteListener(g.mainWin, g.state);
  assert.equal(nextWin.listeners.length, count);
  g.disable();
  assert.equal(nextWin.listeners.length, 0);
  assert.equal(nextDoc.listeners.length, 0);
  assert.equal(f.key('Backspace').down.defaultPrevented, false);
  for (const inputType of ['insertCompositionText', 'deleteContentBackward', 'historyUndo']) {
    assert.equal(f.dispatch(f.event('beforeinput', undefined,
      { inputType, isComposing: true })).defaultPrevented, false);
  }
});

check('Vim native undo and synchronous editing are not blocked by the guard', () => {
  const f = fixture();
  let undoInput;
  f.noteWin.doUndo = () => {
    undoInput = f.dispatch(f.event('beforeinput', undefined, { inputType: 'historyUndo' }));
    return true;
  };
  f.key('u');
  assert.equal(undoInput.defaultPrevented, false);
  let nestedInput;
  f.plugin._handleMainContextNoteNormalKey = () => {
    nestedInput = f.dispatch(f.event('beforeinput', undefined,
      { inputType: 'insertText', data: 'replacement' }));
    return true;
  };
  f.key('r');
  assert.equal(nestedInput.defaultPrevented, false);
  assert.equal(f.state._contextNoteKeyHandling, undefined);
});

check('search text stays native but the command that opened search cannot leak', () => {
  const f = fixture();
  const searchInput = { tagName: 'INPUT', ownerDocument: f.noteDoc };
  f.state._contextNoteSearchUI = { input: searchInput };
  assert.equal(f.dispatch(f.event('keydown', 'h', { target: searchInput })).defaultPrevented, false);
  assert.equal(f.dispatch(f.event('beforeinput', undefined,
    { target: searchInput, inputType: 'insertText', data: 'h' })).defaultPrevented, false);
  f.state._contextNoteConsumedInput = { key: '/', code: 'Slash', doc: f.noteDoc };
  assert.equal(f.dispatch(f.event('keypress', '/',
    { target: searchInput, code: 'Slash' })).defaultPrevented, true);
  assert.equal(f.dispatch(f.event('beforeinput', undefined,
    { target: searchInput, inputType: 'insertText', data: '/' })).defaultPrevented, true);
});

check('guards never cancel foreign documents, untrusted commands or noncancelable input', () => {
  const f = fixture();
  for (const extra of [{ target: { ownerDocument: {} } },
    { isTrusted: false }, { cancelable: false }, { _zvNoteEditorCommand: true }]) {
    assert.equal(f.dispatch(f.event('beforeinput', undefined,
      { inputType: 'insertText', data: 'h', ...extra })).defaultPrevented, false);
  }
  for (const inputType of ['formatBold', 'historyUndo']) {
    assert.equal(f.dispatch(f.event('beforeinput', undefined, { inputType })).defaultPrevented, false);
  }
});

check('editor changes and disabling Vim remove all guards and clear consumed state', () => {
  const f = fixture();
  f.dispatch(f.event('keydown', 'i'));
  assert.ok(f.state._contextNoteConsumedInput);
  f.disable();
  assert.equal(f.state._contextNoteConsumedInput, null);
  assert.equal(f.noteWin.listeners.length, 0);
  assert.equal(f.noteDoc.listeners.length, 0);
  assert.equal(f.key('h').input.defaultPrevented, false);
});

check('handler errors restore the editing bypass and still protect consumed characters', () => {
  const f = fixture();
  f.plugin._handleMainContextNoteNormalKey = () => { throw new Error('test failure'); };
  assert.throws(() => f.dispatch(f.event('keydown', 'h')), /test failure/);
  assert.equal(f.state._contextNoteKeyHandling, undefined);
  assert.equal(f.dispatch(f.event('beforeinput', undefined,
    { inputType: 'insertText', data: 'h' })).defaultPrevented, true);
});

console.log('Note input guard checks passed (' + passed + ' cases).');

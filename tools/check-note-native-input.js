/* global require, __dirname, console */
// Run with: node tools/check-note-native-input.js
// Issue #6 follow-up: disabling note Vim must not expose native note input to
// main-window navigation. No runtime dependencies or real user notes required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = ['zoteroVim.js', 'zoteroVimMain.js']
  .map(file => fs.readFileSync(path.join(root, 'content', file), 'utf8'));

function fixture(type = 'library', enabled = false) {
  const context = vm.createContext({
    Zotero: { debug() {}, Reader: { getByTabID: () => null } },
    Services: { focus: { focusedWindow: null } },
    clearTimeout() {}, setTimeout() { return 1; },
  });
  sources.forEach(source => vm.runInContext(source, context));
  const plugin = context.ZoteroVim;
  plugin.isNoteEditorVimEnabled = () => enabled;
  plugin.getBindings = () => plugin.DEFAULT_BINDINGS;
  plugin._updateIndicator = () => {};
  const actions = [];
  const statuses = [];
  const listeners = [];
  const editable = { tagName: 'DIV', isContentEditable: true };
  const noteDoc = {
    activeElement: editable, designMode: 'off',
    body: { isContentEditable: false, getAttribute() { return null; } },
    querySelector() { return editable; },
    addEventListener(...args) { listeners.push(args); }, removeEventListener() {},
  };
  const noteWin = {
    document: noteDoc, location: { href: 'resource://zotero/note-editor/editor.html' },
    addEventListener(...args) { listeners.push(args); }, removeEventListener() {},
  };
  noteDoc.defaultView = noteWin;
  editable.ownerDocument = noteDoc;
  const frame = { tagName: 'IFRAME', localName: 'iframe', contentWindow: noteWin };
  const doc = {
    activeElement: frame,
    getElementById() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const win = {
    document: doc,
    Zotero_Tabs: { selectedID: 'tab-1', selectedType: type },
    ZoteroContextPane: {
      collapsed: false, context: { mode: 'notes' },
      activeEditor: { _editorInstance: { _iframeWindow: noteWin } },
    },
  };
  doc.defaultView = win;
  frame.ownerDocument = doc;
  context.Zotero.Notes = {
    getByTabID: () => type === 'note' ? { _iframeWindow: noteWin } : null,
  };
  context.Services.focus.focusedWindow = noteWin;
  const cv = {
    selection: { focused: 1, count: 1, select(index) { this.focused = index; } },
    getParentIndex: () => 0, ensureRowIsVisible() {},
  };
  plugin._mainCollectionsView = () => cv;
  plugin._mainShowStatus = (_win, text) => statuses.push(text);
  plugin._forwardReaderKey = () => actions.push('readerForward');
  const state = {
    pickerOpen: false, notesLayoutOpen: false, keyBuffer: '', countBuffer: '',
    _contextNoteMode: 'normal', _contextNoteEditorWin: noteWin,
    _contextNoteEditorDoc: noteDoc, activePanelFocus: 'collections',
    executeAction(action, count) {
      actions.push(action);
      plugin._executeMainAction(action, win, state, count);
    },
  };
  // Exercise the real preference-disable cleanup, which erases tracked note DOM.
  if (!enabled) plugin._syncMainContextNoteListener(win, state);
  function key(value, original = false) {
    const event = {
      key: value, view: original ? noteWin : win, target: original ? editable : frame,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.immediatePropagationStopped = true; },
    };
    plugin._onMainKeyDown(event, win, state);
    return event;
  }
  return { context, plugin, win, doc, noteWin, noteDoc, editable, frame,
    state, actions, statuses, listeners, cv, key };
}

let pass = 0;
function check(label, fn) { fn(); pass++; console.log('  ok  ' + label); }
function untouched(f, event) {
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, undefined);
  assert.equal(event.immediatePropagationStopped, undefined);
  assert.deepEqual(f.actions, []);
  assert.deepEqual(f.statuses, []);
  assert.equal(f.state.keyBuffer, '');
  assert.equal(f.state.countBuffer, '');
}

check('disabled note tabs and side-panel notes keep all native keys untouched', () => {
  for (const type of ['note', 'library', 'reader']) {
    for (const original of [false, true]) {
      for (const value of ['Backspace', 'Delete', 'h', 'j', 'k', ' ', '1',
        'J', 'K', 'Enter', 'Escape', '/', 't']) {
        const f = fixture(type);
        assert.equal(f.state._contextNoteEditorDoc, null);
        untouched(f, f.key(value, original));
        assert.equal(f.listeners.length, 0);
      }
    }
  }
});

check('native side-panel focus is detected after the Vim listener is cleared', () => {
  const f = fixture();
  assert.equal(f.plugin._isMainNoteTextEditing(f.win), true);
  assert.equal(f.plugin._isMainTextEditing(f.win, f.state), true);
  untouched(f, f.key('Backspace'));
});

check('browser wrappers protect note input even without Gecko focusedWindow', () => {
  const f = fixture();
  f.context.Services.focus.focusedWindow = null;
  f.frame.tagName = 'BROWSER';
  f.frame.localName = 'browser';
  untouched(f, f.key('Backspace'));
});

check('nested iframe and shadow-root focus chains reach the native note editor', () => {
  for (const shadow of [false, true]) {
    const f = fixture();
    f.context.Services.focus.focusedWindow = null;
    f.doc.activeElement = shadow ? { shadowRoot: {
      activeElement: f.frame, querySelector() { return null; },
    } }
      : { contentWindow: { document: { activeElement: f.frame } } };
    untouched(f, f.key('Backspace'));
  }
});

check('the original note event is protected even if chrome focus information lags', () => {
  const f = fixture();
  f.context.Services.focus.focusedWindow = f.win;
  f.doc.activeElement = { tagName: 'BODY' };
  untouched(f, f.key('Backspace', true));
});

check('older note editors without context-pane APIs are protected by real iframe focus', () => {
  const f = fixture();
  f.win.ZoteroContextPane = null;
  f.context.Services.focus.focusedWindow = null;
  untouched(f, f.key('Backspace'));
});

check('original note events remain protected without any note lookup API', () => {
  const f = fixture();
  f.win.ZoteroContextPane = null;
  f.context.Services.focus.focusedWindow = f.win;
  f.doc.activeElement = { tagName: 'BODY' };
  untouched(f, f.key('Backspace', true));
});

check('native input and textarea focus and older designMode editors remain protected', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'BODY']) {
    const f = fixture();
    f.noteDoc.activeElement = { tagName: tag, isContentEditable: false };
    if (tag === 'BODY') f.noteDoc.designMode = 'on';
    untouched(f, f.key('Backspace'));
  }
});

check('loading disabled note tabs cannot fall through to collection navigation', () => {
  const f = fixture('note');
  f.context.Zotero.Notes.getByTabID = () => null;
  untouched(f, f.key('Backspace'));
});

check('stale editable focus inside a note does not block collection-tree Backspace', () => {
  for (const type of ['library', 'note']) {
    const f = fixture(type);
    f.context.Services.focus.focusedWindow = f.win;
    f.doc.activeElement = { tagName: 'DIV', id: 'collection-tree' };
    assert.equal(f.noteDoc.activeElement.isContentEditable, true);
    assert.equal(f.plugin._isMainNoteTextEditing(f.win), false);
    const event = f.key('Backspace');
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(f.actions, ['mainTreeParent']);
    assert.equal(f.cv.selection.focused, 0);
    assert.deepEqual(f.statuses, ['→ parent']);
  }
});

check('a remembered Insert mode cannot block library tab shortcuts after disabling Vim', () => {
  const f = fixture();
  f.state._contextNoteMode = 'insert';
  f.context.Services.focus.focusedWindow = f.win;
  f.doc.activeElement = { tagName: 'DIV', id: 'collection-tree' };
  const tabs = [];
  f.plugin._executeMainAction = action => tabs.push(action);
  assert.equal(f.key('J').defaultPrevented, true);
  assert.deepEqual(tabs, ['mainPrevTab']);
});

check('enabled side-panel Insert keys still bypass main bindings', () => {
  const f = fixture('library', true);
  f.state._contextNoteMode = 'insert';
  untouched(f, f.key('Backspace'));
});

check('enabled standalone Normal events still reach note Vim once', () => {
  const f = fixture('note', true);
  f.plugin._syncMainContextNoteListener = () => {};
  let commands = 0;
  f.plugin._handleMainContextNoteNormalKey = event => {
    assert.equal(event.defaultPrevented, true);
    commands++;
    return true;
  };
  assert.equal(f.key('h', true).defaultPrevented, true);
  f.key('h');
  assert.equal(commands, 1);
  assert.deepEqual(f.actions, []);
});

check('enabled standalone Insert Backspace stays native, including forwarded copies', () => {
  const f = fixture('note', true);
  f.plugin._syncMainContextNoteListener = () => {};
  f.state._contextNoteMode = 'insert';
  untouched(f, f.key('Backspace', true));
  untouched(f, f.key('Backspace'));
});

check('main-window search fields retain native input and Escape-to-blur', () => {
  const f = fixture();
  let blurred = false;
  f.doc.activeElement = { tagName: 'INPUT', blur() { blurred = true; } };
  f.context.Services.focus.focusedWindow = f.win;
  untouched(f, f.key('Backspace'));
  assert.equal(f.key('Escape').defaultPrevented, true);
  assert.equal(blurred, true);
});

check('missing or inaccessible note editors do not disable ordinary library navigation', () => {
  for (const inaccessible of [false, true]) {
    const f = fixture();
    f.win.ZoteroContextPane.collapsed = true;
    f.doc.activeElement = { tagName: 'DIV', id: 'collection-tree' };
    f.context.Services.focus.focusedWindow = f.win;
    if (inaccessible) {
      f.win.ZoteroContextPane.collapsed = false;
      Object.defineProperty(f.win.ZoteroContextPane.activeEditor._editorInstance,
        '_iframeWindow', { get() { throw new Error('not accessible'); } });
    }
    assert.equal(f.key('Backspace').defaultPrevented, true);
    assert.deepEqual(f.actions, ['mainTreeParent']);
  }
});

console.log('Native note-input checks passed (' + pass + ' cases).');

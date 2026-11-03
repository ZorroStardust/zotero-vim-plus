/* global require, __dirname, console */
// Exercise shortcut discovery, native input ownership and restoration across windows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function events(target = {}) {
  const listeners = new Map();
  target.listeners = listeners;
  target.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  };
  target.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  target.emit = (type, extra = {}) => {
    const event = { target, type,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
    for (const fn of [...(listeners.get(type) || [])]) fn(event);
    return event;
  };
  return target;
}

function fixture() {
  const timers = new Map(), values = new Map();
  let serial = 0;
  const context = vm.createContext({
    Zotero: { debug() {}, locale: 'zh-CN', Reader: {} }, Services: { focus: {} },
    Components: { utils: { unwrap: v => v, exportFunction: fn => fn } },
    setTimeout(fn) { timers.set(++serial, fn); return serial; },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const name of ['keymapLabels.js', 'zoteroVim.js', 'zoteroVimReader.js',
    'zoteroVimMain.js', 'zoteroVimHelp.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content', name), 'utf8'), context);
  }
  const z = context.ZoteroVim;
  z.getPref = (key, fallback) => values.has(key) ? values.get(key) : fallback;
  z.setPref = (key, value) => values.set(key, value);
  z._isStandaloneNoteTabSelected = () => false;
  z._isMainNoteTextEditing = () => false;
  z._syncNoteCursorVisualState = () => {};
  z._mainShowStatus = () => {};
  let searches = 0;
  z._openSearch = () => searches++;
  function window() {
    const win = events({ closed: false, focusCount: 0,
      focus() { this.focusCount++; context.Services.focus.focusedWindow = this; } });
    const doc = events({ defaultView: win, querySelector: () => null, getElementById: () => null });
    doc.createElementNS = (_ns, tag) => events({
      nodeType: 1, tagName: tag.toUpperCase(), ownerDocument: doc, children: [], parentNode: null,
      style: {}, attrs: {}, textContent: '', value: '', clientHeight: 500,
      scrollHeight: 5000, scrollTop: 0, focusCount: 0,
      get firstChild() { return this.children[0]; },
      get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; },
      appendChild(node) { this.children.push(node); node.parentNode = this; },
      removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; },
      remove() { this.parentNode?.removeChild(this); },
      setAttribute(name, value) { this.attrs[name] = value; },
      contains(other) {
        for (; other; other = other.parentNode) if (other === this) return true;
        return false;
      },
      focus() {
        this.focusCount++; doc.activeElement = this;
        context.Services.focus.focusedWindow = win;
        doc.emit('focusin', { target: this });
      },
      select() { this.selectionStart = 0; this.selectionEnd = this.value.length; },
      setSelectionRange(start, end, direction) {
        this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
      },
    });
    doc.body = doc.createElementNS('', 'body'); doc.documentElement = doc.body;
    doc.activeElement = doc.body; win.document = doc;
    const selection = { anchorNode: doc.body, focusNode: doc.body, anchorOffset: 5, focusOffset: 1,
      rangeCount: 1,
      getRangeAt: () => ({ cloneRange: () => ({ commonAncestorContainer: doc.body }) }),
      setBaseAndExtent(anchor, from, focus, to) {
        this.anchorNode = anchor; this.anchorOffset = from;
        this.focusNode = focus; this.focusOffset = to;
      } };
    win.getSelection = () => selection;
    return win;
  }
  const win = window(), outer = window(), pdf = window(), secondary = window(), note = window();
  win.Zotero_Tabs = { selectedID: 'library' };
  const main = { win, mode: 'main', keyBuffer: '', countBuffer: '',
    _contextNoteMode: 'normal', _contextNoteMainBuffer: '',
    _contextNoteEditorWin: note, _contextNoteEditorDoc: note.document };
  main.executeAction = (action, count) => z._executeMainAction(action, win, main, count);
  const reader = { _instanceID: 'r', _window: win, _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: pdf, _textAnnotationFocused: () => false },
      _secondaryView: { _iframeWindow: secondary, _textAnnotationFocused: () => false } } };
  const state = { reader, mode: 'normal', keyBuffer: '', countBuffer: '', pdfWin: pdf,
    activePdfWin: pdf, smoothHold: { active: true, key: 'j', rafId: null } };
  state.executeAction = (action, count) => z._executeAction(action, reader, state, state.activePdfWin, count);
  z._readerState.set('r', state); z._mainWindowState.set(win, main);
  const editable = note.document.createElementNS('', 'textarea');
  editable.value = 'A note that must stay unchanged';
  editable.selectionStart = 2; editable.selectionEnd = 7; editable.selectionDirection = 'backward';
  note.document.body.appendChild(editable); note.document.activeElement = editable;
  context.Services.focus.focusedWindow = win;
  const event = (key, target, extra = {}) => ({ key, target, ...extra,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }, stopPropagation() { this.stopped = true; } });
  const mainKey = key => z._onMainKeyDown(event(key, win.document.activeElement), win, main);
  const pdfKey = (key, view = pdf) => {
    const e = event(key, view.document.activeElement);
    context.Services.focus.focusedWindow = view;
    z._onKeyDown(e, reader, state, view); return e;
  };
  const noteKey = key => {
    context.Services.focus.focusedWindow = note;
    z._onMainContextNoteKeyDown(event(key, editable), win, main);
  };
  const helpKey = (key, extra = {}, target) => {
    const ui = z._shortcutHelpForWindow(win);
    const e = event(key, target || win.document.activeElement, extra);
    z._onShortcutHelpKeyDown(e, ui); return e;
  };
  return { z, values, timers, win, outer, pdf, secondary, note, editable, reader, state, main,
    context, window, event, mainKey, pdfKey, noteKey, helpKey, searches: () => searches };
}

let passed = 0;
function check(label, fn) { fn(); passed++; console.log('  ok  ' + label); }

check('Space / opens from the library, reader and note Normal mode', () => {
  for (const source of ['main', 'pdf', 'note']) {
    const f = fixture();
    for (const key of ' /') f[source + 'Key'](key);
    const ui = f.z._shortcutHelpForWindow(f.win);
    assert(ui, source); assert.equal(f.win.document.activeElement, ui.input);
    assert.equal(ui.overlay.ownerDocument, f.win.document);
    assert.equal(f.state.smoothHold.active, false);
    assert(!f.main._spacekeys);
    assert(!f.state._spacekeys);
    assert.equal(f.searches(), 0);
    f.helpKey('Escape'); assert.equal(f.z._shortcutHelpForWindow(f.win), null);
  }
});

check('bare / keeps document search and Insert mode keeps native typing', () => {
  const f = fixture();
  f.pdfKey('/'); assert.equal(f.searches(), 1);
  f.state.mode = 'insert'; f.pdfKey(' '); f.pdfKey('/');
  assert.equal(f.z._shortcutHelpForWindow(f.win), null);
  f.main._contextNoteMode = 'insert'; f.noteKey(' '); f.noteKey('/');
  assert.equal(f.z._shortcutHelpForWindow(f.win), null);
});

check('Space / also works from a focused outline and a reader using its iframe window', () => {
  const f = fixture();
  delete f.reader._window;
  f.reader._iframe = { ownerDocument: f.win.document };
  f.state.outlineExplorerOpen = true;
  f.z._readerOutlineExplorerFocused = () => true;
  let headingSearches = 0, treeMoves = 0;
  f.z._onReaderOutlineExplorerKeyDown = e => {
    if (e.key === '/') { headingSearches++; return true; }
    if (e.key === 'j') { treeMoves++; return true; }
    return false;
  };
  f.pdfKey(' '); f.pdfKey('/');
  assert(f.state._shortcutHelp);
  assert.equal(f.state.smoothHold.active, false);
  assert.equal(headingSearches, 0);
  f.helpKey('Escape'); f.pdfKey('/'); assert.equal(headingSearches, 1);
  f.pdfKey(' '); f.pdfKey('j');
  assert.equal(treeMoves, 1); assert.equal(f.state.keyBuffer, '');
  assert.equal(f.state._spacekeys, null);
});

check('actual remaps, tombstones, note inheritance and cursor arguments stay accurate', () => {
  const f = fixture();
  f.values.set('bindings', JSON.stringify({ 'normal: fh': null,
    'normal: f中': 'readerOutlinePick', 'cursor:f': null, 'cursor:Q': 'cursorFindForward',
    'main: zz': 'mainFuzzyAll' }));
  const rows = f.z._shortcutHelpRows();
  assert(!rows.some(row => row.key === 'Space fh'));
  assert(rows.some(row => row.key === 'Space f中' && row.zh.includes('目录')));
  assert(!rows.some(row => row.scope === 'cursor' && row.key === 'f + {char}'));
  assert(rows.some(row => row.key === 'Q + {char}'));
  assert(rows.some(row => row.scope === 'noteNormal' && row.key === 'Space zz' && row.custom));
  assert(rows.some(row => row.scope === 'noteObjects' && row.key.includes('it')));
  assert(rows.some(row => row.scope === 'translation'));
  assert(rows.some(row => row.scope === 'outline'));
  assert(rows.some(row => row.key === 'm{a–z,0–9}'));
  f.values.set('bindings', JSON.stringify({ 'normal:m': 'mainNotesLayout' }));
  assert(!f.z._shortcutHelpRows().some(row => row.key === 'm{a–z,0–9}'));
});

check('Chinese/English text, literal keys and category filters combine without regex parsing', () => {
  const f = fixture(); f.mainKey(' '); f.mainKey('/');
  const ui = f.main._shortcutHelp;
  ui.input.value = 'Space 目录'; ui.input.emit('input');
  assert(ui.filtered.length > 0);
  assert(ui.filtered.every(row => row.key.includes('Space') && row.zh.includes('目录')));
  ui.input.value = '['; ui.input.emit('input'); assert(ui.filtered.length > 0);
  ui.categories.find(entry => entry.category === 'notes').button.emit('click');
  assert(ui.filtered.every(row => row.category === 'notes'));
  ui.input.value = 'no such command xyz'; ui.input.emit('input');
  assert.equal(ui.filtered.length, 0);
  ui.input.value = 'delete'; ui.input.emit('input'); assert(ui.filtered.length > 0);
  assert(ui.filtered.every(row => row.category === 'notes'));
});

check('native search typing and IME stay native while navigation scrolls only the dialog', () => {
  const f = fixture(); f.mainKey(' '); f.mainKey('/');
  const ui = f.main._shortcutHelp;
  for (const key of ['j', 'k', 'y', '/', '中', '[']) {
    const e = f.helpKey(key);
    assert.equal(e.defaultPrevented, undefined); assert.equal(e.stopped, true);
  }
  assert.equal(f.helpKey('Escape', { isComposing: true }).defaultPrevented, undefined);
  assert.equal(f.main._shortcutHelp, ui);
  ui.input.emit('compositionstart'); f.helpKey('Escape'); assert.equal(f.main._shortcutHelp, ui);
  ui.input.emit('compositionend');
  f.helpKey('j', { ctrlKey: true }); assert.equal(ui.list.scrollTop, 60);
  f.helpKey('ArrowUp'); assert.equal(ui.list.scrollTop, 0);
  ui.list.focus(); f.helpKey('j'); assert.equal(ui.list.scrollTop, 60);
  f.helpKey('G'); assert.equal(ui.list.scrollTop, ui.list.scrollHeight);
  f.helpKey('f', { ctrlKey: true }); assert.equal(f.win.document.activeElement, ui.input);
  assert.equal(f.helpKey('Tab').defaultPrevented, undefined);
  assert.equal(f.helpKey('Tab', { shiftKey: true }).defaultPrevented, undefined);
});

check('compact groups preserve every effective command, aliases and mode boundaries', () => {
  const f = fixture();
  const raw = f.z._shortcutHelpRows(), grouped = f.z._compactShortcutHelpRows(raw);
  const id = row => [row.category, row.scope, row.key, row.action].join('\n');
  assert.deepEqual(Array.from(grouped.flatMap(row => row.members), id).sort(),
    Array.from(raw, id).sort());
  assert(grouped.length < raw.length);
  const normal = grouped.filter(row => row.scope === 'normal');
  assert.equal(normal.find(row => row.key === 'j/k/H/L').zh, '向下／上／左／右滚动');
  assert.equal(normal.find(row => row.key === 'h/l').zh, '上一页／下一页');
  assert(normal.some(row => row.key === 'gg/G'));
  assert(normal.some(row => row.key === '*/#'));
  assert(normal.some(row => row.key === 'Ctrl+d/u'));
  assert(normal.some(row => row.key === 'Space ff/fb/fh'));
  assert(normal.find(row => row.action.includes('recolorBlue')).zh.includes('zb→页底'));
  assert(grouped.some(row => row.scope === 'cursor' && row.key === 'f/F/t/T + {char}'));
  assert(grouped.some(row => row.scope === 'main' && row.key === 't1…t9 / t0'));
  assert(grouped.every(row => row.members.every(member => member.scope === row.scope)));
  assert(grouped.every(row => !row.en.includes('undefined') && !row.zh.includes('undefined')));
});

check('partial groups use remapped keys and descriptions without restoring unbound actions', () => {
  const f = fixture();
  f.values.set('bindings', JSON.stringify({ 'normal:j': null, 'normal:k': null,
    'normal:x': 'scrollDown', 'normal:Z': 'scrollRight', 'main:t3': null }));
  const grouped = f.z._compactShortcutHelpRows(f.z._shortcutHelpRows());
  const scroll = grouped.find(row => row.scope === 'normal' && row.action.includes('scrollDown'));
  assert.equal(scroll.key, 'x/H/(L, Z)');
  assert.equal(scroll.zh, '向下／左／右滚动');
  assert.equal(scroll.custom, true);
  assert(!scroll.members.some(member => member.action === 'scrollUp'));
  const tags = grouped.find(row => row.scope === 'main' && row.action.includes('mainColoredTag1'));
  assert(!tags.key.includes('t3')); assert(!tags.key.includes('…'));
  assert(!tags.members.some(member => member.action === 'mainColoredTag3'));
});

check('grouped search still finds individual commands and hidden alias descriptions', () => {
  const f = fixture(); f.mainKey(' '); f.mainKey('/');
  const ui = f.main._shortcutHelp;
  ui.input.value = 'scrollLeft'; ui.input.emit('input');
  assert(ui.filtered.some(row => row.key === 'j/k/H/L'));
  ui.input.value = '上一页'; ui.input.emit('input');
  assert(ui.filtered.some(row => row.key === 'h/l'));
  ui.input.value = 'Ctrl+u'; ui.input.emit('input');
  assert(ui.filtered.some(row => row.key === 'Ctrl+d/u'));
  ui.input.value = '空格 目录'; ui.input.emit('input');
  assert(ui.filtered.some(row => row.key === 'Space ff/fb/fh'));
  ui.category = 'notes';
  for (const key of ['iw', 'aW', 'i"', 'a\'', 'i]', 'iB', 'a>']) {
    ui.input.value = key; ui.input.emit('input');
    assert(ui.filtered.some(row => row.scope === 'noteObjects'), key);
  }
});

check('Ctrl+h/l cycles categories from any control, preserving query and native editing', () => {
  const f = fixture(); f.mainKey(' '); f.mainKey('/');
  const ui = f.main._shortcutHelp;
  ui.input.value = 'search'; ui.input.emit('input'); ui.list.scrollTop = 150;
  assert.equal(f.helpKey('l', { ctrlKey: true }).defaultPrevented, true);
  assert.equal(ui.category, 'reader'); assert.equal(ui.input.value, 'search');
  assert.equal(ui.list.scrollTop, 0); assert.equal(f.win.document.activeElement, ui.input);
  assert(ui.filtered.every(row => row.category === 'reader'));
  f.helpKey('h', { ctrlKey: true }); assert.equal(ui.category, 'all');
  f.helpKey('h', { ctrlKey: true }); assert.equal(ui.category, 'popups');
  ui.list.focus(); f.helpKey('l', { ctrlKey: true }); assert.equal(ui.category, 'all');
  assert.equal(f.win.document.activeElement, ui.list);
  f.helpKey('Backspace', { ctrlKey: true, code: 'KeyH' });
  assert.equal(ui.category, 'popups'); // Gecko can deliver Ctrl+h as Backspace.
  f.helpKey('\f', { ctrlKey: true }); assert.equal(ui.category, 'all');
  assert.equal(f.helpKey('Backspace', { ctrlKey: true }).defaultPrevented, undefined);
  assert.equal(ui.category, 'all'); // Actual Ctrl+Backspace keeps its native editing role.
  ui.input.emit('compositionstart');
  f.helpKey('l', { ctrlKey: true }); assert.equal(ui.category, 'all');
  ui.input.emit('compositionend');
  assert.equal(ui.input.value, 'search');
});

check('PDF and note forwarding cannot trigger background commands or refocus the document', () => {
  const f = fixture(); f.pdfKey(' '); f.pdfKey('/');
  const ui = f.state._shortcutHelp;
  assert.equal(f.z._readerConsumesKey(f.state, 'r', f.pdf), true);
  f.z._patchReaderTextAnnotationFocus(f.reader, f.state);
  assert.equal(f.reader._internalReader._primaryView._textAnnotationFocused(), true);
  assert.equal(f.reader._internalReader._secondaryView._textAnnotationFocused(), true);
  for (const value of ['j', 'd', 'J', 'Enter', '/']) {
    const e = f.event(value, f.pdf.document.body);
    f.z._onKeyDown(e, f.reader, f.state, f.pdf);
    assert.equal(e.defaultPrevented, true);
    assert.equal(f.win.document.activeElement, ui.input);
  }
  const e = f.event('x', f.editable);
  f.z._onMainContextNoteKeyDown(e, f.win, f.main);
  assert.equal(e.defaultPrevented, true); assert.equal(f.editable.value, 'A note that must stay unchanged');
  assert.equal(f.searches(), 0); assert.equal(f.state.smoothHold.active, false);
  f.helpKey('Escape');
  assert.equal(f.reader._internalReader._primaryView._textAnnotationFocused(), false);
});

check('closing restores backward PDF selections and the originating split pane', () => {
  const f = fixture(); f.pdfKey(' ', f.secondary); f.pdfKey('/', f.secondary);
  const before = f.secondary.getSelection();
  before.anchorOffset = 0; before.focusOffset = 0;
  f.helpKey('Escape');
  assert.equal(f.context.Services.focus.focusedWindow, f.secondary);
  assert.equal(before.anchorOffset, 5); assert.equal(before.focusOffset, 1);
  assert.equal(f.state.activePdfWin, f.secondary); assert.equal(f.state.mode, 'normal');
  assert.equal(f.timers.size, 0);
});

check('note text, selection and mode survive opening and closing outside managed content', () => {
  const f = fixture(); f.noteKey(' '); f.noteKey('/');
  const ui = f.main._shortcutHelp;
  assert.equal(f.note.document.body.children.length, 1);
  assert.equal(f.editable.value, 'A note that must stay unchanged');
  f.editable.setSelectionRange(0, 0, 'forward');
  assert.equal(ui.overlay.emit('mousedown').defaultPrevented, true);
  assert.equal(f.context.Services.focus.focusedWindow, f.note);
  assert.equal(f.editable.selectionStart, 2); assert.equal(f.editable.selectionEnd, 2);
  assert.equal(f.main._contextNoteMode, 'normal');
});

check('focus is contained, duplicate open is idempotent and handlers are removed on close', () => {
  const f = fixture(); f.mainKey(' '); f.mainKey('/');
  const ui = f.main._shortcutHelp;
  assert.equal(ui.overlay.emit('wheel').defaultPrevented, true);
  assert.equal(ui.overlay.emit('wheel', { target: ui.list }).defaultPrevented, undefined);
  const key = Object.freeze({ key: 'j', ctrlKey: true, target: ui.input,
    preventDefault() {}, stopImmediatePropagation() {} });
  f.z._onShortcutHelpKeyDown(key, ui);
  f.z._onShortcutHelpKeyDown(key, ui);
  assert.equal(ui.list.scrollTop, 60); // Cross-compartment events need no writable flag.
  f.win.document.body.focus(); assert.equal(f.win.document.activeElement, ui.input);
  f.z._openShortcutHelp(f.state, f.win, f.pdf);
  assert.equal(f.z._shortcutHelpForWindow(f.win), ui);
  assert.equal(f.win.document.body.children.filter(node => node.id === 'zv-shortcut-help').length, 1);
  f.helpKey('Escape');
  for (const target of [f.win, f.win.document]) {
    assert([...target.listeners.values()].every(list => list.size === 0));
  }
  for (const fn of [...f.timers.values()]) fn();
  assert.equal(f.z._shortcutHelpForWindow(f.win), null);
});

check('two chrome windows keep independent dialogs and cleanup ownership', () => {
  const f = fixture(); f.mainKey(' '); f.mainKey('/');
  const first = f.main._shortcutHelp;
  const win = f.window(), owner = { win, mode: 'main' };
  f.z._mainWindowState.set(win, owner);
  f.z._openShortcutHelp(owner, win, win);
  assert(owner._shortcutHelp); assert.equal(f.main._shortcutHelp, first);
  f.z._closeShortcutHelp(owner, false);
  assert.equal(owner._shortcutHelp, null); assert.equal(f.main._shortcutHelp, first);
});

check('tab changes, replaced panes, note replacement and deactivation never restore stale focus', () => {
  for (const change of ['tab', 'pane', 'deactivate', 'note']) {
    const f = fixture();
    if (change === 'note') { f.noteKey(' '); f.noteKey('/'); }
    else { f.pdfKey(' '); f.pdfKey('/'); }
    const owner = change === 'note' ? f.main : f.state;
    const source = change === 'note' ? f.note : f.pdf;
    const before = source.focusCount;
    if (change === 'tab') f.win.Zotero_Tabs.selectedID = 'another';
    if (change === 'pane') f.reader._internalReader._primaryView = null;
    if (change === 'note') f.main._contextNoteEditorDoc = f.window().document;
    if (change === 'deactivate') f.win.emit('deactivate');
    else f.z._syncShortcutHelp(owner);
    assert.equal(owner._shortcutHelp, null, change);
    assert.equal(source.focusCount, before, change); assert.equal(f.timers.size, 0);
  }
});

check('legacy search migration changes only the old default and runs once', () => {
  const f = fixture();
  f.values.set('bindings', JSON.stringify({ 'main: /': 'mainFocusSearch', 'normal:j': null }));
  f.z._migrateShortcutHelpBinding();
  const saved = JSON.parse(f.values.get('bindings'));
  assert.equal(saved['main: /'], undefined); assert.equal(saved['normal:j'], null);
  assert.equal(f.z.getBindings()['main: /'], 'showShortcutHelp');
  f.values.set('bindings', JSON.stringify({ 'main: /': 'mainFocusSearch' }));
  f.z._migrateShortcutHelpBinding();
  assert.equal(f.z.getBindings()['main: /'], 'mainFocusSearch');
  const custom = fixture();
  custom.values.set('bindings', JSON.stringify({ 'main: /': 'mainNotesLayout' }));
  custom.z._migrateShortcutHelpBinding();
  assert.equal(custom.z.getBindings()['main: /'], 'mainNotesLayout');
});

check('shared descriptions cover all built-in actions and the UI follows the chosen language', () => {
  const f = fixture();
  for (const action of new Set(Object.values(f.z.DEFAULT_BINDINGS))) {
    assert(vm.runInContext('ZV_KEYMAP_LABELS.en', f.context)[action], action);
    assert(vm.runInContext('ZV_KEYMAP_LABELS["zh-CN"]', f.context)[action], action);
  }
  f.values.set('language', 'en'); f.mainKey(' '); f.mainKey('/');
  const ui = f.main._shortcutHelp;
  assert.equal(ui.zh, false); assert.match(ui.count.textContent, /shortcut groups/);
  assert.equal(f.z._spacekeysRows('normal:', ' ').find(row => row.key === '/').label,
    'All plugin shortcuts');
});

console.log('Shortcut help checks passed: ' + passed);

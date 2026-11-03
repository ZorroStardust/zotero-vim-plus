/* global require, __dirname, console */
// Exercise real key routing and popup ownership across chrome/PDF/note windows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function events(target = {}) {
  target.listeners = new Map();
  target.addEventListener = (type, fn) => {
    if (!target.listeners.has(type)) target.listeners.set(type, new Set());
    target.listeners.get(type).add(fn);
  };
  target.removeEventListener = (type, fn) => target.listeners.get(type)?.delete(fn);
  target.emit = (type, extra = {}) => {
    for (const fn of [...(target.listeners.get(type) || [])]) fn({ target, ...extra });
  };
  return target;
}

function windowFixture() {
  const win = events({ innerHeight: 800 });
  const frames = new Map();
  let serial = 0;
  win.requestAnimationFrame = fn => { frames.set(++serial, fn); return serial; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.frame = time => {
    for (const [id, fn] of [...frames]) { frames.delete(id); fn(time); }
  };
  win.frames = frames;
  const doc = events({ defaultView: win });
  doc.createElementNS = (_ns, tag) => events({
    nodeType: 1, tagName: tag.toUpperCase(), ownerDocument: doc,
    style: {}, children: [], textContent: '',
    get firstChild() { return this.children[0]; },
    get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; },
    setAttribute() {},
    appendChild(node) { this.children.push(node); node.parentNode = this; },
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; },
    remove() { this.parentNode?.removeChild(this); },
    contains(node) {
      for (; node; node = node.parentNode) if (node === this) return true;
      return false;
    },
    focus() { throw Error('Spacekeys must never take focus'); },
  });
  doc.body = doc.createElementNS('', 'body');
  doc.documentElement = doc.body;
  doc.activeElement = doc.body;
  win.document = doc;
  return win;
}

function fixture(smooth = false) {
  let now = 0, serial = 0;
  const timers = new Map();
  const context = vm.createContext({
    Zotero: { debug() {}, locale: 'zh-CN', Reader: {} }, Services: {}, Components: {},
    setTimeout(fn, delay) { timers.set(++serial, { fn, time: now + delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const name of ['zoteroVim.js', 'zoteroVimReader.js', 'zoteroVimMain.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content', name), 'utf8'), context);
  }
  const z = context.ZoteroVim;
  const prefs = {};
  z.getPref = (key, fallback) => prefs[key] ?? fallback;
  z._isStandaloneNoteTabSelected = () => false;
  z._isMainNoteTextEditing = () => false;
  z._isMainTextEditing = () => false;
  z._syncNoteCursorVisualState = () => {};
  z._mainShowStatus = () => {};
  z.isSmoothScrollEnabled = () => smooth;
  const moves = [];
  z._getScrollContainer = viewWin => viewWin;
  z._scrollContainerBy = (viewWin, dx, dy) => moves.push({ viewWin, dx, dy });
  const win = windowFixture(), outer = windowFixture(), pdf = windowFixture();
  const secondary = windowFixture(), note = windowFixture();
  win.Zotero_Tabs = { selectedID: 'library' };
  const actions = [], counts = [];
  z._executeMainAction = action => actions.push(action);
  const main = { win, mode: 'main', keyBuffer: '', countBuffer: '',
    executeAction: action => actions.push(action),
    _contextNoteMode: 'normal', _contextNoteMainBuffer: '',
    _contextNoteEditorWin: note, _contextNoteEditorDoc: note.document };
  const reader = { _window: win, _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: pdf },
      _secondaryView: { _iframeWindow: secondary } } };
  const state = { mode: 'normal', keyBuffer: '', countBuffer: '', reader,
    pdfWin: pdf, activePdfWin: pdf,
    smoothHold: { active: false, releasing: false, key: null, axis: null,
      direction: 0, speed: 0, rafId: null, lastTS: 0 },
    executeAction: (action, count) => { actions.push(action); counts.push(count); } };
  z._mainWindowState.set(win, main);
  z._readerState.set('r', state);
  const editable = note.document.createElementNS('', 'textarea');
  editable.value = 'ax bx'; editable.selectionStart = editable.selectionEnd = 0;
  editable.setSelectionRange = function(start, end) {
    this.selectionStart = start; this.selectionEnd = end;
  };
  note.document.body.appendChild(editable);
  note.document.activeElement = editable;
  const key = (key, target = win.document.body) => ({
    key, target, preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}, stopImmediatePropagation() {},
  });
  const mainKey = value => {
    const event = key(value); z._onMainKeyDown(event, win, main); return event;
  };
  const pdfKey = (value, targetWin = pdf) => {
    const event = key(value, targetWin.document.body);
    z._onKeyDown(event, reader, state, targetWin); return event;
  };
  const noteKey = value => {
    const event = key(value, editable); z._onMainContextNoteKeyDown(event, win, main);
    return event;
  };
  const advance = duration => {
    const until = now + duration;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.time <= until)
        .sort((a, b) => a[1].time - b[1].time)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].time; due[1].fn();
    }
    now = until;
  };
  return { z, prefs, win, outer, pdf, secondary, note, editable, state, main,
    actions, counts, moves, timers, advance, mainKey, pdfKey, noteKey };
}

function text(node) {
  return node.textContent + node.children.map(text).join(' ');
}

let passed = 0;
function check(label, fn) { fn(); passed++; console.log('  ok  ' + label); }

check('library chords group, narrow and execute without moving focus', () => {
  const f = fixture();
  assert.equal(f.mainKey(' ').defaultPrevented, true);
  f.advance(199); assert.equal(f.main._spacekeys.el, null);
  f.advance(1);
  assert.match(text(f.main._spacekeys.el), /搜索/);
  assert.match(f.main._spacekeys.el.style.cssText, /right:14px;bottom:42px/);
  f.mainKey('f');
  assert.match(text(f.main._spacekeys.el), /全库条目/);
  assert.match(text(f.main._spacekeys.el), /当前分类/);
  f.mainKey('f');
  assert.equal(f.main._spacekeys, null);
  assert.deepEqual(f.actions, ['mainFuzzyAll']);
  assert.equal(f.timers.size, 0);
});

check('reader shows fh and preserves distinct s/S actions and count prefixes', () => {
  const f = fixture();
  f.pdfKey(' '); f.pdfKey('f'); f.advance(200);
  assert.match(text(f.state._spacekeys.el), /PDF 目录标题/);
  assert.equal(f.state._spacekeys.el.ownerDocument, f.outer.document);
  f.pdfKey('h'); assert.deepEqual(f.actions, ['readerOutlinePick']);
  f.pdfKey(' '); f.advance(200);
  const keys = Array.from(f.state._spacekeys.rows, row => row.key);
  assert(keys.includes('s')); assert(keys.includes('S'));
  f.pdfKey('S'); assert.equal(f.actions.pop(), 'toggleReaderSpreadParity');
  f.pdfKey('3'); f.pdfKey(' '); f.pdfKey('s');
  assert.equal(f.state.countBuffer, '');
  assert.equal(f.actions.pop(), 'toggleReaderSpread');
  assert.equal(f.counts.pop(), 3);
});

check('fast typing never flashes later; Escape and invalid prefixes clean up', () => {
  const f = fixture();
  f.pdfKey(' '); f.pdfKey('f'); f.pdfKey('f'); f.advance(1000);
  assert.equal(f.outer.document.body.children.length, 0);
  f.pdfKey(' '); f.advance(200); f.pdfKey('Escape');
  assert.equal(f.state._spacekeys, null);
  assert.deepEqual(f.actions, ['mainFuzzyAll']); // Escape must not clear an existing search.
  f.mainKey(' '); f.advance(200); f.mainKey('!');
  assert.equal(f.main._spacekeys, null); assert.equal(f.main.keyBuffer, '');
  assert.equal(f.timers.size, 0);
});

check('leader waits 10 seconds, ordinary prefixes keep their original timeout', () => {
  const f = fixture();
  f.pdfKey(' '); f.advance(9999);
  assert.equal(f.state.keyBuffer, ' ');
  f.advance(1); assert.equal(f.state.keyBuffer, ''); assert.equal(f.state._spacekeys, null);
  f.pdfKey('z'); f.advance(1200); assert.equal(f.state.keyBuffer, '');
  f.prefs['spacekeys.timeout'] = 3000;
  f.pdfKey(' '); f.advance(3000); assert.equal(f.state.keyBuffer, '');
});

check('abandoning a Space chord starts smooth scrolling on the first keydown', () => {
  for (const mode of ['follow', 'trapezoid']) {
    for (const key of ['j', 'k', 'H', 'L']) {
      for (const prefix of [' ', ' f']) {
        for (const delay of [0, 200]) {
          const baseline = fixture(true);
          baseline.prefs['scroll.mode'] = mode;
          baseline.pdfKey(key);
          const f = fixture(true);
          f.prefs['scroll.mode'] = mode;
          for (const part of prefix) f.pdfKey(part);
          f.advance(delay);
          const event = f.pdfKey(key);
          assert.equal(event.defaultPrevented, true);
          assert.equal(f.state.smoothHold.active, true, mode + ' / ' + prefix + key);
          assert.equal(f.state.smoothHold.key, key);
          assert.equal(f.state.keyBuffer, '');
          assert.equal(f.state._spacekeys, null);
          assert.equal(f.timers.size, 0);
          assert.deepEqual(f.actions, []); // No one-shot scroll before the hold loop starts.
          assert.equal(f.moves.length, 1);
          assert.equal(f.moves[0].dx, baseline.moves[0].dx);
          assert.equal(f.moves[0].dy, baseline.moves[0].dy);
          f.pdf.frame(16); f.pdf.frame(32);
          assert.equal(f.moves.length, 3);
          f.z._onKeyUp({ key }, f.state, f.pdf);
          assert.equal(f.state.smoothHold.active, false);
          if (mode === 'follow') assert.equal(f.pdf.frames.size, 0);
          else assert.equal(f.state.smoothHold.releasing, true);
        }
      }
    }
  }
});

check('scroll fallback preserves custom Space j chords, remaps and step mode', () => {
  for (const chord of [' j', ' jj']) {
    const f = fixture(true);
    f.prefs.bindings = JSON.stringify({ ['normal:' + chord]: 'mainNotesLayout' });
    for (const key of chord) f.pdfKey(key);
    assert.deepEqual(f.actions, ['mainNotesLayout']);
    assert.equal(f.moves.length, 0);
    assert.equal(f.state.smoothHold.active, false);
  }
  const remap = fixture(true);
  remap.prefs.bindings = JSON.stringify({ 'normal:j': 'mainNotesLayout' });
  remap.pdfKey(' '); remap.pdfKey('j');
  assert.deepEqual(remap.actions, ['mainNotesLayout']);
  assert.equal(remap.moves.length, 0);
  const step = fixture();
  step.pdfKey(' '); step.pdfKey('j');
  assert.deepEqual(step.actions, ['scrollDown']);
  assert.equal(step.state.smoothHold.active, false);
});

check('effective remaps, unbindings, Unicode and modifier keys reach the popup', () => {
  const f = fixture();
  f.prefs.bindings = JSON.stringify({ 'normal: fh': null, 'normal: f中': 'readerOutlinePick',
    'normal: ctrl+j': 'scrollDown', 'normal: enter': 'mainNotesLayout' });
  f.pdfKey(' '); f.advance(200);
  assert(f.state._spacekeys.rows.some(row => row.key === 'ctrl+j'));
  assert(f.state._spacekeys.rows.some(row => row.key === 'enter'));
  f.pdfKey('f');
  assert(!f.state._spacekeys.rows.some(row => row.key === 'h'));
  assert(f.state._spacekeys.rows.some(row => row.key === '中'));
  f.pdfKey('中'); assert.deepEqual(f.actions, ['readerOutlinePick']);
  f.pdfKey(' '); f.pdfKey('Enter'); assert.equal(f.actions.pop(), 'mainNotesLayout');
});

check('note Normal mode shares hints, timing and cleanup without editing note text', () => {
  const f = fixture();
  f.noteKey(' '); f.advance(200);
  assert.equal(f.main._spacekeys.source, 'note');
  assert.equal(f.main._spacekeys.el.ownerDocument, f.win.document);
  assert.equal(f.note.document.body.children.length, 1);
  f.noteKey('f'); f.advance(1500); f.noteKey('f');
  assert.deepEqual(f.actions, ['mainFuzzyAll']);
  assert.equal(f.main._spacekeys, null);
  assert.equal(f.editable.value, 'ax bx');
  f.noteKey(' '); f.advance(200); f.noteKey('Escape');
  assert.equal(f.main._spacekeys, null); assert.equal(f.main._contextNoteMainBuffer, '');
  f.main._contextNoteMode = 'insert';
  assert.equal(f.noteKey(' ').defaultPrevented, undefined);
  assert.equal(f.main._spacekeys, null);
});

check('note character arguments keep literal Space; ambiguous remaps wait consistently', () => {
  const f = fixture();
  f.noteKey('f'); f.noteKey(' ');
  assert.equal(f.editable.selectionStart, 2);
  assert.equal(f.main._spacekeys, undefined);
  f.prefs.bindings = JSON.stringify({ 'main: f': 'mainFocusSearch' });
  f.noteKey(' '); f.noteKey('f'); f.advance(200);
  assert.deepEqual(f.actions, []);
  f.noteKey('f'); assert.deepEqual(f.actions, ['mainFuzzyAll']);
  f.noteKey(' '); f.noteKey('f'); f.advance(10000);
  assert.equal(f.actions.pop(), 'mainFocusSearch');
  assert.equal(f.main._spacekeys, null);
});

check('pointer/focus changes and deactivation cancel the originating buffer and timers', () => {
  for (const kind of ['pointerdown', 'focusin', 'blur', 'deactivate']) {
    const f = fixture(); f.pdfKey(' '); f.advance(200);
    if (kind === 'blur') f.pdf.emit(kind);
    else if (kind === 'deactivate') f.win.emit(kind);
    else f.outer.document.emit(kind, { target: f.outer.document.createElementNS('', 'input') });
    assert.equal(f.state._spacekeys, null, kind);
    assert.equal(f.state.keyBuffer, '', kind); assert.equal(f.timers.size, 0, kind);
    for (const target of [f.win, f.pdf, f.win.document, f.outer.document, f.pdf.document]) {
      assert([...target.listeners.values()].every(handlers => handlers.size === 0), kind);
    }
  }
  const f = fixture(); f.noteKey(' '); f.advance(200); f.note.emit('blur');
  assert.equal(f.main._contextNoteMainBuffer, ''); assert.equal(f.main._spacekeys, null);
});

check('tab changes, destroyed panes and replacement note editors invalidate pending chords', () => {
  const f = fixture();
  f.pdfKey(' '); f.advance(200); f.win.Zotero_Tabs.selectedID = 'other';
  f.z._syncSpacekeysContext(f.state); assert.equal(f.state._spacekeys, null);
  f.pdfKey(' ', f.secondary); f.advance(200);
  f.state.reader._internalReader._secondaryView = null;
  f.z._syncSpacekeysContext(f.state); assert.equal(f.state._spacekeys, null);
  f.noteKey(' '); f.advance(200); f.main._contextNoteEditorWin = windowFixture();
  f.z._syncSpacekeysContext(f.main); assert.equal(f.main._spacekeys, null);
  assert.equal(f.timers.size, 0);
});

check('split handoff and reader/note handoff keep a single popup per window', () => {
  const f = fixture();
  f.pdfKey(' '); f.advance(200);
  f.pdfKey('f', f.secondary); // The new pane must not complete the old pane's Space f.
  assert.equal(f.state._spacekeys, null); assert.equal(f.state.keyBuffer, '');
  f.pdfKey(' ', f.secondary); f.advance(200);
  f.noteKey(' '); f.advance(200);
  assert.equal(f.state._spacekeys, null); assert.equal(f.state.keyBuffer, '');
  assert(f.main._spacekeys.el);
  f.pdfKey(' ', f.secondary); f.advance(200);
  assert.equal(f.main._spacekeys, null); assert.equal(f.main._contextNoteMainBuffer, '');
  assert(f.state._spacekeys.el);
  f.mainKey('J');
  assert.equal(f.state._spacekeys, null);
  assert.equal(f.state.keyBuffer, '');
  assert.equal(f.actions.pop(), 'mainPrevTab');
});

check('disabled hints and English labels respect preferences', () => {
  const f = fixture();
  f.prefs['spacekeys.enabled'] = false;
  f.mainKey(' '); f.advance(200); assert.equal(f.main._spacekeys, undefined);
  f.mainKey('f'); f.mainKey('f'); assert.deepEqual(f.actions, ['mainFuzzyAll']);
  f.pdfKey(' ');
  assert.equal(f.z._readerConsumesKey(f.state, 'escape'), true);
  f.pdfKey('Escape'); assert.deepEqual(f.actions, ['mainFuzzyAll']);
  f.prefs['spacekeys.enabled'] = true; f.prefs.language = 'en';
  f.prefs['spacekeys.delay'] = 0;
  f.pdfKey(' '); f.pdfKey('f'); f.advance(0);
  assert.match(text(f.state._spacekeys.el), /PDF headings/);
  f.prefs['spacekeys.enabled'] = false; f.z._syncSpacekeysContext(f.state);
  assert.equal(f.state._spacekeys, null); assert.equal(f.state.keyBuffer, '');
});

console.log('Spacekeys checks passed: ' + passed);

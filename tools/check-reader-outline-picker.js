/* global require, __dirname, console, process, setImmediate */
// Issue #7: tree-local search, full-depth fuzzy matching, focus restoration,
// native input isolation, split-pane destinations and async popup ownership.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clones = [];
const notices = [];
const context = vm.createContext({
  Zotero: { debug() {}, locale: 'en-US' },
  Services: { focus: {}, prefs: { getPrefType: () => 0 } },
  Components: { utils: {
    unwrap: value => value, exportFunction: fn => fn,
    cloneInto(value, target) {
      const copy = JSON.parse(JSON.stringify(value));
      clones.push({ value: copy, target });
      return copy;
    },
  } },
  setTimeout: () => 1, clearTimeout() {},
});
for (const file of ['zoteroVim.js', 'zoteroVimReader.js', 'zoteroVimMain.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content', file), 'utf8'), context);
}
const z = context.ZoteroVim;
z._getActiveMainNoteEditorWindow = () => null;
z.getPref = (_name, fallback) => fallback;
z._showStatus = (_state, text) => notices.push(text);
z._stopSmoothHoldScroll = () => {};
z._smoothHoldSpecForEvent = () => null;
const settle = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function document() {
  const doc = { querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter(listener => listener !== fn);
    },
    emit(type, event) { for (const fn of this.listeners[type] || []) fn(event); },
  };
  doc.createElementNS = (_ns, tag) => ({
    tagName: tag.toUpperCase(), ownerDocument: doc, children: [], parentNode: null,
    style: {}, listeners: {}, attributes: {}, value: '', scrollTop: 0, scrollCount: 0,
    get firstChild() { return this.children[0] || null; },
    get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; },
    appendChild(child) {
      if (child.fragment) {
        for (const node of [...child.children]) this.appendChild(node);
      } else {
        if (child.parentNode) child.parentNode.removeChild(child);
        this.children.push(child);
        child.parentNode = this;
      }
      return child;
    },
    removeChild(child) {
      if (child.contains(doc.activeElement)) doc.activeElement = doc.body;
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
    },
    remove() { this.parentNode?.removeChild(this); },
    contains(other) {
      for (let node = other; node; node = node.parentNode) {
        if (node === this) return true;
      }
      return false;
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    emit(type, event = {}) {
      const value = { type, target: this, button: 0,
        preventDefault() { this.prevented = true; }, ...event };
      doc.emit(type, value);
      this.listeners[type]?.(value);
      return value;
    },
    focus() {
      doc.activeElement = this;
      context.Services.focus.focusedWindow = doc.defaultView;
      doc.emit('focusin', { target: this });
    },
    blur() { if (doc.activeElement === this) doc.body.focus(); },
    scrollIntoView() { this.scrollCount++; },
    querySelector: () => null,
  });
  doc.createDocumentFragment = () => Object.assign(doc.createElementNS('', 'fragment'),
    { fragment: true });
  doc.body = doc.createElementNS('', 'body');
  doc.activeElement = doc.body;
  return doc;
}

function outline() {
  return [
    { title: 'Chapter One', dest: [0, { name: 'XYZ' }, 0, 100, null], items: [
      { title: 'Methods', dest: [2, { name: 'Fit' }], items: [
        { title: 'Deep 中文 heading', dest: [4, { name: 'Fit' }], items: [] },
      ] },
    ] },
    { title: 'Chapter Two', dest: 'chapter-two', items: [
      { title: 'Methods', dest: [8, { name: 'Fit' }], items: [] },
    ] },
  ];
}

function pane(getOutline = async () => outline()) {
  const doc = document();
  const calls = [];
  const forwarded = [];
  let history = 0;
  const app = {
    pdfDocument: { getOutline, getDestination: async () => [6, { name: 'Fit' }] },
    pdfViewer: { currentPageNumber: 1, pagesCount: 20 },
    pdfLinkService: {
      getDestinationHash(dest) {
        if (typeof dest === 'object') assert.ok(clones.some(entry => entry.value === dest));
        return typeof dest === 'string' ? '#nameddest=' + dest : '#page=' + (dest[0] + 1);
      },
      setHash(hash) { calls.push(hash); },
    },
  };
  const win = { document: doc, PDFViewerApplication: app, focusCount: 0,
    focus() { this.focusCount++; context.Services.focus.focusedWindow = win; },
    addEventListener() {}, removeEventListener() {} };
  doc.defaultView = win;
  const view = { _iframeWindow: win, _onKeyDown: event => forwarded.push(event.key),
    _textAnnotationFocused: () => false, _pushHistoryPoint: () => { history++; } };
  return { win, doc, app, calls, forwarded, view, get history() { return history; } };
}

function fixture(getOutline) {
  const primary = pane(getOutline);
  const secondary = pane();
  const reader = { _iframeWindow: { document: document() }, _internalReader: {
    _primaryView: primary.view, _secondaryView: secondary.view, _lastView: primary.view,
    splitType: 'vertical',
  } };
  const state = { mode: 'normal', keyBuffer: '', countBuffer: '', pdfWin: primary.win,
    reader, activePdfWin: primary.win, _outlinePicker: null, outlineExplorerOpen: false,
    outlineExplorerSelected: 0, outlineExplorerTree: null, _pdfViewHandlers: new Map() };
  state.executeAction = (action, count) => z._executeAction(action, reader, state,
    state.activePdfWin, count);
  primary.doc.body.focus();
  return { primary, secondary, reader, state };
}

function key(f, value, modifiers = {}, pane = f.primary) {
  const event = { key: value, target: pane.doc.activeElement, ...modifiers,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  z._onKeyDown(event, f.reader, f.state, pane.win);
  return event;
}

function input(popup, value) {
  popup.input.value = value;
  popup.input.emit('input');
}

let passed = 0;
async function check(label, fn) {
  await fn();
  passed++;
  console.log('  ok  ' + label);
}

async function main() {
  await check('Space+fh is remappable and opens a focused picker in the event pane', async () => {
    for (const remap of [false, true]) {
      z.getPref = (name, fallback) => name === 'bindings' && remap
        ? JSON.stringify({ 'normal: fh': null, 'normal: ft': 'readerOutlinePick' }) : fallback;
      const f = fixture();
      for (const value of remap ? ' ft' : ' fh') {
        assert.equal(key(f, value, {}, f.secondary).prevented, true);
      }
      await settle();
      const popup = f.state._outlinePicker;
      assert.equal(popup.pdfWin, f.secondary.win);
      assert.equal(f.secondary.doc.activeElement, popup.input);
      assert.equal(popup.loading, false);
      assert.equal(f.state.mode, 'normal');
      assert.equal(z._readerConsumesKey(f.state, 'r', f.secondary.win), true);
      z._closeReaderOutlinePicker(f.state);
    }
    z.getPref = (_name, fallback) => fallback;
  });

  await check('search includes deep collapsed headings, parent paths, pages and duplicate titles', async () => {
    const f = fixture();
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    const tree = f.state.outlineExplorerTree;
    tree[0].expanded = false;
    z._refreshReaderOutlineExplorer(f.state);
    z._renderReaderOutlineExplorer(f.state);
    assert.equal(f.state.outlineExplorerVisible.length, 3);
    key(f, '/');
    const popup = f.state._outlinePicker;
    assert.equal(popup.items.length, 5);
    input(popup, 'd中h');
    assert.equal(popup.filtered.length, 1);
    assert.equal(popup.filtered[0].entry.title, 'Deep 中文 heading');
    assert.equal(popup.filtered[0].breadcrumb, 'Chapter One › Methods');
    assert.match(popup.rows[0].children[1].textContent, /p\. 5/);
    input(popup, 'METHODS');
    assert.equal(popup.filtered.filter(item => item.entry.title === 'Methods').length, 2);
    assert.notEqual(popup.filtered[0].breadcrumb, popup.filtered.at(-1).breadcrumb);
    z._closeReaderOutlinePicker(f.state);
  });

  await check('tree slash consumes the key; Escape restores exact tree nodes, expansion and scroll', async () => {
    const f = fixture();
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    f.state.outlineExplorerSelected = 1;
    f.state._outlineExplorerList.scrollTop = 173;
    const tree = f.state._outlineExplorerOverlay;
    const rows = [...f.state._outlineExplorerList.children];
    const expanded = f.state.outlineExplorerTree[0].expanded;
    assert.equal(key(f, '/').prevented, true);
    assert.equal(tree.style.visibility, 'hidden');
    input(f.state._outlinePicker, 'not found');
    assert.equal(key(f, 'Escape').prevented, true);
    assert.equal(f.state._outlinePicker, null);
    assert.equal(f.primary.doc.activeElement, tree);
    assert.equal(tree.style.visibility, '');
    assert.equal(f.state._outlineExplorerList.scrollTop, 173);
    assert.equal(f.state.outlineExplorerSelected, 1);
    assert.equal(f.state.outlineExplorerTree[0].expanded, expanded);
    assert.deepEqual(f.state._outlineExplorerList.children, rows);
  });

  await check('a visible unfocused tree leaves PDF search and motions active in either pane', async () => {
    const f = fixture();
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    let bodySearches = 0;
    const openSearch = z._openSearch;
    z._openSearch = () => bodySearches++;
    f.primary.doc.body.emit('pointerdown');
    f.primary.doc.body.focus();
    key(f, '/');
    f.secondary.doc.body.focus();
    key(f, '/', {}, f.secondary);
    assert.equal(bodySearches, 2);
    assert.equal(f.state._outlinePicker, null);
    assert.equal(z._handleReaderSidebarAction(f.state, f.reader, f.secondary.win, 'scrollDown'), false);
    f.state._outlineExplorerOverlay.emit('mousedown');
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.secondary.win), false);
    z._openSearch = openSearch;
  });

  await check('tree slash survives parent-window focus reports and a DOM focus that does nothing', async () => {
    const f = fixture();
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    context.Services.focus.focusedWindow = f.reader._iframeWindow;
    f.primary.doc.body.focus(); // A late frame-body focus is not a user handoff.
    assert.equal(key(f, '/').prevented, true);
    assert.ok(f.state._outlinePicker?.outlineOverlay);
    key(f, 'Escape');
    key(f, 'l', { ctrlKey: true });
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), false);
    f.state._outlineExplorerOverlay.focus = () => {};
    key(f, 'h', { ctrlKey: true });
    assert.equal(f.primary.doc.activeElement, f.primary.doc.body);
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
    key(f, '/');
    assert.ok(f.state._outlinePicker?.outlineOverlay);
    key(f, 'Escape');
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
  });

  await check('Ctrl+h/l switch tree and PDF focus while keeping normal split navigation', async () => {
    const f = fixture();
    for (const value of ' e') key(f, value);
    await settle();
    const tree = f.state._outlineExplorerOverlay;
    f.state.outlineExplorerSelected = 1;
    f.state._outlineExplorerList.scrollTop = 97;
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
    assert.equal(key(f, 'l', { ctrlKey: true }).prevented, true);
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), false);
    assert.equal(f.state.outlineExplorerOpen, true);
    assert.match(f.state._outlineExplorerHeader.textContent, /Ctrl\+h/);
    key(f, 'l', { ctrlKey: true });
    assert.equal(f.state.activePdfWin, f.secondary.win);
    key(f, 'h', { ctrlKey: true }, f.secondary);
    assert.equal(f.state.activePdfWin, f.primary.win);
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), false);
    key(f, 'h', { ctrlKey: true });
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
    assert.equal(f.state._outlineExplorerOverlay, tree);
    assert.equal(f.state.outlineExplorerSelected, 1);
    assert.equal(f.state._outlineExplorerList.scrollTop, 97);
    assert.match(f.state._outlineExplorerHeader.textContent, /Focused/);
    key(f, '/');
    assert.ok(f.state._outlinePicker?.outlineOverlay);
    key(f, 'Escape');
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
  });

  await check('focus-direction remaps reach the same tree/PDF actions', async () => {
    const f = fixture();
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    z.getPref = (name, fallback) => name === 'bindings'
      ? JSON.stringify({ 'normal:ctrl+h': null, 'normal:ctrl+l': null,
        'normal:ctrl+arrowleft': 'focusReaderSplitLeft',
        'normal:ctrl+arrowright': 'focusReaderSplitRight' }) : fallback;
    key(f, 'ArrowRight', { ctrlKey: true });
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), false);
    key(f, 'ArrowLeft', { ctrlKey: true });
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
    z.getPref = (_name, fallback) => fallback;
  });

  await check('real pointer focus changes select the command region and listeners are removed on close', async () => {
    const f = fixture();
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    const tree = f.state._outlineExplorerOverlay;
    // The outside click must hand control to the PDF even before default
    // browser focus has moved activeElement away from the tree.
    f.primary.doc.body.emit('pointerdown');
    assert.equal(f.primary.doc.activeElement, tree);
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), false);
    const event = f.state._outlineExplorerList.children[0].emit('mousedown');
    assert.equal(event.prevented, true);
    assert.equal(z._readerOutlineExplorerFocused(f.state, f.primary.win), true);
    z._closeReaderOutlineExplorer(f.state);
    for (const type of ['pointerdown', 'mousedown', 'focusin']) {
      assert.equal(f.primary.doc.listeners[type].length, 0);
    }
    assert.equal(f.state._outlineExplorerFocused, false);
    assert.equal(f.state._outlineExplorerPdfWin, null);
  });

  await check('chrome forwarding preserves tree ownership before routing slash', async () => {
    const f = fixture();
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    f.reader._instanceID = 'outline-forwarding';
    z._readerState.set(f.reader._instanceID, f.state);
    const ensure = z._ensureReaderInjected;
    z._ensureReaderInjected = () => {};
    context.Zotero.Reader = { getByTabID: () => f.reader };
    // This reproduces a PDF-window focus call dropping DOM focus to its body.
    f.primary.win.focus = () => { throw new Error('must not refocus PDF for a tree key'); };
    const event = { key: '/', target: {},
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
    z._forwardReaderKey(event, { Zotero_Tabs: { selectedID: 'reader-tab' } });
    assert.equal(event.prevented, true);
    assert.ok(f.state._outlinePicker?.outlineOverlay);
    z._ensureReaderInjected = ensure;
    z._readerState.delete(f.reader._instanceID);
  });

  await check('letters, slash, Backspace, paste and composing Enter/Escape remain native input', async () => {
    const f = fixture();
    await z._openReaderOutlinePicker(f.state, f.reader, f.primary.win);
    const popup = f.state._outlinePicker;
    for (const value of ['h', 'j', 'k', 'l', 'r', 's', 'g', 'y', '/', 'Backspace', '中']) {
      const event = key(f, value);
      assert.equal(event.prevented, undefined);
      assert.equal(event.stopped, true);
    }
    assert.equal(key(f, 'v', { ctrlKey: true }).prevented, undefined);
    popup.input.emit('compositionstart');
    assert.equal(key(f, 'Enter').prevented, undefined);
    assert.equal(key(f, 'Escape').prevented, undefined);
    popup.input.emit('compositionend');
    assert.equal(key(f, 'Enter', { isComposing: true }).prevented, undefined);
    assert.equal(key(f, 'Escape', { keyCode: 229 }).prevented, undefined);
    assert.equal(f.state._outlinePicker, popup);
    key(f, 'Escape');
    assert.equal(f.state._outlinePicker, null);
    assert.equal(f.primary.doc.activeElement, f.primary.doc.body);
  });

  await check('navigation updates highlights in place, handles bounds and Tab retains input focus', async () => {
    const f = fixture();
    await z._openReaderOutlinePicker(f.state, f.reader, f.primary.win);
    const popup = f.state._outlinePicker;
    const rows = [...popup.rows];
    for (const [value, mods, expected] of [
      ['j', { ctrlKey: true }, 1], ['n', { ctrlKey: true }, 2], ['ArrowDown', {}, 3],
      ['k', { ctrlKey: true }, 2], ['p', { ctrlKey: true }, 1], ['ArrowUp', {}, 0],
      ['ArrowUp', {}, 0],
    ]) {
      assert.equal(key(f, value, mods).prevented, true);
      assert.equal(popup.selected, expected);
      assert.deepEqual([...popup.rows], rows);
      assert.equal(rows.filter(row => row.style.backgroundColor === '#313244').length, 1);
    }
    assert.equal(key(f, 'Tab').prevented, true);
    assert.equal(f.primary.doc.activeElement, popup.input);
  });

  await check('Zotero forwarding and annotation Enter are suppressed only in the picker pane', async () => {
    const f = fixture();
    z._patchReaderKeyForwarding(f.reader, f.state);
    z._patchReaderTextAnnotationFocus(f.reader, f.state);
    await z._openReaderOutlinePicker(f.state, f.reader, f.secondary.win);
    f.secondary.view._onKeyDown({ key: 'r' });
    f.secondary.view._onKeyDown({ key: 'F8' });
    f.primary.view._onKeyDown({ key: 'F8' });
    assert.deepEqual(f.secondary.forwarded, []);
    assert.deepEqual(f.primary.forwarded, ['F8']);
    assert.equal(f.secondary.view._textAnnotationFocused(), true);
    assert.equal(f.primary.view._textAnnotationFocused(), false);
    z._closeReaderOutlinePicker(f.state);
    assert.equal(f.secondary.view._textAnnotationFocused(), false);
    f.secondary.view._onKeyDown({ key: 'F8' });
    assert.deepEqual(f.secondary.forwarded, ['F8']);
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    assert.equal(f.primary.view._textAnnotationFocused(), true);
    f.primary.doc.body.emit('pointerdown');
    f.primary.doc.body.focus();
    assert.equal(f.primary.view._textAnnotationFocused(), false);
  });

  await check('Enter jumps with cloned destinations in the originating split and records its history', async () => {
    const f = fixture();
    await z._openReaderOutlinePicker(f.state, f.reader, f.secondary.win);
    input(f.state._outlinePicker, 'deep');
    assert.equal(key(f, 'Enter', {}, f.secondary).prevented, true);
    await settle();
    assert.deepEqual(f.primary.calls, []);
    assert.deepEqual(f.secondary.calls, ['page=5']);
    assert.equal(f.primary.history, 0);
    assert.equal(f.secondary.history, 1);
    assert.equal(clones.at(-1).target, f.secondary.win);
    assert.equal(f.state._outlinePicker, null);
    assert.equal(f.state.mode, 'normal');
    assert.equal(context.Services.focus.focusedWindow, f.secondary.win);
    await z._openReaderOutlineExplorer(f.state, f.reader, f.primary.win);
    key(f, '/');
    f.state._outlinePicker.rows[1].emit('click');
    await settle();
    assert.equal(f.state.outlineExplorerOpen, false);
    assert.equal(f.state._outlinePicker, null);
  });

  await check('page-only fallback navigates the requested pane and failed jumps stay dismissible', async () => {
    const f = fixture();
    await z._openReaderOutlinePicker(f.state, f.reader, f.secondary.win);
    const popup = f.state._outlinePicker;
    popup.filtered[0].entry = { title: 'Page-only', pageIndex: 3 };
    await z._activateReaderOutlinePicker(f.state);
    assert.deepEqual(f.secondary.calls, ['page=4']);
    await z._openReaderOutlinePicker(f.state, f.reader, f.secondary.win);
    f.state._outlinePicker.filtered[0].entry = { title: 'Unknown' };
    await z._activateReaderOutlinePicker(f.state);
    assert.match(f.state._outlinePicker.status.textContent, /Jump failed/);
    z._closeReaderOutlinePicker(f.state);
    let navigation;
    delete f.secondary.app.pdfLinkService.setHash;
    f.secondary.view.navigate = payload => { navigation = payload; };
    await z._openReaderOutlinePicker(f.state, f.reader, f.secondary.win);
    f.state._outlinePicker.filtered[0].entry = { title: 'Native fallback', pageIndex: 7 };
    await z._activateReaderOutlinePicker(f.state);
    assert.deepEqual(navigation, { pageIndex: 7 });
    assert.equal(clones.at(-1).target, f.reader._iframeWindow);
  });

  await check('empty, unmatched, loading, non-PDF and load errors have truthful states', async () => {
    const empty = fixture(async () => []);
    await z._openReaderOutlinePicker(empty.state, empty.reader, empty.primary.win);
    assert.match(empty.state._outlinePicker.list.children[0].textContent, /No outline/);
    key(empty, 'ArrowDown'); key(empty, 'Enter');
    assert.ok(empty.state._outlinePicker);
    input(empty.state._outlinePicker, 'unknown');
    const normal = fixture();
    await z._openReaderOutlinePicker(normal.state, normal.reader, normal.primary.win);
    input(normal.state._outlinePicker, 'not a heading');
    assert.match(normal.state._outlinePicker.list.children[0].textContent, /No matching/);
    const error = fixture(async () => { throw new Error('Loading failed'); });
    await z._openReaderOutlinePicker(error.state, error.reader, error.primary.win);
    assert.match(error.state._outlinePicker.list.children[0].textContent, /Error loading/);
    const absent = fixture();
    delete absent.primary.app.pdfDocument;
    await z._openReaderOutlinePicker(absent.state, absent.reader, absent.primary.win);
    assert.match(notices.at(-1), /still loading/);
    delete absent.primary.win.PDFViewerApplication;
    await z._openReaderOutlinePicker(absent.state, absent.reader, absent.primary.win);
    assert.match(notices.at(-1), /only available in PDF/);
    assert.equal(absent.state._outlinePicker, null);
  });

  await check('closing/reopening while loading ignores stale results and retains the current query', async () => {
    const old = deferred();
    const current = deferred();
    let count = 0;
    const f = fixture(() => (++count === 1 ? old.promise : current.promise));
    const first = z._openReaderOutlinePicker(f.state, f.reader, f.primary.win);
    const stale = f.state._outlinePicker;
    key(f, 'Escape');
    const second = z._openReaderOutlinePicker(f.state, f.reader, f.primary.win);
    const popup = f.state._outlinePicker;
    input(popup, 'deep');
    current.resolve(outline());
    await second;
    old.resolve([{ title: 'Old title', dest: [0], items: [] }]);
    await first;
    assert.equal(f.state._outlinePicker, popup);
    assert.equal(popup.filtered.length, 1);
    assert.equal(popup.filtered[0].entry.title, 'Deep 中文 heading');
    assert.equal(stale.overlay.isConnected, false);
  });

  await check('independent readers, removed split panes and mode changes clean up without stealing focus', async () => {
    const first = fixture();
    const second = fixture();
    await z._openReaderOutlinePicker(first.state, first.reader, first.secondary.win);
    await z._openReaderOutlinePicker(second.state, second.reader, second.primary.win);
    const pending = second.state._outlinePicker;
    first.state._pdfViewHandlers.set(first.secondary.win, {});
    delete first.reader._internalReader._secondaryView;
    const before = first.secondary.win.focusCount;
    z._injectSelectionCSS = () => {};
    z._syncReaderPdfViewListeners(first.reader, first.state);
    assert.equal(first.state._outlinePicker, null);
    assert.equal(first.secondary.win.focusCount, before);
    assert.equal(second.state._outlinePicker, pending);
    z._setMode(second.state, 'insert');
    assert.equal(second.state._outlinePicker, null);
    assert.equal(pending.overlay.isConnected, false);
    const late = fixture();
    await z._openReaderOutlinePicker(late.state, late.reader, late.secondary.win);
    const jump = deferred();
    delete late.secondary.app.pdfLinkService.getDestinationHash;
    delete late.secondary.app.pdfLinkService.setHash;
    late.secondary.app.pdfLinkService.goToDestination = () => jump.promise;
    const navigation = z._activateReaderOutlinePicker(late.state);
    const focusCount = late.secondary.win.focusCount;
    delete late.reader._internalReader._secondaryView;
    jump.resolve();
    await navigation;
    assert.equal(late.state._outlinePicker, null);
    assert.equal(late.secondary.win.focusCount, focusCount);
  });

  console.log('Reader outline picker checks passed (' + passed + ' cases).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

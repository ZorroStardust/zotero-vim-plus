/* global require, __dirname, console, process, setImmediate */
// Unified focus appearance: ownership, nested-frame geometry, note independence
// and lifecycle. The appearance layer must never edit or consume native input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function events(target = {}) {
  target.listeners = new Map();
  target.addEventListener = function (type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  };
  target.removeEventListener = function (type, fn) { this.listeners.get(type)?.delete(fn); };
  target.emit = function (type, event = {}) {
    const input = { type, target: this, preventDefault() { throw Error('Consumed input'); },
      stopPropagation() { throw Error('Stopped input'); }, ...event };
    for (const fn of this.listeners.get(type) || []) fn(input);
    return input;
  };
  return target;
}

function rectangle(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function windowFixture(context, width, height) {
  let serial = 0;
  const frames = new Map();
  const win = events({ innerWidth: width, innerHeight: height, frames,
    animations: [], reduced: false,
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    flush() {
      for (const [id, fn] of [...frames]) { frames.delete(id); fn(); }
    },
    focus() { context.Services.focus.focusedWindow = win; },
    matchMedia: () => ({ matches: win.reduced }),
    getComputedStyle: element => ({ color: element.ink || 'rgb(30, 30, 30)' }),
  });
  const doc = events({ defaultView: win,
    hasFocus: () => win === context.Services.focus.activeWindow
      || win === context.Services.focus.focusedWindow,
    querySelector: () => null, querySelectorAll: () => [],
  });
  doc.createElementNS = (_ns, tag) => events({
    ownerDocument: doc, tagName: tag.toUpperCase(), children: [], parentNode: null,
    attrs: {}, textContent: '',
    style: { priorities: {},
      setProperty(key, value, priority = '') { this[key] = value; this.priorities[key] = priority; },
      getPropertyValue(key) { return this[key] || ''; },
      getPropertyPriority(key) { return this.priorities[key] || ''; },
      removeProperty(key) { delete this[key]; delete this.priorities[key]; } },
    get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; },
    setAttribute(key, value) { this.attrs[key] = value; },
    appendChild(node) { this.children.push(node); node.parentNode = this; },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(node => node !== this);
        this.parentNode = null;
      }
    },
    contains(other) {
      for (let node = other; node; node = node.parentNode) {
        if (node === this) return true;
      }
      return false;
    },
    focus() { doc.activeElement = this; win.focus(); doc.emit('focusin', { target: this }); },
    getBoundingClientRect() { return this.rect || rectangle(0, 0, width, height); },
    animate(keyframes, options) {
      const animation = { keyframes, options, canceled: false,
        cancel() { this.canceled = true; } };
      win.animations.push(animation);
      return animation;
    },
  });
  doc.body = doc.createElementNS('', 'body');
  doc.documentElement = doc.body;
  doc.activeElement = doc.body;
  win.document = doc;
  return win;
}

function frame(parent, child, rect) {
  const node = parent.document.createElementNS('', 'iframe');
  node.rect = rect;
  node.offsetWidth = node.clientWidth = rect.width;
  node.offsetHeight = node.clientHeight = rect.height;
  node.contentWindow = child;
  parent.document.body.appendChild(node);
  child.frameElement = node;
  return node;
}

function fixture(enabled = false) {
  const clones = [];
  const timers = [];
  const context = vm.createContext({
    Zotero: { debug() {}, Reader: {} }, Services: { focus: {} },
    Components: { utils: { cloneInto(value, target) {
      clones.push(target); return JSON.parse(JSON.stringify(value));
    } } },
    clearTimeout() {}, setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
  });
  for (const name of ['zoteroVim.js', 'zoteroVimReader.js', 'zoteroVimMain.js', 'zoteroVimFocus.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content', name), 'utf8'), context);
  }
  const z = context.ZoteroVim;
  z.isNoteEditorVimEnabled = () => enabled;
  const win = windowFixture(context, 1400, 900);
  const outer = windowFixture(context, 900, 650);
  const primary = windowFixture(context, 450, 650);
  const secondary = windowFixture(context, 450, 650);
  const note = windowFixture(context, 300, 650);
  const readerFrame = frame(win, outer, rectangle(100, 70, 900, 650));
  const primaryFrame = frame(outer, primary, rectangle(0, 0, 450, 650));
  frame(outer, secondary, rectangle(450, 0, 450, 650));
  const editor = win.document.createElementNS('', 'note-editor');
  editor.rect = rectangle(1020, 70, 300, 650);
  win.document.body.appendChild(editor);
  const noteFrame = frame(win, note, editor.rect);
  noteFrame.remove(); editor.appendChild(noteFrame);
  editor._iframe = noteFrame;
  editor.focus = async () => note.document.body.focus();
  note.document.body.textContent = 'Native note contents';
  const reader = { _instanceID: 'r1', _window: win, _iframe: readerFrame, _iframeWindow: outer,
    _internalReader: { _primaryView: { _iframeWindow: primary },
      _secondaryView: { _iframeWindow: secondary } } };
  let selectedReader = reader;
  win.Zotero_Tabs = { selectedID: 'reader-tab' };
  win.ZoteroContextPane = { collapsed: false, context: { mode: 'notes' }, activeEditor: editor };
  context.Zotero.Reader.getByTabID = () => selectedReader;
  context.Services.focus.activeWindow = win;
  context.Services.focus.focusedWindow = primary;
  const state = { reader, pdfWin: primary, activePdfWin: primary, mode: 'normal',
    keyBuffer: '', _focusCue: null, outlineExplorerOpen: false, _pdfViewHandlers: new Map() };
  z._readerState.set(reader._instanceID, state);
  const sync = () => { z._syncReaderFocusCue(reader, state); win.flush(); };
  sync();
  return { context, z, win, outer, primary, secondary, note, editor, reader, state,
    primaryFrame, clones, timers, sync, select(value) { selectedReader = value; } };
}

function assertRing(f, kind, expected = null) {
  const element = f.state._focusCue.element;
  assert.equal(element.style.opacity, '1');
  assert.equal(element.attrs['data-region'], kind);
  if (expected) {
    assert.deepEqual([element.style.left, element.style.top,
      element.style.width, element.style.height], expected.map(value => value + 'px'));
  }
}

let passed = 0;
async function check(label, fn) {
  await fn(); passed++; console.log('  ok  ' + label);
}

async function main() {
  await check('initialization scroll cannot retarget keys; a ready new split gets real focus and its marker', async () => {
    for (const orientation of ['vertical', 'horizontal']) {
      const f = fixture();
      delete f.reader._internalReader._secondaryView;
      f.sync();
      const secondary = windowFixture(f.context, 450, 650);
      const iframe = frame(f.outer, secondary, rectangle(450, 0, 450, 650));
      let ready;
      const initializedPromise = new Promise(resolve => { ready = resolve; });
      const method = orientation === 'vertical' ? 'toggleVerticalSplit' : 'toggleHorizontalSplit';
      f.reader[method] = () => {
        f.reader._internalReader.splitType = orientation;
        f.reader._internalReader._secondaryView = { _iframe: iframe,
          _iframeWindow: secondary, initializedPromise };
      };
      f.z._injectSelectionCSS = () => {};
      f.z.getReaderProgressMode = () => 'always';
      // The real runtime reported a different window wrapper, retained native
      // primary focus and no focus events at all before the first j key.
      f.context.Services.focus.focusedWindow = windowFixture(f.context, 450, 650);
      f.z._toggleReaderSplit(f.state, f.reader, orientation);
      f.z._showReaderProgress(f.state, secondary); // PDF.js initialization scroll.
      assert.equal(f.state.activePdfWin, f.primary);
      assert.equal(f.state._focusCue.owner.win, f.primary);
      for (const timer of [...f.timers]) timer.fn();
      assert.equal(f.state._focusCue.owner.win, f.primary);
      ready();
      await initializedPromise;
      await new Promise(resolve => setImmediate(resolve));
      f.win.flush();
      assertRing(f, 'pdf');
      assert.equal(f.state.activePdfWin, secondary);
      assert.equal(f.state._focusCue.owner.win, secondary);
      assert.equal(f.context.Services.focus.focusedWindow, secondary);
      assert.equal(f.state._focusCue.layers.get(secondary.document).marker.style.display, 'block');
      f.z._showReaderProgress(f.state, f.primary); // A background scroll cannot undo the handoff.
      assert.equal(f.state.activePdfWin, secondary);
      assert.equal(f.state._readerSplitFocus, null);
    }
  });

  await check('later note or toolbar input cancels focus handoff while the new PDF loads', async () => {
    for (const destination of ['note', 'toolbar']) {
      const f = fixture();
      delete f.reader._internalReader._secondaryView;
      f.sync();
      let ready;
      const initializedPromise = new Promise(resolve => { ready = resolve; });
      f.reader.toggleVerticalSplit = () => {
        f.reader._internalReader.splitType = 'vertical';
        f.reader._internalReader._secondaryView = { _iframeWindow: f.secondary, initializedPromise };
      };
      f.z._injectSelectionCSS = () => {};
      f.z._toggleReaderSplit(f.state, f.reader, 'vertical');
      if (destination === 'note') {
        f.note.focus();
        f.note.document.emit('pointerdown');
      } else {
        const button = f.win.document.createElementNS('', 'button');
        f.win.document.body.appendChild(button);
        button.focus();
      }
      assert.equal(f.state._readerSplitFocus, null);
      ready(); await initializedPromise;
      await new Promise(resolve => setImmediate(resolve));
      for (const timer of [...f.timers]) timer.fn();
      f.win.flush();
      if (destination === 'note') {
        assertRing(f, 'note');
        assert.equal(f.context.Services.focus.focusedWindow, f.note);
      } else {
        assert.equal(f.state._focusCue.owner, null);
        assert.equal(f.context.Services.focus.focusedWindow, f.win);
      }
    }
  });

  await check('PDF rings render in their own document with exactly one visible split pane', () => {
    const f = fixture();
    assertRing(f, 'pdf', [1, 1, 448, 648]);
    const overlay = f.state._focusCue.element;
    assert.equal(overlay.parentNode, f.primary.document.body);
    f.secondary.document.emit('pointerdown'); f.win.flush();
    assertRing(f, 'pdf', [1, 1, 448, 648]);
    assert.equal(f.state._focusCue.element.parentNode, f.secondary.document.body);
    assert.equal(overlay.style.opacity, '0');
    assert.equal([...f.state._focusCue.layers.values()]
      .filter(layer => layer.element.style.opacity === '1').length, 1);
    assert.equal(f.win.document.body.children.filter(node => node.className === 'zv-focus-frame').length, 1);
    f.primary.document.emit('pointerdown'); f.win.flush();
    assert.equal(f.state._focusCue.element, overlay);
  });

  await check('new splits show the focused pane marker without a key or scroll event', () => {
    for (const orientation of ['vertical', 'horizontal']) {
      for (const focusBeforeSync of [true, false]) {
        const f = fixture();
        delete f.reader._internalReader._secondaryView;
        f.sync();
        const secondary = windowFixture(f.context, 450, 650);
        frame(f.outer, secondary, rectangle(450, 0, 450, 650));
        f.reader[orientation === 'vertical' ? 'toggleVerticalSplit' : 'toggleHorizontalSplit']
          = () => {
            f.reader._internalReader.splitType = orientation;
            f.reader._internalReader._secondaryView = { _iframeWindow: secondary };
            if (focusBeforeSync) {
              secondary.focus();
              secondary.emit('focus'); // No document focusin in Gecko.
            }
          };
        f.z._injectSelectionCSS = () => {};
        f.z._toggleReaderSplit(f.state, f.reader, orientation);
        for (const timer of f.timers) timer.fn();
        if (!focusBeforeSync) {
          secondary.focus();
          secondary.emit('focus');
        }
        f.win.flush();
        assertRing(f, 'pdf');
        const cue = f.state._focusCue;
        assert.equal(cue.owner.win, secondary);
        assert.equal(cue.element.ownerDocument, secondary.document);
        assert.equal(cue.layers.get(secondary.document).marker.style.display, 'block');
        assert.equal([...cue.layers.values()]
          .filter(layer => layer.element.style.opacity === '1').length, 1);
      }
    }
  });

  await check('native split iframe-element focus moves the marker while the old pane stays alive', () => {
    for (const orientation of ['vertical', 'horizontal']) {
      for (const focusBeforeSync of [true, false]) {
        const f = fixture();
        delete f.reader._internalReader._secondaryView;
        f.sync();
        const secondary = windowFixture(f.context, 450, 650);
        const iframe = frame(f.outer, secondary, rectangle(450, 0, 450, 650));
        const method = orientation === 'vertical' ? 'toggleVerticalSplit' : 'toggleHorizontalSplit';
        f.reader[method] = () => {
          f.reader._internalReader.splitType = orientation;
          f.reader._internalReader._secondaryView = { _iframe: iframe, _iframeWindow: secondary };
          // Zotero PDFView.focus() focuses the parent iframe element, rather
          // than its window. No inner focusin or window focus event follows.
          if (focusBeforeSync) iframe.focus();
        };
        f.z._injectSelectionCSS = () => {};
        f.z._toggleReaderSplit(f.state, f.reader, orientation);
        for (const timer of f.timers) timer.fn();
        if (!focusBeforeSync) iframe.focus();
        f.win.flush();
        assertRing(f, 'pdf');
        const cue = f.state._focusCue;
        assert.equal(cue.owner.win, secondary);
        assert.equal(cue.layers.get(secondary.document).marker.style.display, 'block');
        assert.equal(cue.layers.get(f.primary.document).element.style.opacity, '0');
        assert.equal(f.context.Services.focus.focusedWindow, focusBeforeSync ? secondary : f.outer);
      }
    }
  });

  await check('late native focus changes reconcile live panes without any focus or input event', () => {
    for (const nativeWindow of ['content', 'reader', 'chrome', 'retained-content']) {
      const f = fixture();
      f.win.document.activeElement = f.reader._iframe;
      f.outer.document.activeElement = f.primaryFrame;
      f.sync();
      const iframe = f.secondary.frameElement;
      f.reader._internalReader._secondaryView._iframe = iframe;
      // This transition occurs after the new document already has observers.
      // Its old peer is still live, so destroyed-view recovery does not apply.
      f.outer.document.activeElement = iframe;
      f.context.Services.focus.focusedWindow = nativeWindow === 'content' ? f.secondary
        : nativeWindow === 'reader' ? f.outer
          : nativeWindow === 'chrome' ? f.win : f.primary;
      f.sync();
      assertRing(f, 'pdf');
      const cue = f.state._focusCue;
      assert.equal(cue.owner.win, f.secondary, nativeWindow);
      assert.equal(cue.layers.get(f.secondary.document).marker.style.display, 'block');
      const nativeFocus = f.context.Services.focus.focusedWindow;
      f.sync();
      assert.equal(cue.owner.win, f.secondary);
      assert.equal(f.context.Services.focus.focusedWindow, nativeFocus);
    }
  });

  await check('retained PDF frame focus cannot override toolbar or note input during split loading', () => {
    const f = fixture();
    f.win.document.activeElement = f.reader._iframe;
    f.outer.document.activeElement = f.primaryFrame;
    f.context.Services.focus.focusedWindow = f.outer;
    f.sync();
    const button = f.win.document.createElementNS('', 'button');
    f.win.document.activeElement = button;
    f.win.document.emit('focusin', { target: button });
    f.sync();
    // A late-created frame must not win over the actual chrome control,
    // even when Gecko still reports reader.html as the focused window.
    f.outer.document.activeElement = f.secondary.frameElement;
    f.sync();
    assert.equal(f.state._focusCue.owner, null);
    f.win.document.activeElement = f.reader._iframe;
    f.sync();
    assertRing(f, 'pdf');
    assert.equal(f.state._focusCue.owner.win, f.secondary);

    f.note.document.body.focus(); f.win.flush();
    f.outer.document.activeElement = f.primaryFrame;
    f.sync();
    assertRing(f, 'note');
    assert.equal(f.context.Services.focus.focusedWindow, f.note);
    f.win.document.activeElement = f.reader._iframe;
    const input = f.outer.document.createElementNS('', 'input');
    input.focus(); f.win.flush(); f.sync();
    assert.equal(f.state._focusCue.owner, null);
    assert.equal(f.outer.document.activeElement, input);
    assert.equal(f.context.Services.focus.focusedWindow, f.outer);
  });

  await check('a split created after both callbacks adopts its existing native focus', () => {
    const f = fixture();
    delete f.reader._internalReader._secondaryView;
    f.sync();
    f.reader.toggleVerticalSplit = () => { f.reader._internalReader.splitType = 'vertical'; };
    // Native creation can take longer than either split callback.
    f.z._injectSelectionCSS = () => {};
    f.z._toggleReaderSplit(f.state, f.reader, 'vertical');
    for (const timer of f.timers) timer.fn();
    const secondary = windowFixture(f.context, 450, 650);
    f.reader._internalReader._secondaryView = { _iframeWindow: secondary };
    secondary.focus(); secondary.emit('focus');
    f.sync();
    assertRing(f, 'pdf');
    assert.equal(f.state._focusCue.owner.win, secondary);
    assert.equal(f.state._focusCue.layers.get(secondary.document).marker.style.display, 'block');
  });

  await check('window focus events preserve tree ownership and do not mark an unfocused new pane', () => {
    const f = fixture();
    const tree = f.primary.document.createElementNS('', 'div');
    tree.rect = rectangle(0, 0, 180, 650);
    f.primary.document.body.appendChild(tree);
    Object.assign(f.state, { outlineExplorerOpen: true, _outlineExplorerOverlay: tree,
      _outlineExplorerPdfWin: f.primary });
    f.z._setReaderOutlineExplorerFocus(f.state, true); f.win.flush();
    f.primary.emit('focus'); f.win.flush();
    assertRing(f, 'outline');
    delete f.reader._internalReader._secondaryView;
    f.sync();
    f.reader._internalReader._secondaryView = { _iframeWindow: f.secondary };
    f.sync();
    assertRing(f, 'outline');
    f.note.focus(); f.note.emit('focus'); f.win.flush();
    assertRing(f, 'note');
    f.z._setReaderOutlineExplorerFocus(f.state, false);
    f.primary.focus(); f.primary.emit('focus'); f.win.flush();
    assertRing(f, 'pdf');
  });

  await check('the upper-right marker follows PDF focus, never outline or note focus', () => {
    const f = fixture();
    const cue = f.state._focusCue;
    const primary = cue.layers.get(f.primary.document);
    const visibleMarkers = () => [...cue.layers.values()].filter(layer =>
      layer.element.style.opacity === '1' && layer.marker.style.display === 'block');
    assert.equal(primary.marker.parentNode, primary.element);
    assert.equal(primary.marker.attrs['aria-hidden'], 'true');
    assert.match(primary.marker.style.cssText, /pointer-events:none!important/);
    assert.match(primary.marker.style.cssText, /width:6px;height:6px/);
    assert.equal(visibleMarkers()[0], primary);
    f.secondary.document.emit('pointerdown'); f.win.flush();
    assert.equal(visibleMarkers().length, 1);
    assert.equal(visibleMarkers()[0].win, f.secondary);

    const tree = f.primary.document.createElementNS('', 'div');
    tree.rect = rectangle(0, 0, 180, 650);
    f.primary.document.body.appendChild(tree);
    Object.assign(f.state, { outlineExplorerOpen: true, _outlineExplorerOverlay: tree,
      _outlineExplorerPdfWin: f.primary });
    f.z._setReaderOutlineExplorerFocus(f.state, true); f.win.flush();
    assertRing(f, 'outline');
    assert.equal(primary.marker.style.display, 'none');
    assert.equal(visibleMarkers().length, 0);
    f.z._focusReaderPdfWindow(f.primary, f.state); f.win.flush();
    assertRing(f, 'pdf', [181, 1, 268, 648]);
    assert.equal(visibleMarkers()[0], primary);
    f.note.document.emit('pointerdown'); f.win.flush();
    assertRing(f, 'note');
    assert.equal(cue.layers.get(f.win.document).marker.style.display, 'none');
    assert.equal(visibleMarkers().length, 0);
  });

  await check('PDF marker stays at its viewport corner through scroll, zoom and sidebar resize', () => {
    const f = fixture();
    const layer = f.state._focusCue.layers.get(f.primary.document);
    const marker = layer.marker;
    assert.equal(marker.style.right, '10px');
    assert.equal(marker.style.top, '6px');
    const container = f.primary.document.createElementNS('', 'div');
    container.rect = rectangle(0, 0, 450, 650);
    container.clientWidth = 430;
    const pdfViewer = { container, currentScale: 1, currentPageNumber: 4 };
    f.primary.PDFViewerApplication = { pdfViewer };
    f.sync();
    assert.equal(marker.style.right, '30px'); // Keep clear of a classic scrollbar.
    container.scrollTop = 1000;
    container.scrollLeft = 200;
    pdfViewer.currentScale = 2;
    f.primary.document.emit('scroll', { target: container }); f.win.flush();
    assert.equal(marker.style.right, '30px');
    assert.equal(marker.style.top, '6px');
    assert.match(marker.style.cssText, /width:6px;height:6px/);
    f.primary.innerWidth = 350;
    container.rect = rectangle(0, 0, 350, 650);
    container.clientWidth = 330;
    f.primary.emit('resize'); f.win.flush();
    assertRing(f, 'pdf', [1, 1, 348, 648]);
    assert.equal(marker.style.right, '30px');
    assert.equal(marker.style.top, '6px');
    assert.equal(marker.style.display, 'block');
    assert.equal(pdfViewer.currentScale, 2);
    assert.equal(container.scrollTop, 1000);
    assert.equal(container.scrollLeft, 200);
    f.primary.innerWidth = 10;
    container.clientWidth = 10;
    f.primary.emit('resize'); f.win.flush();
    assert.equal(marker.style.display, 'none');
    f.primary.innerWidth = 350;
    container.clientWidth = 330;
    f.primary.emit('resize'); f.win.flush();
    assert.equal(marker.style.display, 'block');
  });

  await check('outline uses the same ring; PDF focus excludes the still-visible tree', () => {
    const f = fixture();
    const tree = f.primary.document.createElementNS('', 'div');
    tree.rect = rectangle(0, 0, 180, 650);
    tree.ink = 'rgb(205, 214, 244)';
    f.primary.document.body.appendChild(tree);
    Object.assign(f.state, { outlineExplorerOpen: true, _outlineExplorerOverlay: tree,
      _outlineExplorerPdfWin: f.primary,
      _outlineExplorerHeader: f.primary.document.createElementNS('', 'div') });
    f.z._setReaderOutlineExplorerFocus(f.state, true); f.win.flush();
    assertRing(f, 'outline', [1, 1, 178, 648]);
    assert.equal(f.state._focusCue.element.parentNode, f.primary.document.body);
    assert.match(f.state._focusCue.element.style.cssText, /z-index:100001/);
    assert.equal(f.state._focusCue.element.style['--zv-focus-ink'], tree.ink);
    assert.equal(f.state._outlineExplorerHeader.textContent, 'Outline');
    f.z._focusReaderPdfWindow(f.primary, f.state); f.win.flush();
    assertRing(f, 'pdf', [181, 1, 268, 648]);
    assert.equal(f.state._focusCue.element.style['--zv-focus-ink'], 'rgb(30, 30, 30)');
    assert.equal(tree.style.borderRightColor, undefined);
  });

  await check('sidebar notes own the sole ring with Vim disabled and leave native contents/input untouched', () => {
    const f = fixture(false);
    const before = [...f.note.document.body.children];
    f.note.document.emit('pointerdown'); f.win.flush();
    assertRing(f, 'note', [1021, 71, 298, 648]);
    f.note.document.emit('keydown', { key: 'y', isComposing: true });
    f.note.document.emit('focusin'); f.win.flush();
    assertRing(f, 'note');
    assert.equal(f.z.isNoteEditorVimEnabled(), false);
    assert.equal(f.note.document.body.textContent, 'Native note contents');
    assert.deepEqual(f.note.document.body.children, before);
    assert.equal(f.state._contextNoteEditorKeyHandler, undefined);
    f.primary.document.emit('pointerdown'); f.win.flush();
    assertRing(f, 'pdf');
  });

  await check('keyboard focus to note/PDF and note toolbar clicks update appearance immediately', async () => {
    const f = fixture(true);
    await f.z._focusContextNoteEditor(f.win); f.win.flush();
    assertRing(f, 'note');
    f.z._focusReaderPdfWindow(f.secondary, f.state); f.win.flush();
    assertRing(f, 'pdf', [1, 1, 448, 648]);
    const toolbar = f.win.document.createElementNS('', 'button');
    f.editor.appendChild(toolbar);
    f.win.document.emit('pointerdown', { target: toolbar }); f.win.flush();
    assertRing(f, 'note');
  });

  await check('new note documents gain focus even if their creation preceded observer attachment', () => {
    const f = fixture(false);
    const replacement = windowFixture(f.context, 300, 650);
    const node = frame(f.win, replacement, f.editor.rect);
    f.editor._iframe = node;
    f.context.Services.focus.focusedWindow = replacement;
    f.sync();
    assertRing(f, 'note');
    assert.equal(f.note.document.listeners.get('pointerdown').size, 0);
    assert.equal(f.state._focusCue.note.win, replacement);
  });

  await check('toolbar focus clears the cue without being overwritten by retained PDF/note focus', () => {
    const f = fixture();
    const button = f.win.document.createElementNS('', 'button');
    f.win.document.emit('focusin', { target: button }); f.win.flush();
    assert.equal(f.state._focusCue.element.style.opacity, '0');
    f.sync();
    assert.equal(f.state._focusCue.element.style.opacity, '0');
    // Original content events captured by chrome must not erase a finer owner.
    f.primary.document.emit('pointerdown');
    f.win.document.emit('keydown', { target: f.primary.document.body }); f.win.flush();
    assertRing(f, 'pdf');
  });

  await check('modals, inactive tabs and inactive windows suppress the ring', () => {
    const f = fixture();
    for (const field of ['_outlinePicker', '_translationPopup', 'marksExplorerOpen', '_commentOverlay']) {
      f.state[field] = {}; f.sync();
      assert.equal(f.state._focusCue.element.style.opacity, '0');
      f.state[field] = null;
    }
    f.sync(); assertRing(f, 'pdf');
    f.select(null); f.sync();
    assert.equal(f.state._focusCue.element.style.opacity, '0');
    f.select(f.reader); f.sync(); assertRing(f, 'pdf');
    const animation = f.state._focusCue.animation;
    f.win.emit('deactivate');
    assert.equal(f.state._focusCue.element.style.opacity, '0');
    assert.equal(animation.canceled, true);
    f.win.emit('activate'); f.win.flush(); assertRing(f, 'pdf');
  });

  await check('layout changes reproject with scale, frame borders, clipping and Gecko root-frame fallback', () => {
    const f = fixture();
    f.primaryFrame.rect = rectangle(20, 10, 225, 325);
    f.primaryFrame.clientLeft = 2; f.primaryFrame.clientTop = 4;
    // source viewport clips a region extending beyond all four edges.
    const projected = f.z._projectReaderFocusRect(rectangle(-20, -10, 500, 700),
      f.primary, f.state._focusCue, f.reader);
    assert.deepEqual(JSON.parse(JSON.stringify(projected)),
      { left: 121, top: 82, right: 346, bottom: 407 });
    f.outer.frameElement = null;
    f.win.emit('resize'); f.win.flush();
    assertRing(f, 'pdf', [1, 1, 448, 648]);
    f.reader._iframe.remove(); f.sync();
    assert.equal(f.state._focusCue.element.style.opacity, '0');
  });

  await check('closing a split recovers the focused PDF; closing a sidebar removes its cue', () => {
    const f = fixture();
    f.secondary.document.emit('pointerdown'); f.win.flush();
    delete f.reader._internalReader._secondaryView;
    f.sync();
    assertRing(f, 'pdf');
    assert.equal(f.state._focusCue.owner.win, f.primary);
    assert.equal(f.secondary.document.listeners.get('pointerdown').size, 0);
    f.note.document.emit('pointerdown'); f.win.flush(); assertRing(f, 'note');
    f.win.ZoteroContextPane.collapsed = true; f.sync();
    assert.equal(f.state._focusCue.element.style.opacity, '0');
    assert.equal(f.note.document.listeners.get('keydown').size, 0);
  });

  await check('detached frame, stylesheet or marker is rebuilt without user input', () => {
    const f = fixture();
    const first = f.state._focusCue.element;
    first.remove();
    f.sync();
    assertRing(f, 'pdf', [1, 1, 448, 648]);
    assert.notEqual(f.state._focusCue.element, first);
    assert.equal(f.state._focusCue.element.isConnected, true);
    const layer = f.state._focusCue.layers.get(f.primary.document);
    layer.style.remove();
    f.sync();
    assert.notEqual(f.state._focusCue.element, layer.element);
    assert.equal(layer.element.isConnected, false);
    assert.equal(f.state._focusCue.layers.get(f.primary.document).style.isConnected, true);
    const current = f.state._focusCue.layers.get(f.primary.document);
    current.marker.remove();
    f.sync();
    assertRing(f, 'pdf');
    assert.equal(current.element.isConnected, false);
    const replacement = f.state._focusCue.layers.get(f.primary.document);
    assert.equal(replacement.marker.isConnected, true);
    assert.equal(replacement.marker.style.display, 'block');
  });

  await check('a reused WindowProxy with a new document recovers ownership and local drawing', () => {
    const f = fixture();
    const oldDoc = f.primary.document;
    const oldLayer = f.state._focusCue.layers.get(oldDoc);
    const replacement = windowFixture(f.context, 450, 650);
    f.primary.document = replacement.document;
    replacement.document.defaultView = f.primary;
    f.sync();
    assertRing(f, 'pdf');
    assert.equal(f.state._focusCue.owner.doc, replacement.document);
    assert.equal(f.state._focusCue.owner.win, f.primary);
    assert.equal(f.state._focusCue.element.ownerDocument, replacement.document);
    assert.equal(oldLayer.element.isConnected, false);
    assert.equal(f.state._focusCue.layers.has(oldDoc), false);
  });

  await check('split close recovers a primary view created after both timed callbacks', () => {
    const f = fixture();
    f.z._injectSelectionCSS = () => {};
    f.secondary.document.emit('pointerdown'); f.win.flush();
    f.context.Services.focus.focusedWindow = f.secondary;
    f.win.document.activeElement = f.reader._iframe;
    f.reader._internalReader.splitType = 'vertical';
    f.reader.toggleVerticalSplit = () => {
      delete f.reader._internalReader._primaryView;
      delete f.reader._internalReader._secondaryView;
      f.reader._internalReader.splitType = '';
    };
    f.z._toggleReaderSplit(f.state, f.reader, 'vertical');
    for (const timer of f.timers) timer.fn();
    f.win.flush();
    assert.ok([...f.state._focusCue.layers.values()]
      .every(layer => layer.element.style.opacity === '0'));
    const primary = windowFixture(f.context, 900, 650);
    f.reader._internalReader._primaryView = { _iframeWindow: primary };
    // Native focus can still point to the removed frame during the transition.
    f.z._syncReaderPdfViewListeners(f.reader, f.state); f.win.flush();
    assertRing(f, 'pdf', [1, 1, 898, 648]);
    assert.equal(f.state._focusCue.owner.win, primary);
    assert.equal(f.state._focusCue.element.ownerDocument, primary.document);
    assert.equal(f.state._focusCue.pendingRecovery, null);
    assert.equal(f.context.Services.focus.focusedWindow, primary);
  });

  await check('recovery respects a focused note or toolbar instead of stale activePdfWin', () => {
    const note = fixture(false);
    note.secondary.document.emit('pointerdown'); note.win.flush();
    delete note.reader._internalReader._secondaryView;
    note.context.Services.focus.focusedWindow = note.note;
    note.sync();
    assertRing(note, 'note');
    assert.equal(note.context.Services.focus.focusedWindow, note.note);
    const toolbar = fixture();
    toolbar.secondary.document.emit('pointerdown'); toolbar.win.flush();
    delete toolbar.reader._internalReader._secondaryView;
    const button = toolbar.win.document.createElementNS('', 'button');
    toolbar.win.document.activeElement = button;
    toolbar.context.Services.focus.focusedWindow = toolbar.win;
    toolbar.sync(); toolbar.sync();
    assert.equal(toolbar.state._focusCue.owner, null);
    assert.ok(toolbar.state._focusCue.pendingRecovery);
    assert.equal(toolbar.win.document.activeElement, button);
    toolbar.win.document.emit('focusin', { target: button });
    toolbar.context.Services.focus.focusedWindow = toolbar.primary;
    toolbar.sync();
    assert.equal(toolbar.state._focusCue.owner, null);
    assert.equal(toolbar.state._focusCue.pendingRecovery, null);
  });

  await check('native search input delays recovery until focus returns to a live PDF', () => {
    const f = fixture();
    f.secondary.document.emit('pointerdown'); f.win.flush();
    delete f.reader._internalReader._secondaryView;
    const input = f.outer.document.createElementNS('', 'input');
    f.outer.document.activeElement = input;
    f.context.Services.focus.focusedWindow = f.outer;
    f.sync();
    assert.equal(f.state._focusCue.owner, null);
    assert.ok(f.state._focusCue.pendingRecovery);
    assert.equal(f.outer.document.activeElement, input);
    f.outer.document.activeElement = f.outer.document.body;
    f.sync();
    assertRing(f, 'pdf');
    assert.equal(f.state._focusCue.owner.win, f.primary);
    assert.equal(f.context.Services.focus.focusedWindow, f.outer);
  });

  await check('dead content wrappers cannot prevent a replacement layer from being drawn', () => {
    const f = fixture();
    const layer = f.state._focusCue.layers.get(f.primary.document);
    layer.element.remove(); layer.style.remove();
    const dead = () => { throw Error('Dead content object'); };
    layer.animation = { cancel: dead };
    layer.element.remove = dead;
    layer.style.remove = dead;
    Object.defineProperty(layer.element, 'isConnected', { get: dead });
    f.sync();
    assertRing(f, 'pdf');
    assert.notEqual(f.state._focusCue.element, layer.element);
    assert.equal(f.state._focusCue.element.isConnected, true);
  });

  await check('neutral animation is deduplicated, cloned and disabled for reduced motion', () => {
    const f = fixture();
    const count = f.primary.animations.length;
    f.primary.document.emit('keydown', { key: 'h' }); f.win.flush();
    assert.equal(f.primary.animations.length, count);
    f.secondary.document.emit('pointerdown'); f.win.flush();
    assert.equal(f.secondary.animations.length, 1);
    assert.equal(f.secondary.animations.at(-1).options.duration, 140);
    assert.equal(f.clones.at(-1), f.secondary);
    f.primary.reduced = true;
    f.primary.document.emit('pointerdown'); f.win.flush();
    assert.equal(f.primary.animations.length, count);
    assertRing(f, 'pdf');
  });

  await check('chrome nodes are out of flow before insertion even without an active stylesheet', () => {
    const f = fixture();
    f.z._clearReaderFocusCue(f.state);
    const snapshots = [];
    const append = f.win.document.body.appendChild;
    f.win.document.body.appendChild = function (node) {
      snapshots.push({ tag: node.tagName, css: node.style.cssText });
      return append.call(this, node);
    };
    f.sync();
    assert.match(snapshots.find(node => node.tag === 'STYLE').css, /display:none!important/);
    const ring = snapshots.find(node => node.tag === 'DIV');
    assert.match(ring.css, /position:fixed!important/);
    assert.match(ring.css, /margin:0!important;padding:0!important/);
    assert.match(ring.css, /pointer-events:none!important/);
    assert.match(f.state._focusCue.element.style.boxShadow, /^inset 0 0 0 1px /);
    assertRing(f, 'pdf');
  });

  await check('embedded PDF focus does not mark the active chrome window as inactive', () => {
    const f = fixture();
    f.z._clearReaderFocusCue(f.state);
    f.win.document.hasFocus = () => false;
    f.context.Services.focus.activeWindow = { document: f.win.document };
    f.sync();
    assertRing(f, 'pdf');
  });

  await check('native PdfView frames and document identity bypass opaque WindowProxy frameElement', () => {
    const f = fixture();
    f.primary.frameElement = null;
    f.outer.frameElement = null;
    f.reader._internalReader._primaryView._iframe = f.primaryFrame;
    const alias = { document: f.win.document, innerWidth: 1400, innerHeight: 900 };
    f.reader._iframe.ownerDocument = { defaultView: alias };
    f.primary.document.emit('pointerdown'); f.win.flush();
    assertRing(f, 'pdf', [1, 1, 448, 648]);
  });

  await check('PDF and outline rendering never depends on parent-browser geometry', () => {
    const f = fixture();
    const denied = () => { throw Error('Cross-frame geometry is inaccessible'); };
    Object.defineProperty(f.primary, 'frameElement', { get: denied });
    f.primaryFrame.getBoundingClientRect = denied;
    f.reader._iframe.getBoundingClientRect = denied;
    f.primary.document.emit('pointerdown'); f.win.flush();
    assertRing(f, 'pdf', [1, 1, 448, 648]);
    assert.equal(f.state._focusCue.element.ownerDocument, f.primary.document);
    const tree = f.primary.document.createElementNS('', 'div');
    tree.rect = rectangle(0, 0, 180, 650);
    f.primary.document.body.appendChild(tree);
    Object.assign(f.state, { outlineExplorerOpen: true, _outlineExplorerOverlay: tree,
      _outlineExplorerPdfWin: f.primary });
    f.z._setReaderOutlineExplorerFocus(f.state, true); f.win.flush();
    assertRing(f, 'outline', [1, 1, 178, 648]);
    assert.equal(f.state._focusCue.element.ownerDocument, f.primary.document);
    // The working note path remains outside the editor, in the chrome document.
    f.note.document.emit('pointerdown'); f.win.flush();
    assertRing(f, 'note', [1021, 71, 298, 648]);
    assert.equal(f.state._focusCue.element.ownerDocument, f.win.document);
  });

  await check('incidental outer-reader focus cannot erase the PDF owner; toolbar input can', () => {
    const f = fixture();
    f.primary.document.emit('pointerdown');
    f.outer.document.emit('focusin', { target: f.outer.document.body });
    f.outer.document.emit('keydown', { target: f.primary.document.body });
    f.win.flush();
    assertRing(f, 'pdf');
    const button = f.outer.document.createElementNS('', 'button');
    f.outer.document.emit('pointerdown', { target: button }); f.win.flush();
    assert.ok([...f.state._focusCue.layers.values()]
      .every(layer => layer.element.style.opacity === '0'));
  });

  await check('split gutters remove only adjoining padding and restore inline values on close', () => {
    const f = fixture();
    const makeViewer = win => {
      const viewer = win.document.createElementNS('', 'div');
      win.document.body.appendChild(viewer);
      win.document.getElementById = id => id === 'viewer' ? viewer : null;
      viewer.style.padding = '18px';
      return viewer;
    };
    const first = makeViewer(f.primary);
    const second = makeViewer(f.secondary);
    first.style.setProperty('padding-right', '7px', 'important');
    second.style.setProperty('padding-left', '9px');
    const ir = f.reader._internalReader;
    ir.splitType = 'vertical';
    f.z._syncReaderSplitGutters(f.reader, f.state);
    assert.equal(first.style.getPropertyValue('padding-right'), '0px');
    assert.equal(second.style.getPropertyValue('padding-left'), '0px');
    assert.equal(first.style.padding, '18px');
    assert.equal(second.style.padding, '18px');
    assert.equal(first.style.getPropertyValue('padding-top'), '');
    ir.splitType = 'horizontal';
    f.z._syncReaderSplitGutters(f.reader, f.state);
    assert.equal(first.style.getPropertyValue('padding-right'), '7px');
    assert.equal(first.style.getPropertyPriority('padding-right'), 'important');
    assert.equal(second.style.getPropertyValue('padding-left'), '9px');
    assert.equal(first.style.getPropertyValue('padding-bottom'), '0px');
    assert.equal(second.style.getPropertyValue('padding-top'), '0px');
    delete ir._secondaryView;
    ir.splitType = '';
    f.z._syncReaderSplitGutters(f.reader, f.state);
    assert.equal(first.style.getPropertyValue('padding-bottom'), '');
    assert.equal(second.style.getPropertyValue('padding-top'), '');
    assert.equal(f.state._readerSplitGutters.size, 0);
  });

  await check('replaced viewers and shutdown restore gutter overrides without changing page content', () => {
    const f = fixture();
    const viewers = [f.primary, f.secondary].map(win => {
      const viewer = win.document.createElementNS('', 'div');
      win.document.body.appendChild(viewer);
      win.document.getElementById = () => viewer;
      return viewer;
    });
    const page = f.primary.document.createElementNS('', 'div');
    page.textContent = 'Existing PDF text';
    viewers[0].appendChild(page);
    const navigation = { currentScaleValue: 'page-width', currentPageNumber: 4 };
    f.primary.PDFViewerApplication = { pdfViewer: navigation };
    f.reader._internalReader.splitType = 'vertical';
    f.z._syncReaderSplitGutters(f.reader, f.state);
    const replacement = f.primary.document.createElementNS('', 'div');
    f.primary.document.getElementById = () => replacement;
    f.z._syncReaderSplitGutters(f.reader, f.state);
    assert.equal(viewers[0].style.getPropertyValue('padding-right'), '');
    assert.equal(replacement.style.getPropertyValue('padding-right'), '0px');
    f.z._clearReaderSplitGutters(f.state);
    assert.equal(replacement.style.getPropertyValue('padding-right'), '');
    assert.equal(viewers[1].style.getPropertyValue('padding-left'), '');
    assert.deepEqual(navigation, { currentScaleValue: 'page-width', currentPageNumber: 4 });
    assert.equal(page.textContent, 'Existing PDF text');
  });

  await check('cleanup cancels pending paint and removes only plugin-owned nodes/listeners', () => {
    const f = fixture();
    const unrelated = () => {};
    f.note.document.addEventListener('keydown', unrelated);
    const cue = f.state._focusCue;
    const layers = [...cue.layers.values()];
    f.z._queueReaderFocusCue(f.state);
    f.z._clearReaderFocusCue(f.state);
    assert.equal(f.state._focusCue, null);
    assert.equal(f.win.frames.size, 0);
    assert.equal(cue.element.isConnected, false);
    assert.ok(layers.every(layer => !layer.style.isConnected && !layer.element.isConnected));
    assert.equal(f.note.document.listeners.get('keydown').size, 1);
    for (const doc of [f.win.document, f.outer.document, f.primary.document, f.secondary.document]) {
      assert.equal(doc.listeners.get('pointerdown').size, 0);
    }
    for (const win of [f.primary, f.secondary, f.note]) {
      assert.equal(win.listeners.get('focus')?.size || 0, 0);
    }
    f.win.flush();
  });
  console.log('Reader focus cue checks passed (' + passed + ' cases).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

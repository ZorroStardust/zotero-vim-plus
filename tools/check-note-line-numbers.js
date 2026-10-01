/* global require, __dirname, console */
// Run with: node tools/check-note-line-numbers.js
// Native position mapping and UI lifecycle without adding runtime dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
let clones = 0;
const context = vm.createContext({
  Zotero: { debug() {} },
  Components: { utils: { cloneInto(value) { clones++; return value; } } },
  clearTimeout() {},
});
for (const name of ['zoteroVim.js', 'zoteroVimMain.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
}
const plugin = context.ZoteroVim;

function node(type, children = [], text = null) {
  const isText = text !== null;
  const isTextblock = ['paragraph', 'heading', 'codeBlock'].includes(type);
  const isLeaf = isText || type === 'hardBreak' || type === 'image';
  return {
    type: { name: type }, isText, isTextblock, isLeaf, text,
    childCount: children.length, child: i => children[i],
    content: { size: children.reduce((size, child) => size + child.nodeSize, 0) },
    get nodeSize() {
      return isText ? text.length : isLeaf ? 1 : this.content.size + (type === 'doc' ? 0 : 2);
    },
  };
}
const text = value => node('text', [], value);
const paragraph = value => node('paragraph', value ? [text(value)] : []);

function element(doc, tag = 'DIV') {
  const classes = new Set();
  const el = {
    tagName: tag, ownerDocument: doc, nodeType: 1, isConnected: true,
    children: [], parentElement: null, style: {}, attributes: {},
    classList: { add: value => classes.add(value), remove: value => classes.delete(value),
      contains: value => classes.has(value) },
    clientLeft: 0, clientTop: 0, clientWidth: 400, clientHeight: 300,
    css: { paddingLeft: '30px', overflowX: 'visible', overflowY: 'visible',
      fontSize: '16px', marginBottom: '0px' },
    rect: { left: 0, top: 0, right: 400, bottom: 300 },
    getBoundingClientRect() { return this.rect; },
    contains(other) { return other === el; },
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) {
      child.parentElement = el;
      child.previousElementSibling = this.children[this.children.length - 1] || null;
      this.children.push(child); return child;
    },
    replaceChildren(fragment) { this.children = fragment?.tagName === 'FRAGMENT'
      ? fragment.children : fragment ? [fragment] : []; },
    remove() { this.removed = true; },
    addEventListener() {}, removeEventListener() {},
  };
  return el;
}

function fixture(content) {
  const frames = new Map();
  const observers = [];
  const events = [];
  let frameID = 0;
  const eventTarget = {
    addEventListener(type, handler) { events.push({ target: this, type, handler }); },
    removeEventListener(type, handler) {
      const index = events.findIndex(e => e.target === this && e.type === type && e.handler === handler);
      if (index >= 0) events.splice(index, 1);
    },
  };
  const win = {
    ...eventTarget, innerWidth: 400, innerHeight: 300,
    requestAnimationFrame(fn) { frames.set(++frameID, fn); return frameID; },
    cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle(el, pseudo) { return pseudo ? el.pseudo?.[pseudo] || { content: 'none' } : el.css; },
    MutationObserver: function(fn) {
      this.callback = fn;
      this.observe = (_el, options) => { this.options = options; };
      this.disconnect = () => { this.disconnected = true; };
      observers.push(this);
    },
    ResizeObserver: function(fn) {
      this.callback = fn; this.observe = () => {};
      this.disconnect = () => { this.disconnected = true; };
      observers.push(this);
    },
  };
  const doc = {
    ...eventTarget, defaultView: win, getSelection: () => null,
    createElement: tag => element(doc, tag.toUpperCase()),
    createDocumentFragment: () => element(doc, 'FRAGMENT'),
  };
  doc.head = element(doc);
  doc.body = element(doc);
  doc.documentElement = doc.body;
  const editable = element(doc);
  editable.parentElement = doc.body;
  const nodes = new Map();
  const view = {
    dom: editable, state: { doc: node('doc', content), selection: { from: 1 } },
    dispatch() {}, nodeDOM: pos => nodes.get(pos),
    coordsCalls: 0,
    coordsAtPos(pos) { this.coordsCalls++; return { top: pos * 20, bottom: pos * 20 + 16 }; },
  };
  win._currentEditorInstance = { _editorCore: { view } };
  const state = { _contextNoteEditorDoc: doc };
  function flush() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(fn => fn());
  }
  return { win, doc, editable, view, state, frames, events, observers, nodes, flush };
}

let pass = 0;
function check(label, fn) { fn(); pass++; console.log('  ok  ' + label); }

check('default on; numbering requires note Vim mode', () => {
  const original = plugin.getPref;
  plugin.getPref = (_key, fallback) => fallback;
  assert.equal(plugin.isNoteLineNumbersEnabled(), true);
  plugin.getPref = key => key !== 'noteEditor.enabled';
  assert.equal(plugin.isNoteLineNumbersEnabled(), false);
  plugin.getPref = key => key !== 'noteEditor.lineNumbers';
  assert.equal(plugin.isNoteLineNumbersEnabled(), false);
  plugin.getPref = original;
});

check('paragraphs, empty lines, headings, hard breaks and code newlines share one numbering', () => {
  const f = fixture([
    node('heading', [text('title')]), paragraph(''),
    node('paragraph', [text('a'), node('hardBreak'), text('b'), node('hardBreak')]),
    node('codeBlock', [text('c\nd\n')]),
    node('bulletList', [node('listItem', [paragraph('list')])]),
  ]);
  const model = plugin._noteLineNumberModel(f.editable);
  assert.equal(model.snapshot.text, 'title\n\na\nb\n\nc\nd\n\nlist');
  assert.equal(model.starts.length, 9);
  assert.deepEqual(Array.from(model.starts), [0, 6, 7, 9, 11, 12, 14, 16, 17]);
  assert.deepEqual(Array.from(model.groups, g => g.lines.length), [1, 1, 3, 3, 1]);
});

check('every displayed position agrees with numbered G, including empty lines', () => {
  const f = fixture([paragraph('first'), paragraph(''),
    node('paragraph', [text('a'), node('hardBreak'), text('b')]),
    node('codeBlock', [text('x\ny\n')])]);
  const model = plugin._noteLineNumberModel(f.editable);
  const select = plugin._noteSelectOffsets;
  plugin._noteSelectOffsets = (snapshot, offset) => {
    f.view.state.selection = { from: snapshot.points[offset] }; return true;
  };
  for (const group of model.groups) {
    for (const line of group.lines) {
      plugin._noteGoToLine(f.editable, line.number);
      assert.equal(f.view.state.selection.from, line.pos);
      assert.equal(plugin._noteLineNumberCurrent(model), line.number);
    }
  }
  plugin._noteSelectOffsets = select;
});

check('table cells keep global document-order numbers and distinct native cell positions', () => {
  const f = fixture([paragraph('before'), node('table', [node('table_row', [
    node('table_cell', [paragraph('left')]), node('table_header', [paragraph('right')]),
  ])]), paragraph('after')]);
  const model = plugin._noteLineNumberModel(f.editable);
  assert.equal(model.starts.length, 4);
  assert.equal(model.groups[0].cellPos, undefined);
  assert.notEqual(model.groups[1].cellPos, model.groups[2].cellPos);
  assert.equal(typeof model.groups[1].cellPos, 'number');
  assert.equal(model.groups[3].cellPos, undefined);
});

check('cache survives cursor/viewport changes but rebuilds for document or view replacement', () => {
  const f = fixture([paragraph('one'), paragraph('two')]);
  const model = plugin._noteLineNumberModel(f.editable);
  f.view.state.selection = { from: model.groups[1].lines[0].pos };
  f.win.innerWidth = 200;
  assert.equal(plugin._noteLineNumberModel(f.editable, model), model);
  assert.equal(plugin._noteLineNumberCurrent(model), 2);
  f.view.state.doc = node('doc', [paragraph('new')]);
  assert.notEqual(plugin._noteLineNumberModel(f.editable, model), model);
  f.win._currentEditorInstance._editorCore.view = { ...f.view };
  assert.notEqual(plugin._noteLineNumberModel(f.editable, model), model);
});

check('live DOM caret wins over stale editor state for the current-line highlight', () => {
  const f = fixture([paragraph('one'), paragraph('two')]);
  const model = plugin._noteLineNumberModel(f.editable);
  f.doc.getSelection = () => ({ rangeCount: 1, anchorNode: f.editable, anchorOffset: 0 });
  f.view.posAtDOM = () => model.groups[1].lines[0].pos;
  assert.equal(plugin._noteLineNumberCurrent(model), 2);
});

check('gutter is outside managed content; paint is coalesced; observers clone their options', () => {
  const f = fixture([paragraph('one')]);
  const before = f.view.state.doc;
  plugin.isNoteLineNumbersEnabled = () => true;
  const beforeClones = clones;
  plugin._syncNoteLineNumbers(f.state);
  const state = f.state._contextNoteLineNumbers;
  assert.equal(state.layer.parentElement, f.doc.body);
  assert.equal(state.layer.attributes['aria-hidden'], 'true');
  assert.equal(state.layer.attributes.contenteditable, 'false');
  assert.equal(f.editable.children.length, 0);
  assert.equal(f.frames.size, 1);
  f.observers.forEach(observer => observer.callback());
  assert.equal(f.frames.size, 1);
  assert.ok(clones > beforeClones);
  assert.equal(f.view.state.doc, before);
});

check('offscreen blocks are not measured and table labels have separate columns', () => {
  const f = fixture([paragraph('above'), node('table', [node('table_row', [
    node('table_cell', [paragraph('left')]), node('table_cell', [paragraph('right')]),
  ])]), paragraph('below')]);
  const model = plugin._noteLineNumberModel(f.editable);
  model.groups.forEach((group, i) => {
    const block = element(f.doc);
    block.rect = { left: 0, right: 400, top: i === 0 ? -200 : i === 3 ? 800 : 80,
      bottom: i === 0 ? -100 : i === 3 ? 900 : 120 };
    f.nodes.set(group.from, block);
    if (group.cellPos !== undefined) {
      const cell = element(f.doc);
      cell.rect = { left: i === 1 ? 40 : 200, right: 400, top: 80, bottom: 120 };
      f.nodes.set(group.cellPos, cell);
    }
  });
  f.view.coordsAtPos = () => { f.view.coordsCalls++; return { top: 80, bottom: 96 }; };
  plugin._syncNoteLineNumbers(f.state);
  f.flush();
  const rows = f.state._contextNoteLineNumbers.layer.children;
  assert.deepEqual(rows.map(row => row.textContent), ['2', '3']);
  assert.match(rows[0].style.cssText, /left:45px/);
  assert.match(rows[1].style.cssText, /left:205px/);
  assert.equal(f.view.coordsCalls, 4);
});

check('long code blocks measure only visible rows after logarithmic lookup', () => {
  const f = fixture([node('codeBlock', [text('x\n'.repeat(10000))])]);
  const block = element(f.doc);
  block.rect.bottom = 500000;
  f.nodes.set(0, block);
  f.editable.rect.top = -250000;
  f.editable.rect.bottom = 250000;
  f.view.coordsAtPos = pos => { f.view.coordsCalls++;
    return { top: pos * 20 - 250000, bottom: pos * 20 - 250000 + 16 }; };
  plugin._syncNoteLineNumbers(f.state);
  f.flush();
  assert.ok(f.view.coordsCalls < 30);
  assert.ok(f.state._contextNoteLineNumbers.layer.children.length < 10);
});

check('viewport clips labels to scroll containers and excludes the toolbar', () => {
  const f = fixture([paragraph('one')]);
  const scroller = element(f.doc);
  scroller.rect = { left: 20, top: 40, right: 380, bottom: 280 };
  scroller.clientWidth = 360; scroller.clientHeight = 240;
  scroller.css.overflowX = scroller.css.overflowY = 'auto';
  f.editable.parentElement = scroller;
  assert.deepEqual(JSON.parse(JSON.stringify(plugin._noteLineNumberViewport(f.editable))),
    { left: 20, top: 40, right: 380, bottom: 280 });
});

check('spacing scales with digit count; printing hides labels and retains native padding', () => {
  const f = fixture([paragraph('one')]);
  plugin._syncNoteLineNumbers(f.state);
  const state = f.state._contextNoteLineNumbers;
  plugin._noteLineNumberStyle(state, 9999);
  assert.equal(state.width, 40);
  assert.equal(state.padding, 48);
  assert.match(state.style.textContent, /@media screen/);
  assert.match(state.style.textContent, /@media print.*display: none/);
  assert.match(state.style.textContent, /padding-left: 50px/);
});

check('ordinary paragraphs and headings without badges retain the original compact margin', () => {
  for (const nativePadding of [0, 30, 48]) {
    const f = fixture([node('heading', [text('title')]), paragraph('body')]);
    f.editable.css.paddingLeft = nativePadding + 'px';
    for (const group of plugin._noteLineNumberModel(f.editable).groups) {
      const block = element(f.doc);
      f.nodes.set(group.from, block);
    }
    plugin._syncNoteLineNumbers(f.state);
    f.flush();
    const state = f.state._contextNoteLineNumbers;
    assert.equal(state.padding, Math.max(nativePadding, 32));
    assert.ok(state.layer.children[0].style.cssText.startsWith(
      'left:' + (state.padding - state.width - 8) + 'px;'));
    assert.ok(!state.layer.children[0].className.includes('zv-note-heading-line'));
    assert.ok(!state.style.textContent.includes('margin-bottom: max'));
    assert.equal(f.view.state.doc.child(0).type.name, 'heading');
  }
});

function headingDOM(f, parent = f.editable, tag = 'H2') {
  const block = parent.appendChild(element(f.doc, tag));
  block.rect = { left: 32, top: 40, right: 400, bottom: 60 };
  block.pseudo = { '::before': {
    content: '"H2"', display: 'block', visibility: 'visible',
    fontSize: '10px', width: '20px', height: '10px', lineHeight: '10px',
    left: '0px', top: '2px', marginLeft: '-26px', transform: 'none',
    borderLeftWidth: '1px', borderRightWidth: '1px', boxSizing: 'border-box',
  } };
  return block;
}

check('badged heading numbers sit below H2 as 10px-high labels and keep current-line emphasis', () => {
  const f = fixture([node('heading', [text('title')]), paragraph('body')]);
  const model = plugin._noteLineNumberModel(f.editable);
  const block = headingDOM(f);
  f.nodes.set(model.groups[0].from, block);
  f.view.coordsAtPos = () => ({ left: 32, top: 40, bottom: 60 });
  plugin._syncNoteLineNumbers(f.state);
  f.flush();
  const state = f.state._contextNoteLineNumbers;
  const row = state.layer.children[0];
  assert.match(row.className, /zv-note-current-line/);
  assert.match(row.className, /zv-note-heading-line/);
  assert.match(row.style.cssText, /top:53px/);
  assert.match(row.style.cssText, /height:10px;line-height:10px/);
  assert.match(state.style.textContent, /font-size: 9px/);
  assert.match(state.style.textContent, /h2:nth-child\(1\).*margin-bottom: max\(5px/);
  assert.equal(state.padding, 32);
  assert.equal(block.pseudo['::before'].marginLeft, '-26px');
});

check('table headings reserve only vertical clearance, never an extra horizontal marker column', () => {
  const f = fixture([node('table', [node('table_row', [
    node('table_cell', [node('heading', [text('title')])]),
  ])])]);
  const model = plugin._noteLineNumberModel(f.editable);
  const table = f.editable.appendChild(element(f.doc, 'TABLE'));
  const row = table.appendChild(element(f.doc, 'TR'));
  const cell = row.appendChild(element(f.doc, 'TD'));
  const block = headingDOM(f, cell);
  f.nodes.set(model.groups[0].from, block);
  plugin._syncNoteLineNumbers(f.state);
  const state = f.state._contextNoteLineNumbers;
  state.model = model;
  plugin._noteLineNumberStyle(state, 1);
  assert.match(state.style.textContent, /padding-left: 34px/);
  assert.ok(!state.style.textContent.includes('padding-left: 66px'));
  assert.match(state.style.textContent, /td:nth-child\(1\) > h2:nth-child\(1\).*margin-bottom/);
});

check('an empty 64px click-target pseudo-element is not mistaken for a heading badge', () => {
  const f = fixture([node('heading', [text('title')])]);
  const block = headingDOM(f);
  block.pseudo['::before'].content = '""';
  block.pseudo['::before'].width = '64px';
  assert.equal(plugin._noteHeadingMarkerBox({ win: f.win }, block), null);
});

check('image-based heading badges are detected without changing their content', () => {
  const f = fixture([node('heading', [text('title')])]);
  const block = headingDOM(f);
  block.pseudo['::before'].content = '""';
  block.pseudo['::before'].backgroundImage = 'url("heading-level.svg")';
  const marker = plugin._noteHeadingMarkerBox({ win: f.win }, block);
  assert.equal(marker.center, 16);
  assert.equal(marker.bottom, 52);
  assert.equal(block.pseudo['::before'].content, '""');
});

check('padded SVG heading badges align numbers with the icon, not the wide click target', () => {
  for (const boxSizing of ['border-box', 'content-box']) {
    const f = fixture([node('heading', [text('title')])]);
    const block = headingDOM(f);
    block.rect.left = 44;
    const svg = '<svg width="18px" height="18px" viewBox="0 0 24 15.56"></svg>';
    Object.assign(block.pseudo['::before'], {
      content: 'url("data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg) + '")',
      left: 'auto', marginLeft: '-64px', width: '64px', paddingLeft: '40px',
      paddingRight: '0px', borderLeftWidth: '0px', borderRightWidth: '0px',
      boxSizing, textAlign: 'left',
    });
    const marker = plugin._noteHeadingMarkerBox({ win: f.win }, block);
    assert.equal(marker.center, 29);
    f.nodes.set(0, block);
    plugin._syncNoteLineNumbers(f.state);
    const state = f.state._contextNoteLineNumbers;
    const model = plugin._noteLineNumberModel(f.editable);
    model.groups[0].lines[0].number = 20;
    state.model = model;
    f.view.coordsAtPos = () => ({ left: 44, top: 40, bottom: 60 });
    f.flush();
    const row = state.layer.children[0];
    const x = parseFloat(/left:([^;]+)/.exec(row.style.cssText)[1]);
    const width = parseFloat(/width:([^;]+)/.exec(row.style.cssText)[1]);
    assert.equal(x + width / 2, marker.center);
    assert.match(row.style.cssText, /height:10px/);
    assert.equal(state.padding, 32);
  }
});

check('right-aligned transparent heading labels and centered transforms use the label itself', () => {
  const f = fixture([node('heading', [text('title')])]);
  const block = headingDOM(f);
  Object.assign(block.pseudo['::before'], {
    width: '64px', marginLeft: '-64px', borderLeftWidth: '0px', borderRightWidth: '0px',
    textAlign: 'right', backgroundColor: 'rgba(0, 0, 0, 0)',
    top: '10px', transform: 'matrix(1, 0, 0, 1, 0, -5)',
  });
  const marker = plugin._noteHeadingMarkerBox({ win: f.win }, block);
  assert.equal(marker.center, 25);
  assert.equal(marker.bottom, 55);
});

check('four-digit heading numbers remain flat and never extend into the title text', () => {
  const f = fixture([node('heading', [text('title')])]);
  const block = headingDOM(f);
  f.nodes.set(0, block);
  plugin._syncNoteLineNumbers(f.state);
  const state = f.state._contextNoteLineNumbers;
  const model = plugin._noteLineNumberModel(f.editable);
  model.groups[0].lines[0].number = 1234;
  state.model = model;
  f.view.coordsAtPos = () => ({ left: 32, top: 40, bottom: 60 });
  f.flush();
  const row = state.layer.children[0];
  const x = parseFloat(/left:([^;]+)/.exec(row.style.cssText)[1]);
  const width = parseFloat(/width:([^;]+)/.exec(row.style.cssText)[1]);
  assert.equal(row.textContent, '1234');
  assert.ok(x + width <= 30);
  assert.match(row.style.cssText, /height:10px/);
});

check('hard-break heading numbers never overlap each other, and clearance adapts if needed', () => {
  const f = fixture([node('heading', [text('a'), node('hardBreak'), text('b')])]);
  const block = headingDOM(f);
  block.rect.bottom = 64;
  block.pseudo['::before'].top = '16px';
  block.pseudo['::before'].height = '14px';
  f.nodes.set(0, block);
  plugin._syncNoteLineNumbers(f.state);
  f.view.coordsAtPos = pos => ({ left: 32, top: pos === 1 ? 40 : 52,
    bottom: pos === 1 ? 52 : 64 });
  f.flush();
  const state = f.state._contextNoteLineNumbers;
  const rows = state.layer.children;
  assert.equal(rows.length, 2);
  const top = row => parseFloat(/top:([^;]+)/.exec(row.style.cssText)[1]);
  assert.ok(top(rows[1]) >= top(rows[0]) + 11);
  assert.ok(state.headingGaps.get(block) >= top(rows[1]) + 10 - block.rect.bottom);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.frames.size, 0);
});

check('disable removes spacing, DOM, observers, listeners and pending animation frame', () => {
  const f = fixture([paragraph('one')]);
  plugin._syncNoteLineNumbers(f.state);
  const state = f.state._contextNoteLineNumbers;
  plugin.isNoteLineNumbersEnabled = () => false;
  plugin._syncNoteLineNumbers(f.state);
  assert.equal(f.state._contextNoteLineNumbers, null);
  assert.equal(f.frames.size, 0);
  assert.equal(f.events.length, 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
  assert.equal(f.editable.classList.contains('zv-note-numbered-editor'), false);
  assert.equal(state.layer.removed, true);
  assert.equal(state.style.removed, true);
  plugin._queueNoteLineNumbers(state);
  assert.equal(f.frames.size, 0);
  plugin.isNoteLineNumbersEnabled = () => true;
});

check('native view replacement cleans old UI and attaches once to the new editor', () => {
  const f = fixture([paragraph('one')]);
  plugin._syncNoteLineNumbers(f.state);
  const old = f.state._contextNoteLineNumbers;
  const editable = element(f.doc);
  editable.parentElement = f.doc.body;
  f.view.dom = editable;
  plugin._syncNoteLineNumbers(f.state);
  assert.equal(old.disposed, true);
  assert.equal(f.state._contextNoteLineNumbers.editable, editable);
  const next = f.state._contextNoteLineNumbers;
  plugin._syncNoteLineNumbers(f.state);
  assert.equal(f.state._contextNoteLineNumbers, next);
});

check('switching notes or shutting down clears the gutter through the existing listener cleanup', () => {
  const f = fixture([paragraph('one')]);
  plugin._syncNoteLineNumbers(f.state);
  const state = f.state._contextNoteLineNumbers;
  plugin._clearMainContextNoteListener(f.state);
  assert.equal(state.disposed, true);
  assert.equal(f.state._contextNoteLineNumbers, null);
  assert.equal(f.state._contextNoteEditorDoc, null);
  assert.equal(f.events.length, 0);
});

check('unavailable or disconnected native editor is a no-op', () => {
  const f = fixture([paragraph('one')]);
  f.editable.isConnected = false;
  plugin._syncNoteLineNumbers(f.state);
  assert.equal(f.state._contextNoteLineNumbers, undefined);
  assert.equal(f.events.length, 0);
  assert.equal(f.frames.size, 0);
});

console.log('Note line-number checks passed (' + pass + ' cases).');

/* global require, __dirname, console, process */
// Reader text motions, objects, word search, repeat and progress are DOM-light.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({
  Zotero: { debug() {} },
  Components: { utils: { cloneInto: value => value }, interfaces: {} },
  Services: { prefs: { getPrefType: () => 0 } },
  setTimeout: () => 1,
  clearTimeout() {},
});
for (const name of ['zoteroVim.js', 'zoteroVimReader.js', 'zoteroVimFlash.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
}
const z = context.ZoteroVim;
const realUpdateIndicator = z._updateIndicator;

function text(data) {
  const parentElement = { closest: () => ({}), contains: node => node === parentElement };
  const node = { nodeType: 3, data, length: data.length, isConnected: true, parentElement };
  parentElement.firstChild = node;
  return node;
}

let pass = 0;
function check(label, fn) { fn(); pass++; console.log('  ok  ' + label); }

check('Cursor f/F/t/T stays on the current line and respects counts', () => {
  const node = text('abc xyc xzc');
  for (const [motion, char, count, focus, expected] of [
    ['f', 'c', 2, 0, 6], ['t', 'c', 2, 0, 5],
    ['F', 'x', 2, 9, 4], ['T', 'x', 1, 9, 9],
  ]) {
    const target = z._cursorFindTarget([node], node, focus, motion, char, count);
    assert.equal(target.node, node);
    assert.equal(target.offset, expected);
  }
  assert.equal(z._cursorFindTarget([node], node, 0, 'f', 'q', 1), null);
});

check('character finds map targets across adjacent PDF text spans', () => {
  const first = text('abc ');
  const second = text('xyz');
  const target = z._cursorFindTarget([first, second], first, 1, 'f', 'y', 1);
  assert.equal(target.node, second);
  assert.equal(target.offset, 1);
});

function rect(left, right, top = 0) {
  return { left, right, top, bottom: top + 10, width: right - left, height: 10 };
}

check('word motion distinguishes visual gaps from font runs inside a Unicode word', () => {
  const nodes = [text('ca'), text('fé'), text('next'), text('line')];
  const bounds = [rect(0, 9), rect(9, 19), rect(24, 39), rect(0, 12, 12)];
  nodes.forEach((node, i) => {
    node.parentElement.getBoundingClientRect = () => bounds[i];
  });
  const expect = (idx, off, direction, count, targetIdx, targetOff, big = false) => {
    const result = z._cursorComputeWordPosition(nodes, { idx, off }, direction, big, count);
    assert.equal(result.idx, targetIdx);
    assert.equal(result.off, targetOff);
  };
  expect(0, 0, 'forward', 1, 2, 0);
  expect(1, 2, 'forward', 1, 2, 0);
  expect(0, 0, 'forward', 2, 3, 0, true);
  expect(3, 0, 'backward', 2, 0, 0);

  const joined = text('café, next');
  assert.equal(z._cursorComputeWordPosition([joined], { idx: 0, off: 0 },
    'forward', false, 1).off, 4);
  assert.equal(z._cursorComputeWordPosition([joined], { idx: 0, off: 0 },
    'forward', true, 1).off, 6);
});

check('word motions skip PDF spaces and format marks and stop before trailing blanks', () => {
  const nodes = [text('co\u00ADoperate\u200B\u0085'), text('\u200F next\u00A0  '), text('\u200B ') ];
  const move = (idx, off, direction, big = false, extend = false) =>
    z._cursorComputeWordPosition(nodes, { idx, off }, direction, big, 1, extend);
  for (const big of [false, true]) {
    assert.equal(move(0, 0, 'forward', big).idx, 1);
    assert.equal(move(0, 0, 'forward', big).off, 2);
    assert.equal(move(1, 2, 'backward', big).off, 0);
    assert.equal(move(1, 2, 'forward', big).idx, 1);
    assert.equal(move(1, 2, 'forward', big).off, 2);
    assert.equal(move(1, 2, 'forward', big, true).off, 6);
  }
  const joined = [text('co\u00AD'), text('\u200Doperate word')];
  const next = z._cursorComputeWordPosition(joined, { idx: 0, off: 0 }, 'forward', false, 1);
  assert.equal(next.idx, 1);
  assert.equal(next.off, 9);
});

check('Flash maps ligatures, partial phrases, combining marks and punctuation to DOM offsets', () => {
  const nodes = [text('ﬂow'), text('matching, banana e'), text('\u0301lan')];
  const index = z._buildFlashIndex(nodes.map((node, i) => ({ node,
    rect: [rect(0, 12), rect(18, 100), rect(100, 121)][i], pageIdx: 0, colIdx: 0 })));
  const verify = (query, startNode, startOffset, endNode, endOffset) => {
    const matches = Array.from(z._flashMatches(index, query));
    assert.equal(matches.length, 1, query);
    assert.equal(matches[0].start.node, startNode);
    assert.equal(matches[0].start.offset, startOffset);
    assert.equal(matches[0].end.node, endNode);
    assert.equal(matches[0].end.offset, endOffset);
  };
  verify('f', nodes[0], 0, nodes[0], 3);
  verify('ow mat', nodes[0], 0, nodes[1], 8);
  verify(',', nodes[1], 8, nodes[1], 9);
  verify('ana', nodes[1], 10, nodes[1], 16);
  verify('é', nodes[1], 17, nodes[2], 4);
  assert.equal(Array.from(z._flashMatches(index, 'Matching')).length, 0);
});

check('Flash labels reserve every raw continuation and stay prefix-free', () => {
  const index = z._buildFlashIndex([{ node: text('banana boats') }]);
  const continuations = new Set();
  assert.equal(Array.from(z._flashMatches(index, 'a', continuations)).length, 2);
  assert.deepEqual([...continuations].sort(), ['N', 'T']);
  continuations.clear();
  Array.from(z._flashMatches(index, 'banana ', continuations));
  assert.deepEqual([...continuations], ['B']);
  const excluded = new Set([...z._hintAlphabet()].slice(1));
  const labels = z._flashLabels(48, excluded);
  assert.equal(new Set(labels).size, 48);
  assert(labels.every(label => label.startsWith('A') && label.length === 3));
});

check('reader word lookup supports Unicode letters, marks, digits and underscore', () => {
  const node = text('one 中文_test42 three');
  const range = z._readerWordRange([node], node, 7);
  assert.equal(range.text, '中文_test42');
  assert.equal(range.start, 4);
  assert.equal(range.end, 13);
});

check('Visual inner objects select words, quotes and nested bracket pairs', () => {
  const quoted = text('before "alpha beta" after');
  let range = z._readerTextObjectRange([quoted], quoted, 10, '"');
  assert.equal(range.snapshot.text.slice(range.start, range.end), 'alpha beta');

  const nested = text('x (one (two) three) y');
  range = z._readerTextObjectRange([nested], nested, 9, '(');
  assert.equal(range.snapshot.text.slice(range.start, range.end), 'two');

  const word = z._readerTextObjectRange([quoted], quoted, 9, 'word');
  assert.equal(word.snapshot.text.slice(word.start, word.end), 'alpha');
});

check('Cursor find consumes one literal argument and carries the count', () => {
  z._nativeEditableFocused = () => false;
  z._smoothHoldSpecForEvent = () => null;
  z._updateIndicator = () => {};
  let found = null;
  z._cursorFindChar = (_state, _win, motion, char, count) => {
    found = { motion, char, count };
  };
  const state = { mode: 'cursor', keyBuffer: '', countBuffer: '', cursorFindPending: null };
  const pdfWin = {};
  const reader = {};
  state.executeAction = (action, count) => z._executeAction(action, reader, state, pdfWin, count);
  const key = (value) => {
    const event = { key: value, preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; } };
    z._onKeyDown(event, reader, state, pdfWin);
    return event;
  };
  key('2'); key('f');
  assert.equal(state.cursorFindPending.motion, 'f');
  assert.equal(state.cursorFindPending.count, 2);
  key('f');
  assert.equal(state.cursorFindPending.motion, 'f');
  assert.equal(key('x').prevented, true);
  assert.deepEqual(found, { motion: 'f', char: 'x', count: 2 });
  key('F');
  assert.equal(z._readerConsumesKey(state, 'r'), true);
  key('Escape');
  assert.equal(state.cursorFindPending, null);
});

check('Cursor find takes priority while start-position hints are still open', () => {
  z._nativeEditableFocused = () => false;
  z._smoothHoldSpecForEvent = () => null;
  z._updateIndicator = () => {};
  z._clearVisualHints = state => { state.hintMode = false; };
  z._placeCursorNearViewportCenter = () => true;
  const state = { mode: 'cursor', keyBuffer: '', countBuffer: '', hintMode: true,
    hintTargetMode: 'cursor', hintStage: 'coarse', cursorFindPending: null };
  state.executeAction = (action, count) => z._executeAction(action, {}, state, {}, count);
  z._onKeyDown({ key: 't', preventDefault() {}, stopImmediatePropagation() {} }, {}, state, {});
  assert.equal(state.hintMode, false);
  assert.equal(state.cursorFindPending.motion, 't');
  assert.equal(z._hintLabelList(40, null, 'FT').some(label => /[FT]/.test(label)), false);
});

check('character find falls back to the caret text node outside the visible-line index', () => {
  const originalVisibleLines = z._cursorVisibleLines;
  z._cursorVisibleLines = () => ({ lines: [] });
  const node = text('fallback target');
  assert.deepEqual(Array.from(z._cursorLineTextNodes({}, node)), [node]);
  z._cursorVisibleLines = originalVisibleLines;
});

check('vgiw leaves hint picking and resolves as a Visual text object', () => {
  z._nativeEditableFocused = () => false;
  z._smoothHoldSpecForEvent = () => null;
  z._clearVisualHints = state => { state.hintMode = false; };
  z._placeCursorNearViewportCenter = () => true;
  z._updateIndicator = () => {};
  const actions = [];
  const state = { mode: 'visual', keyBuffer: '', countBuffer: '', hintMode: true,
    hintTargetMode: 'visual', hintStage: 'coarse' };
  state.executeAction = action => actions.push(action);
  const key = (value) => z._onKeyDown({ key: value, preventDefault() {},
    stopImmediatePropagation() {} }, {}, state, {});
  key('g');
  assert.equal(state.hintMode, false);
  assert.equal(state.keyBuffer, 'g');
  key('i');
  assert.equal(state.keyBuffer, 'gi');
  key('w');
  assert.deepEqual(actions, ['visualInnerWord']);
  assert.equal(z._hintLabelList(40, null, 'G').some(label => label.includes('G')), false);
});

check('i dispatches addNote immediately in Visual mode', () => {
  const actions = [];
  const state = {
    mode: 'visual',
    keyBuffer: '',
    countBuffer: '',
    executeAction: action => actions.push(action),
  };
  const event = { key: 'i', preventDefault() {}, stopImmediatePropagation() {} };
  z._onKeyDown(event, {}, state, {});
  assert.deepEqual(actions, ['addNote']);
  assert.equal(state.keyBuffer, '');
  assert.equal(state.keyTimeout, null);
});

check('dot repeats only the last annotation-changing reader action', () => {
  z._handleReaderSidebarAction = () => false;
  const calls = [];
  const annotateSelection = z._annotateSelection;
  z._annotateSelection = (_state, _reader, _win, type, color) => calls.push([type, color]);
  const state = { mode: 'visual', lastReaderChange: null,
    selectionParams: { annotation: {} } };
  const reader = {};
  const pdfWin = { document: {} };
  try {
    z._executeAction('highlightRed', reader, state, pdfWin);
    z._executeAction('underlineRed', reader, state, pdfWin, 3);
    z._executeAction('repeatLastChange', reader, state, pdfWin);
    assert.deepEqual(calls, [
      ['highlight', z.COLORS.red], ['underline', z.COLORS.red], ['underline', z.COLORS.red],
    ]);
    assert.equal(state.lastReaderChange.action, 'underlineRed');
    assert.equal(state.lastReaderChange.count, 3);

    state.selectionParams = null;
    pdfWin.getSelection = () => ({ isCollapsed: true, toString: () => '' });
    z._lastSelectionParams = null;
    z._executeAction('underlineBlue', reader, state, pdfWin);
    assert.equal(state.lastReaderChange.action, 'underlineRed');
  } finally {
    z._annotateSelection = annotateSelection;
  }
});

check('word search normalizes text and starts backward search after filling the popup', () => {
  const originalSetTimeout = context.setTimeout;
  context.setTimeout = fn => { fn(); return 1; };
  let popupOptions = null;
  let previousCalls = 0;
  const input = {
    value: '',
    dispatchEvent(event) { this.event = event; },
  };
  const readerWin = {
    document: { querySelector: () => input },
    Event: function Event(type, options) { this.type = type; this.bubbles = options.bubbles; },
  };
  const reader = {
    _iframeWindow: readerWin,
    _internalReader: {
      toggleFindPopup(options) { popupOptions = options; },
      findPrevious() { previousCalls++; },
    },
  };
  assert.equal(z._searchReaderText({}, reader, {}, '  alpha\n  beta  ', true), true);
  assert.equal(popupOptions.open, true);
  assert.equal(input.value, 'alpha beta');
  assert.equal(input.event.type, 'input');
  assert.equal(input.event.bubbles, true);
  assert.equal(previousCalls, 1);
  context.setTimeout = originalSetTimeout;
});

check('page progress is compact and supports off, transient and always modes', () => {
  z._updateIndicator = realUpdateIndicator;
  const indicatorEl = { style: {}, textContent: '' };
  const state = { mode: 'normal', keyBuffer: '', countBuffer: '', indicatorEl,
    _progressVisible: false, activePdfWin: { PDFViewerApplication: {
      pdfViewer: { currentPageNumber: 12 }, pdfDocument: { numPages: 34 },
    } } };
  assert.equal(z._readerProgressText(state), '12/34 · 35%');
  z.getReaderProgressMode = () => 'off';
  z._updateIndicator(state);
  assert.equal(indicatorEl.style.display, 'none');
  z.getReaderProgressMode = () => 'transient';
  state.mode = 'cursor';
  z._updateIndicator(state);
  assert.equal(indicatorEl.textContent.includes('12/34'), false);
  state._progressVisible = true;
  state.mode = 'normal';
  z._updateIndicator(state);
  assert.equal(indicatorEl.textContent, '12/34 · 35%');
  assert.equal(indicatorEl.style.fontWeight, 'normal');
  z.getReaderProgressMode = () => 'always';
  state._progressVisible = false;
  z._updateIndicator(state);
  assert.equal(indicatorEl.style.display, 'block');
});

function pdfTextFixture() {
  let reads = 0;
  const pages = [], layers = [], all = [];
  const getPart = (node, start, end) => {
    const r = node.parentElement.getBoundingClientRect();
    const left = r.left + start * r.width / node.length;
    const right = r.left + end * r.width / node.length;
    return { ...r, left, right, width: right - left };
  };
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(layer) { layer.redraw = this.callback; }
    disconnect() {}
    takeRecords() { return []; }
  }
  const doc = {
    body: { appendChild() {} },
    createElement: () => ({ style: {}, setAttribute() {} }),
    querySelectorAll(selector) {
      if (selector === '.textLayer') return layers;
      if (selector === '.textLayer span') return layers.flatMap(layer => layer.spans);
      return [];
    },
    createRange() {
      return {
        commonAncestorContainer: doc,
        setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
        setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
        collapse() { this.setEnd(this.startContainer, this.startOffset); },
        intersectsNode(node) {
          return node.domIndex >= this.startContainer.domIndex
            && node.domIndex <= this.endContainer.domIndex;
        },
        getClientRects() {
          return all.filter(node => this.intersectsNode(node)).map(node => getPart(node,
            node === this.startContainer ? this.startOffset : 0,
            node === this.endContainer ? this.endOffset : node.length));
        },
        toString() {
          return all.filter(node => this.intersectsNode(node)).map(node => node.data.slice(
            node === this.startContainer ? this.startOffset : 0,
            node === this.endContainer ? this.endOffset : node.length)).join(' ');
        },
      };
    },
    createTreeWalker() {
      let i = 0;
      return { nextNode: () => all[i++] };
    },
  };
  const selection = {
    ranges: [],
    get rangeCount() { return this.ranges.length; },
    get isCollapsed() {
      return !this.rangeCount || this.anchorNode === this.focusNode
        && this.anchorOffset === this.focusOffset;
    },
    getRangeAt(i) { return this.ranges[i]; },
    removeAllRanges() {
      this.ranges = []; this.anchorNode = this.focusNode = null;
    },
    addRange(range) {
      // Gecko's DOM focus need not match the plugin's active end of a multi-range selection.
      this.ranges.push(range);
      this.ranges.sort((a, b) => a.startContainer.domIndex - b.startContainer.domIndex);
      this.anchorNode = this.ranges[0].startContainer;
      this.anchorOffset = this.ranges[0].startOffset;
      this.focusNode = this.ranges.at(-1).endContainer;
      this.focusOffset = this.ranges.at(-1).endOffset;
    },
    setBaseAndExtent(anchor, from, focus, to) {
      const range = doc.createRange();
      const reverse = anchor.domIndex > focus.domIndex || anchor === focus && from > to;
      range.setStart(reverse ? focus : anchor, reverse ? to : from);
      range.setEnd(reverse ? anchor : focus, reverse ? from : to);
      this.ranges = [range];
      this.anchorNode = anchor; this.anchorOffset = from;
      this.focusNode = focus; this.focusOffset = to;
    },
    toString() { return this.ranges.map(range => range.toString()).join(' '); },
  };
  const pdfWin = { document: doc, focus() {}, getSelection: () => selection, MutationObserver: Observer,
    PDFViewerApplication: { pdfViewer: {
      getPageView: () => ({ viewport: {
        scale: 1, height: 760, convertToPdfPoint: (x, y) => [x, 760 - y],
      } }),
    } },
  };
  doc.defaultView = pdfWin;
  function addPage(x, y, entries) {
    const page = { dataset: { pageNumber: String(layers.length + 1) },
      querySelector: () => null, x, y,
      getBoundingClientRect() { return { ...rect(this.x, this.x + 620, this.y), height: 760 }; },
    };
    const layer = { nodeType: 1, ownerDocument: doc, closest: () => page,
      getBoundingClientRect: () => page.getBoundingClientRect(), spans: [],
      querySelectorAll() { return this.spans; } };
    for (const [name, left, right, top, height = 10] of entries) {
      const node = text(name);
      const span = node.parentElement;
      node.ownerDocument = doc;
      node.domIndex = all.length;
      node.compareDocumentPosition = other => node.domIndex < other.domIndex ? 4 : 2;
      span.closest = selector => selector.startsWith('.page') ? page : layer;
      span.getBoundingClientRect = () => {
        reads++;
        const bounds = rect(left + page.x, right + page.x, top + page.y);
        return { ...bounds, height, bottom: bounds.top + height };
      };
      span.textContent = name;
      all.push(node);
      layer.spans.push(span);
    }
    layers.push(layer);
    pages.push(page);
    return layer.spans.map(span => span.firstChild);
  }
  const double = [
    ['Wide heading', 40, 580, 30],
    ['Left one', 40, 295, 60], ['Right one', 325, 580, 60],
    ['Left two', 40, 295, 74], ['Right two', 325, 580, 74],
    ['Left three', 40, 295, 88], ['Right three', 325, 580, 88],
    ['Wide figure caption', 40, 580, 108],
    ['Left four', 40, 295, 124], ['Right four', 325, 580, 124],
    ['Left five', 40, 295, 138], ['Right five', 325, 580, 138],
    ['Left six', 40, 295, 152], ['Right six', 325, 580, 152],
  ];
  return { z, doc, pdfWin, selection, pages, layers, all, double, addPage, reads: () => reads,
    start(view, anchor, focus = anchor) {
      selection.setBaseAndExtent(view, anchor, view, focus);
      return { mode: 'visual', pdfWin, activePdfWin: pdfWin };
    } };
}

check('PDF reading order stays page-local and separates full-width blocks from column flow', () => {
  const f = pdfTextFixture();
  f.addPage(0, 0, f.double);
  const expected = [
    'Wide heading', 'Left one', 'Left two', 'Left three', 'Right one', 'Right two', 'Right three',
    'Wide figure caption', 'Left four', 'Left five', 'Left six', 'Right four', 'Right five', 'Right six',
  ];
  assert.equal(z._cursorOrderedTextNodes(f.doc).map(node => node.data).join('|'), expected.join('|'));
  const reads = f.reads();
  f.pages[0].y -= 400;
  f.pages[0].x -= 42;
  assert.equal(z._readingOrderKeys(f.doc).items[1].rect.top, -340);
  assert.equal(f.reads(), reads, 'scrolling should reuse span geometry');
  const mixed = Array.from({ length: 34 }, (_, i) => i % 2
    ? ['Adjacent page', 34, 389, 96 + i * 15] : ['Adjacent page', 220, 579, 96 + i * 15]);
  f.addPage(0, 368, mixed);
  assert.equal(z._cursorOrderedTextNodes(f.doc).slice(0, 14).map(node => node.data).join('|'),
    expected.join('|'));
  const before = f.reads();
  f.layers[0].redraw();
  z._readingOrderKeys(f.doc);
  assert.equal(f.reads() - before, 14, 'invalidate only the changed text layer');
});

check('A narrow occupied gutter and staggered baselines keep the same order at each zoom', () => {
  for (const zoom of [0.82, 1.25, 2.14]) {
    // Approximate Gecko's fractional layout coordinates for a narrow IEEE-style page.
    const scaled = value => Math.round(value * zoom * 16) / 16;
    const item = (data, x1, x2, y, h = 9) => {
      const left = scaled(x1), right = scaled(x2), top = scaled(y), bottom = scaled(y + h);
      return { node: { data }, rect: { left, right, top, bottom,
        width: right - left, height: bottom - top } };
    };
    const left = [], right = [], interleaved = [];
    for (let i = 0; i < 16; i++) {
      left.push(item('Left ' + i, 54 + (i === 0 ? 10 : 0), i % 4 === 0 ? 296 : 298, 174 + i * 10));
      right.push(item('Right ' + i, 312.7 + (i % 6 === 0 ? 9 : 0), 558.7, 172 + i * 11.4, 10));
      interleaved.push(left.at(-1), right.at(-1));
    }
    const frontMatter = [item('Full width title', 54, 556, 72, 16),
      item('Centered subtitle', 229, 383, 92, 16)];
    const margin = item('Vertical margin', 20.25, 30.25, 295, 125);
    const items = [...frontMatter, ...interleaved, margin].map((part, domIndex) => ({ ...part, domIndex }));
    const lines = z._readerPageTextLines(items, 612 * zoom);
    const ordered = lines.flatMap(line => line.spans.map(span => span.node.data));
    const expected = [...frontMatter, ...left, ...right, margin].map(part => part.node.data);
    assert.equal(ordered.join('|'), expected.join('|'), 'reading order at zoom ' + zoom);
  }
});

check('Ordinary selection keeps publisher source order across a figure break and a page break', () => {
  const f = pdfTextFixture();
  const [first, , , , , leftEnd, rightStart, , , pageEnd] = f.addPage(0, 0, [
    ['Preface', 40, 580, 25],
    ['Publisher inserted footer', 40, 232, 732, 8],
    ['Movie 1. Caption', 40, 282, 462, 8],
    ['Left first', 40, 295, 60], ['Left next', 40, 295, 74],
    ['Sentence before figure', 40, 295, 88],
    ['Right continuation', 325, 580, 60],
    ['Right next', 325, 580, 74], ['Right third', 325, 580, 88],
    ['Final right line', 325, 580, 670],
  ]);
  const [nextPage] = f.addPage(0, 760, [['Next page continues', 40, 295, 68],
    ['Other first', 325, 580, 68], ['Other second', 325, 580, 82]]);
  const order = z._cursorOrderedTextNodes(f.doc);
  assert.equal(order[0], first);
  assert.equal(order[order.indexOf(leftEnd) + 1], rightStart);
  assert.equal(order[order.indexOf(pageEnd) + 1], nextPage);

  let state = f.start(leftEnd, 0, leftEnd.length);
  z._extendByWord(state, f.pdfWin, 'forward');
  assert.equal(state._orderedVisual.focus.node, rightStart);
  assert.equal(z._readerSelectedText(state, f.pdfWin), 'Sentence before figure\nRight');
  assert(!f.selection.toString().includes('Caption'));
  z._extendByWord(state, f.pdfWin, 'backward');
  assert.equal(state._orderedVisual.focus.node, leftEnd);

  state = f.start(pageEnd, 0, pageEnd.length);
  z._extendByWord(state, f.pdfWin, 'forward');
  assert.equal(state._orderedVisual.focus.node, nextPage);
  assert.equal(z._readerSelectedText(state, f.pdfWin), 'Final right line\nNext');
});

check('Only the local interleaved runs are repaired inside a page with native column order', () => {
  const f = pdfTextFixture();
  const [initial] = f.addPage(0, 0, [
    ['Publisher preface', 325, 580, 30],
    ['Left 1', 40, 295, 120], ['Right 1', 325, 580, 120],
    ['Left 2', 40, 295, 135], ['Right 2', 325, 580, 135],
    ['Left 3', 40, 295, 150], ['Right 3', 325, 580, 150],
    ['Publisher footer', 40, 220, 720, 8],
  ]);
  const order = z._cursorOrderedTextNodes(f.doc);
  assert.equal(order[0], initial);
  assert.equal(order.map(node => node.data).join('|'),
    'Publisher preface|Left 1|Left 2|Left 3|Right 1|Right 2|Right 3|Publisher footer');
});

check('Body text selection skips publisher furniture in movements and in actual DOM ranges', () => {
  const f = pdfTextFixture();
  const page1 = f.addPage(0, 0, [
    ['Journal Header', 40, 250, 31, 8],
    ['Opening body text', 40, 295, 160], ['Left second body line', 40, 295, 174],
    ['Left third body line', 40, 295, 188],
    ['Rotated ordinary label', 28, 34, 300, 60],
    ['Author affiliations', 40, 295, 637, 7],
    ['Corresponding author', 40, 295, 648, 7],
    ['Right first body line', 325, 580, 160], ['Right second body line', 325, 580, 174],
    ['Right third body line', 325, 580, 188],
    ['Sentence tail', 325, 580, 690],
    ['Writer et al. Sci. Tech. 10, ejournal1212 (2025)', 40, 260, 730, 8],
    ['1 of 15', 541, 580, 730, 8],
    ['Downloaded from the journal', 605, 612, 270, 280],
  ]);
  const page2 = f.addPage(0, 760, [
    ['Journal Header', 40, 250, 31, 8],
    ['Sentence continues', 40, 295, 60],
    ['Left second body line', 40, 295, 140], ['Left third body line', 40, 295, 154],
    ['Experiment design', 40, 164, 380, 13],
    ['Text before figure', 40, 295, 411],
    ['Movie 1. Caption', 40, 295, 590, 8],
    ['Continuation of caption', 40, 295, 603, 8],
    ['Small text with unknown purpose', 40, 295, 656, 8],
    ['Right continuation', 325, 580, 60],
    ['Right second body line', 325, 580, 140], ['Right third body line', 325, 580, 154],
    ['2 of 15', 541, 580, 730, 8],
  ]);
  const anchor = page1[10];
  const state = f.start(anchor, 0, anchor.length);
  z._extendByWord(state, f.pdfWin, 'forward');
  assert.equal(state._orderedVisual.focus.node, page1[11], 'ordinary selection exposes source text');

  z._toggleReaderBodyText(state, f.pdfWin);
  f.selection.setBaseAndExtent(anchor, 0, anchor, anchor.length);
  const keys = z._readingOrderKeys(f.doc, state);
  for (const node of [...page1.slice(11), page1[5], page1[6], page2[0], page2[6], page2[7], page2[12]]) {
    assert(!keys.byNode.has(node), node.data);
  }
  for (const node of [page1[4], page2[4], page2[8]]) assert(keys.byNode.has(node), node.data);
  z._extendByWord(state, f.pdfWin, 'forward');
  assert.equal(state._orderedVisual.focus.node, page2[1]);
  assert.equal(z._readerSelectedText(state, f.pdfWin), 'Sentence tail\nSentence');
  assert.equal(f.selection.toString(), 'Sentence tail Sentence');
  z._extendByWord(state, f.pdfWin, 'backward');
  assert.equal(state._orderedVisual.focus.node, anchor);

  const from = { node: page2[5], offset: 0 };
  const to = { node: page2[9], offset: page2[9].length };
  assert(z._applyReaderVisualSelection(state, f.pdfWin, from, to));
  assert.equal(z._readerSelectedText(state, f.pdfWin),
    'Text before figure\nSmall text with unknown purpose\nRight continuation');
  assert(!f.selection.toString().includes('Caption'));
  const flash = z._buildFlashIndex(keys.items);
  assert.equal([...z._flashMatches(flash, 'Movie')].length, 0);
  const firstLayer = f.layers.shift();
  const afterScroll = z._readingOrderKeys(f.doc, state);
  assert(!afterScroll.byNode.has(page2[0]), 'known running header stays excluded off the first page');
  f.layers.unshift(firstLayer);

  z._toggleReaderBodyText(state, f.pdfWin);
  assert(z._readingOrderKeys(f.doc, state).byNode.has(page2[6]));
  assert(z._readingOrderKeys(f.doc, state).byNode.has(page1[11]));
});

check('Visual words, lines and character motions project onto the same left-column ranges', () => {
  const f = pdfTextFixture();
  const [, left, right, next] = f.addPage(0, 0, f.double);
  const state = f.start(left, 0, 4);
  z._extendByWord(state, f.pdfWin, 'forward', 2);
  assert.equal(z._readerSelectedText(state, f.pdfWin), 'Left one\nLeft');
  assert.equal(state._orderedVisual.focus.node, next);
  assert.equal(state._orderedVisual.focus.offset, 4);
  assert.equal(f.selection.rangeCount, 2);
  assert(!f.selection.toString().includes(right.data));
  z._extendByChar(state, f.pdfWin, 1);
  assert.equal(state._orderedVisual.focus.offset, 5);
  z._extendByLine(state, f.pdfWin, 1);
  assert.equal(state._orderedVisual.focus.node.data, 'Left three');
  assert([4, 10].includes(state._orderedVisual.focus.offset));
  z._swapVisualEnds(state, f.pdfWin);
  assert.equal(state._orderedVisual.focus.node, left);
  assert(!z._readerSelectedText(state, f.pdfWin).includes('Right'));
  z._extendByWord(state, f.pdfWin, 'backward');
  assert.equal(state._orderedVisual.focus.node.data, 'Wide heading');
  assert(!z._readerSelectedText(state, f.pdfWin).includes('Right'));
  // Exact token anchoring also works when reversing across the initial word.
  const start = { node: left, offset: 5 }, end = { node: left, offset: 8 };
  z._applyReaderVisualSelection(state, f.pdfWin, start, end, { wordAnchor: { start, end } });
  z._extendByWord(state, f.pdfWin, 'backward');
  assert.equal(z._readerSelectedText(state, f.pdfWin), 'Left one');
  assert.equal(state._orderedVisual.anchor.offset, 8);
  z._extendByWord(state, f.pdfWin, 'forward');
  assert.equal(z._readerSelectedText(state, f.pdfWin), 'one');
  z._extendByWord(state, f.pdfWin, 'forward');
  assert.equal(z._readerSelectedText(state, f.pdfWin), 'one\nLeft');
});

check('Flash previews and restores both ranges of an interleaved Visual selection', () => {
  const f = pdfTextFixture();
  const [, left, , next] = f.addPage(0, 0, f.double);
  const state = f.start(left, 0, 4);
  z._applyReaderVisualSelection(state, f.pdfWin, { node: left, offset: 0 },
    { node: next, offset: 4 });
  const ordered = state._orderedVisual;
  f.doc.documentElement = { removeAttribute() {}, setAttribute() {} };
  const registry = new Map();
  f.pdfWin.CSS = { highlights: registry };
  f.pdfWin.Highlight = class extends Set {
    constructor(range) { super([range]); }
  };
  const ui = {
    doc: f.doc, pdfWin: f.pdfWin, ordered, preview: {},
    selection: { anchor: left, anchorOffset: 0, focus: next, focusOffset: 4 },
  };
  f.selection.removeAllRanges();
  z._paintReaderFlashSelection(ui);
  const preview = registry.get('zv-flash-selection');
  assert.equal(preview.size, 2);
  assert(!Array.from(preview, range => range.toString()).join(' ').includes('Right'));
  z._paintOrderedReaderVisual(f.pdfWin, ordered);
  assert.equal(f.selection.rangeCount, 2);
  assert.equal(f.selection.toString(), 'Left one Left');
});

check('Cursor counts advance through the current column and only wrap at its last word', () => {
  const f = pdfTextFixture();
  const [, left, right] = f.addPage(0, 0, f.double);
  const state = f.start(left, 0);
  state.mode = 'cursor';
  z._cursorMoveWord(state, f.pdfWin, 'forward', false, 5);
  assert.equal(f.selection.focusNode.data, 'Left three');
  assert.equal(f.selection.focusOffset, 5);
  z._cursorMoveWord(state, f.pdfWin, 'forward', false, 1);
  assert.equal(f.selection.focusNode, right);
  assert.equal(f.selection.focusOffset, 0);
  z._cursorMoveWord(state, f.pdfWin, 'backward', false, 1);
  assert.equal(f.selection.focusNode.data, 'Left three');
  assert.equal(f.selection.focusOffset, 5);
});

async function checkPdfAnnotationSelection() {
  const f = pdfTextFixture();
  const firstPage = f.addPage(0, 0, [...f.double, ['1 of 15', 540, 580, 730, 8]]);
  const [, left, , next] = firstPage;
  const [second] = f.addPage(640, 0, [['Next page', 40, 580, 60]]);
  const [third] = f.addPage(0, 760, [['Third page', 40, 580, 60]]);
  let copied = '';
  const saved = [];
  const state = f.start(left, 0, 4);
  const oldClasses = context.Components.classes;
  const oldItems = context.Zotero.Items;
  const oldItem = context.Zotero.Item;
  context.Components.classes = {
    '@mozilla.org/widget/clipboardhelper;1': { getService: () => ({
      copyString: value => { copied = value; },
    }) },
  };
  context.Zotero.Items = { get: () => ({ id: 11, libraryID: 2 }) };
  context.Zotero.Item = function () {
    this.saveTx = async () => { saved.push(this); };
  };
  try {
    const a = { node: left, offset: 0 }, b = { node: next, offset: next.length };
    assert(z._applyReaderVisualSelection(state, f.pdfWin, a, b));
    assert.equal(z._readerSelectedText(state, f.pdfWin), 'Left one\nLeft two');
    const copy = {
      clipboardData: { setData: (flavor, value) => {
        assert.equal(flavor, 'text/plain');
        copied = value;
      } },
      preventDefault() { this.prevented = true; },
    };
    z._copyOrderedReaderSelection(copy, state, f.pdfWin);
    assert(copy.prevented);
    assert.equal(copied, 'Left one Left two');
    copied = '';
    z._copySelection(state, f.pdfWin);
    assert.equal(copied, 'Left one Left two');
    assert.equal(state.mode, 'normal');
    state.mode = 'visual';
    z._applyReaderVisualSelection(state, f.pdfWin, a, b);
    await z._executeAction('highlightYellow', { itemID: 11 }, state, f.pdfWin);
    assert.equal(saved[0].annotationType, 'highlight');
    assert.equal(saved[0].annotationColor, z.COLORS.yellow);
    assert.equal(saved[0].annotationText, copied);
    assert.deepEqual(JSON.parse(saved[0].annotationPosition), {
      pageIndex: 0, rects: [[40, 690, 295, 700], [40, 676, 295, 686]],
    });

    z._applyReaderVisualSelection(state, f.pdfWin, { node: second, offset: 0 },
      { node: second, offset: second.length });
    await z._executeAction('underlineYellow', { itemID: 11 }, state, f.pdfWin);
    assert.equal(saved[1].annotationType, 'underline');
    assert.equal(saved[1].annotationColor, z.COLORS.yellow);
    assert.deepEqual(JSON.parse(saved[1].annotationPosition), {
      pageIndex: 1, rects: [[40, 690, 580, 700]],
    });

    state._readerBodyText = true;
    const lastBody = firstPage.at(-2);
    z._applyReaderVisualSelection(state, f.pdfWin, { node: lastBody, offset: 0 },
      { node: second, offset: second.length });
    await z._executeAction('underlinePurple', { itemID: 11 }, state, f.pdfWin);
    assert.equal(saved[2].annotationType, 'underline');
    assert.equal(saved[2].annotationColor, z.COLORS.purple);
    assert.equal(saved[2].annotationText, 'Right six Next page');
    assert.deepEqual(JSON.parse(saved[2].annotationPosition), {
      pageIndex: 0, rects: [[325, 598, 580, 608]], nextPageRects: [[40, 690, 580, 700]],
    });

    z._applyReaderVisualSelection(state, f.pdfWin, a, { node: third, offset: third.length });
    await z._executeAction('underlineBlue', { itemID: 11 }, state, f.pdfWin);
    assert.equal(saved.length, 3, 'refuse a three-page range without discarding its text');
    assert(z._readerSelectedText(state, f.pdfWin).includes('Third page'));

    z._clearOrderedReaderVisual(state, f.pdfWin);
    const position = { pageIndex: 0, rects: [[40, 690, 295, 700]] };
    state.selectionParams = { annotation: { type: 'highlight', text: 'Left one', position } };
    await z._executeAction('underlineGreen', { itemID: 11 }, state, f.pdfWin);
    assert.equal(saved[3].annotationType, 'underline');
    assert.equal(saved[3].annotationColor, z.COLORS.green);
    assert.equal(saved[3].annotationText, 'Left one');
    assert.deepEqual(JSON.parse(saved[3].annotationPosition), position);
  } finally {
    context.Components.classes = oldClasses;
    context.Zotero.Items = oldItems;
    context.Zotero.Item = oldItem;
  }
}

async function checkAnnotationStyleSelection() {
  const watermark = { key: 'OLD', annotationType: 'highlight' };
  const mark = { key: 'MARK', annotationType: 'highlight', annotationColor: z.COLORS.yellow,
    annotationComment: 'Keep me', annotationPosition: '{"pageIndex":0}' };
  const box = { key: 'BOX', annotationType: 'text', annotationColor: z.COLORS.red,
    annotationComment: 'Line one\nLine two' };
  const note = { key: 'NOTE', annotationType: 'note', annotationComment: 'A note\n  Indented' };
  const saved = [];
  for (const item of [watermark, mark, box]) {
    item.save = async () => saved.push([item.key, item.annotationType, item.annotationColor]);
  }
  const native = { selectedAnnotationIDs: ['MARK'] };
  const reader = { itemID: 11, _internalReader: { _state: native },
    _iframeWindow: {}, setAnnotations: async () => {} };
  const state = { mode: 'normal', lastAnnotationKey: 'OLD' };
  const { Items, DB } = context.Zotero;
  const { classes, interfaces } = context.Components;
  const copied = [];
  context.Components.classes = { '@mozilla.org/widget/clipboardhelper;1': {
    getService: () => ({ copyString: text => copied.push(text) }),
  } };
  context.Components.interfaces = {};
  context.Zotero.Items = { get: () => ({ getAnnotations: () => [watermark, mark, box, note] }) };
  context.Zotero.DB = { executeTransaction: async fn => fn() };
  try {
    await z._executeAction('highlightYellow', reader, state, {});
    assert.deepEqual(saved.at(-1), ['MARK', 'highlight', z.COLORS.yellow]);
    await z._executeAction('underlineYellow', reader, state, {});
    assert.deepEqual(saved.at(-1), ['MARK', 'underline', z.COLORS.yellow]);
    await z._executeAction('highlightYellow', reader, state, {});
    assert.deepEqual(saved.at(-1), ['MARK', 'highlight', z.COLORS.yellow]);
    await z._executeAction('underlineMagenta', reader, state, {});
    assert.deepEqual(saved.at(-1), ['MARK', 'underline', z.COLORS.magenta]);
    assert.equal(mark.annotationComment, 'Keep me');
    assert.equal(state.lastReaderChange.action, 'underlineMagenta');
    await z._executeAction('highlightGray', reader, state, {});
    assert.deepEqual(saved.at(-1), ['MARK', 'highlight', z.COLORS.gray]);

    native.selectedAnnotationIDs = ['BOX'];
    await z._executeAction('highlightOrange', reader, state, {});
    await z._executeAction('underlineOrange', reader, state, {});
    assert.deepEqual(saved.at(-1), ['BOX', 'text', z.COLORS.orange]);
    assert.equal(saved.length, 6);
    await z._executeAction('recolorBlack', reader, state, {});
    assert.deepEqual(saved.at(-1), ['BOX', 'text', '#000000']);
    z._executeAction('yankAnnotation', reader, state, {});
    native.selectedAnnotationIDs = ['NOTE'];
    native.readOnly = true;
    z._executeAction('yankAnnotation', reader, state, {});
    native.readOnly = false;
    assert.deepEqual(copied, ['Line one\nLine two', 'A note\n  Indented']);
    native.selectedAnnotationIDs = ['MARK'];
    await z._executeAction('recolorBlack', reader, state, {});
    native.selectedAnnotationIDs = [];
    await z._executeAction('highlightGray', reader, state, {});
    native.selectedAnnotationIDs = ['MARK', 'BOX'];
    await z._executeAction('highlightGray', reader, state, {});
    native.selectedAnnotationIDs = ['MARK'];
    mark.annotationIsExternal = true;
    await z._executeAction('highlightOrange', reader, state, {});
    assert.equal(saved.length, 7);
  } finally {
    Object.assign(context.Components, { classes, interfaces });
    Object.assign(context.Zotero, { Items, DB });
  }
}

async function checkAnnotationTypeRepaint() {
  const saved = [], paints = [], thumbnails = [], clones = [];
  let published = null;
  const item = { key: 'MARK', annotationType: 'highlight', annotationColor: z.COLORS.yellow,
    annotationPosition: JSON.stringify({ pageIndex: 3, rects: [[1, 2, 3, 4]],
      nextPageRects: [[5, 6, 7, 8]] }), save: async () => saved.push(item.annotationType) };
  const view = name => ({ _iframeWindow: { name },
    _render: pages => {
      assert.equal(published, item.annotationType, 'publish the committed type before painting');
      paints.push([name, Array.from(pages), published]);
    },
    _pdfThumbnails: { render: (pages, onlyRendered) => {
      assert.equal(onlyRendered, true);
      thumbnails.push([name, Array.from(pages)]);
    } },
  });
  const primary = view('primary'), secondary = view('secondary'), another = view('another');
  const reader = { itemID: 11, _iframeWindow: { name: 'reader' }, _internalReader: {
    _primaryView: primary, _secondaryView: secondary,
    _getActiveView: isPrimary => isPrimary ? primary : secondary,
  }, setAnnotations: async items => { published = items[0].annotationType; } };
  const secondReader = { ...reader, _iframeWindow: { name: 'another-reader' },
    _internalReader: { _primaryView: another } };
  const { DB } = context.Zotero;
  const { cloneInto } = context.Components.utils;
  const state = {};
  context.Zotero.DB = { executeTransaction: async fn => fn() };
  context.Components.utils.cloneInto = (pages, win) => {
    clones.push(win.name);
    return Array.from(pages);
  };
  z._readerState.set('repaint-other', { reader: secondReader });
  z._readerState.set('repaint-unrelated', { reader: { itemID: 12,
    setAnnotations() { throw Error('unrelated attachment'); } } });
  try {
    await z._styleAnnotation(state, reader, item, z.COLORS.yellow, 'underline');
    assert.deepEqual(saved, ['underline']);
    assert.deepEqual(paints, [
      ['primary', [3, 4], 'underline'], ['secondary', [3, 4], 'underline'],
      ['another', [3, 4], 'underline'],
    ]);
    assert.deepEqual(clones, ['reader', 'another-reader']);
    assert.equal(thumbnails.length, 3);

    await z._styleAnnotation(state, reader, item, z.COLORS.orange, 'underline');
    assert.equal(paints.length, 3, 'colour-only changes use Zotero notification rendering');
    await z._styleAnnotation(state, reader, item, z.COLORS.orange, 'highlight');
    assert.deepEqual(paints.slice(3), [
      ['primary', [3, 4], 'highlight'], ['secondary', [3, 4], 'highlight'],
      ['another', [3, 4], 'highlight'],
    ]);

    context.Zotero.DB.executeTransaction = async () => { throw Error('failed save'); };
    await z._styleAnnotation(state, reader, item, z.COLORS.orange, 'underline');
    assert.equal(paints.length, 6, 'failed writes must not publish or repaint');
  } finally {
    context.Zotero.DB = DB;
    context.Components.utils.cloneInto = cloneInto;
    z._readerState.delete('repaint-other');
    z._readerState.delete('repaint-unrelated');
  }
}

checkPdfAnnotationSelection().then(async () => {
  pass++;
  console.log('  ok  Copy and PDF annotations use the projected ranges and their actual pages');
  await checkAnnotationStyleSelection();
  pass++;
  console.log('  ok  Annotation styles update a single editable native selection in place');
  await checkAnnotationTypeRepaint();
  pass++;
  console.log('  ok  Same-colour type conversions repaint committed pages in every reader pane');
  console.log('Reader text checks passed (' + pass + ' cases).');
}).catch(error => { console.error(error); process.exitCode = 1; });

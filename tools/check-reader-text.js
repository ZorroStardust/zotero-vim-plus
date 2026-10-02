/* global require, __dirname, console */
// Reader text motions, objects, word search, repeat and progress are DOM-light.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({
  Zotero: { debug() {} },
  Components: { utils: { cloneInto: value => value } },
  Services: { prefs: { getPrefType: () => 0 } },
  setTimeout: () => 1,
  clearTimeout() {},
});
for (const name of ['zoteroVim.js', 'zoteroVimReader.js']) {
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

check('viw leaves hint picking and resolves as a Visual text object', () => {
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
  key('i');
  assert.equal(state.hintMode, false);
  assert.equal(state.keyBuffer, 'i');
  key('w');
  assert.deepEqual(actions, ['visualInnerWord']);
  assert.equal(z._hintLabelList(40, null, 'I').some(label => label.includes('I')), false);
});

check('dot repeats only the last annotation-changing reader action', () => {
  z._handleReaderSidebarAction = () => false;
  const calls = [];
  z._highlight = (_state, _reader, _win, color) => calls.push(color);
  const state = { mode: 'visual', lastReaderChange: null,
    selectionParams: { annotation: {} } };
  const reader = {};
  const pdfWin = { document: {} };
  z._executeAction('highlightRed', reader, state, pdfWin, 3);
  z._executeAction('repeatLastChange', reader, state, pdfWin);
  assert.deepEqual(calls, [z.COLORS.red, z.COLORS.red]);
  assert.equal(state.lastReaderChange.action, 'highlightRed');
  assert.equal(state.lastReaderChange.count, 3);

  state.selectionParams = null;
  pdfWin.getSelection = () => ({ isCollapsed: true, toString: () => '' });
  z._lastSelectionParams = null;
  z._executeAction('highlightBlue', reader, state, pdfWin);
  assert.equal(state.lastReaderChange.action, 'highlightRed');
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

console.log('Reader text checks passed (' + pass + ' cases).');

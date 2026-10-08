/* global require, __dirname, console */
// Check pane isolation and reversible native PDF layout transitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({
  Zotero: { debug() {} },
  setTimeout: () => 1, clearTimeout() {},
});
for (const name of ['zoteroVim.js', 'zoteroVimReader.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
}
const z = context.ZoteroVim;
const notices = [];
z.getPref = (_name, fallback) => fallback;
z._showStatus = (_state, text) => notices.push(text);
z._nativeEditableFocused = () => false;
z._smoothHoldSpecForEvent = () => null;
z._stopSmoothHoldScroll = () => {};
z._updateIndicator = () => {};
z._handleReaderSidebarAction = () => false;

function pane(scrollMode = 1, scale = '1.5', spreadMode = 0) {
  const viewer = { spreadMode, scrollMode, currentScaleValue: scale,
    currentPageNumber: 1, pagesCount: 13 };
  const win = { PDFViewerApplication: { pdfViewer: viewer } };
  const calls = [];
  const view = {
    _iframeWindow: win,
    setSpreadMode(value) { calls.push(['spread', value]); viewer.spreadMode = value; },
    setScrollMode(value) { calls.push(['scroll', value]); viewer.scrollMode = value; },
    zoomPageHeight() { calls.push(['fit']); viewer.currentScaleValue = 'page-fit'; },
  };
  return { viewer, win, view, calls };
}

function fixture() {
  const primary = pane();
  const secondary = pane(2, 'page-width');
  const ir = { _primaryView: primary.view, _secondaryView: secondary.view,
    _lastView: primary.view, _state: { primary: true } };
  const reader = { _internalReader: ir };
  const state = { mode: 'normal', keyBuffer: '', countBuffer: '', activePdfWin: primary.win };
  state.executeAction = (action, count) =>
    z._executeAction(action, reader, state, state.activePdfWin, count);
  return { primary, secondary, ir, reader, state };
}

function key(f, value) {
  const event = { key: value, preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  z._onKeyDown(event, f.reader, f.state, f.state.activePdfWin);
  return event;
}

function chord(f, suffix) {
  assert.equal(key(f, ' ').prevented, true);
  assert.equal(z._readerConsumesKey(f.state, suffix), true);
  assert.equal(key(f, suffix).prevented, true);
}

let passed = 0;
function check(label, fn) { fn(); passed++; console.log('  ok  ' + label); }

check('Space+s fits native odd spreads and restores zoom/scroll at the current page', () => {
  const f = fixture();
  assert.equal(z.getBindings()['normal: p'], undefined);
  assert.equal(z.getBindings()['normal: P'], undefined);
  f.state.keyBuffer = ' ';
  assert.equal(z._readerConsumesKey(f.state, 'p'), false);
  assert.equal(z._readerConsumesKey(f.state, 'P'), false);
  f.state.keyBuffer = '';
  chord(f, 's');
  assert.equal(f.primary.viewer.spreadMode, 1);
  assert.equal(f.primary.viewer.scrollMode, 0);
  assert.equal(f.primary.viewer.currentScaleValue, 'page-fit');
  assert.deepEqual(f.primary.calls, [['scroll', 0], ['spread', 1], ['fit']]);
  f.primary.viewer.currentPageNumber = 11;
  chord(f, 's');
  assert.equal(f.primary.viewer.spreadMode, 0);
  assert.equal(f.primary.viewer.scrollMode, 1);
  assert.equal(f.primary.viewer.currentScaleValue, '1.5');
  assert.equal(f.primary.viewer.currentPageNumber, 11);
});

check('Space+S opens even spreads; parity changes keep manual zoom and the restore point', () => {
  const f = fixture();
  chord(f, 'S');
  assert.equal(f.primary.viewer.spreadMode, 2);
  f.primary.viewer.currentScaleValue = '1.8';
  chord(f, 'S');
  assert.equal(f.primary.viewer.spreadMode, 1);
  assert.equal(f.primary.viewer.currentScaleValue, '1.8');
  chord(f, 'S');
  chord(f, 's');
  assert.equal(f.primary.viewer.currentScaleValue, '1.5');
  chord(f, 's');
  assert.equal(f.primary.viewer.spreadMode, 2);
});

check('split panes have independent parity and restore points despite stale native focus', () => {
  const f = fixture();
  chord(f, 's');
  f.state.activePdfWin = f.secondary.win;
  chord(f, 'S');
  assert.equal(f.primary.viewer.spreadMode, 1);
  assert.equal(f.secondary.viewer.spreadMode, 2);
  chord(f, 's');
  assert.equal(f.secondary.viewer.scrollMode, 2);
  assert.equal(f.secondary.viewer.currentScaleValue, 'page-width');
  assert.equal(f.primary.viewer.currentScaleValue, 'page-fit');
  f.state.activePdfWin = f.primary.win;
  chord(f, 's');
  assert.equal(f.primary.viewer.scrollMode, 1);
  assert.equal(f.primary.viewer.currentScaleValue, '1.5');
  f.state.activePdfWin = f.secondary.win;
  chord(f, 's');
  assert.equal(f.secondary.viewer.spreadMode, 2);
});

check('direct actions are idempotent and native pre-existing double-page layouts are respected', () => {
  const f = fixture();
  z._executeAction('setReaderEvenSpread', f.reader, f.state, f.primary.win);
  f.primary.viewer.currentScaleValue = '2';
  const callCount = f.primary.calls.length;
  z._executeAction('setReaderEvenSpread', f.reader, f.state, f.primary.win);
  assert.equal(f.primary.calls.length, callCount);
  assert.equal(f.primary.viewer.currentScaleValue, '2');
  z._executeAction('setReaderOddSpread', f.reader, f.state, f.primary.win);
  z._executeAction('setReaderSinglePage', f.reader, f.state, f.primary.win);
  assert.equal(f.primary.viewer.currentScaleValue, '1.5');
  const native = pane(0, 'page-width', 2);
  f.ir._primaryView = native.view;
  f.state.activePdfWin = native.win;
  chord(f, 's');
  assert.equal(native.viewer.currentScaleValue, 'page-width');
  chord(f, 's');
  assert.equal(native.viewer.spreadMode, 2);
});

check('older view APIs fall back to PDF.js scalar setters', () => {
  const f = fixture();
  delete f.primary.view.setSpreadMode;
  delete f.primary.view.setScrollMode;
  delete f.primary.view.zoomPageHeight;
  chord(f, 'S');
  assert.equal(f.primary.viewer.spreadMode, 2);
  assert.equal(f.primary.viewer.scrollMode, 0);
  assert.equal(f.primary.viewer.currentScaleValue, 'page-fit');
  chord(f, 's');
  assert.equal(f.primary.viewer.scrollMode, 1);
  assert.equal(f.primary.viewer.currentScaleValue, '1.5');
});

check('failed transitions roll back layout and retain the original restore point for retry', () => {
  const f = fixture();
  const setSpread = f.primary.view.setSpreadMode;
  f.primary.view.setSpreadMode = value => { if (value !== 0) throw new Error('Failure'); };
  chord(f, 's');
  assert.equal(f.primary.viewer.spreadMode, 0);
  assert.equal(f.primary.viewer.scrollMode, 1);
  assert.equal(f.primary.viewer.currentScaleValue, '1.5');
  assert.match(notices.at(-1), /Could not change/);
  f.primary.view.setSpreadMode = setSpread;
  chord(f, 'S');
  f.primary.view.setScrollMode = value => {
    if (value === 1) throw new Error('Restore failure');
    f.primary.viewer.scrollMode = value;
  };
  chord(f, 's');
  assert.equal(f.primary.viewer.spreadMode, 2);
  assert.equal(f.primary.viewer.currentScaleValue, 'page-fit');
  f.primary.view.setScrollMode = value => { f.primary.viewer.scrollMode = value; };
  chord(f, 's');
  assert.equal(f.primary.viewer.scrollMode, 1);
  assert.equal(f.primary.viewer.currentScaleValue, '1.5');
});

check('non-PDF, loading and stale windows are rejected without changing another pane', () => {
  const f = fixture();
  assert.equal(z._setReaderSpreadMode(f.state, f.reader, {}, 'toggle'), false);
  assert.equal(f.primary.calls.length, 0);
  f.primary.viewer.pagesCount = 0;
  chord(f, 's');
  assert.equal(f.primary.calls.length, 0);
  assert.match(notices.at(-1), /loading/);
  f.primary.viewer.pagesCount = 13;
  const replacedWin = f.primary.win;
  f.ir._primaryView = pane().view;
  assert.equal(z._setReaderSpreadMode(f.state, f.reader, replacedWin, 'toggle'), false);
  assert.equal(f.secondary.calls.length, 0);
});

check('chord forwarding respects remaps while Insert and native text inputs keep typing', () => {
  const f = fixture();
  z.getPref = (name, fallback) => name === 'bindings'
    ? JSON.stringify({ 'normal: s': null, 'normal: r': 'toggleReaderSpread' }) : fallback;
  assert.equal(z._readerConsumesKey(f.state, 's'), false);
  chord(f, 'r');
  assert.equal(f.primary.viewer.spreadMode, 1);
  f.state.mode = 'insert';
  assert.equal(key(f, ' ').prevented, undefined);
  assert.equal(key(f, 'S').prevented, undefined);
  assert.equal(z._readerConsumesKey(f.state, 'S'), false);
  f.state.mode = 'normal';
  for (const tagName of ['INPUT', 'TEXTAREA']) {
    z._onKeyDown({ key: ' ', target: { tagName },
      preventDefault() { throw new Error('Text input consumed'); } },
    f.reader, f.state, f.primary.win);
  }
  z.getPref = (_name, fallback) => fallback;
});

console.log('Reader page layout checks passed (' + passed + ' cases).');

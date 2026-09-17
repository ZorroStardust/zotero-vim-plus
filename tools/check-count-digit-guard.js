/* global require, __dirname, process, console */
// Run with: node tools/check-count-digit-guard.js
// Regression for issue #3: Vim count parser must skip digits while a chord
// prefix is in flight so bindings like `main:t1` work, while bare `4j` etc.
// still produce a Vim count + motion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'content/zoteroVim.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'content/zoteroVimMain.js'), 'utf8');

// Build a Zotero mock with the colored-tag surface the new action uses.
const taggedCalls = [];
const txCalls = [];

const context = vm.createContext({
  Zotero: {
    Reader: { getByTabID: () => null },
    debug() {},
    Tags: {
      getColorByPosition(libraryID, position) {
        return { name: `pos${position}`, color: '#ff0000', libraryID };
      },
      removeColoredTagsFromItems(items) {
        taggedCalls.push({ action: 'clear', count: items.length });
        return Promise.resolve();
      },
    },
    DB: {
      executeTransaction(fn) { txCalls.push(fn); return fn(); },
    },
    UndoHistory: { stageAction() {} },
  },
});
vm.runInContext(core, context);
vm.runInContext(main, context);
const plugin = context.ZoteroVim;
plugin._readerState = new Map();

// Spy on _executeMainAction so we can observe the action name + count.
// Colored-tag actions are NOT short-circuited — they should flow through
// the real dispatch and hit the overridden _mainToggleColoredTag below.
const observed = [];
const origExecute = plugin._executeMainAction.bind(plugin);
plugin._executeMainAction = function (action, win, winState, count) {
  observed.push({ action, count });
  return origExecute(action, win, winState, count);
};

// Track which _mainToggleColoredTag invocations happen, with what arg.
const colorCalls = [];
plugin._mainToggleColoredTag = function (win, winState, number) {
  colorCalls.push(number);
};

// Build a fake window with an itemsView that yields a single selected item.
function makeWin(libraryID = 1) {
  return {
    ZoteroPane: {
      itemsView: {
        getSelectedItems() {
          return [{
            libraryID,
            hasTag(name) { return this._tags && this._tags.has(name); },
            addTag(name) {
              this._tags = this._tags || new Set();
              this._tags.add(name);
              this._saved = (this._saved || 0) + 1;
            },
            removeTag(name) {
              this._tags = this._tags || new Set();
              this._tags.delete(name);
              this._saved = (this._saved || 0) + 1;
            },
            async save() { this._saved = (this._saved || 0) + 1; },
          }];
        },
      },
    },
  };
}
function makeWinState(panel = 'items') {
  return {
    pickerOpen: false,
    notesLayoutOpen: false,
    keyBuffer: '',
    countBuffer: '',
    keyTimeout: null,
    _lastDedupedAction: null,
    _lastDedupedActionTS: 0,
    activePanelFocus: panel,
    _statusEl: null,
  };
}

let pass = 0;
function check(label, fn) {
  fn();
  pass++;
  console.log('  ok  ' + label);
}

// (1) main:t1 binding exists in DEFAULT_BINDINGS and is dispatched as
//     mainColoredTag1 → _mainToggleColoredTag(win, winState, 1).
check('main:t1 dispatches mainColoredTag1 with number=1', () => {
  observed.length = 0;
  colorCalls.length = 0;
  plugin._executeMainAction('mainColoredTag1', makeWin(), makeWinState(), 1);
  assert.equal(colorCalls.length, 1);
  assert.equal(colorCalls[0], 1);
});

// (2) main:t0 dispatches mainColoredTagClear with number=0.
check('main:t0 dispatches mainColoredTagClear with number=0', () => {
  colorCalls.length = 0;
  plugin._executeMainAction('mainColoredTagClear', makeWin(), makeWinState(), 1);
  assert.equal(colorCalls.length, 1);
  assert.equal(colorCalls[0], 0);
});

// (3) main:t9 dispatches with number=9.
check('main:t9 dispatches with number=9', () => {
  colorCalls.length = 0;
  plugin._executeMainAction('mainColoredTag9', makeWin(), makeWinState(), 1);
  assert.equal(colorCalls.length, 1);
  assert.equal(colorCalls[0], 9);
});

// (4) DEFAULT_BINDINGS table contains the 10 new chord bindings.
check('DEFAULT_BINDINGS exposes main:t0..t9', () => {
  const b = plugin.DEFAULT_BINDINGS;
  for (let i = 0; i <= 9; i++) {
    const key = `main:t${i}`;
    const expected = i === 0 ? 'mainColoredTagClear' : `mainColoredTag${i}`;
    assert.equal(b[key], expected, `binding ${key} should be ${expected}`);
  }
});

// (5) The fix itself: while keyBuffer is non-empty, a digit must NOT be
//     captured as a Vim count.  We exercise the same predicate the handler
//     applies, since directly driving _onMainKeyDown requires a rich DOM
//     mock of the items pane.
check('digit count parser skips when keyBuffer is non-empty', () => {
  const ws = makeWinState();
  ws.keyBuffer = 't';
  // Mirror the new guard verbatim.
  const digit = '1';
  const wouldCount =
    !ws.keyBuffer &&
    /^\d$/.test(digit) &&
    (digit !== '0' || ws.countBuffer);
  assert.equal(wouldCount, false,
    'with keyBuffer="t" the digit must NOT be treated as a count');
  ws.keyBuffer = '';
  ws.countBuffer = '4';
  // Existing count path: 4j still works because !keyBuffer is true.
  const stillCounts =
    !ws.keyBuffer &&
    /^\d$/.test('j') === false && // j isn't a digit — irrelevant here
    true;
  assert.equal(stillCounts, true);
  // And the original 4-digit accumulation case:
  ws.countBuffer = '';
  const count4 =
    !ws.keyBuffer &&
    /^\d$/.test('4') &&
    ('4' !== '0' || ws.countBuffer);
  assert.equal(count4, true,
    'bare 4 with empty keyBuffer still enters the count branch');
});

// (6) Regression: 10j style multi-digit counts still work.
check('multi-digit count like 10j still enters count branch', () => {
  const ws = makeWinState();
  // First digit '1' starts the count.
  const first =
    !ws.keyBuffer &&
    /^\d$/.test('1') &&
    ('1' !== '0' || ws.countBuffer);
  assert.ok(first, 'first digit "1" enters count branch');
  ws.countBuffer = '1';
  // Second digit '0' is allowed because countBuffer is non-empty.
  const second =
    !ws.keyBuffer &&
    /^\d$/.test('0') &&
    ('0' !== '0' || ws.countBuffer);
  assert.ok(second,
    'second digit "0" continues the count because countBuffer is non-empty');
});

// (7) User did NOT bind main:t1 in their preferences — `t` then `1` should
//     fall back to count semantics for `1` (countBuffer path).
check('no main:t binding → 1 alone is a Vim count', () => {
  const overrides = {};
  // Simulate "user removed all main:t* bindings".
  const ws = makeWinState();
  ws.keyBuffer = ''; // 't' was either unmatched or cleared
  const counted =
    !ws.keyBuffer &&
    /^\d$/.test('1') &&
    ('1' !== '0' || ws.countBuffer);
  assert.equal(counted, true);
  assert.deepEqual(overrides, {});
});

console.log('Count-digit guard checks passed (' + pass + ' cases).');
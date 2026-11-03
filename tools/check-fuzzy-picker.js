/* global require, __dirname, console, process */
// Regression checks for issue #8: search typing, explicit copy shortcuts and
// selection ownership when keyboard navigation and mouse hovering overlap.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const timers = new Map();
const copies = [];
let nextTimer = 0;
const context = vm.createContext({
  setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
  clearTimeout(id) { timers.delete(id); },
  Zotero: { debug() {}, Libraries: { userLibraryID: 1 }, Items: {} },
  Services: { focus: {} },
  Components: {
    classes: {
      '@mozilla.org/widget/clipboardhelper;1': {
        getService: () => ({ copyString: text => copies.push(text) }),
      },
    },
    interfaces: { nsIClipboardHelper: {} },
  },
});
const root = path.join(__dirname, '..');
for (const file of ['zoteroVim.js', 'zoteroVimMain.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', file), 'utf8'), context);
}
const plugin = context.ZoteroVim;
plugin._mainShowStatus = () => {};

// Minimal DOM with persistent node identity, bubbling mouse/input events,
// focus and observable scrolling. Layout-generated events are supplied below.
function element(doc, fragment = false) {
  return {
    ownerDocument: doc, fragment, children: [], parentNode: null,
    style: {}, dataset: {}, listeners: {}, value: '', isConnected: true,
    focusCount: 0, scrollCount: 0,
    get firstChild() { return this.children[0] || null; },
    appendChild(child) {
      if (child.fragment) {
        for (const entry of [...child.children]) this.appendChild(entry);
      } else {
        if (child.parentNode) child.parentNode.removeChild(child);
        this.children.push(child);
        child.parentNode = this;
      }
      return child;
    },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
    },
    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter(value => value !== fn);
    },
    emit(type, event = {}) {
      if (!event.target) event.target = this;
      for (const fn of this.listeners[type] || []) fn(event);
      if (this.parentNode) this.parentNode.emit(type, event);
    },
    contains(other) {
      for (let node = other; node; node = node.parentNode) {
        if (node === this) return true;
      }
      return false;
    },
    closest() {
      for (let node = this; node; node = node.parentNode) {
        if ('zvPickerIndex' in node.dataset) return node;
      }
      return null;
    },
    focus() { this.focusCount++; doc.activeElement = this; },
    scrollIntoView() { this.scrollCount++; },
  };
}

function flushTimers() {
  const pending = [...timers.values()];
  timers.clear();
  for (const fn of pending) fn();
}

async function fixture(scope = 'all', count = 4, citekey = true) {
  copies.length = 0;
  timers.clear();
  const doc = {};
  doc.createElementNS = () => element(doc);
  doc.createDocumentFragment = () => element(doc, true);
  doc.body = element(doc);
  const previousFocus = element(doc);
  doc.body.appendChild(previousFocus);
  doc.activeElement = previousFocus;
  const items = Array.from({ length: count }, (_, i) => ({
    id: i + 1, title: 'Yearly study ' + i, citekey: citekey ? 'study' + i : '',
    year: '2026', author: 'Author', kind: 'reader',
    searchStr: 'yearly study ' + i,
    getField(field) { return this[field]; },
    getCreators: () => [{ lastName: 'Author' }],
    isAttachment: () => false, isNote: () => false,
  }));
  context.Zotero.Items.getAll = async () => items;
  context.Zotero.BetterBibTeX = {
    KeyManager: { get: id => ({ citationKey: items[id - 1].citekey }) },
  };
  const selected = [];
  const opened = [];
  const win = { document: doc, ZoteroPane: {
    selectItem: id => selected.push(id),
    collectionsView: { getSelectedCollection: () => ({ getChildItems: () => items }) },
  } };
  plugin._buildTabPickerItems = () => items;
  plugin._mainSelectTab = (_win, id) => selected.push(id);
  plugin._mainOpenPDF = () => opened.push(true);
  const state = {};
  await plugin._openFuzzyPicker(win, state, scope);
  flushTimers(); // Initial input focus only; typing must not add copy timers.
  return { win, state, selected, opened, previousFocus, input: state._pickerInput };
}

function key(f, value, extra = {}) {
  const event = { key: value, code: '', ctrlKey: false, shiftKey: false,
    metaKey: false, altKey: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
  plugin._onPickerKeyDown(event, f.win, f.state);
  if (!event.prevented && !event.ctrlKey && !event.metaKey && !event.altKey
      && value.length === 1) {
    f.input.value += value;
    f.input.emit('input');
  }
  return event;
}

let passed = 0;
async function check(label, fn) {
  await fn();
  passed++;
  console.log('  ok  ' + label);
}

async function main() {
  await check('y, yy and uppercase Y remain search text at any typing speed', async () => {
    for (const scope of ['all', 'collection']) {
      const f = await fixture(scope);
      for (const value of 'yyYya') {
        assert.equal(key(f, value).prevented, undefined);
        assert.equal(timers.size, 0);
        flushTimers();
      }
      assert.equal(f.input.value, 'yyYya');
      assert.equal(f.state.pickerOpen, true);
      assert.equal(copies.length, 0);
      key(f, 'Escape');
    }
  });

  await check('Ctrl+y and Ctrl+Shift+y copy immediately and restore focus', async () => {
    for (const scope of ['all', 'collection']) {
      for (const shiftKey of [false, true]) {
        const f = await fixture(scope);
        key(f, 'j', { ctrlKey: true });
        const event = key(f, shiftKey ? 'Y' : 'y', { ctrlKey: true, shiftKey });
        assert.equal(event.prevented, true);
        assert.deepEqual(copies, [shiftKey ? 'study1'
          : '@study1  Yearly study 1  (Author, 2026)']);
        assert.equal(f.state.pickerOpen, false);
        assert.equal(f.previousFocus.focusCount, 1);
        assert.equal(timers.size, 0);
        // A forwarded copy of the same event must not execute a second time.
        plugin._onPickerKeyDown(event, f.win, f.state);
        assert.equal(copies.length, 1);
      }
    }
  });

  await check('unrelated modifiers, missing citekeys and empty results do not copy', async () => {
    const f = await fixture();
    for (const mods of [{ altKey: true }, { metaKey: true },
      { ctrlKey: true, altKey: true }, { ctrlKey: true, metaKey: true }]) {
      assert.equal(key(f, 'y', mods).prevented, undefined);
    }
    assert.equal(copies.length, 0);
    const missing = await fixture('all', 1, false);
    key(missing, 'Y', { ctrlKey: true, shiftKey: true });
    assert.equal(copies.length, 0);
    const empty = await fixture('all', 0);
    for (const value of ['ArrowDown', 'ArrowUp']) key(empty, value);
    key(empty, 'y', { ctrlKey: true });
    assert.equal(empty.state.pickerOpen, true);
    assert.equal(copies.length, 0);
    key(empty, 'Escape');
  });

  await check('keyboard navigation keeps rows and selection under a stationary pointer', async () => {
    for (const scope of ['all', 'tabs']) {
      const f = await fixture(scope, 30);
      const rows = [...f.state._pickerResults.children];
      rows[0].emit('mousemove', { screenX: 100, screenY: 100 });
      for (const [value, mods, expected] of [
        ['j', { ctrlKey: true }, 1], ['n', { ctrlKey: true }, 2],
        ['ArrowDown', {}, 3], ['k', { ctrlKey: true }, 2],
        ['p', { ctrlKey: true }, 1], ['ArrowUp', {}, 0],
        ['ArrowUp', {}, 0], ['x', { ctrlKey: true, code: 'KeyJ' }, 1],
      ]) {
        assert.equal(key(f, value, mods).prevented, true);
        rows[0].emit('mouseenter', { screenX: 100, screenY: 100 });
        rows[0].emit('mousemove', { screenX: 100, screenY: 100 });
        assert.equal(f.state._pickerSelected, expected);
        assert.deepEqual(f.state._pickerResults.children, rows);
        assert.equal(rows[expected].style.backgroundColor, '#313244');
        assert.equal(rows.filter(row => row.style.backgroundColor === '#313244').length, 1);
      }
      key(f, 'Escape');
    }
  });

  await check('moving the mouse takes selection without scrolling; clicking activates its row', async () => {
    const f = await fixture();
    const rows = [...f.state._pickerResults.children];
    f.input.emit('mousemove', { screenX: 100, screenY: 50 });
    const scrolls = rows.reduce((sum, row) => sum + row.scrollCount, 0);
    rows[2].children[0].emit('mousemove', { screenX: 101, screenY: 100 });
    assert.equal(f.state._pickerSelected, 2);
    assert.equal(rows.reduce((sum, row) => sum + row.scrollCount, 0), scrolls);
    key(f, 'j', { ctrlKey: true });
    assert.equal(f.state._pickerSelected, 3);
    rows[1].emit('click');
    assert.deepEqual(f.selected, [2]);
    assert.equal(f.state.pickerOpen, false);
  });

  await check('filtering cannot hand selection to an unmoved pointer; reopening resets it', async () => {
    const f = await fixture();
    f.input.emit('mousemove', { screenX: 100, screenY: 50 });
    f.state._pickerResults.children[2].emit('mousemove', { screenX: 101, screenY: 100 });
    key(f, 'y');
    assert.equal(f.state._pickerSelected, 0);
    f.state._pickerResults.children[2].emit('mousemove', { screenX: 101, screenY: 100 });
    assert.equal(f.state._pickerSelected, 0);
    key(f, 'Escape');
    assert.equal(f.state._pickerPointer, null);
    await plugin._openFuzzyPicker(f.win, f.state, 'all');
    flushTimers();
    assert.equal(f.state._pickerSelected, 0);
    f.state._pickerResults.children[2].emit('mousemove', { screenX: 101, screenY: 100 });
    assert.equal(f.state._pickerSelected, 0);
    key(f, 'Escape');
  });

  await check('tab hints/search, Enter and Ctrl+o keep their existing actions', async () => {
    const tabs = await fixture('tabs', 30);
    key(tabs, 'y', { ctrlKey: true });
    key(tabs, 'Y', { ctrlKey: true, shiftKey: true });
    assert.equal(copies.length, 0);
    assert.equal(tabs.state.pickerOpen, true);
    const hintIndex = plugin._pickerIndexFromHint('y', 30);
    assert.ok(hintIndex >= 0);
    key(tabs, 'y');
    assert.deepEqual(tabs.selected, [hintIndex + 1]);
    const search = await fixture('tabs');
    search.input.value = 'study';
    search.input.emit('input');
    assert.equal(key(search, 'y').prevented, undefined);
    assert.equal(search.input.value, 'studyy');
    key(search, 'Escape');
    for (const action of ['Enter', 'o']) {
      const f = await fixture();
      key(f, action, { ctrlKey: action === 'o' });
      assert.deepEqual(f.selected, [1]);
      assert.equal(f.opened.length, action === 'o' ? 1 : 0);
      assert.equal(f.state.pickerOpen, false);
    }
  });
  console.log('Fuzzy picker checks passed (' + passed + ' cases).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

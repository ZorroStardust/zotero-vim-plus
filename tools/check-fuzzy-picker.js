/* global require, __dirname, console, process */
// Regression checks for picker ranking, scope, async search and input handling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const timers = new Map();
const copies = [];
const prefs = new Map();
let nextTimer = 0;
const context = vm.createContext({
  setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
  clearTimeout(id) { timers.delete(id); },
  Zotero: { debug() {}, Libraries: { userLibraryID: 1 }, Items: {} },
  Services: { focus: {}, prefs: {
    getPrefType: key => prefs.has(key) ? 32 : 0,
    getStringPref: key => prefs.get(key),
    setStringPref: (key, value) => prefs.set(key, value),
  } },
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
for (const file of ['zoteroVim.js', 'zoteroVimMain.js', 'zoteroVimLibrary.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', file), 'utf8'), context);
}
const plugin = context.ZoteroVim;
plugin._mainShowStatus = () => {};

// Minimal DOM with persistent node identity, bubbling mouse/input events,
// focus and observable scrolling. Layout-generated events are supplied below.
function element(doc, fragment = false, localName = '') {
  return {
    ownerDocument: doc, fragment, localName, children: [], parentNode: null,
    style: {}, dataset: {}, listeners: {}, value: '', isConnected: true,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    click() { this.emit('click'); },
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
  return Promise.all(pending.map(fn => fn()));
}

function makeItem(id, title, overrides = {}) {
  return {
    id, title, itemType: 'book', year: '2026', citekey: '', kind: 'reader',
    dateAdded: '2026-01-01 12:00:00',
    searchStr: title.toLowerCase(),
    getField(field) { return this[field]; },
    getDisplayTitle() { return this.title; },
    getCreators: () => [{ lastName: 'Author' }],
    getAttachments: () => [], getNotes: () => [], getAnnotations: () => [],
    isRegularItem() { return this.itemType === 'book'; },
    isAttachment() { return this.itemType === 'attachment'; },
    isFileAttachment() { return this.isAttachment(); },
    ...overrides,
  };
}

async function fixture(scope = 'all', count = 4, citekey = true, overrides = {}) {
  copies.length = 0;
  timers.clear();
  const doc = {};
  doc.createElementNS = (_ns, tag) => element(doc, false, tag);
  doc.createDocumentFragment = () => element(doc, true);
  doc.body = element(doc);
  const previousFocus = element(doc);
  doc.body.appendChild(previousFocus);
  doc.activeElement = previousFocus;
  const items = overrides.items || Array.from({ length: count }, (_, i) =>
    makeItem(i + 1, 'Yearly study ' + i, {
      citekey: citekey ? 'study' + i : '',
      dateAdded: new Date(Date.UTC(2026, 0, 1, 0, 0, count - i)).toISOString(),
    }));
  context.Zotero.Items.getAll = async () => items;
  context.Zotero.Items.get = ids => ids.map(id => items.find(item => item.id === id));
  context.Zotero.BetterBibTeX = {
    KeyManager: { get: id => ({ citationKey: items.find(item => item.id === id)?.citekey }) },
  };
  const selected = [];
  const opened = [];
  const win = { document: doc, ZoteroPane: {
    selectItem: id => selected.push(id),
    viewAttachment: (id, _event, _noLocate, data) => opened.push({ id, data }),
    collectionsView: { getSelectedCollection: () => ({ libraryID: 2,
      getChildItems: () => overrides.collection || items }) },
  } };
  plugin._buildTabPickerItems = () => items;
  plugin._mainSelectTab = (_win, id) => selected.push(id);
  plugin._mainOpenPDF = (_win, _state, item) => opened.push(item);
  const state = {};
  await plugin._openFuzzyPicker(win, state, scope);
  await flushTimers(); // Initial input focus only; typing must not add copy timers.
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
        assert.equal(rows[expected].style.backgroundColor, 'var(--zv-theme-control, #313244)');
        assert.equal(rows.filter(row => row.style.backgroundColor === 'var(--zv-theme-control, #313244)').length, 1);
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
      await Promise.resolve();
      assert.deepEqual(f.selected, [1]);
      assert.equal(f.opened.length, action === 'o' ? 1 : 0);
      assert.equal(f.state.pickerOpen, false);
    }
  });

  await check('default view is recent references and ranks exact coauthors before the cap', async () => {
    const exact = makeItem(1, 'Introductory Econometrics', {
      dateAdded: '2020-01-01 00:00:00',
      getCreators: () => [{ lastName: 'Smith' }, { firstName: 'Jeffrey', lastName: 'Wooldridge' }],
    });
    const weak = Array.from({ length: 101 }, (_, i) =>
      makeItem(2 + i, 'w a o a o a l a d a r a i a d a g a e'));
    const notes = makeItem(105, 'Notebook', { itemType: 'note' });
    const f = await fixture('all', 0, false, { items: [exact, ...weak, notes] });
    const rows = () => Array.from(f.state._pickerFiltered, row => row.id);
    const query = value => { f.input.value = value; f.input.emit('input'); };
    assert.equal(rows().length, 100);
    assert.equal(rows()[0], 102);
    assert.equal(rows().includes(notes.id), false);
    assert.equal(f.state._pickerResults.children[0].children[0].children.length, 1);
    query('wooldridge');
    assert.equal(rows()[0], exact.id);
    assert.equal(rows().length, 100);
    query('2026 wooldridge econometrics');
    assert.deepEqual(rows(), [exact.id]);
    key(f, 'Escape');
  });

  await check('reopening the picker uses the saved language over Zotero locale', async () => {
    context.Zotero.locale = 'zh-CN';
    try {
      for (const [language, mode, type, empty] of [
        ['', '标题、创建者、年份', '文献', '无结果'],
        ['en', 'Title, Creator, Year', 'References', 'No results'],
        ['zh-CN', '标题、创建者、年份', '文献', '无结果'],
      ]) {
        plugin.setPref('language', language);
        const f = await fixture('all', 0);
        const buttons = f.state._pickerItemSearch.buttons;
        assert.equal(buttons.mode[0].textContent, mode);
        assert.equal(buttons.type[0].textContent, type);
        assert.equal(f.state._pickerResults.children[0].textContent, empty);
        key(f, 'Escape');
      }
    } finally {
      prefs.clear();
      delete context.Zotero.locale;
    }
  });

  await check('type controls preserve query, collection scope and annotation navigation', async () => {
    const parent = makeItem(1, 'Parent', { getAttachments: () => [2], getNotes: () => [3] });
    const annotation = makeItem(4, 'Synthesis', { itemType: 'annotation', parentID: 2, key: 'ABCDE123' });
    const attachment = makeItem(2, 'Local PDF', { itemType: 'attachment', parentID: 1,
      getAnnotations: () => [annotation] });
    const note = makeItem(3, 'Synthesis', { itemType: 'note', parentID: 1 });
    const outside = makeItem(5, 'Synthesis', { itemType: 'note' });
    const f = await fixture('collection', 0, false,
      { items: [parent, attachment, note, annotation, outside], collection: [parent] });
    f.input.value = 'synthesis';
    f.input.emit('input');
    assert.equal(f.state._pickerFiltered.length, 0);
    key(f, 'L', { ctrlKey: true, shiftKey: true });
    assert.deepEqual(Array.from(f.state._pickerFiltered, row => row.id), [4, 3]);
    const buttons = f.state._pickerItemSearch.buttons.type;
    assert.equal(buttons[1].attributes['aria-pressed'], 'true');
    buttons[5].click();
    assert.equal(f.input.value, 'synthesis');
    assert.equal(f.state._pickerFiltered.length, 1);
    assert.equal(f.state._pickerFiltered[0].id, annotation.id);
    key(f, 'Enter', { isComposing: true });
    assert.equal(f.state.pickerOpen, true);
    key(f, 'Enter');
    assert.equal(f.opened[0].id, attachment.id);
    assert.equal(f.opened[0].data.location.annotationID, annotation.key);
  });

  await check('native modes use the captured library and discard out-of-order responses', async () => {
    const parent = makeItem(1, 'Parent', { getAttachments: () => [2] });
    const attachment = makeItem(2, 'Local PDF', { itemType: 'attachment', parentID: 1 });
    const outside = makeItem(3, 'Other collection');
    const requests = [];
    context.Zotero.Search = function () {
      this.addCondition = (...condition) => { this.condition = condition; };
      this.search = () => new Promise(resolve => {
        requests.push({ libraryID: this.libraryID, condition: this.condition, resolve });
      });
    };
    const f = await fixture('collection', 0, false,
      { items: [parent, attachment, outside], collection: [parent] });
    f.input.value = 'inside attachment';
    key(f, 'l', { ctrlKey: true });
    const older = flushTimers();
    assert.equal(f.state._pickerResults.children[0].textContent, 'Searching…');
    key(f, 'o', { ctrlKey: true });
    assert.deepEqual(f.opened, []);
    key(f, 'l', { ctrlKey: true });
    const newer = flushTimers();
    assert.deepEqual(requests.map(r => [r.libraryID, ...r.condition]), [
      [2, 'quicksearch-fields', 'contains', 'inside attachment'],
      [2, 'quicksearch-everything', 'contains', 'inside attachment'],
    ]);
    requests[1].resolve([2, 3]);
    await newer;
    assert.deepEqual(Array.from(f.state._pickerFiltered, row => row.id), [1]);
    requests[0].resolve([]);
    await older;
    assert.deepEqual(Array.from(f.state._pickerFiltered, row => row.id), [1]);
    key(f, 'l', { ctrlKey: true });
    assert.equal(f.state._pickerItemSearch.mode, 0);
    assert.equal(f.state._pickerFiltered.length, 0);
    key(f, 'Escape');
  });

  await check('Ctrl+o opens the captured picker item after asynchronous selection', async () => {
    const f = await fixture();
    let finishSelection;
    f.win.ZoteroPane.selectItem = () => new Promise(resolve => { finishSelection = resolve; });
    key(f, 'j', { ctrlKey: true });
    const highlighted = f.state._pickerFiltered[1].source;
    key(f, 'o', { ctrlKey: true });
    assert.equal(f.state.pickerOpen, false);
    assert.deepEqual(f.opened, []);
    finishSelection();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.opened, [highlighted]);
  });
  await check('selection markers follow virtual rows and are removed on clear or replacement',
    async () => {
      const f = await fixture();
      plugin._closeFuzzyPicker(f.win, f.state);
      const doc = f.win.document;
      doc.head = element(doc);
      const picked = makeItem(1, 'First', { libraryID: 1, key: 'SAME' });
      const other = makeItem(2, 'Second', { libraryID: 2, key: 'SAME' });
      const row = { id: 'item-tree-main-default-row-0', classList: {
        toggle(_name, value) { row.marked = value; },
        remove() { row.marked = false; },
      } };
      const root = element(doc);
      root.querySelectorAll = () => [row];
      let currentRoot = root;
      let currentItem = picked;
      doc.getElementById = () => currentRoot;
      f.win.ZoteroPane.getSelectedItems = () => [picked];
      f.win.ZoteroPane.itemsView = { getRow: () => ({ ref: currentItem }) };
      let refresh;
      let disconnected = 0;
      f.win.MutationObserver = function (callback) {
        refresh = callback;
        this.observe = () => {};
        this.disconnect = () => disconnected++;
      };
      plugin._toggleWorkset(f.win, f.state);
      assert.equal(row.marked, true);
      currentItem = other;
      refresh();
      assert.equal(row.marked, false);
      currentItem = picked;
      refresh();
      assert.equal(row.marked, true);
      currentRoot = null;
      plugin._syncWorksetMarkers(f.win, f.state);
      assert.equal(row.marked, false);
      assert.equal(disconnected, 1);
      assert.equal(doc.head.children.length, 0);
      currentRoot = root;
      plugin._syncWorksetMarkers(f.win, f.state);
      assert.equal(row.marked, true);
      await plugin._runLibraryAction('mainClearWorkset', f.win, f.state);
      assert.equal(row.marked, false);
      assert.equal(disconnected, 2);
    });

  await check('cross-collection selection creates, reopens and edits a saved PDF group', async () => {
    const f = await fixture();
    const win = f.win;
    const state = f.state;
    plugin._closeFuzzyPicker(win, state);
    const first = makeItem(1, 'First paper', { libraryID: 1, key: 'FIRST',
      getAttachments: () => [3, 4] });
    const second = makeItem(2, 'Second paper', { libraryID: 2, key: 'SECOND',
      getAttachments: () => [5] });
    const pdf = (id, libraryID, key) => makeItem(id, 'PDF ' + id,
      { itemType: 'attachment', attachmentContentType: 'application/pdf', libraryID, key });
    const pdfs = [pdf(3, 1, 'SAME'), pdf(4, 1, 'OTHER'), pdf(5, 2, 'SAME')];
    const items = [first, second, ...pdfs];
    context.Zotero.Items.get = id => items.find(item => item.id === id);
    context.Zotero.Items.getByLibraryAndKey = (libraryID, key) =>
      items.find(item => item.libraryID === libraryID && item.key === key);
    context.Zotero.Utilities = { randomString: () => 'group-1' };
    let selected = first;
    win.ZoteroPane.getSelectedItems = () => [selected];
    win.ZoteroPane.itemsView = { rowCount: 1, getRow: () => ({ ref: selected }) };
    plugin._toggleWorkset(win, state);
    selected = second;
    plugin._toggleWorkset(win, state);
    assert.equal(plugin._libraryTargets(win, state).hidden, 1);

    await plugin._runLibraryAction('mainCreateReadingGroup', win, state);
    assert.equal(state._pickerFiltered.length, 2);
    key(f, 'Escape');
    assert.equal(plugin._readReadingGroups().length, 0);

    await plugin._runLibraryAction('mainCreateReadingGroup', win, state);
    await plugin._pickerSelectItem(win, state);
    assert.match(state._pickerChoices.form.details, /1 outside the current list/);
    key({ ...f, input: state._pickerInput }, 'R');
    assert.equal(state._pickerInput.value, 'R');
    key(f, 'Enter', { isComposing: true });
    assert.equal(plugin._readReadingGroups().length, 0);
    state._pickerInput.value = 'Reading sprint';
    await plugin._submitPickerForm(win, state);
    assert.deepEqual(Array.from(plugin._readReadingGroups()[0].members, item => item.libraryID),
      [1, 2]);
    assert.deepEqual(f.opened, []);

    const fresh = { ...f, state: {} };
    await plugin._runLibraryAction('mainShowReadingGroups', win, fresh.state);
    await plugin._pickerSelectItem(win, fresh.state);
    assert.equal(key(fresh, 'ArrowDown', { altKey: true }).prevented, true);
    assert.equal(plugin._readReadingGroups()[0].members[0].libraryID, 2);
    assert.equal(fresh.state._pickerSelected, 1);
    await plugin._pickerSelectItem(win, fresh.state);
    assert.deepEqual(f.opened, [pdfs[0]]);

    await plugin._runLibraryAction('mainAppendReadingGroup', win, state);
    await plugin._pickerSelectItem(win, state);
    await plugin._pickerSelectItem(win, state);
    assert.equal(plugin._readReadingGroups()[0].members.length, 2);
    assert.equal(state.pickerOpen, false);
    assert.deepEqual(f.opened, [pdfs[0]]);

    await plugin._runLibraryAction('mainShowReadingGroups', win, fresh.state);
    key(fresh, 'Delete');
    assert.equal(fresh.state._pickerChoices.form.destructive, true);
    key(fresh, 'Escape');
    await Promise.resolve();
    assert.equal(plugin._readReadingGroups().length, 1);
    assert.equal(fresh.state._pickerScope, 'libraryChoices');
    key(fresh, 'Delete');
    await plugin._submitPickerForm(win, fresh.state);
    assert.equal(plugin._readReadingGroups().length, 0);
  });

  await check('batch tag edits confirm hidden targets and reject read-only items', async () => {
    const f = await fixture();
    plugin._closeFuzzyPicker(f.win, f.state);
    const changes = [];
    const items = [1, 2].map(id => makeItem(id, 'Item ' + id, {
      libraryID: 1, key: String(id), tags: new Set(),
      hasTag(tag) { return this.tags.has(tag); },
      addTag(tag) { this.tags.add(tag); },
      removeTag(tag) { this.tags.delete(tag); },
      async save() { changes.push(this.id); },
    }));
    let selected = items[0];
    f.win.ZoteroPane.getSelectedItems = () => [selected];
    f.win.ZoteroPane.itemsView = { rowCount: 1, getRow: () => ({ ref: selected }) };
    context.Zotero.Items.getByLibraryAndKey = (_libraryID, key) =>
      items.find(item => item.key === key);
    plugin._toggleWorkset(f.win, f.state);
    selected = items[1];
    plugin._toggleWorkset(f.win, f.state);
    let transactions = 0;
    context.Zotero.DB = { executeTransaction: async fn => { transactions++; return fn(); } };
    await plugin._runLibraryAction('mainAddWorksetTag', f.win, f.state);
    assert.match(f.state._pickerChoices.form.details, /2 items · 1 outside/);
    await plugin._submitPickerForm(f.win, f.state);
    assert.equal(f.state.pickerOpen, true);
    key(f, 'Escape');
    assert.equal(transactions, 0);
    await plugin._runLibraryAction('mainAddWorksetTag', f.win, f.state);
    f.state._pickerInput.value = 'To read';
    await plugin._submitPickerForm(f.win, f.state);
    assert.deepEqual(changes, [1, 2]);
    items[1].isEditable = () => false;
    await plugin._runLibraryAction('mainRemoveWorksetTag', f.win, f.state);
    f.state._pickerInput.value = 'To read';
    await plugin._submitPickerForm(f.win, f.state);
    assert.equal(transactions, 1);
    assert(items.every(item => item.hasTag('To read')));
  });
  await check('batch collection adds only to a valid collection in the source library', async () => {
    const f = await fixture();
    plugin._closeFuzzyPicker(f.win, f.state);
    const membership = new Set();
    const item = makeItem(1, 'Article', {
      libraryID: 1, key: 'ARTICLE', inCollection: id => membership.has(id),
      addToCollection: id => membership.add(id), async save() {},
    });
    context.Zotero.Items.getByLibraryAndKey = () => item;
    f.win.ZoteroPane.getSelectedItems = () => [item];
    const collections = [{ id: 1, libraryID: 2 }, { id: 2, libraryID: 1 }];
    context.Zotero.Collections = { get: id => collections.find(collection => collection.id === id) };
    const oldBuild = plugin._buildCollectionPickerItems;
    plugin._buildCollectionPickerItems = async () => [
      { id: 'C1', title: 'Other library', path: 'Group' },
      { id: 'C2', title: 'Reading', path: 'My Library' },
      { id: 'S1', title: 'Saved search', path: 'My Library' },
    ];
    plugin._mainWindowState.set(f.win, f.state);
    try {
      await plugin._runLibraryAction('mainAddWorksetToCollection', f.win, f.state);
      assert.deepEqual(Array.from(f.state._pickerFiltered, row => row.title), ['Reading']);
      await plugin._pickerSelectItem(f.win, f.state);
      await plugin._submitPickerForm(f.win, f.state);
      assert.deepEqual([...membership], [2]);
    } finally {
      plugin._mainWindowState.delete(f.win);
      plugin._buildCollectionPickerItems = oldBuild;
    }
  });
  console.log('Fuzzy picker checks passed (' + passed + ' cases).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

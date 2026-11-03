/* global require, __dirname, console, process */
// Exercise real main-window dispatch against native-style shadow inputs and async views.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const preferences = new Map([['search.quicksearch-mode', 'fields']]);
  const searches = [], filters = [], statuses = [], timers = new Map();
  let serial = 0;
  const context = vm.createContext({
    Zotero: { locale: 'zh-CN', debug() {}, Reader: {},
      Prefs: { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) },
      Libraries: { getAll: () => [{ libraryID: 1, name: 'My library' }] },
      Collections: { getByLibrary: (_id, recursive) => {
        assert.equal(recursive, true, 'include descendants of collapsed collections');
        return [{ id: 1, name: 'Parent' }, { id: 2, parentID: 1, name: 'Collapsed child' }];
      } }, Searches: { getAll: async () => [{ id: 3, name: 'Saved query' }] },
    },
    Services: { focus: {} }, Components: {},
    setTimeout(fn) { timers.set(++serial, fn); return serial; },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const name of ['keymapLabels.js', 'zoteroVim.js', 'zoteroVimMain.js',
    'zoteroVimSearch.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content', name), 'utf8'), context);
  }
  const z = context.ZoteroVim;
  z.getPref = (_key, fallback) => fallback;
  z._isStandaloneNoteTabSelected = () => false;
  z._isMainNoteTextEditing = () => false;
  z._mainShowStatus = (_win, message) => statuses.push(message);
  const ids = new Map(), listeners = new Map();
  const doc = { getElementById: id => ids.get(id), querySelector: () => null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  };
  function element(tag, id = '') {
    const events = new Map(), attrs = new Map(), classes = new Set();
    const node = { id, tagName: tag.toUpperCase(), localName: tag, ownerDocument: doc,
      style: {}, children: [], dataset: {}, parentNode: null, value: '', isConnected: true,
      get firstChild() { return this.children[0]; },
      appendChild(child) {
        if (child.fragment) { child.children.forEach(entry => this.appendChild(entry)); return; }
        child.parentNode = this; this.children.push(child);
      },
      removeChild(child) {
        this.children.splice(this.children.indexOf(child), 1); child.parentNode = null;
      },
      contains(other) {
        for (; other; other = other.parentNode) if (other === this) return true;
        return false;
      },
      focus() {
        doc.activeElement = this.parentNode?.host || this;
        if (this.parentNode?.host) this.parentNode.activeElement = this;
        for (const fn of listeners.get('focusin') || []) fn({ target: this });
      },
      select() { this.selectionStart = 0; this.selectionEnd = this.value.length; },
      getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
      removeAttribute: key => attrs.delete(key), hasAttribute: key => attrs.has(key),
      classList: { add: key => classes.add(key), remove: key => classes.delete(key),
        contains: key => classes.has(key) },
      querySelector: () => null, scrollIntoView() {},
      addEventListener(type, fn) { events.set(type, fn); },
      removeEventListener(type) { events.delete(type); },
      emit(type) { events.get(type)?.({ target: this }); },
    };
    if (id) ids.set(id, node);
    return node;
  }
  doc.createElementNS = (_ns, tag) => element(tag);
  doc.createDocumentFragment = () => Object.assign(element('div'), { fragment: true });
  doc.body = element('body'); doc.documentElement = doc.body;
  const collectionTree = element('div', 'collection-tree');
  const itemTree = element('div', 'item-tree-main-default');
  const host = element('quick-search-textbox', 'zotero-tb-search');
  function field(id) {
    const control = element('search-textbox', id);
    const input = element('input');
    control.shadowRoot = { host: control, activeElement: null,
      querySelector: () => input };
    input.parentNode = control.shadowRoot;
    control.inputField = input;
    Object.defineProperty(control, 'value', {
      get: () => input.value, set: value => { input.value = value; },
    });
    return control;
  }
  const itemSearch = field('zotero-tb-search-textbox');
  const collectionSearch = field('zotero-collections-search');
  const button = element('button', 'zotero-tb-collections-search');
  collectionSearch.setAttribute('disabled', true);
  button.click = () => { throw new Error('native delayed animation must not run'); };
  host.searchTextbox = itemSearch; host.appendChild(itemSearch);
  host.focus = () => { throw new Error('host focus opens mode button, not the text input'); };
  host._searchModes = { titleCreatorYear: '标题、创建者、年份', fields: '所有字段和标签',
    everything: '所有内容' };
  host.updateMode = () => {
    host.radioValue = preferences.get('search.quicksearch-mode');
    itemSearch.inputField.placeholder = host._searchModes[host.radioValue];
  };
  host.updateMode();
  for (const node of [collectionTree, itemTree, host, collectionSearch, button]) {
    doc.body.appendChild(node);
  }
  const selection = () => ({ count: 1, focused: 0, select(row) { this.focused = row; } });
  const matches = [2, 4, 6];
  const cv = { tree: collectionTree, selection: selection(), rowCount: 7, _filter: '',
    getRow: index => ({ id: 'C' + index, ref: { id: index }, type: 'collection' }),
    _matchesFilter: ref => ({ matchesFilter: matches.includes(ref.id) }),
    _isFilterEmpty() { return !this._filter; },
    async setFilter(query) { filters.push(query); this._filter = query; },
    focusedRowMatchesFilter() { return matches.includes(this.selection.focused); },
    async focusFirstMatchingRow() { this.selection.select(2); this.tree.focus(); },
    async focusLastMatchingRow() { this.selection.select(6); },
    async focusNextMatchingRow(start, reverse) {
      const list = reverse ? [...matches].reverse() : matches;
      const next = list.find(row => reverse ? row < start : row > start);
      if (next === undefined) return false;
      this.selection.select(next); this.tree.focus(); return true;
    },
    async selectByID(id) {
      this.selectedID = id; this.selection.select(Number(id.slice(1))); return true;
    }, ensureRowIsVisible() {},
  };
  const iv = { tree: itemTree, selection: selection(), rowCount: 7, ensureRowIsVisible() {} };
  const win = { document: doc, closed: false, Zotero_Tabs: { selectedID: 'library' },
    ZoteroPane: { collectionsView: cv, itemsView: iv,
      async search(advanced) {
        searches.push({ query: itemSearch.value,
          mode: preferences.get('search.quicksearch-mode'), advanced });
      },
      hideCollectionSearch() {
        if (!collectionSearch.value) collectionSearch.classList.remove('visible');
      },
    } };
  doc.defaultView = win;
  const state = { win, mode: 'main', keyBuffer: '', countBuffer: '', activePanelFocus: 'items' };
  state.executeAction = (action, count) => z._executeMainAction(action, win, state, count);
  z._mainWindowState.set(win, state);
  function key(value, extra = {}) {
    const event = { key: value, target: doc.activeElement, ctrlKey: false, altKey: false,
      metaKey: false, shiftKey: false, ...extra,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    };
    z._onMainKeyDown(event, win, state);
    return event;
  }
  const type = text => {
    for (const char of text) {
      const event = key(char);
      if (!event.defaultPrevented) doc.activeElement.inputField.value += char;
    }
  };
  return { z, context, win, state, doc, ids, preferences, statuses, searches, filters, cv, iv,
    host, itemSearch, collectionSearch, collectionTree, itemTree, key, type, timers, element,
    listeners };
}

async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
let cases = 0;
async function test(name, run) {
  await run(fixture()); cases++; console.log('  ✓ ' + name);
}

(async () => {
  await test('collection / enables native input immediately without a delayed click', f => {
    f.collectionTree.focus();
    assert.equal(f.key('/').defaultPrevented, true);
    assert.equal(f.doc.activeElement, f.collectionSearch);
    assert.equal(f.collectionSearch.hasAttribute('disabled'), false);
    assert.equal(f.collectionSearch.classList.contains('visible'), true);
    f.type('robot/中文');
    assert.equal(f.collectionSearch.value, 'robot/中文');
    assert.equal(f.itemSearch.value, '');
  });
  await test('items / enters the shadow input despite an active collection selection', f => {
    f.itemTree.focus(); f.key('/'); f.type('j/k');
    assert.equal(f.doc.activeElement, f.itemSearch);
    assert.equal(f.itemSearch.value, 'j/k');
    assert.equal(f.state.activePanelFocus, 'items');
  });
  await test('body/toolbar focus does not become collection focus because of selection', f => {
    f.doc.body.focus();
    assert.equal(f.z._mainDetectFocusedPanel(f.win, f.state, { strict: true }), null);
    f.key('/'); assert.equal(f.doc.activeElement, f.doc.body);
  });
  await test('native item input works when opened with the mouse, including mode cycling', f => {
    f.itemSearch.inputField.focus(); f.type('robot');
    f.itemSearch.inputField.selectionStart = 2; f.itemSearch.inputField.selectionEnd = 4;
    f.key('l', { ctrlKey: true });
    assert.equal(f.preferences.get('search.quicksearch-mode'), 'everything');
    assert.equal(f.host.radioValue, 'everything');
    assert.equal(f.itemSearch.value, 'robot');
    assert.equal(f.itemSearch.inputField.selectionStart, 2);
    assert.equal(f.itemSearch.inputField.selectionEnd, 4);
    assert.equal(f.searches.at(-1).query, 'robot');
    assert.equal(f.searches.at(-1).mode, 'everything');
    f.key('l', { ctrlKey: true });
    assert.equal(f.host.radioValue, 'titleCreatorYear');
    f.key('h', { ctrlKey: true });
    assert.equal(f.host.radioValue, 'everything');
    f.key('h', { ctrlKey: true });
    assert.equal(f.host.radioValue, 'fields');
  });
  await test('item Enter applies quoted query and returns focus to items', async f => {
    f.itemTree.focus(); f.key('/'); f.type('"robot"'); f.key('Enter'); await settle();
    assert.equal(f.searches.at(-1).query, '"robot"');
    assert.equal(f.searches.at(-1).advanced, true);
    assert.equal(f.itemSearch.value, '"robot"');
    assert.equal(f.doc.activeElement, f.itemTree);
  });
  await test('item Escape clears query, keeps selected mode, and focuses items', async f => {
    f.itemTree.focus(); f.key('/'); f.type('robot'); f.key('h', { ctrlKey: true });
    f.key('Escape'); await settle();
    assert.equal(f.itemSearch.value, '');
    assert.equal(f.host.radioValue, 'titleCreatorYear');
    assert.equal(f.searches.at(-1).query, '');
    assert.equal(f.doc.activeElement, f.itemTree);
  });
  await test('collection Enter flushes debounce and selects a matching row', async f => {
    f.collectionTree.focus(); f.key('/'); f.type('child'); f.key('Enter'); await settle();
    assert.equal(f.filters.at(-1), 'child');
    assert.equal(f.cv.selection.focused, 2);
    assert.equal(f.doc.activeElement, f.collectionTree);
    assert.equal(f.collectionSearch.value, 'child');
  });
  await test('collection Escape clears filter and returns focus in one press', async f => {
    f.collectionTree.focus(); f.key('/'); f.type('child'); f.key('Escape'); await settle();
    assert.equal(f.filters.at(-1), '');
    assert.equal(f.collectionSearch.value, '');
    assert.equal(f.doc.activeElement, f.collectionTree);
    assert.equal(f.collectionSearch.classList.contains('visible'), false);
  });
  await test('filtered counted j/k and gg/G skip contextual rows', async f => {
    f.collectionTree.focus(); f.cv._filter = 'child'; f.cv.selection.focused = 2;
    f.key('2'); f.key('j'); await settle(); assert.equal(f.cv.selection.focused, 6);
    f.key('k'); await settle(); assert.equal(f.cv.selection.focused, 4);
    f.key('g'); f.key('g'); await settle(); assert.equal(f.cv.selection.focused, 2);
    f.key('G'); await settle(); assert.equal(f.cv.selection.focused, 6);
  });
  await test('unfiltered navigation retains regular item and collection movement', f => {
    f.collectionTree.focus(); f.key('j'); assert.equal(f.cv.selection.focused, 1);
    f.itemTree.focus(); f.key('j'); assert.equal(f.iv.selection.focused, 1);
  });
  await test('native mode menu retains Enter, Escape and J/K', f => {
    f.itemSearch.inputField.focus();
    f.host._searchModePopup = { state: 'open' };
    for (const key of ['Enter', 'Escape', 'J', 'K']) {
      assert.equal(!!f.key(key).defaultPrevented, false);
    }
    assert.equal(f.searches.length, 0);
  });
  await test('IME confirmation and modified keys stay native', f => {
    f.itemTree.focus(); f.key('/'); f.type('中文');
    assert.equal(!!f.key('Enter', { isComposing: true }).defaultPrevented, false);
    assert.equal(!!f.key('Escape', { keyCode: 229 }).defaultPrevented, false);
    assert.equal(!!f.key('l', { ctrlKey: true, altKey: true }).defaultPrevented, false);
    assert.equal(f.host.radioValue, 'fields'); assert.equal(f.searches.length, 0);
  });
  await test('non-search inputs keep slash typing and original Escape behavior', f => {
    const input = f.element('input'); input.blur = () => f.doc.body.focus();
    f.doc.body.appendChild(input); input.focus();
    assert.equal(!!f.key('/').defaultPrevented, false);
    f.key('Escape'); assert.equal(f.doc.activeElement, f.doc.body);
  });
  await test('Escape supersedes pending Enter without restoring stale focus', async f => {
    let resolve;
    f.win.ZoteroPane.search = () => new Promise(done => { resolve = done; });
    f.itemTree.focus(); f.key('/'); f.type('old'); f.key('Enter');
    const old = resolve;
    f.key('Escape'); resolve(); await settle();
    assert.equal(f.doc.activeElement, f.itemTree);
    f.collectionTree.focus(); old(); await settle();
    assert.equal(f.doc.activeElement, f.collectionTree);
  });
  await test('collection selection completion does not refocus after a tab change', async f => {
    let resolve;
    f.cv.selectByID = () => new Promise(done => { resolve = done; });
    f.collectionTree.focus(); f.key('/'); f.type('child'); f.key('Enter'); await settle();
    f.win.Zotero_Tabs.selectedID = 'reader';
    f.itemTree.focus(); resolve(true); await settle();
    assert.equal(f.doc.activeElement, f.itemTree);
  });
  for (const change of ['focus', 'tab', 'view', 'shutdown']) {
    await test('pending search does not steal focus after ' + change, async f => {
      let resolve;
      f.win.ZoteroPane.search = () => new Promise(done => { resolve = done; });
      f.itemTree.focus(); f.key('/'); f.key('Enter');
      if (change === 'focus') f.collectionTree.focus();
      if (change === 'tab') f.win.Zotero_Tabs.selectedID = 'reader';
      if (change === 'view') f.win.ZoteroPane.itemsView = {};
      if (change === 'shutdown') f.z._cancelLibrarySearch(f.state);
      const active = f.doc.activeElement; resolve(); await settle();
      assert.equal(f.doc.activeElement, active);
    });
  }
  await test('older collection UI falls back to searchable collapsed descendants', async f => {
    f.ids.delete('zotero-collections-search');
    f.collectionTree.focus(); f.key('/'); await settle();
    for (const fn of f.timers.values()) fn(); f.timers.clear();
    assert.equal(f.state._pickerScope, 'collections');
    assert.equal(f.state._pickerItems.length, 4);
    const child = f.state._pickerItems.find(item => item.id === 'C2');
    assert.equal(child.path, 'My library / Parent');
    f.state._pickerInput.value = 'collapsed'; f.state._pickerInput.emit('input');
    assert.equal(f.state._pickerFiltered.length, 1);
    await f.z._pickerSelectItem(f.win, f.state);
    assert.equal(f.cv.selectedID, 'C2');
    assert.equal(f.doc.activeElement, f.collectionTree);
  });
  await test('Space / and reader / retain separate bindings', f => {
    assert.equal(f.z.getBindings()['main: /'], 'showShortcutHelp');
    assert.equal(f.z.getBindings()['normal:/'], 'openSearch');
    assert.equal(f.z.getBindings()['main:/'], 'mainSearch');
  });
  console.log('Library search: ' + cases + ' checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

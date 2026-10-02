/* global require, __dirname, console */
// Check real preference-table edits, persistence and runtime binding semantics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const values = new Map();
let failSave = false;
const prefs = {
  getPrefType(key) {
    if (!values.has(key)) return 0;
    return typeof values.get(key) === 'boolean' ? 128 : 32;
  },
  getStringPref: key => values.get(key),
  getBoolPref: key => values.get(key),
  setStringPref(key, value) {
    if (failSave) throw new Error('Simulated save failure');
    values.set(key, value);
  },
  setBoolPref: (key, value) => values.set(key, value),
};

// A small table DOM: use the real row/render/validation/event code in prefs.js.
function element(tag) {
  return {
    tag, children: [], dataset: {}, style: {}, attributes: {}, listeners: {}, textContent: '',
    get value() {
      return this._value ?? (this.tag === 'select'
        ? (this.children.find(c => c.selected) || this.children[0])?.value || '' : '');
    },
    set value(value) { this._value = value; },
    set innerHTML(value) { if (value === '') this.children = []; },
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    remove() { this.parentNode.children = this.parentNode.children.filter(c => c !== this); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelectorAll(selector) {
      const descendants = this.children.flatMap(c => [c, ...c.querySelectorAll('*')]);
      return selector === '*' ? descendants : descendants.filter(c => c.tag === selector
        || selector.startsWith('.') && String(c.className || '').split(/\s+/)
          .includes(selector.slice(1)));
    },
    querySelector(selector) {
      return selector === 'td:first-child' ? this.children[0] : this.querySelectorAll(selector)[0];
    },
  };
}
const ids = Object.fromEntries([
  ['zv-bindings-body', 'tbody'], ['zv-bindings-status', 'div'], ['zv-cursor-enabled', 'checkbox'],
  ['zv-scroll-step', 'input'], ['zv-language', 'select'], ['zv-save', 'button'],
  ['zv-save-status', 'span'], ['zv-reset-bindings', 'button'],
].map(([id, tag]) => [id, element(tag)]));
const doc = {
  createElement: element,
  getElementById: id => ids[id] || null,
  querySelectorAll: () => [],
};
const context = vm.createContext({
  document: doc, window: { setTimeout() {} }, setTimeout() {}, clearTimeout() {}, dump() {},
  Zotero: { debug() {} }, Services: { prefs },
  Components: { classes: { '@mozilla.org/preferences-service;1': { getService: () => prefs } },
    interfaces: { nsIPrefBranch: {} } },
});
for (const name of ['zoteroVim.js', 'zoteroVimReader.js', 'i18n.js', 'prefs.js']) {
  const source = fs.readFileSync(path.join(root, 'content', name), 'utf8');
  vm.runInContext(name === 'prefs.js' ? source.replace(/\n\/\/ Boot[\s\S]*$/, '') : source, context);
}
const z = context.ZoteroVim;
const prefix = z.PREF_PREFIX + '.';
const saved = () => values.get(prefix + 'bindings') || '';
const rows = () => ids['zv-bindings-body'].children;
const find = (mode, key) => rows().find(row => row.dataset.mode === mode
  && row.querySelector('input').value === key);
const plain = value => JSON.parse(JSON.stringify(value));
let pass = 0;
function check(label, fn) { fn(); pass++; console.log('  ok  ' + label); }

context._zvInit();
check('default table validates; resetting saves no redundant overrides', () => {
  assert.deepEqual(plain(context._zvReadTable()), plain(z.DEFAULT_BINDINGS));
  assert.equal(context._zvSaveBindings(), true);
  assert.equal(saved(), '');
});

check('remapping a default tombstones its old key, surviving table/runtime reload', () => {
  find('normal', 'j').querySelector('input').value = 'x';
  assert.equal(context._zvSaveBindings(), true);
  assert.deepEqual(JSON.parse(saved()), { 'normal:j': null, 'normal:x': 'scrollDown' });
  const effective = z.getBindings();
  assert.equal(effective['normal:j'], undefined);
  assert.equal(effective['normal:x'], 'scrollDown');
  context._zvRenderTable(context._zvLoadBindings());
  assert.equal(find('normal', 'j'), undefined);
  assert.equal(find('normal', 'x').querySelector('select').value, 'scrollDown');
  assert.deepEqual(plain(context._zvReadTable()), plain(effective));
});

check('deleting defaults and custom bindings really unbinds; reset restores defaults', () => {
  find('normal', 'x').querySelector('button').listeners.click();
  find('normal', 'k').querySelector('button').listeners.click();
  assert.equal(context._zvSaveBindings(), true);
  assert.equal(z.getBindings()['normal:k'], undefined);
  assert.equal(z.getBindings()['normal:x'], undefined);
  assert.deepEqual(JSON.parse(saved()), { 'normal:j': null, 'normal:k': null });
  ids['zv-reset-bindings'].listeners.click();
  assert.equal(saved(), '');
  assert.deepEqual(plain(z.getBindings()), plain(z.DEFAULT_BINDINGS));
});

check('duplicate rows are both marked and Apply cannot overwrite working bindings', () => {
  const old = saved();
  const j = find('normal', 'j');
  const k = find('normal', 'k');
  k.querySelector('input').value = 'j';
  k.querySelector('input').listeners.input();
  for (const row of [j, k]) {
    assert.equal(row.querySelector('input').attributes['aria-invalid'], 'true');
    assert.match(row.querySelector('.zv-binding-error').textContent, /repeated/);
  }
  assert.equal(context._zvSaveBindings(), false);
  ids['zv-save'].listeners.click();
  assert.equal(ids['zv-save-status'].textContent, '');
  assert.equal(saved(), old);
  assert.match(ids['zv-bindings-status'].textContent, /not applied/);
  // A language switch must not collapse these duplicate, unsaved rows.
  const count = rows().length;
  ids['zv-language'].value = 'zh-CN';
  ids['zv-language'].listeners.command();
  assert.equal(rows().length, count);
  assert.equal(k.querySelector('input').value, 'j');
  assert.match(k.querySelector('.zv-binding-error').textContent, /重复/);
  k.querySelector('input').value = 'k';
  assert.notEqual(context._zvReadTable(), null);
});

check('case, modes and leader notation stay distinct; invalid keys are rejected', () => {
  for (const key of ['G', 'gg', 'Za', ' ff', 'ctrl+f', 'ctrl+alt+f', 'alt+arrowleft',
    'ctrl++', 'ctrl+junk', 'ctrl+ ', '0', 't1', '😀']) {
    assert.equal(context._zvBindingKeyError('normal', key), '', key);
  }
  for (const key of ['', 'shift+j', 'Ctrl+f', 'meta+j', 'alt+ctrl+j', 'ctrl+',
    'ctrl+shift+j', 'g g', ' ff ', '<Space>ff', '<escape>', 'Control', 'space']) {
    assert.notEqual(context._zvBindingKeyError('normal', key), '', key);
  }
  assert.notEqual(context._zvBindingKeyError('normal', '3j'), '');
  assert.notEqual(context._zvBindingKeyError('cursor', '2'), '');
  assert.equal(context._zvBindingKeyError('visual', '2'), '');
  assert.equal(context._zvBindingKeyError('insert', 'ctrl+o'), '');
  assert.notEqual(context._zvBindingKeyError('insert', 'jj'), '');
  assert.equal(context._zvKeyFromDisplay('<space>ff'), ' ff');
  assert.equal(context._zvKeyFromDisplay('ctrl+<space>'), 'ctrl+ ');
  assert.equal(context._zvKeyToDisplay('ctrl+ '), 'ctrl+<space>');
  assert.equal(find('normal', 'G').querySelector('input').value, 'G');
  assert.ok(find('normal', 'j') && find('visual', 'j'));
  const original = find('normal', 'j').querySelector('input');
  const old = saved();
  for (const key of ['', 'shift+j', '3j']) {
    original.value = key;
    assert.equal(context._zvSaveBindings(), false);
    assert.equal(saved(), old);
  }
  original.value = 'j';
});

check('legacy maps, new defaults, tombstones and malformed stored data load consistently', () => {
  for (const raw of [JSON.stringify({ 'normal:x': 'scrollDown' }),
    JSON.stringify({ 'normal:j': null, 'normal:x': 'scrollDown' }),
    '{bad json', 'null', '[]', '42', JSON.stringify({ 'normal:j': false, 'normal:k': '' })]) {
    values.set(prefix + 'bindings', raw);
    assert.deepEqual(plain(context._zvLoadBindings()), plain(z.getBindings()), raw);
    assert.equal(z.getBindings()['normal:ctrl+o'], 'navigateBack');
    assert.equal(z.getBindings()['normal:ctrl+i'], 'navigateForward');
  }
  const legacy = { ...plain(z.DEFAULT_BINDINGS), 'normal:j': 'scrollUp' };
  delete legacy['normal:ctrl+o']; delete legacy['normal:ctrl+i'];
  values.set(prefix + 'bindings', JSON.stringify(legacy));
  assert.equal(z.getBindings()['normal:j'], 'scrollUp');
  assert.equal(z.getBindings()['normal:ctrl+o'], 'navigateBack');
  values.set(prefix + 'bindings', '');
  context._zvRenderTable(context._zvLoadBindings());
});

check('a failed preference write is reported, not falsely treated as saved', () => {
  failSave = true;
  assert.equal(context._zvSaveBindings(), false);
  assert.match(ids['zv-bindings-status'].textContent, /保存绑定失败/);
  failSave = false;
});

check('Cursor checkbox toggles the runtime gate live and preserves Visual settings', () => {
  const checkbox = ids['zv-cursor-enabled'];
  assert.equal(checkbox.checked, true);
  let entered = 0;
  z._enterCursorMode = () => { entered++; };
  z._handleReaderSidebarAction = () => false;
  checkbox.checked = false; checkbox.listeners.command();
  assert.equal(values.get(prefix + 'mode.cursor.enabled'), false);
  z._executeAction('enterCursor', {}, {}, {});
  assert.equal(entered, 0);
  assert.equal(z.isModeEnabled('visual'), true);
  checkbox.checked = true; checkbox.listeners.command();
  z._executeAction('enterCursor', {}, {}, {});
  assert.equal(entered, 1);
});

check('unbound letters are not consumed merely because modifier bindings share a prefix', () => {
  values.set(prefix + 'bindings', JSON.stringify({ 'normal:c': null }));
  assert.equal(z._readerConsumesKey({ mode: 'normal' }, 'c'), false);
  assert.equal(z._readerConsumesKey({ mode: 'normal' }, 'ctrl+o'), true);
  assert.equal(z._readerConsumesKey({ mode: 'normal' }, 'g'), true);
});

console.log('Binding preference checks passed (' + pass + ' cases).');

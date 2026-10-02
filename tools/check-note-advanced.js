/* global require, __dirname, console */
// Exercise note motions, search, Visual selections and text objects without Zotero.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let copied = '';
let tabActions = 0;
const context = vm.createContext({
  Zotero: { debug() {} },
  Components: {
    classes: { '@mozilla.org/widget/clipboardhelper;1': {
      getService: () => ({ copyString(text) { copied = text; } }),
    } },
    interfaces: { nsIClipboardHelper: {} },
    utils: { cloneInto: value => value },
  },
  setTimeout: () => 1, clearTimeout() {},
});
const root = path.join(__dirname, '..');
for (const name of ['zoteroVim.js', 'zoteroVimMain.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
}
const z = context.ZoteroVim;
z.isNoteEditorVimEnabled = () => true;
z._syncNoteCursorVisualState = () => {};
z._mainShowStatus = () => {};
z._executeMainAction = () => { tabActions++; };

function fixture(text, caret = 0) {
  const doc = { defaultView: { Event: function(type) { this.type = type; } } };
  doc.createElement = tag => ({
    nodeType: 1, tagName: tag.toUpperCase(), ownerDocument: doc,
    style: {}, value: '', children: [], listeners: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(el) { this.children.push(el); el.parentNode = this; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type) { delete this.listeners[type]; },
    remove() { this.parentNode.children = this.parentNode.children.filter(el => el !== this); },
    focus() { doc.activeElement = this; },
  });
  doc.body = doc.createElement('body');
  const el = doc.createElement('textarea');
  el.value = text;
  el.selectionStart = el.selectionEnd = caret;
  el.setSelectionRange = function(from, to, direction) {
    this.selectionStart = from; this.selectionEnd = to; this.selectionDirection = direction;
  };
  el.setRangeText = function(value, from, to) {
    this.value = this.value.slice(0, from) + value + this.value.slice(to);
    this.setSelectionRange(from + value.length, from + value.length);
  };
  el.dispatchEvent = () => true;
  doc.activeElement = el;
  const state = { _contextNoteMode: 'normal' };
  const key = (value, options = {}) => {
    const event = { key: value, target: doc.activeElement || el, ...options,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    z._onMainContextNoteKeyDown(event, {}, state);
    return event;
  };
  const send = keys => { for (const value of keys) key(value); };
  const search = (pattern, direction = '/', confirm = true) => {
    key(direction);
    const input = state._contextNoteSearchUI.input;
    input.value = pattern;
    input.listeners.input();
    if (confirm) key('Enter');
  };
  return { el, doc, state, key, send, search,
    selected: () => el.value.slice(el.selectionStart, el.selectionEnd) };
}

let pass = 0;
function check(label, fn) { fn(); pass++; console.log('  ok  ' + label); }

check('f/F/t/T locate the counted character on the current line', () => {
  for (const [keys, caret, expected] of [
    ['2fx', 0, 4], ['2tx', 0, 3], ['2Fx', 8, 4], ['2Tx', 8, 5],
  ]) {
    const f = fixture('ax bx cx end', caret);
    f.send(keys);
    assert.equal(f.el.selectionStart, expected, keys);
  }
});

check('find arguments include digits, spaces, uppercase and emoji', () => {
  for (const [keys, text, expected] of [
    ['f2', 'a12', 2], ['f ', 'a b', 1], ['fK', 'aK', 1], ['f😀', 'a😀z', 1],
  ]) {
    const f = fixture(text);
    f.send(keys);
    assert.equal(f.el.selectionStart, expected, keys);
    assert.equal(f.el.value, text);
  }
  assert.equal(tabActions, 0);
});

check('failed finds and line boundaries leave the caret/document unchanged', () => {
  const f = fixture('one\nx end', 1);
  f.send('fx');
  assert.equal(f.el.selectionStart, 1);
  f.send('dfx');
  assert.equal(f.el.value, 'one\nx end');
  f.key('f'); f.key('Escape'); f.key('x');
  assert.equal(f.el.value, 'oe\nx end');
});

check('counts and pending note commands never expire into a different destructive command', () => {
  const timer = context.setTimeout;
  let scheduled = 0;
  context.setTimeout = () => { scheduled++; return 1; };
  try {
    const f = fixture('ax bx cx'); f.send('2df');
    assert.equal(scheduled, 0); assert.equal(f.state._contextNoteKeyBuffer, 'df');
    f.send('x'); assert.equal(f.el.value, ' cx');
  } finally { context.setTimeout = timer; }
});

check('semicolon repeats and comma reverses without changing the remembered direction', () => {
  const f = fixture('ax bx cx dx');
  f.send('fx;'); assert.equal(f.el.selectionStart, 4);
  f.send(','); assert.equal(f.el.selectionStart, 1);
  f.send(';'); assert.equal(f.el.selectionStart, 4);
  f.send('2;'); assert.equal(f.el.selectionStart, 10);
});

check('till repeats skip their adjacent old target instead of getting stuck', () => {
  const f = fixture('ax bx cx dx');
  f.send('tx;'); assert.equal(f.el.selectionStart, 3);
  f.send(';'); assert.equal(f.el.selectionStart, 6);
  f.send(','); assert.equal(f.el.selectionStart, 5);
  f.send(';'); assert.equal(f.el.selectionStart, 6);
  const backwards = fixture('ax bx cx dx', 11);
  backwards.send('Tx;'); assert.equal(backwards.el.selectionStart, 8);
});

check('forward find operators are inclusive, backward find operators exclusive', () => {
  for (const [command, caret, expected] of [
    ['dfx', 0, ' bx cx'], ['dtx', 0, 'x bx cx'],
    ['dFx', 7, 'ax bx'], ['dTx', 7, 'ax bxx'],
  ]) {
    const f = fixture('ax bx cx', caret);
    f.send(command);
    assert.equal(f.el.value, expected, command);
  }
});

check('operator counts multiply for finds and repeats; c enters Insert, y copies', () => {
  const f = fixture('ax bx cx dx ex');
  f.send('2d2fx'); assert.equal(f.el.value, ' ex');
  const y = fixture('a😀b'); y.send('yf😀'); assert.equal(copied, 'a😀');
  const c = fixture('ab:x'); c.send('ct:');
  assert.equal(c.el.value, ':x'); assert.equal(c.state._contextNoteMode, 'insert');
  const repeat = fixture('ax bx cx'); repeat.send('fxd;');
  assert.equal(repeat.el.value, 'a cx');
});

check('percent finds the next bracket on this line and handles nested multi-line pairs', () => {
  const f = fixture('call({a: [1,2]})\nlast');
  f.send('%'); assert.equal(f.el.selectionStart, 15);
  f.send('%'); assert.equal(f.el.selectionStart, 4);
  const multi = fixture('(one\n(two)\nend)', 0);
  multi.send('%'); assert.equal(multi.el.selectionStart, 14);
  const line = fixture('no pair\n(x)'); line.send('%'); assert.equal(line.el.selectionStart, 0);
});

check('d% includes both endpoints in either direction and ignores string brackets', () => {
  for (const caret of [0, 8]) {
    const f = fixture('(a "[" b) tail', caret);
    f.send('d%'); assert.equal(f.el.value, ' tail');
  }
  const f = fixture('(a \\) b) tail');
  f.send('%'); assert.equal(f.el.selectionStart, 7);
});

check('numbered percent moves by document percentage; out-of-range percentages do nothing', () => {
  const f = fixture('a\nb\nc\nd'); f.send('50%'); assert.equal(f.el.selectionStart, 2);
  f.send('101%'); assert.equal(f.el.selectionStart, 2);
});

check('inner/around word and WORD objects distinguish punctuation and surrounding spaces', () => {
  for (const [keys, expected] of [
    ['yiw', 'hello'], ['yaw', 'hello'], ['yiW', 'hello-world'], ['yaW', 'hello-world '],
    ['2yiw', 'hello-'], ['2yaw', 'hello-'],
  ]) {
    const f = fixture('hello-world next', 2); f.send(keys); assert.equal(copied, expected, keys);
  }
  const f = fixture('one two three'); f.send('2yaw'); assert.equal(copied, 'one two ');
  const blank = fixture('one   two', 4); blank.send('yiw'); assert.equal(copied, '   ');
  const last = fixture('one two', 5); last.send('daw'); assert.equal(last.el.value, 'one');
});

check('quote objects support escaped quotes, all three quote types and adjacent whitespace', () => {
  for (const quote of ['"', "'", '`']) {
    const f = fixture('say ' + quote + 'a\\' + quote + 'b' + quote + ' end', 6);
    f.send('yi' + quote); assert.equal(copied, 'a\\' + quote + 'b');
    f.send('da' + quote); assert.equal(f.el.value, 'say end');
  }
  const before = fixture('say "word"', 0); before.send('yi"'); assert.equal(copied, 'word');
  const missing = fixture('say "open\nclosed"'); missing.send('di"');
  assert.equal(missing.el.value, 'say "open\nclosed"');
});

check('bracket objects, closing-key aliases and counted nesting share exclusive ranges', () => {
  for (const type of ['(', ')', 'b']) {
    const f = fixture('(one (two) end)', 7);
    f.send('yi' + type); assert.equal(copied, 'two');
    f.send('2yi' + type); assert.equal(copied, 'one (two) end');
  }
  for (const [open, close, alias] of [['[', ']', ']'], ['{', '}', 'B'], ['<', '>', '>']]) {
    const f = fixture(open + 'word' + close, 2);
    f.send('da' + alias); assert.equal(f.el.value, '');
  }
  const next = fixture('call(word)'); next.send('yi('); assert.equal(copied, 'word');
});

check('empty inner objects are valid for c but d never removes an adjacent character', () => {
  const f = fixture('() tail'); f.send('di('); assert.equal(f.el.value, '() tail');
  f.send('ci('); assert.equal(f.el.value, '() tail');
  assert.equal(f.el.selectionStart, 1); assert.equal(f.state._contextNoteMode, 'insert');
});

check('tag objects support nested same-name tags, quoted > attributes and self-closing tags', () => {
  const text = '<b title=">">one <b>two</b><br/> end</b> tail';
  const f = fixture(text, text.indexOf('two'));
  f.send('yit'); assert.equal(copied, 'two');
  f.send('2yit'); assert.equal(copied, 'one <b>two</b><br/> end');
  const a = fixture(text, text.indexOf('two')); a.send('dat');
  assert.equal(a.el.value, '<b title=">">one <br/> end</b> tail');
});

check('sentence objects include English/Chinese punctuation and counted following sentences', () => {
  const f = fixture('One.  Two! Three?', 1); f.send('yis'); assert.equal(copied, 'One.');
  f.send('2yas'); assert.equal(copied, 'One.  Two! ');
  const chinese = fixture('第一句。第二句！最后一句', 1);
  chinese.send('dis'); assert.equal(chinese.el.value, '第二句！最后一句');
  const paragraphs = fixture('No punctuation\n\nAnother paragraph');
  paragraphs.send('yis'); assert.equal(copied, 'No punctuation');
});

check('sentence objects stop at native paragraph boundaries, even without punctuation', () => {
  const range = z._noteTextObjectRange({ text: 'first\nsecond', caret: 0,
    blocks: [{ start: 0, end: 5 }, { start: 6, end: 12 }] }, 'is');
  assert.equal(range.to, 5);
});

check('combining marks stay part of Unicode words and whole-word searches', () => {
  const f = fixture('e\u0301 e\u0301clair e\u0301'); f.send('yiw'); assert.equal(copied, 'e\u0301');
  f.send('*'); assert.equal(f.el.selectionStart, 11);
});

check('literal tag objects ignore unclosed HTML void elements', () => {
  const f = fixture('<div>one<br>two<img src="x"></div>', 6);
  f.send('yit'); assert.equal(copied, 'one<br>two<img src="x">');
});

check('read-only fallback controls permit selection but refuse mutations', () => {
  const f = fixture('one two'); f.el.readOnly = true;
  for (const keys of ['diw', 'v2ld', 'O']) { f.send(keys); f.key('Escape'); }
  assert.equal(f.el.value, 'one two'); assert.equal(f.state._contextNoteMode, 'normal');
});

check('plain-text paragraphs span nonblank lines; ap includes adjacent blank lines', () => {
  const f = fixture('one\ncontinued\n\ntwo\n\nthree', 5);
  f.send('yip'); assert.equal(copied, 'one\ncontinued\n');
  f.send('dap'); assert.equal(f.el.value, 'two\n\nthree');
  const count = fixture('one\n\ntwo\n\nthree'); count.send('2dip');
  assert.equal(count.el.value, '\nthree');
});

check('v selects characters inclusively; reverse selection and o retain the moving edge', () => {
  const f = fixture('abcdef', 3); f.send('v2h');
  assert.equal(f.selected(), 'bcd'); assert.equal(f.el.selectionDirection, 'backward');
  f.send('o'); assert.equal(f.el.selectionDirection, 'forward');
  f.send('l'); assert.equal(f.selected(), 'bcde');
  f.key('Escape'); assert.equal(f.el.selectionStart, 4);
  assert.equal(f.state._contextNoteMode, 'normal');
});

check('Visual selection never splits an emoji, including at line end', () => {
  const f = fixture('a😀b'); f.send('vl'); assert.equal(f.selected(), 'a😀');
  f.send('$'); assert.equal(f.selected(), 'a😀b');
  f.send('h'); assert.equal(f.selected(), 'a😀');
  f.send('y'); assert.equal(copied, 'a😀');
});

check('Visual arrows extend/reverse selections and linewise arrows select lines', () => {
  const f = fixture('abc\ndef\nghi', 1); f.send('v');
  for (const [arrow, expected] of [
    ['ArrowDown', 'bc\nde'], ['ArrowRight', 'bc\ndef'],
    ['ArrowUp', 'bc'], ['ArrowLeft', 'b'],
  ]) {
    f.key(arrow); assert.equal(f.selected(), expected, arrow);
    assert.equal(f.state._contextNoteMode, 'visual');
  }
  f.key('ArrowLeft'); assert.equal(f.selected(), 'ab');
  assert.equal(f.el.selectionDirection, 'backward');
  const lines = fixture('one\ntwo\nthree'); lines.send('V'); lines.key('ArrowDown');
  assert.equal(lines.selected(), 'one\ntwo\n');
  assert.equal(lines.state._contextNoteMode, 'visual-line');
});

check('arrows cancel pending character finds instead of becoming h/j/k/l arguments', () => {
  for (const command of ['f', 'df', 'vf']) {
    const f = fixture('abc l end'); f.send(command); f.key('ArrowRight');
    assert.equal(f.el.selectionStart, 0, command);
    assert.equal(f.el.value, 'abc l end');
    assert.equal(f.state._contextNoteKeyBuffer, '');
    assert.equal(f.state._contextNoteLastFind, undefined);
  }
});

check('V operates on whole logical lines, including empty/last lines', () => {
  const f = fixture('one\n\nthree', 1); f.send('Vjd');
  assert.equal(f.el.value, 'three'); assert.equal(f.state._contextNoteRegisterType, 'line');
  const last = fixture('one\ntwo', 5); last.send('Vd'); assert.equal(last.el.value, 'one');
});

check('Visual mode can switch between v/V; unsupported J/K never switch tabs', () => {
  const f = fixture('one\ntwo'); f.send('vV');
  assert.equal(f.state._contextNoteMode, 'visual-line');
  f.send('JK'); assert.equal(tabActions, 0);
  f.send('v'); assert.equal(f.state._contextNoteMode, 'visual');
  f.send('v'); assert.equal(f.state._contextNoteMode, 'normal');
});

check('Visual c deletes the selected range and enters Insert; y leaves text unchanged', () => {
  const c = fixture('hello world'); c.send('v4lc');
  assert.equal(c.el.value, ' world'); assert.equal(c.state._contextNoteMode, 'insert');
  const y = fixture('hello'); y.send('v2ly');
  assert.equal(copied, 'hel'); assert.equal(y.el.value, 'hello');
  assert.equal(y.state._contextNoteMode, 'normal');
});

check('Visual motions include finds, repeat, %, G/gg and big-word ends', () => {
  const f = fixture('(one) tail'); f.send('v%'); assert.equal(f.selected(), '(one)');
  const find = fixture('ax bx cx'); find.send('vfx;'); assert.equal(find.selected(), 'ax bx');
  const lines = fixture('one\ntwo\nthree'); lines.send('vG'); assert.equal(lines.selected(), 'one\ntwo\nt');
  lines.send('2gg'); assert.equal(lines.selected(), 'one\nt');
  const big = fixture('abc-def rest'); big.send('vE'); assert.equal(big.selected(), 'abc-def');
});

check('invalid Visual find arguments do not overwrite the last successful character find', () => {
  const f = fixture('ax bx'); f.send('fxv'); f.key('f'); f.key('ArrowRight');
  assert.equal(f.state._contextNoteLastFind.char, 'x');
  f.send(';'); assert.equal(f.selected(), 'x bx');
});

check('Visual text objects and repeat nesting expand without deleting anything', () => {
  const f = fixture('(one (two) end)', 7); f.send('vi('); assert.equal(f.selected(), 'two');
  f.send('i('); assert.equal(f.selected(), 'one (two) end');
  f.send('y'); assert.equal(copied, 'one (two) end');
  const empty = fixture('()'); empty.send('vi(c');
  assert.equal(empty.el.value, '()'); assert.equal(empty.state._contextNoteMode, 'insert');
});

check('gv restores the last unchanged selection but refuses stale offsets after an edit', () => {
  const f = fixture('hello'); f.send('v2l'); f.key('Escape'); f.send('gvy');
  assert.equal(copied, 'hel');
  f.send('xgv'); assert.equal(f.state._contextNoteMode, 'normal');
});

check('Visual external document changes safely exit instead of using stale offsets', () => {
  const f = fixture('hello'); f.send('v2l'); f.el.value = 'new'; f.send('d');
  assert.equal(f.el.value, 'new'); assert.equal(f.state._contextNoteMode, 'normal');
});

check('literal search finds Chinese and punctuation, previews without stealing input focus', () => {
  const f = fixture('中文 a.b 中文 a.b'); f.search('a.b', '/', false);
  const ui = f.state._contextNoteSearchUI;
  assert.equal(f.selected(), 'a.b'); assert.equal(f.doc.activeElement, ui.input);
  assert.equal(ui.status.textContent, '1/2');
  assert.equal(f.el.value, '中文 a.b 中文 a.b');
  f.key('Enter'); assert.equal(f.el.selectionStart, 3);
  assert.equal(f.state._contextNoteSearchUI, null); assert.equal(f.doc.body.children.length, 0);
  f.search('中文'); assert.equal(f.el.selectionStart, 7);
});

check('opening search does not run normal caret synchronisation and steal input focus', () => {
  const sync = z._syncNoteCursorVisualState;
  z._syncNoteCursorVisualState = (_doc, _mode, editable) => editable?.focus();
  try {
    const f = fixture('one two'); f.key('/');
    assert.equal(f.doc.activeElement, f.state._contextNoteSearchUI.input);
  } finally { z._syncNoteCursorVisualState = sync; }
});

check('n/N/counts repeat searches with wraparound without changing remembered direction', () => {
  const f = fixture('x a x a x'); f.search('x'); assert.equal(f.el.selectionStart, 4);
  f.send('n'); assert.equal(f.el.selectionStart, 8);
  f.send('n'); assert.equal(f.el.selectionStart, 0);
  f.send('N'); assert.equal(f.el.selectionStart, 8);
  f.send('2n'); assert.equal(f.el.selectionStart, 4);
  const back = fixture('x a x a x', 8); back.search('x', '?');
  assert.equal(back.el.selectionStart, 4); back.send('n'); assert.equal(back.el.selectionStart, 0);
  back.send('N'); assert.equal(back.el.selectionStart, 4);
});

check('Escape/no match restores the original caret and previous query; empty Enter reuses query', () => {
  const f = fixture('one two one'); f.search('one'); const before = f.el.selectionStart;
  f.search('two', '/', false); f.key('Escape'); assert.equal(f.el.selectionStart, before);
  assert.equal(f.state._contextNoteSearch.pattern, 'one');
  f.search('missing'); assert.equal(f.el.selectionStart, before);
  assert.equal(f.state._contextNoteSearch.pattern, 'one');
  f.search(''); assert.equal(f.el.selectionStart, 0);
});

check('search typing/Backspace/modifiers and composing Enter stay native; blur cancels', () => {
  const f = fixture('中文 中文'); f.search('中文', '/', false);
  for (const [key, options] of [['Backspace', {}], ['a', { ctrlKey: true }],
    ['Enter', { isComposing: true }], ['Escape', { isComposing: true }]]) {
    assert.equal(f.key(key, options).prevented, undefined);
  }
  const ui = f.state._contextNoteSearchUI; ui.input.listeners.blur();
  assert.equal(f.state._contextNoteSearchUI, null); assert.equal(f.el.selectionStart, 0);
});

check('star/hash search whole Unicode words, not substrings, and update n/N memory', () => {
  const f = fixture('word wording word'); f.send('*'); assert.equal(f.el.selectionStart, 13);
  f.send('n'); assert.equal(f.el.selectionStart, 0);
  f.send('#'); assert.equal(f.el.selectionStart, 13);
  const chinese = fixture('你好 你好吗 你好'); chinese.send('*');
  assert.equal(chinese.el.selectionStart, 7);
  const emoji = fixture('😀 a 😀'); emoji.send('*'); assert.equal(emoji.el.selectionStart, 5);
});

check('search repeats work as operator motions; Visual search extends or restores the selection', () => {
  const f = fixture('one two one'); f.search('one'); f.send('0dn');
  assert.equal(f.el.value, 'one');
  const visual = fixture('one two one'); visual.send('vl'); visual.search('two');
  assert.equal(visual.selected(), 'one t'); assert.equal(visual.state._contextNoteMode, 'visual');
  visual.search('one'); assert.equal(visual.selected(), 'one two o');
  const before = visual.selected(); visual.search('two', '/', false); visual.key('Escape');
  assert.equal(visual.selected(), before);
});

check('operator plus interactive search deletes/changes exclusively and respects multiplied counts', () => {
  for (const [keys, expected, mode] of [['d/', 'one one one one', 'normal'],
    ['2d2/', 'one', 'normal'], ['c/', 'one one one one', 'insert']]) {
    const f = fixture('one one one one one'); f.send(keys);
    f.state._contextNoteSearchUI.input.value = 'one'; f.key('Enter');
    assert.equal(f.el.value, expected);
    assert.equal(f.state._contextNoteMode, mode);
  }
  const cancel = fixture('one two one'); cancel.send('d/');
  cancel.state._contextNoteSearchUI.input.value = 'one'; cancel.key('Escape');
  assert.equal(cancel.el.value, 'one two one');
});

check('search cannot apply cached offsets after an external document mutation', () => {
  const f = fixture('one two one'); f.search('one', '/', false);
  f.el.value = 'new'; f.key('Enter'); assert.equal(f.el.value, 'new');
  assert.equal(f.state._contextNoteSearch, undefined);
});

check('failed read-only search operators restore editor focus after closing the search bar', () => {
  const f = fixture('one two one'); f.el.readOnly = true; f.send('d/');
  f.state._contextNoteSearchUI.input.value = 'one'; f.key('Enter');
  assert.equal(f.el.value, 'one two one'); assert.equal(f.doc.activeElement, f.el);
  assert.equal(f.el.selectionStart, 0);
});

check('preview highlights use clipped UI-only rectangles outside the managed editor', () => {
  const f = fixture('one two one');
  const node = {};
  let start;
  let end;
  f.doc.createRange = () => ({
    setStart(n, offset) { assert.equal(n, node); start = offset; },
    setEnd(n, offset) { assert.equal(n, node); end = offset; },
    getClientRects: () => [
      { left: 0, top: 0, right: 20, bottom: 20 },
      { left: 0, top: 30, right: 20, bottom: 40 },
    ],
  });
  const ui = { snapshot: { editableEl: f.el,
    points: Array.from({ length: 12 }, (_, offset) => ({ node, offset })) },
    result: { offset: 8, length: 3 }, highlight: f.doc.createElement('div') };
  const viewport = z._noteLineNumberViewport;
  z._noteLineNumberViewport = () => ({ left: 5, top: 5, right: 15, bottom: 15 });
  try {
    z._notePaintSearchHighlight(ui);
    assert.equal(start, 8); assert.equal(end, 11);
    assert.equal(ui.highlight.children.length, 1);
    assert.match(ui.highlight.children[0].style.cssText, /left:5px;top:5px;width:10px;height:10px/);
    assert.equal(f.doc.body.children.length, 0);
    assert.equal(f.el.value, 'one two one');
  } finally { z._noteLineNumberViewport = viewport; }
});

check('highlight cleanup cancels pending paint and detaches viewport listeners', () => {
  const f = fixture('one two one');
  const listeners = new Map();
  let callback;
  let cancelled;
  f.doc.defaultView.addEventListener = (type, fn) => listeners.set(type, fn);
  f.doc.defaultView.removeEventListener = type => listeners.delete(type);
  f.doc.defaultView.requestAnimationFrame = fn => { callback = fn; return 123; };
  f.doc.defaultView.cancelAnimationFrame = id => { cancelled = id; };
  f.search('one', '/', false);
  const ui = f.state._contextNoteSearchUI;
  assert.equal(listeners.size, 2); assert.equal(ui.frame, 123);
  f.key('Escape'); assert.equal(cancelled, 123); assert.equal(listeners.size, 0);
  callback(); assert.equal(ui.disposed, true); assert.equal(f.doc.body.children.length, 0);
});

check('search preview uses the native head while its input owns focus, not the stale DOM caret', () => {
  const f = fixture('one two one');
  const ctx = { view: { state: { selection: { head: 9 } }, dom: { contains: () => false } } };
  const snapshot = { editableEl: f.el, ctx, points: Array.from({ length: 12 }, (_, i) => i + 1) };
  f.doc.activeElement = f.doc.createElement('input');
  f.doc.getSelection = () => ({ rangeCount: 1, anchorNode: f.el, anchorOffset: 0 });
  assert.equal(z._noteNativeCaretOffset(snapshot), 8);
});

check('line-number highlighting follows the inclusive Visual head, not the next-line selection boundary', () => {
  const model = { starts: [0, 4, 8] };
  assert.equal(z._noteLineNumberCurrent(model, 2), 1);
  assert.equal(z._noteLineNumberCurrent(model, 5), 2);
});

check('cleanup removes search UI/listeners and clears per-editor Visual/find/search state', () => {
  const f = fixture('one two one'); f.send('vl'); f.search('one', '/', false);
  const ui = f.state._contextNoteSearchUI;
  z._clearMainContextNoteListener(f.state);
  assert.equal(f.doc.body.children.length, 0); assert.deepEqual(ui.input.listeners, {});
  assert.equal(f.state._contextNoteMode, 'normal'); assert.equal(f.state._contextNoteVisual, null);
  assert.equal(f.state._contextNoteSearch, null); assert.equal(f.state._contextNoteLastFind, null);
});

check('f/F/t/T show a persistent directional hint without editing or changing focus/caret', () => {
  for (const [key, text] of [['f', 'Find →'], ['F', 'Find ←'], ['t', 'Till →'], ['T', 'Till ←']]) {
    const f = fixture('ax bx', 3);
    let edits = 0;
    f.el.dispatchEvent = () => { edits++; };
    f.key(key);
    const ui = f.state._contextNotePendingUI;
    assert.equal(ui.command.textContent, key);
    assert.match(ui.description.textContent, new RegExp(text));
    assert.equal(ui.cancel.textContent, 'Esc cancel');
    assert.equal(ui.root.attributes.role, 'status');
    assert.equal(ui.root.attributes['aria-live'], 'polite');
    assert.match(ui.root.style.cssText, /pointer-events:none/);
    assert.match(ui.root.children[3].textContent, /@media print/);
    assert.equal(f.doc.activeElement, f.el); assert.equal(f.el.selectionStart, 3);
    assert.equal(f.el.selectionEnd, 3); assert.equal(f.el.value, 'ax bx'); assert.equal(edits, 0);
    assert.equal(f.el.children.length, 0); assert.equal(f.doc.body.children.length, 1);
    f.key('Escape'); assert.equal(f.doc.body.children.length, 0);
  }
});

check('operator/count hints update one pill and show the multiplied occurrence', () => {
  const f = fixture('ax bx cx dx ex fx gx'); f.key('2');
  const ui = f.state._contextNotePendingUI;
  f.send('d3f');
  assert.equal(f.state._contextNotePendingUI, ui); assert.equal(f.doc.body.children.length, 1);
  assert.equal(ui.command.textContent, '2d3f');
  assert.match(ui.description.textContent, /^Delete · Find →/);
  assert.match(ui.description.textContent, /#6$/);
  f.key('x'); assert.equal(f.doc.body.children.length, 0); assert.equal(f.el.value, ' gx');
});

check('Chinese hints follow Zotero locale and honour the explicit language preference', () => {
  const pref = z.getPref;
  const locale = context.Zotero.locale;
  context.Zotero.locale = 'zh-CN';
  try {
    const f = fixture('a x'); f.send('ct');
    assert.equal(f.state._contextNotePendingUI.description.textContent,
      '修改 · 向右停在目标前：等待字符');
    assert.equal(f.state._contextNotePendingUI.cancel.textContent, 'Esc 取消');
    f.key('Escape'); z.getPref = (key, fallback) => key === 'language' ? 'en' : fallback;
    f.key('F'); assert.match(f.state._contextNotePendingUI.description.textContent, /^Find ←/);
  } finally { z.getPref = pref; context.Zotero.locale = locale; }
});

check('Visual find/object hints preserve the existing range and clear on completion', () => {
  const f = fixture('(one) tail'); f.send('v2l'); const selected = f.selected();
  f.key('f'); assert.equal(f.selected(), selected);
  assert.equal(f.state._contextNotePendingUI.command.textContent, 'f');
  f.key(')'); assert.equal(f.state._contextNotePendingUI, null);
  assert.equal(f.selected(), '(one)'); f.key('i');
  assert.match(f.state._contextNotePendingUI.description.textContent, /^Inner object/);
  f.key('('); assert.equal(f.state._contextNotePendingUI, null); assert.equal(f.selected(), 'one');
});

check('failed/invalid finds, pane focus and Insert switching remove the hint', () => {
  const focus = z._focusReaderContent;
  z._focusReaderContent = () => true;
  try {
    for (const keys of [['f', 'z'], ['f', 'ArrowRight'], ['f', 'Escape', 'i']]) {
      const f = fixture('abc'); f.send(keys);
      assert.equal(f.state._contextNotePendingUI, null); assert.equal(f.doc.body.children.length, 0);
    }
    const f = fixture('abc'); f.key('f'); f.key('h', { ctrlKey: true });
    assert.equal(f.state._contextNotePendingUI, null);
    assert.equal(f.state._contextNoteKeyBuffer, '');
  } finally { z._focusReaderContent = focus; }
});

check('focus leaving the editor cancels pending commands and removes both focus listeners', () => {
  const f = fixture('ax bx'); const listeners = new Map();
  f.doc.defaultView.addEventListener = (type, fn) => listeners.set(type, fn);
  f.doc.defaultView.removeEventListener = type => listeners.delete(type);
  f.key('f'); f.el.listeners.focusout({ relatedTarget: f.el });
  assert.notEqual(f.state._contextNotePendingUI, null);
  f.el.listeners.focusout({ relatedTarget: f.doc.createElement('input') });
  assert.equal(f.state._contextNoteKeyBuffer, ''); assert.equal(listeners.size, 0);
  assert.equal(f.el.listeners.focusout, undefined); assert.equal(f.doc.body.children.length, 0);
  f.key('f'); listeners.get('blur')();
  assert.equal(f.state._contextNoteKeyBuffer, ''); assert.equal(listeners.size, 0);
});

check('note switching/disable cleanup and search opening remove pending-command UI', () => {
  const f = fixture('ax bx'); f.key('f');
  z._clearMainContextNoteListener(f.state); assert.equal(f.doc.body.children.length, 0);
  assert.equal(f.state._contextNotePendingUI, null);
  f.key('d'); z._noteOpenSearch(f.el, 1, {}, f.state);
  assert.equal(f.state._contextNotePendingUI, null); assert.equal(f.doc.body.children.length, 1);
  f.key('Escape'); assert.equal(f.doc.body.children.length, 0);
});

check('leader chords hide obsolete note hints and keep their own timeout behaviour', () => {
  const f = fixture('abc'); f.key('d'); f.key(' ');
  assert.equal(f.state._contextNotePendingUI, null);
  assert.equal(f.state._contextNoteMainBuffer, ' ');
  assert.equal(f.doc.body.children.length, 0);
});

check('long count rendering stays compact without truncating command state', () => {
  const f = fixture('ax bx'); const count = '9'.repeat(80);
  f.state._contextNoteCountBuffer = count; f.key('f');
  const ui = f.state._contextNotePendingUI;
  assert.ok(ui.command.textContent.length < 32); assert.equal(ui.command.title, count + 'f');
  assert.equal(f.state._contextNoteCountBuffer, count);
});

check('an unavailable hint document never prevents the buffered command from executing', () => {
  const f = fixture('ax bx'); f.doc.createElement = () => { throw new Error('closed'); };
  f.send('fx'); assert.equal(f.el.selectionStart, 1); assert.equal(f.el.value, 'ax bx');
});

console.log('Advanced note checks passed (' + pass + ' cases).');

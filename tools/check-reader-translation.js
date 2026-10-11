/* global require, __dirname, console, process */
// Translation API, popup ownership, selection restoration and shortcut isolation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const statuses = [];
const copies = [];
const clones = [];
const apiGlobal = {};
const context = vm.createContext({
  Zotero: { debug() {}, locale: 'zh-CN' },
  Components: {
    classes: { '@mozilla.org/widget/clipboardhelper;1': {
      getService: () => ({ copyString: value => copies.push(value) }),
    } },
    interfaces: { nsIClipboardHelper: {} },
    utils: {
      getGlobalForObject: () => apiGlobal,
      cloneInto(value, target) { clones.push({ value, target }); return { ...value }; },
      unwrap: value => value,
      exportFunction: fn => fn,
    },
  },
  Services: { prefs: { getPrefType: () => 0 } },
  clearTimeout() {},
});
for (const name of ['zoteroVim.js', 'zoteroVimReader.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', name), 'utf8'), context);
}
const z = context.ZoteroVim;
z.id = 'zotero-vim-plus@zotero-vim';
z._showStatus = (_state, text) => statuses.push(text);
z._updateIndicator = () => {};
z._updateVisualCursor = () => {};
z._stopSmoothHoldScroll = () => {};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function pane(raw = 'A ﬁne\n  selection') {
  const doc = {
    createElementNS(_namespace, tag) {
      return {
        localName: tag, ownerDocument: doc, children: [], attributes: {}, listeners: {},
        style: {}, textContent: '', scrollTop: 0, clientHeight: 200,
        get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; },
        appendChild(child) { child.parentNode = this; this.children.push(child); },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(key, fn) { this.listeners[key] = fn; },
        focus() { doc.activeElement = this; },
        remove() {
          this.parentNode.children = this.parentNode.children.filter(child => child !== this);
          this.parentNode = null;
        },
      };
    },
  };
  doc.body = doc.createElementNS('', 'body');
  const anchor = { isConnected: true };
  const focus = { isConnected: true };
  const selection = {
    isCollapsed: false, anchorNode: anchor, anchorOffset: 12, focusNode: focus, focusOffset: 3,
    toString: () => raw,
    setBaseAndExtent(...values) { this.restored = values; },
  };
  const pdfWin = { document: doc, getSelection: () => selection, focus() {},
    removeEventListener() {} };
  const state = { mode: 'visual', keyBuffer: '', countBuffer: '', pdfWin,
    selectionParams: { text: raw }, _translationPopup: null };
  return { state, pdfWin, selection, reader: { itemID: 42 }, anchor, focus };
}

function key(state, value, target, modifiers = {}) {
  const event = {
    key: value, target, ...modifiers,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  z._onKeyDown(event, {}, state, state.pdfWin);
  return event;
}

let passed = 0;
async function check(label, fn) {
  await fn();
  passed++;
  console.log('  ok  ' + label);
}

async function main() {
  await check('empty selections and missing/disabled APIs preserve Visual mode', async () => {
    for (const addon of [undefined, {}, { data: { alive: false }, api: { translate() {} } }]) {
      context.Zotero.PDFTranslate = addon;
      const p = pane();
      await z._translateSelection(p.state, p.reader, p.pdfWin);
      assert.equal(p.state._translationPopup, null);
      assert.equal(p.state.mode, 'visual');
    }
    context.Zotero.PDFTranslate = { api: { translate() { throw Error('must not call'); } } };
    for (const p of [pane(' \n '), pane()]) {
      if (p.selection.toString().trim()) p.selection.isCollapsed = true;
      await z._translateSelection(p.state, p.reader, p.pdfWin);
      assert.equal(p.state._translationPopup, null);
    }
    assert.equal(statuses.length, 5);
  });

  await check('API receives normalized pane text, caller ID and cloned attachment options', async () => {
    const pending = deferred();
    let args;
    context.Zotero.PDFTranslate = { api: { translate(...values) {
      args = values; return pending.promise;
    } } };
    const p = pane();
    const request = z._translateSelection(p.state, p.reader, p.pdfWin);
    const popup = p.state._translationPopup;
    assert.equal(args[0], 'A fine selection');
    assert.deepEqual(args[1], { pluginID: z.id, itemID: 42 });
    assert.equal(clones.at(-1).target, apiGlobal);
    assert.equal(popup.result.textContent, '正在翻译…');
    assert.equal(popup.copyButton.disabled, true);
    assert.equal(p.state.mode, 'visual');
    pending.resolve({ status: 'success', result: '译文 <script>plain text</script>' });
    await request;
    assert.equal(popup.result.textContent, '译文 <script>plain text</script>');
    assert.equal(popup.copyButton.disabled, false);
    const savedParams = p.state.selectionParams;
    p.state.selectionParams = null; // selecting popup text invalidates Zotero's selection cache
    assert.equal(key(p.state, 'y').prevented, true);
    assert.equal(copies.at(-1), popup.translation);
    assert.equal(key(p.state, 'Escape').prevented, true);
    assert.equal(p.state._translationPopup, null);
    assert.equal(popup.overlay.isConnected, false);
    assert.equal(p.state.mode, 'visual');
    assert.equal(p.state.selectionParams, savedParams);
    assert.deepEqual(p.selection.restored, [p.anchor, 12, p.focus, 3]);
  });

  await check('service failures, thrown errors and empty/invalid results remain dismissible', async () => {
    for (const result of [
      { status: 'fail', result: 'Service unavailable' },
      { status: 'success', result: '  ' }, undefined,
      new Error('Request rejected'),
    ]) {
      context.Zotero.PDFTranslate = { api: { async translate() {
        if (result instanceof Error) throw result;
        return result;
      } } };
      const p = pane();
      await z._translateSelection(p.state, p.reader, p.pdfWin);
      const popup = p.state._translationPopup;
      assert.equal(popup.resultLabel.textContent, '翻译失败');
      assert.equal(popup.copyButton.disabled, true);
      assert.equal(popup.translation, '');
      assert.ok(popup.result.textContent.trim());
      if (result instanceof Error) assert.equal(popup.result.textContent, result.message);
      if (result?.status === 'fail') assert.equal(popup.result.textContent, result.result);
      key(p.state, 'Escape');
      assert.equal(p.state._translationPopup, null);
    }
  });

  await check('closing and reopening ignores a stale request without overwriting the new result', async () => {
    const first = deferred();
    const second = deferred();
    let calls = 0;
    context.Zotero.PDFTranslate = { api: { translate() {
      return calls++ === 0 ? first.promise : second.promise;
    } } };
    const p = pane();
    const oldRequest = z._translateSelection(p.state, p.reader, p.pdfWin);
    const oldPopup = p.state._translationPopup;
    key(p.state, 'Escape');
    const newRequest = z._translateSelection(p.state, p.reader, p.pdfWin);
    const newPopup = p.state._translationPopup;
    second.resolve({ status: 'success', result: 'new translation' });
    await newRequest;
    first.resolve({ status: 'success', result: 'stale translation' });
    await oldRequest;
    assert.equal(p.state._translationPopup, newPopup);
    assert.equal(newPopup.result.textContent, 'new translation');
    assert.equal(oldPopup.result.textContent, '正在翻译…');
    z._closeTranslationPopup(p.state);
  });

  await check('popup keys scroll and focus buttons while suppressing PDF and Zotero shortcuts', async () => {
    context.Zotero.PDFTranslate = { api: { async translate() {
      return { status: 'success', result: 'translation' };
    } } };
    const p = pane();
    await z._translateSelection(p.state, p.reader, p.pdfWin);
    const popup = p.state._translationPopup;
    for (const value of ['j', 'l', 'r', 's', 'escape', 'ctrl+c']) {
      assert.equal(z._readerConsumesKey(p.state, value), true);
    }
    key(p.state, 'j');
    assert.equal(popup.body.scrollTop, 60);
    key(p.state, 'k');
    assert.equal(popup.body.scrollTop, 0);
    key(p.state, 'PageDown');
    assert.equal(popup.body.scrollTop, 160);
    key(p.state, 'Tab');
    assert.equal(p.pdfWin.document.activeElement, popup.closeButton);
    key(p.state, 'Tab', popup.closeButton);
    assert.equal(p.pdfWin.document.activeElement, popup.copyButton);
    assert.equal(key(p.state, 'Enter', popup.copyButton).prevented, undefined);
    assert.equal(key(p.state, 'c', popup.result, { ctrlKey: true }).prevented, undefined);
    assert.equal(key(p.state, 'l').prevented, true);
    const view = { _iframeWindow: p.pdfWin, _textAnnotationFocused: () => false };
    z._patchReaderTextAnnotationFocus({ _internalReader: { _primaryView: view } }, p.state);
    assert.equal(view._textAnnotationFocused(), true);
    popup.closeButton.listeners.click();
    assert.equal(view._textAnnotationFocused(), false);
  });

  await check('independent readers keep their own popup and translation request', async () => {
    const pending = deferred();
    context.Zotero.PDFTranslate = { api: { translate: () => pending.promise } };
    const first = pane('first pane');
    const second = pane('second pane');
    const request1 = z._translateSelection(first.state, first.reader, first.pdfWin);
    const request2 = z._translateSelection(second.state, second.reader, second.pdfWin);
    z._closeTranslationPopup(first.state, false);
    pending.resolve({ status: 'success', result: 'translation' });
    await Promise.all([request1, request2]);
    assert.equal(first.state._translationPopup, null);
    assert.equal(first.selection.restored, undefined);
    assert.equal(second.state._translationPopup.translation, 'translation');
    z._closeTranslationPopup(second.state);
  });

  await check('mode switches dismiss pending requests without restoring a stale selection', async () => {
    const pending = deferred();
    context.Zotero.PDFTranslate = { api: { translate: () => pending.promise } };
    const p = pane();
    const request = z._translateSelection(p.state, p.reader, p.pdfWin);
    z._setMode(p.state, 'normal');
    assert.equal(p.state._translationPopup, null);
    assert.equal(p.selection.restored, undefined);
    pending.resolve({ status: 'success', result: 'late translation' });
    await request;
    assert.equal(p.state._translationPopup, null);
  });

  await check('removing a split pane dismisses its pending popup without moving focus', async () => {
    const pending = deferred();
    context.Zotero.PDFTranslate = { api: { translate: () => pending.promise } };
    const p = pane();
    const request = z._translateSelection(p.state, p.reader, p.pdfWin);
    p.state._pdfViewHandlers = new Map([[p.pdfWin, {}]]);
    p.pdfWin.document.removeEventListener = () => {};
    z._syncReaderPdfViewListeners(p.reader, p.state);
    assert.equal(p.state._translationPopup, null);
    assert.equal(p.state._pdfViewHandlers.size, 0);
    assert.equal(p.selection.restored, undefined);
    pending.resolve({ status: 'success', result: 'late translation' });
    await request;
    assert.equal(p.state._translationPopup, null);
  });

  await check('single-word routing follows dictionary preferences and sends ordered API services', async () => {
    const prefix = 'extensions.zotero.ZoteroPDFTranslate';
    const prefs = { enableDict: true, dictSource: 'youdaodict', translateSource: 'googleapi' };
    context.Zotero.Prefs = { get(pref, global) {
      assert.equal(global, true);
      return prefs[pref.slice(prefix.length + 1)];
    } };
    let options;
    context.Zotero.PDFTranslate = { api: { async translate(_text, value) {
      options = value;
      return { status: 'success', service: value.service?.[0] || 'googleapi',
        result: 'n. 控制；管理\nv. 控制；抑制\nadj. 对照的' };
    } } };
    for (const [word, single] of [
      ['control', true], ['control,', true], ["don't", true], ['café', true],
      ['control group', false], ['research-based', false], ['!!!', false],
    ]) assert.equal(z._isSingleTranslationWord(word), single, word);
    const word = pane('control');
    await z._translateSelection(word.state, word.reader, word.pdfWin);
    assert.deepEqual(Array.from(options.service), ['youdaodict', 'googleapi']);
    assert.equal(word.state._translationPopup.resultLabel.textContent, '词典释义');
    assert.equal(word.state._translationPopup.copyButton.textContent, '复制释义');
    assert.match(word.state._translationPopup.result.textContent, /n\.[\s\S]*v\.[\s\S]*adj\./);
    z._closeTranslationPopup(word.state);
    for (const raw of ['control group', 'control', 'control']) {
      if (raw === 'control') {
        if (prefs.enableDict) prefs.enableDict = false;
        else { prefs.enableDict = true; prefs.dictSource = ''; }
      }
      const p = pane(raw);
      await z._translateSelection(p.state, p.reader, p.pdfWin);
      assert.equal(options.service, undefined);
      assert.equal(p.state._translationPopup.resultLabel.textContent, '译文');
      z._closeTranslationPopup(p.state);
    }
    delete context.Zotero.Prefs;
  });

  await check('phonetic metadata complements definitions and copies without duplicates', async () => {
    context.Zotero.Prefs = { get: pref => pref.endsWith('.enableDict') ? true
      : pref.endsWith('.dictSource') ? 'bingdict' : 'googleapi' };
    const result = 'n. 控制；管理\nv. 控制；抑制\nadj. 对照的';
    context.Zotero.PDFTranslate = { api: { async translate() {
      return { status: 'success', service: 'bingdict', result, audio: [
        { text: '英 [kənˈtrəʊl]', url: 'https://example.com/uk.mp3' },
        { text: '美 [kənˈtroʊl]', url: 'https://example.com/us.mp3' },
        { text: '英   [kənˈtrəʊl]', url: 'https://example.com/duplicate.mp3' },
        { text: '', url: '' },
      ] };
    } } };
    const p = pane('control');
    await z._translateSelection(p.state, p.reader, p.pdfWin);
    const popup = p.state._translationPopup;
    assert.equal(popup.phonetics.textContent, '英 [kənˈtrəʊl] · 美 [kənˈtroʊl]');
    assert.equal(popup.phonetics.style.display, 'block');
    assert.equal(popup.result.textContent, result);
    key(p.state, 'y');
    assert.equal(copies.at(-1), '英 [kənˈtrəʊl]\n美 [kənˈtroʊl]\n\n' + result);
    z._closeTranslationPopup(p.state);
    context.Zotero.PDFTranslate.api.translate = async () => ({
      status: 'success', service: 'bingdict', result: '英 [kənˈtrəʊl]\n' + result,
      audio: [{ text: '英  [kənˈtrəʊl]', url: 'https://example.com/uk.mp3' }],
    });
    await z._translateSelection(p.state, p.reader, p.pdfWin);
    assert.equal(p.state._translationPopup.phonetics.style.display, 'none');
    assert.equal(p.state._translationPopup.translation, '英 [kənˈtrəʊl]\n' + result);
    z._closeTranslationPopup(p.state);
    delete context.Zotero.Prefs;
  });

  await check('failed or empty dictionary lookups fall back once and show translation labels', async () => {
    context.Zotero.Prefs = { get: pref => pref.endsWith('.enableDict') ? true
      : pref.endsWith('.dictSource') ? 'youdaodict' : 'googleapi' };
    for (const task of [
      { status: 'success', service: 'googleapi', result: '普通翻译' },
      { status: 'success', service: 'youdaodict', result: '' },
      { status: 'fail', service: 'youdaodict', result: 'not implemented' },
      { status: 'fail', service: 'googleapi', result: 'all services failed' },
    ]) {
      let calls = 0;
      context.Zotero.PDFTranslate = { api: { async translate(_text, options) {
        if (++calls === 1) return task;
        assert.equal(options.service, 'googleapi');
        return { status: 'success', service: 'googleapi', result: '普通翻译' };
      } } };
      const p = pane('control');
      await z._translateSelection(p.state, p.reader, p.pdfWin);
      const popup = p.state._translationPopup;
      assert.equal(calls, task.service === 'youdaodict' ? 2 : 1);
      assert.equal(popup.resultLabel.textContent,
        task.service === 'googleapi' && task.status === 'fail' ? '翻译失败' : '译文');
      assert.notEqual(popup.phonetics.style.display, 'block');
      z._closeTranslationPopup(p.state);
    }
    delete context.Zotero.Prefs;
  });

  console.log('Reader translation checks passed (' + passed + ' cases).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

/* global Zotero, ZoteroVim, Services, Components, ZV_KEYMAP_LABELS */

Object.assign(ZoteroVim, {
  _openSettings(owner, win, sourceWin = null) {
    this._openShortcutHelp(owner, win, sourceWin, false, true);
  },

  _createSettings(ui) {
    this._attachTheme(ui.doc);
    const { overlay, panel, header, close, h } = this._createShortcutDialog(ui,
      ui.zh ? 'Vim Plus 设置' : 'Vim Plus Settings', () => this._requestSettingsClose(ui));
    const style = h('style');
    style.textContent = `
      #zv-settings-overlay { color-scheme: var(--zv-theme-scheme, dark); }
      #zv-settings-overlay button, #zv-settings-overlay select,
      #zv-settings-overlay input:not([type=checkbox]) {
        background: var(--zv-theme-control, #313244); color: var(--zv-theme-text, #cdd6f4); border: 1px solid var(--zv-theme-border, #585b70);
        border-radius: 5px; font: inherit; padding: 4px 8px;
      }
      #zv-settings-overlay button { cursor: pointer; }
      #zv-settings-overlay button[aria-selected=true] {
        background: var(--zv-theme-selected, #45475a); border-color: var(--zv-theme-accent, #89b4fa);
      }
      #zv-settings-overlay :focus-visible { outline: 2px solid var(--zv-theme-accent, #89b4fa); outline-offset: 2px; }
      #zotero-vim-settings-form [hidden] { display: none !important; }
      #zotero-vim-settings-form fieldset {
        min-width: 0; margin: 0 0 12px; padding: 10px 12px;
        border: 1px solid var(--zv-theme-selected, #45475a); border-radius: 7px;
      }
      #zotero-vim-settings-form p { color: var(--zv-theme-muted, #a6adc8) !important; }
      #zotero-vim-settings-form th { background: var(--zv-theme-control, #313244); }
      #zotero-vim-settings-form td { border-bottom: 1px solid var(--zv-theme-selected, #45475a); }
      #zotero-vim-settings-form td select { max-width: 100%; }
      #zotero-vim-settings-form tr[data-mode=normal] {
        background: var(--zv-theme-accent-faint, transparent);
      }
      #zotero-vim-settings-form tr[data-mode=visual] {
        background: var(--zv-theme-success-tint, transparent);
      }
      #zotero-vim-settings-form :is(tr[data-mode=cursor], tr[data-mode=insert]) {
        background: var(--zv-theme-hint-tint, transparent);
      }
      #zotero-vim-settings-form tr[data-mode=main] {
        background: var(--zv-theme-recessed, transparent);
      }
      #zotero-vim-settings-form .zv-binding-error,
      #zotero-vim-settings-form #zv-bindings-status { color: var(--zv-theme-danger, #ffb4ab); }
    `;
    const body = h('div');
    body.style.cssText = 'display:flex;min-height:0;height:65vh;border-top:1px solid var(--zv-theme-selected, #45475a);';
    const tabs = h('div');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-orientation', 'vertical');
    tabs.setAttribute('aria-label', ui.zh ? '设置分类' : 'Settings categories');
    tabs.style.cssText = 'flex:0 0 auto;padding:12px;display:flex;flex-direction:column;'
      + 'gap:6px;border-right:1px solid var(--zv-theme-selected, #45475a);overflow:auto;';
    const list = h('div');
    list.id = 'zotero-vim-settings-form';
    list.style.cssText = 'padding:12px 16px;flex:1;min-width:0;overflow:auto;'
      + 'overscroll-behavior:contain;';
    body.append(tabs, list);

    const footer = h('div');
    footer.style.cssText = 'padding:8px 18px;border-top:1px solid var(--zv-theme-selected, #45475a);color:var(--zv-theme-muted, #a6adc8);';
    const status = h('span');
    status.setAttribute('role', 'status');
    const tips = ui.zh
      ? 'Shift+J/K 切页 · f 提示 · Tab 移动焦点 · Esc 退出控件或关闭'
      : 'Shift+J/K tabs · f hints · Tab move focus · Esc leave a field or close';
    status.textContent = tips;
    const confirm = h('div');
    confirm.hidden = true;
    const keep = h('button');
    keep.textContent = ui.zh ? '继续编辑' : 'Keep editing';
    const discard = h('button');
    discard.textContent = ui.zh ? '放弃修改并关闭' : 'Discard and close';
    discard.style.marginInlineStart = '8px';
    keep.addEventListener('click', () => {
      confirm.hidden = true;
      body.inert = false;
      status.textContent = tips;
      ui.input.focus();
    });
    discard.addEventListener('click', () => this._closeShortcutHelp(ui.owner));
    confirm.append(keep, discard);
    footer.append(status, confirm);
    panel.append(style, header, body, footer);

    Object.assign(ui, { overlay, body, list, status, tips, confirm, keep, h,
      input: close, hints: [], hintPrefix: '', page: 0 });
    (ui.doc.body || ui.doc.documentElement).appendChild(overlay);
    list.textContent = ui.zh ? '正在加载设置…' : 'Loading settings…';
    list.addEventListener('scroll', () => this._clearSettingsHints(ui), true);
    overlay.addEventListener('pointerdown', () => this._clearSettingsHints(ui), true);
    this._loadSettingsForm(ui, tabs).catch(error => {
      Zotero.debug('[ZoteroVim] load settings: ' + error);
      if (ui.owner._shortcutHelp === ui) {
        list.textContent = ui.zh ? '设置加载失败。' : 'Could not load settings.';
      }
    });
  },

  /** Render the native pane template as HTML, then run its controller in a scoped global. */
  async _loadSettingsForm(ui, tabs) {
    const url = this.rootURI + 'content/preferences.xhtml';
    const source = await (Zotero.File.getResourceAsync
      ? Zotero.File.getResourceAsync(url) : Zotero.File.getResource(url));
    if (ui.owner._shortcutHelp !== ui || !ui.overlay.isConnected) return;
    // Parse the XUL vocabulary as inert XML. The overlay creates its own HTML controls.
    const markup = source.replace('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul',
      'urn:zotero-vim:settings');
    const template = new ui.win.DOMParser().parseFromString(markup, 'application/xml');
    if (template.documentElement.getAttribute('id') !== 'zotero-vim-prefs') {
      throw new Error('Invalid preferences template');
    }

    const { list, h } = ui;
    list.textContent = '';
    ui.pages = [
      ['general', 'General', '常规'],
      ['appearance', 'Appearance', '外观'],
      ['reader', 'Reader', '阅读器'],
      ['notes', 'Notes', '笔记'],
      ['keys', 'Keybindings', '快捷键'],
    ].map(([id, en, zh], index) => {
      const section = h('section');
      section.id = 'zv-settings-page-' + id;
      section.setAttribute('role', 'tabpanel');
      const tab = h('button');
      tab.id = 'zv-settings-tab-' + id;
      tab.textContent = ui.zh ? zh : en;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', section.id);
      section.setAttribute('aria-labelledby', tab.id);
      tab.addEventListener('click', () => this._selectSettingsPage(ui, index));
      for (const node of template.documentElement.children) {
        if (node.getAttribute('data-zv-settings-page') === id) {
          section.appendChild(this._renderSettingsControl(node, h));
        }
      }
      tabs.appendChild(tab);
      list.appendChild(section);
      return { tab, section };
    });

    // Use only pane-local lookup and HTML element creation when the controller
    // runs in the library or reader chrome document.
    const scope = {
      Zotero, Components, ZV_KEYMAP_LABELS, ZV_SETTINGS_PANE: true,
      dump: message => Zotero.debug(message),
      window: ui.win,
      document: {
        getElementById: id => list.querySelector('#' + id),
        querySelectorAll: selector => list.querySelectorAll(selector),
        createElement: h,
      },
    };
    Services.scriptloader.loadSubScript(this.rootURI + 'content/i18n.js', scope, 'UTF-8');
    Services.scriptloader.loadSubScript(this.rootURI + 'content/prefs.js', scope, 'UTF-8');
    ui.prefs = scope;
    this._addSettingsBindingSearch(ui);
    this._selectSettingsPage(ui, 0);
  },

  /** Translate the template's XUL form elements while retaining shared IDs and labels. */
  _renderSettingsControl(node, h) {
    const html = node.namespaceURI === 'http://www.w3.org/1999/xhtml';
    const name = node.localName;
    const tags = {
      groupbox: 'fieldset', hbox: 'div', label: 'label',
      menulist: 'select', menuitem: 'option', checkbox: 'input',
    };
    const element = h(html ? name : (tags[name] || 'div'));
    for (const attr of node.attributes) {
      if (attr.name === 'data-zv-settings-page') continue;
      if (!html && ['label', 'align'].includes(attr.name)) continue;
      if (!html && name === 'label' && attr.name === 'value') continue;
      element.setAttribute(attr.name, attr.value);
    }
    if (!html) {
      if (name === 'checkbox') {
        element.type = 'checkbox';
        const label = h('label');
        const text = h('span');
        text.textContent = node.getAttribute('label');
        if (element.hasAttribute('data-i18n')) {
          text.setAttribute('data-i18n', element.getAttribute('data-i18n'));
          element.removeAttribute('data-i18n');
        }
        label.append(element, ' ', text);
        return label;
      }
      if (name === 'label') element.textContent = node.getAttribute('value');
      if (name === 'label' && node.nextElementSibling?.localName === 'menulist') {
        element.htmlFor = node.nextElementSibling.getAttribute('id');
      }
      if (name === 'menuitem') element.textContent = node.getAttribute('label');
      if (name === 'hbox') {
        element.style.display = 'flex';
        element.style.flexWrap = 'wrap';
        element.style.gap = '4px';
        if (node.hasAttribute('align')) element.style.alignItems = node.getAttribute('align');
      }
    }
    const children = !html && name === 'menulist'
      ? node.firstElementChild.childNodes : node.childNodes;
    for (const child of children) {
      if (child.nodeType === 1) element.appendChild(this._renderSettingsControl(child, h));
      if (child.nodeType === 3) element.append(child.nodeValue);
    }
    return element;
  },

  _addSettingsBindingSearch(ui) {
    const { list, h } = ui;
    const table = list.querySelector('#zv-bindings-table');
    const tableWrap = table.parentElement;
    ui.applyBindings = list.querySelector('#zv-save');
    const controls = ui.applyBindings.parentElement;
    controls.querySelector('p')?.remove();
    tableWrap.before(controls);
    tableWrap.style.maxHeight = 'none';
    tableWrap.style.overflow = 'visible';

    const search = h('input');
    search.type = 'search';
    search.placeholder = ui.zh ? '筛选动作或按键…' : 'Filter actions or keys…';
    search.setAttribute('aria-label', search.placeholder);
    search.style.marginBlockEnd = '8px';
    table.closest('fieldset').prepend(search);
    const rows = table.tBodies[0];
    const filter = () => {
      const query = search.value.trim().toLowerCase();
      for (const row of rows.rows) {
        const key = row.querySelector('input').value;
        const selects = row.querySelectorAll('select');
        const selected = selects[selects.length - 1].selectedOptions[0];
        row.hidden = ![key, key.replace(/<space>/g, 'space '), row.dataset.mode,
          selected?.value, selected?.textContent]
          .some(text => text?.toLowerCase().includes(query));
      }
    };
    search.addEventListener('input', filter);
    const clear = () => { search.value = ''; filter(); };
    for (const id of ['zv-add-binding', 'zv-reset-bindings']) {
      list.querySelector('#' + id).addEventListener('click', clear, true);
    }
    ui.applyBindings.addEventListener('click', () => {
      const invalid = rows.querySelector('input[aria-invalid=true]');
      if (!invalid) return;
      clear();
      invalid.focus();
    });
  },

  _selectSettingsPage(ui, index) {
    this._clearSettingsHints(ui);
    ui.pages.forEach(({ tab, section }, i) => {
      tab.tabIndex = i === index ? 0 : -1;
      tab.setAttribute('aria-selected', String(i === index));
      section.hidden = i !== index;
    });
    ui.page = index;
    ui.input = ui.pages[index].tab;
    ui.list.scrollTop = 0;
    ui.input.focus();
  },

  _requestSettingsClose(ui) {
    if (!ui.prefs?._zvHasBindingDraft()) {
      this._closeShortcutHelp(ui.owner);
      return;
    }
    this._clearSettingsHints(ui);
    ui.status.textContent = ui.zh ? '快捷键修改尚未应用。' : 'Keybinding changes have not been applied.';
    ui.confirm.hidden = false;
    ui.body.inert = true;
    ui.keep.focus();
  },

  _clearSettingsHints(ui) {
    if (!ui.hints.length) return;
    for (const { badge } of ui.hints) badge.remove();
    ui.hints = [];
    ui.hintPrefix = '';
    ui.status.textContent = ui.tips;
  },

  _showSettingsHints(ui) {
    const page = ui.pages?.[ui.page]?.section;
    if (!page) return;
    const targets = [...page.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
      .map(control => ({ control, rect: control.getBoundingClientRect() }))
      .filter(({ control, rect }) => rect.width && rect.height && ui.doc.elementFromPoint(
        Math.max(rect.left, Math.min(rect.right - 2, rect.left + 8)),
        rect.top + rect.height / 2)?.closest('input, button, select') === control);
    const labels = this._hintLabelList(targets.length);
    ui.hints = targets.map(({ control, rect }, i) => {
      const badge = ui.h('span');
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = labels[i];
      badge.style.cssText = 'position:fixed;pointer-events:none;z-index:1;'
        + 'background:var(--zv-theme-hint, #f9e2af);color:var(--zv-theme-on-hint, #1e1e2e);border:1px solid var(--zv-theme-hint-border, #66542c);border-radius:3px;'
        + 'padding:0 3px;font:bold 11px/1.3 monospace;'
        + 'left:' + rect.left + 'px;top:' + Math.max(0, rect.top - 8) + 'px;';
      ui.overlay.appendChild(badge);
      return { control, badge, label: labels[i] };
    });
    if (ui.hints.length) {
      ui.status.textContent = ui.zh ? '输入提示字母 · Esc 取消' : 'Type a hint · Esc cancel';
    }
  },

  _activateSettingsControl(control) {
    control.focus();
    if (control.matches('button, input[type=checkbox]')) {
      control.click();
    } else if (control.localName === 'select') {
      try { control.showPicker?.(); } catch (_) {}
    } else {
      control.select();
    }
  },

  _onSettingsKeyDown(event, ui) {
    const { key } = event;
    const target = ui.doc.activeElement;
    const inField = target?.matches?.('input:not([type=checkbox]), select');
    const typing = target?.matches?.('input[type=text], input[type=search]');
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (key === 'Tab') {
      event.preventDefault();
      this._clearSettingsHints(ui);
      const root = ui.confirm.hidden ? ui.overlay : ui.confirm;
      const controls = [...root.querySelectorAll('button, input, select')]
        .filter(el => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length);
      if (!controls.length) return;
      const index = controls.indexOf(target);
      controls[(index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length)].focus();
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      if (event.repeat) return;
      if (ui.hints.length) this._clearSettingsHints(ui);
      else if (!ui.confirm.hidden) ui.keep.click();
      else if (inField) ui.input.focus();
      else this._requestSettingsClose(ui);
      return;
    }
    if (!ui.confirm.hidden) {
      if (!ui.confirm.contains(target)) {
        event.preventDefault();
        ui.keep.focus();
      }
      return;
    }
    if (ui.hints.length) {
      event.preventDefault();
      if (!plain || !/^[a-z]$/i.test(key) || event.repeat) return;
      ui.hintPrefix += key.toUpperCase();
      const matches = ui.hints.filter(hint => hint.label.startsWith(ui.hintPrefix));
      if (matches.length === 1 && matches[0].label === ui.hintPrefix) {
        const { control } = matches[0];
        this._clearSettingsHints(ui);
        this._activateSettingsControl(control);
      } else if (!matches.length) {
        this._clearSettingsHints(ui);
      } else {
        for (const hint of ui.hints) hint.badge.hidden = !matches.includes(hint);
      }
      return;
    }
    if (!ui.overlay.contains(target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'Enter'
        && ui.applyBindings && ui.pages[ui.page].section.contains(ui.applyBindings)) {
      event.preventDefault();
      if (!event.repeat) ui.applyBindings.click();
      return;
    }
    if (!plain) return;
    const onTab = target === ui.input;
    const direction = (event.shiftKey && key === 'J') || (onTab && key === 'ArrowDown') ? 1
      : (event.shiftKey && key === 'K') || (onTab && key === 'ArrowUp') ? -1 : 0;
    if (!typing && direction && ui.pages) {
      event.preventDefault();
      this._selectSettingsPage(ui, (ui.page + direction + ui.pages.length) % ui.pages.length);
    } else if (!inField && key === 'f' && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat) this._showSettingsHints(ui);
    } else if (!inField && ['PageDown', 'PageUp'].includes(key)) {
      event.preventDefault();
      ui.list.scrollTop += ui.list.clientHeight * 0.8 * (key === 'PageDown' ? 1 : -1);
    } else if (key === 'Enter' && target?.matches?.('input')) {
      event.preventDefault();
      if (target.type === 'checkbox' && !event.repeat) target.click();
      else if (target.type !== 'checkbox') ui.input.focus();
    }
  },
});

/* global Zotero, ZoteroVim, Services, Components, ZV_THEME, ZV_KEYMAP_LABELS */

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
      #zv-settings-overlay button,
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
      #zotero-vim-settings-form .zv-settings-select {
        display: inline-flex; align-items: center; gap: 12px;
        max-width: 100%; text-align: start;
      }
      #zotero-vim-settings-form .zv-settings-select > span {
        min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      }
      #zotero-vim-settings-form td .zv-settings-select { width: 100%; }
      #zotero-vim-settings-form .zv-settings-select::after {
        content: "▾"; margin-inline-start: auto; color: var(--zv-theme-muted, #a6adc8);
      }
      #zv-theme-cards {
        width: 100%; display: grid; gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
      }
      #zv-theme-cards .zv-theme-card {
        min-width: 0; padding: 6px; text-align: start;
        display: flex; flex-direction: column; gap: 5px;
      }
      #zv-theme-cards .zv-theme-card[aria-checked=true] {
        border-color: var(--zv-theme-accent, #89b4fa);
        background: var(--zv-theme-selected, #45475a);
      }
      #zv-theme-cards .zv-theme-card-name {
        display: flex; justify-content: space-between; align-items: baseline; gap: 4px;
      }
      #zv-theme-cards .zv-theme-card-name::after {
        content: '✓'; visibility: hidden; color: var(--zv-theme-accent, #89b4fa);
      }
      #zv-theme-cards [aria-checked=true] .zv-theme-card-name::after { visibility: visible; }
      #zv-theme-cards .zv-theme-card-preview { display: flex; gap: 4px; }
      #zv-theme-cards .zv-theme-sample {
        flex: 1; min-width: 0; padding: 6px;
        border: 1px solid var(--zv-preview-border); border-radius: 5px;
        background: var(--zv-preview-surface); color: var(--zv-preview-text);
      }
      #zv-theme-cards .zv-theme-sample-type {
        display: block; font-weight: bold; font-size: 15px; line-height: 1;
        border-inline-start: 3px solid var(--zv-preview-accent);
        padding-inline-start: 5px; margin-block-end: 6px;
        background: var(--zv-preview-control);
      }
      #zv-theme-cards .zv-theme-swatches {
        display: flex; gap: 2px; height: 9px;
      }
      #zv-theme-cards .zv-theme-swatches > span { flex: 1; border-radius: 2px; }
      #zv-settings-choice-layer {
        position: absolute; inset: 0; z-index: 2; padding: 24px; background: #0005;
        display: flex; justify-content: center; align-items: center;
      }
      #zv-settings-choice {
        width: min(520px, 100%); max-height: min(75vh, 100%);
        display: flex; flex-direction: column; gap: 8px; min-height: 0;
        box-sizing: border-box; padding: 12px; border-radius: 9px;
        font: 13px/1.5 sans-serif; color: var(--zv-theme-text, #cdd6f4);
        background: var(--zv-theme-surface, #1e1e2e);
        border: 1px solid var(--zv-theme-border, #585b70);
        box-shadow: 0 16px 48px #0008;
      }
      #zv-settings-choice-title { margin: 0; font-size: 15px; }
      #zv-settings-choice-options {
        overflow: auto; overscroll-behavior: contain; min-height: 0;
        border: 1px solid var(--zv-theme-border, #585b70); border-radius: 5px;
      }
      #zv-settings-choice-options [role=option] {
        display: flex; align-items: baseline; gap: 8px;
        padding: 4px 8px; cursor: pointer; overflow-wrap: anywhere;
        border-inline-start: 2px solid transparent;
      }
      #zv-settings-choice-options [aria-selected=true] {
        background: var(--zv-theme-selected, #45475a);
        border-inline-start-color: var(--zv-theme-accent, #89b4fa);
      }
      #zv-settings-choice-options .zv-settings-choice-mark {
        min-width: 1em; color: var(--zv-theme-accent, #89b4fa);
      }
      #zv-settings-choice [hidden] { display: none !important; }
      #zv-settings-choice footer { color: var(--zv-theme-muted, #a6adc8); font-size: 11px; }
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

    Object.assign(ui, { overlay, panel, body, list, status, tips, confirm, keep, h,
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
      Zotero, Components, ZV_THEME, ZV_KEYMAP_LABELS, ZV_SETTINGS_PANE: true,
      ZV_SETTINGS_SELECT: select => this._wrapSettingsSelect(ui, select),
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
    this._renderSettingsThemeCards(ui, list.querySelector('#zv-theme'));
    for (const select of list.querySelectorAll('select:not([hidden])')) {
      this._wrapSettingsSelect(ui, select);
    }
    list.addEventListener('change', event => {
      if (event.target.id === 'zv-theme') return;
      if (event.target.id === 'zv-language') {
        ui.syncThemeCards();
        for (const button of list.querySelectorAll('.zv-settings-select')) {
          this._syncSettingsSelect(button.previousElementSibling, button);
        }
      } else if (event.target.localName === 'select') {
        this._syncSettingsSelect(event.target, event.target.nextElementSibling);
      }
    });
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
    const targets = [...page.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      .map(control => ({ control, rect: control.getBoundingClientRect() }))
      .filter(({ control, rect }) => rect.width && rect.height && ui.doc.elementFromPoint(
        Math.max(rect.left, Math.min(rect.right - 2, rect.left + 8)),
        rect.top + rect.height / 2)?.closest('input, button') === control);
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

  /** Show each preset with its own colors, regardless of the active theme. */
  _renderSettingsThemeCards(ui, select) {
    const { h } = ui;
    const grid = h('div');
    grid.id = 'zv-theme-cards';
    grid.setAttribute('role', 'radiogroup');
    const palettes = ZV_THEME.palettes;
    const cards = Array.from(select.options, option => {
      const button = h('button');
      button.type = 'button';
      button.className = 'zv-theme-card';
      button.setAttribute('role', 'radio');
      const name = h('span');
      name.className = 'zv-theme-card-name';
      const preview = h('span');
      preview.className = 'zv-theme-card-preview';
      preview.setAttribute('aria-hidden', 'true');
      const samples = option.value === 'system' ? [palettes.latte, palettes.mocha]
        : [palettes[option.value] || { ...palettes.mocha, hint: '#ffd400' }];
      for (const palette of samples) {
        const sample = h('span');
        sample.className = 'zv-theme-sample';
        for (const key of ['border', 'surface', 'text', 'accent', 'control']) {
          sample.style.setProperty('--zv-preview-' + key, palette[key]);
        }
        const type = h('span');
        type.className = 'zv-theme-sample-type';
        type.textContent = 'Aa';
        const swatches = h('span');
        swatches.className = 'zv-theme-swatches';
        for (const key of ['control', 'text', 'accent', 'success', 'danger', 'hint']) {
          const swatch = h('span');
          swatch.style.backgroundColor = palette[key];
          swatches.appendChild(swatch);
        }
        sample.append(type, swatches);
        preview.appendChild(sample);
      }
      button.append(name, preview);
      button.addEventListener('click', () => {
        if (select.value === option.value) return;
        select.value = option.value;
        select.dispatchEvent(new ui.win.Event('change', { bubbles: true }));
      });
      grid.appendChild(button);
      return { button, name, option };
    });
    ui.syncThemeCards = () => {
      grid.setAttribute('aria-label', this._settingsSelectLabel(select));
      for (const { button, name, option } of cards) {
        name.textContent = option.label;
        button.setAttribute('aria-label', option.label);
        button.setAttribute('aria-checked', String(option.selected));
        button.tabIndex = option.selected ? 0 : -1;
      }
    };
    select.hidden = true;
    select.after(grid);
    select.addEventListener('change', ui.syncThemeCards);
    ui.syncThemeCards();
  },

  /** Keep the source select as the form value, with one focusable trigger in the overlay. */
  _wrapSettingsSelect(ui, select) {
    const button = ui.h('button');
    button.type = 'button';
    button.className = 'zv-settings-select';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.appendChild(ui.h('span'));
    this._syncSettingsSelect(select, button);
    select.hidden = true;
    select.after(button);
    button.addEventListener('click', () => this._openSettingsChoice(ui, select, button));
    for (const label of select.labels) {
      label.addEventListener('click', event => {
        event.preventDefault();
        button.click();
      });
    }
  },

  _settingsSelectLabel(select) {
    return select.getAttribute('aria-label')
      || [...select.labels].map(label => label.textContent.trim()).join(' ');
  },

  _syncSettingsSelect(select, button) {
    const value = select.selectedOptions[0]?.label || '';
    button.firstElementChild.textContent = value;
    button.title = value;
    button.disabled = select.disabled;
    button.setAttribute('aria-label', [this._settingsSelectLabel(select), value]
      .filter(Boolean).join(' · '));
  },

  _openSettingsChoice(ui, select, button) {
    if (ui.choice || button.disabled || !ui.confirm.hidden) return;
    const { h } = ui;
    const zh = ui.prefs.ZV_I18N_CURRENT_LANG() === 'zh-CN';
    const layer = h('div');
    layer.id = 'zv-settings-choice-layer';
    const dialog = h('section');
    dialog.id = 'zv-settings-choice';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = h('h2');
    title.id = 'zv-settings-choice-title';
    title.textContent = this._settingsSelectLabel(select) || (zh ? '选择选项' : 'Choose an option');
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.appendChild(title);

    const list = h('div');
    list.id = 'zv-settings-choice-options';
    list.tabIndex = 0;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', title.id);
    const options = Array.from(select.options).filter(option => !option.disabled);
    const choice = { layer, list, select, button, items: [], visible: [], active: null };
    if (options.length > 10) {
      const search = h('input');
      search.type = 'search';
      search.placeholder = zh ? '筛选选项…' : 'Filter options…';
      search.setAttribute('aria-label', search.placeholder);
      search.setAttribute('aria-controls', list.id);
      search.addEventListener('input', () => this._filterSettingsChoice(choice));
      choice.search = search;
      dialog.appendChild(search);
    }
    const empty = h('div');
    empty.setAttribute('role', 'status');
    empty.textContent = zh ? '没有匹配的选项' : 'No matching options';
    choice.empty = empty;
    const footer = h('footer');
    footer.textContent = zh ? 'j/k 或 ↑/↓ 移动 · Enter 确认 · Esc 取消'
      : 'j/k or ↑/↓ move · Enter confirm · Esc cancel';
    if (choice.search) footer.textContent += zh ? ' · / 筛选' : ' · / filter';
    for (const [index, option] of options.entries()) {
      const row = h('div');
      row.id = 'zv-settings-choice-option-' + index;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      const mark = h('span');
      mark.className = 'zv-settings-choice-mark';
      mark.setAttribute('aria-hidden', 'true');
      if (option.selected) mark.textContent = '✓';
      row.append(mark, option.label);
      const item = { option, row };
      row.addEventListener('click', () => this._closeSettingsChoice(ui, item));
      choice.items.push(item);
      list.appendChild(row);
    }
    dialog.append(list, empty, footer);
    layer.appendChild(dialog);
    layer.addEventListener('click', event => {
      if (event.target === layer) this._closeSettingsChoice(ui);
    });
    ui.choice = choice;
    button.setAttribute('aria-expanded', 'true');
    ui.panel.inert = true;
    ui.overlay.appendChild(layer);
    list.focus({ preventScroll: true });
    choice.active = choice.items.find(item => item.option.selected);
    this._filterSettingsChoice(choice);
  },

  _filterSettingsChoice(choice) {
    const query = (choice.search?.value || '').trim().toLocaleLowerCase();
    choice.visible = choice.items.filter(({ option, row }) => {
      row.hidden = !option.label.toLocaleLowerCase().includes(query)
        && !option.value.toLocaleLowerCase().includes(query);
      return !row.hidden;
    });
    choice.empty.hidden = choice.visible.length > 0;
    this._focusSettingsChoiceItem(choice,
      choice.visible.includes(choice.active) ? choice.active : choice.visible[0]);
  },

  _focusSettingsChoiceItem(choice, item) {
    if (choice.active && choice.active !== item) {
      choice.active.row.setAttribute('aria-selected', 'false');
    }
    choice.active = item;
    if (!item) {
      choice.list.removeAttribute('aria-activedescendant');
      return;
    }
    item.row.setAttribute('aria-selected', 'true');
    choice.list.setAttribute('aria-activedescendant', item.row.id);
    item.row.scrollIntoView({ block: 'nearest' });
  },

  _closeSettingsChoice(ui, item = null) {
    const { layer, select, button } = ui.choice;
    ui.choice = null;
    layer.remove();
    ui.panel.inert = false;
    button.setAttribute('aria-expanded', 'false');
    if (item && select.selectedIndex !== item.option.index) {
      select.selectedIndex = item.option.index;
      select.dispatchEvent(new ui.win.Event('change', { bubbles: true }));
    }
    button.focus({ preventScroll: true });
  },

  _onSettingsChoiceKeyDown(event, ui) {
    const { key } = event;
    const choice = ui.choice;
    const typing = choice.search && ui.doc.activeElement === choice.search;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (key === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this._closeSettingsChoice(ui);
    } else if (key === 'Tab') {
      event.preventDefault();
      (typing ? choice.list : choice.search || choice.list).focus();
    } else if (!plain) {
      return;
    } else if (key === 'Enter' || (!typing && key === ' ')) {
      event.preventDefault();
      if (!event.repeat && choice.active) this._closeSettingsChoice(ui, choice.active);
    } else if (!typing && key === '/' && choice.search) {
      event.preventDefault();
      choice.search.focus();
    } else {
      const { visible, active } = choice;
      const index = visible.indexOf(active);
      const step = key === 'ArrowDown' || (!typing && key === 'j') ? 1
        : key === 'ArrowUp' || (!typing && key === 'k') ? -1 : 0;
      const next = step ? index + step
        : !typing && key === 'Home' ? 0 : !typing && key === 'End' ? visible.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      this._focusSettingsChoiceItem(choice, visible[Math.max(0, Math.min(next, visible.length - 1))]);
    }
  },

  _activateSettingsControl(control) {
    control.focus();
    if (control.matches('button, input[type=checkbox]')) {
      control.click();
    } else {
      control.select();
    }
  },

  _onSettingsKeyDown(event, ui) {
    if (ui.choice) {
      this._onSettingsChoiceKeyDown(event, ui);
      return;
    }
    const { key } = event;
    const target = ui.doc.activeElement;
    const inField = target?.matches?.('input:not([type=checkbox])');
    const typing = target?.matches?.('input[type=text], input[type=search]');
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (key === 'Tab') {
      event.preventDefault();
      this._clearSettingsHints(ui);
      const root = ui.confirm.hidden ? ui.overlay : ui.confirm;
      const controls = [...root.querySelectorAll('button, input')]
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
    if (target?.classList.contains('zv-theme-card')) {
      const step = ['ArrowRight', 'ArrowDown', 'l', 'j'].includes(key) ? 1
        : ['ArrowLeft', 'ArrowUp', 'h', 'k'].includes(key) ? -1 : 0;
      if (step && !event.shiftKey) {
        event.preventDefault();
        const grid = target.parentElement;
        const next = step > 0 ? target.nextElementSibling || grid.firstElementChild
          : target.previousElementSibling || grid.lastElementChild;
        next.click();
        next.focus();
        return;
      }
    }
    if (target?.classList.contains('zv-settings-select')
        && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(key)) {
      event.preventDefault();
      if (!event.repeat) target.click();
      return;
    }
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

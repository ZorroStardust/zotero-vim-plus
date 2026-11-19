/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */

// Theme variables are defined on each host document so they also reach plugin
// UI inside the reader and note iframes. Only plugin styles consume them.
var ZV_THEME = {
  pref: 'extensions.zotero-vim@zotero-vim.theme',
  customPref: 'extensions.zotero-vim@zotero-vim.theme.custom',
  documents: new Map(),
  observing: false,
  palettes: {
    classic: {
      scheme: 'dark', surface: '#23262d', recessed: '#1b1e24', control: '#2d323b',
      selected: '#363f50', border: '#49515e', text: '#edf0f5', muted: '#b3bccb',
      accent: '#a7c3ed', success: '#a6c9b6', danger: '#efaeb4',
      hint: '#e5c58e', 'on-hint': '#2c251b', 'hint-border': '#a88f66',
    },
    mocha: {
      scheme: 'dark', surface: '#1e1e2e', recessed: '#181825', control: '#313244',
      selected: '#45475a', border: '#585b70', text: '#cdd6f4', muted: '#a6adc8',
      accent: '#89b4fa', success: '#a6e3a1', danger: '#f38ba8',
      hint: '#f9e2af', 'on-hint': '#302517', 'hint-border': '#a88e62',
      'selection-rgb': '245, 194, 231', 'selection-opacity': '0.52',
    },
    latte: {
      scheme: 'light', surface: '#eff1f5', recessed: '#e6e9ef', control: '#dce0e8',
      selected: '#cdd5e8', border: '#8991a5', text: '#333850', muted: '#545b73',
      accent: '#2457b3', success: '#28662b', danger: '#a31740',
      hint: '#ffe2a2', 'on-hint': '#3d2b14', 'hint-border': '#936820',
      'selection-rgb': '35, 104, 211', 'selection-opacity': '0.35',
    },
    nord: {
      scheme: 'dark', surface: '#2e3440', recessed: '#262c36', control: '#3b4252',
      selected: '#434c5e', border: '#65728a', text: '#eceff4', muted: '#c1cad9',
      accent: '#88c0d0', success: '#a3be8c', danger: '#ef9ba2',
      hint: '#ebcb8b', 'on-hint': '#30291f', 'hint-border': '#ab9368',
      'selection-rgb': '136, 192, 208', 'selection-opacity': '0.52',
    },
    gruvbox: {
      scheme: 'dark', surface: '#282828', recessed: '#1d2021', control: '#3c3836',
      selected: '#504945', border: '#7c6f64', text: '#ebdbb2', muted: '#c7b89d',
      accent: '#8ec07c', success: '#b8bb26', danger: '#fb8273',
      hint: '#fabd2f', 'on-hint': '#342914', 'hint-border': '#a8813a',
      'selection-rgb': '250, 189, 47', 'selection-opacity': '0.48',
    },
    dracula: {
      scheme: 'dark', surface: '#282a36', recessed: '#21222c',
      control: '#343746', selected: '#44475a', border: '#6272a4',
      text: '#f8f8f2', muted: '#b8bad0', accent: '#bd93f9',
      success: '#50fa7b', danger: '#ff5555', hint: '#f1fa8c',
      'on-hint': '#282a36', 'hint-border': '#a4ae52',
      'selection-rgb': '189, 147, 249', 'selection-opacity': '0.45',
    },
    onedark: {
      scheme: 'dark', surface: '#282c34', recessed: '#21252b',
      control: '#303640', selected: '#3e4451', border: '#616a79',
      text: '#abb2bf', muted: '#9da5b4', accent: '#61afef',
      success: '#98c379', danger: '#e06c75', hint: '#e5c07b',
      'on-hint': '#282c34', 'hint-border': '#aa8949',
      'selection-rgb': '97, 175, 239', 'selection-opacity': '0.45',
    },
    tokyonight: {
      scheme: 'dark', surface: '#1a1b26', recessed: '#16161e',
      control: '#24283b', selected: '#33405b', border: '#565f89',
      text: '#c0caf5', muted: '#a9b1d6', accent: '#7aa2f7',
      success: '#9ece6a', danger: '#f7768e', hint: '#e0af68',
      'on-hint': '#1a1b26', 'hint-border': '#a98248',
      'selection-rgb': '122, 162, 247', 'selection-opacity': '0.45',
    },
    solarizeddark: {
      scheme: 'dark', surface: '#002b36', recessed: '#00212b',
      control: '#073642', selected: '#174653', border: '#586e75',
      text: '#eee8d5', muted: '#a4b5b7', accent: '#56b4ee',
      success: '#a5b51e', danger: '#ff6b64', hint: '#f1bb48',
      'on-hint': '#002b36', 'hint-border': '#9a741d',
      'selection-rgb': '86, 180, 238', 'selection-opacity': '0.45',
    },
    solarizedlight: {
      scheme: 'light', surface: '#fdf6e3', recessed: '#eee8d5',
      control: '#f0e8d2', selected: '#e3e0c8', border: '#889a99',
      text: '#344e58', muted: '#4e646a', accent: '#096fa4',
      success: '#526200', danger: '#a82d29', hint: '#f4cf72',
      'on-hint': '#422c10', 'hint-border': '#87620a',
      'selection-rgb': '9, 111, 164', 'selection-opacity': '0.45',
    },
  },

  customKeys: [
    'surface', 'recessed', 'control', 'selected', 'border', 'text', 'muted',
    'accent', 'success', 'danger', 'hint', 'on-hint', 'hint-border',
  ],

  customPalette(value) {
    const palette = { ...this.palettes.mocha, scheme: value?.scheme === 'light' ? 'light' : 'dark' };
    for (const key of this.customKeys) {
      const color = value?.[key];
      if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) palette[key] = color;
    }
    palette['selection-rgb'] = palette.accent.slice(1).match(/../g)
      .map(channel => parseInt(channel, 16)).join(', ');
    palette['selection-opacity'] = palette.scheme === 'light' ? '0.35' : '0.52';
    return palette;
  },

  readCustom() {
    let value;
    try { value = JSON.parse(this.prefs().getStringPref(this.customPref, '{}')); } catch (_) {}
    return this.customPalette(value);
  },

  prefs() {
    if (typeof Services !== 'undefined') return Services.prefs;
    return Components.classes['@mozilla.org/preferences-service;1']
      .getService(Components.interfaces.nsIPrefBranch);
  },

  observe() {
    const css = this.stylesheet();
    for (const [doc, { style }] of this.documents) {
      try { style.textContent = css; } catch (_) { this.detach(doc); }
    }
  },

  stylesheet() {
    let theme;
    try { theme = this.prefs().getStringPref(this.pref, 'classic'); } catch (_) {}
    if (!Object.hasOwn(this.palettes, theme) && theme !== 'custom' && theme !== 'system') {
      theme = 'classic';
    }
    if (theme === 'classic') {
      // Keep Classic colors on plugin UI surfaces so native editor decorations
      // and PDF selections retain their own contrast and color settings.
      const surfaces = [
        '#zv-shortcut-help', '#zv-settings-overlay', '#zv-picker-overlay',
        '#zv-notes-layout-overlay', '#zv-spacekeys', '#zv-main-status',
        '#zotero-vim-mode-indicator', '#zv-outline-picker', '#zv-outline-explorer',
        '#zv-marks-explorer', '#zv-translation-popup', '#zv-annotation-comment',
        '#zv-flash-panel', '[data-zv-link-preview]',
      ];
      return this.rules(this.palettes.classic, surfaces.join(','));
    }
    if (theme === 'custom') return this.rules(this.readCustom());
    if (theme === 'system') {
      return this.rules(this.palettes.latte)
        + '@media (prefers-color-scheme: dark) {' + this.rules(this.palettes.mocha) + '}';
    }
    return this.rules(this.palettes[theme]);
  },

  rules(palette, selector = ':root') {
    const colors = { ...palette };
    colors['hint-text'] = palette.scheme === 'light' ? '#795006' : palette.hint;
    for (const role of ['accent', 'success', 'danger', 'hint']) {
      colors[role + '-tint'] = 'color-mix(in srgb,' + palette[role] + ' 26%,' + palette.surface + ')';
    }
    colors['accent-faint'] = 'color-mix(in srgb,' + palette.accent + ' 15%,transparent)';
    colors['hint-faint'] = 'color-mix(in srgb,' + palette.hint + ' 32%,transparent)';
    return selector + '{' + Object.entries(colors)
      .map(([key, value]) => '--zv-theme-' + key + ':' + value)
      .join(';') + '}';
  },

  /** Attach to a chrome or content document and release it when its window unloads. */
  attach(doc) {
    if (!doc?.defaultView || this.documents.has(doc)) return;
    try {
      const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
      style.textContent = this.stylesheet();
      (doc.head || doc.documentElement).appendChild(style);
      const unload = () => this.detach(doc);
      this.documents.set(doc, { style, unload });
      doc.defaultView.addEventListener('unload', unload);
      if (!this.observing) {
        this.prefs().addObserver(this.pref, this);
        this.observing = true;
      }
    } catch (error) {
      this.detach(doc);
      Zotero.debug('[ZoteroVim] theme attach: ' + error);
    }
  },

  detach(doc) {
    const entry = this.documents.get(doc);
    if (!entry) return;
    this.documents.delete(doc);
    try {
      doc.defaultView?.removeEventListener('unload', entry.unload);
      entry.style.remove();
    } catch (_) {}
    if (this.observing && !this.documents.size) {
      this.prefs().removeObserver(this.pref, this);
      this.observing = false;
    }
  },

  shutdown() {
    for (const doc of this.documents.keys()) this.detach(doc);
  },
};

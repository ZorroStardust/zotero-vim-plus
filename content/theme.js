/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */

// Theme variables are defined on each host document so they also reach plugin
// UI inside the reader and note iframes. Only plugin styles consume them.
var ZV_THEME = {
  pref: 'extensions.zotero-vim@zotero-vim.theme',
  documents: new Map(),
  observing: false,
  palettes: {
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
    if (theme === 'system') {
      return this.rules(this.palettes.latte)
        + '@media (prefers-color-scheme: dark) {' + this.rules(this.palettes.mocha) + '}';
    }
    return Object.hasOwn(this.palettes, theme) ? this.rules(this.palettes[theme]) : '';
  },

  rules(palette) {
    const colors = { ...palette };
    colors['hint-text'] = palette.scheme === 'light' ? '#795006' : palette.hint;
    for (const role of ['accent', 'success', 'danger', 'hint']) {
      colors[role + '-tint'] = 'color-mix(in srgb,' + palette[role] + ' 26%,' + palette.surface + ')';
    }
    colors['accent-faint'] = 'color-mix(in srgb,' + palette.accent + ' 15%,transparent)';
    colors['hint-faint'] = 'color-mix(in srgb,' + palette.hint + ' 32%,transparent)';
    return ':root{' + Object.entries(colors)
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

/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */

/**
 * Zotero Vim — main plugin object.
 *
 * Architecture:
 *   Zotero's PDF reader is a 3-level iframe stack:
 *     1. Zotero chrome window
 *     2. reader.html  (reader._iframeWindow)            — React app
 *     3. PDF.js iframe (reader._internalReader._primaryView._iframeWindow)
 *
 *   We inject a keydown listener (capture) into the inner PDF.js window.
 *   For annotation creation we first try Zotero's renderTextSelectionPopup
 *   hook; if that fails we compute PDF-coordinate rects from the DOM
 *   selection and call new Zotero.Item() directly.
 */

var ZoteroVim = {

  // ── Constants ────────────────────────────────────────────────────────────

  PREF_PREFIX: 'extensions.zotero-vim@zotero-vim',

  COLORS: {
    yellow: '#ffd400',
    red:    '#ff6666',
    green:  '#5fb236',
    blue:   '#2ea8e5',
    purple: '#a28ae5',
  },

  DEFAULT_BINDINGS: {
    // Normal mode — navigation
    'normal:j':       'scrollDown',
    'normal:k':       'scrollUp',
    'normal:h':       'prevPage',
    'normal:l':       'nextPage',
    'normal:gg':      'firstPage',
    'normal:G':       'lastPage',
    'normal:ctrl+d':  'halfPageDown',
    'normal:ctrl+u':  'halfPageUp',
    'normal:ctrl+f':  'fullPageDown',
    'normal:ctrl+b':  'fullPageUp',
    'normal:/':       'openSearch',
    'normal:[':       'prevAnnotation',
    'normal:]':       'nextAnnotation',
    'normal:return':  'editAnnotation',
    'normal:dd':      'deleteAnnotation',
    'normal:y':       'yankAnnotation',
    'normal:yy':      'yankAnnotationComment',
    'normal:zy':      'recolorYellow',
    'normal:zr':      'recolorRed',
    'normal:zg':      'recolorGreen',
    'normal:zb':      'recolorBlue',
    'normal:zp':      'recolorPurple',
    'normal:zt':      'scrollTop',
    'normal:zz':      'scrollCenter',
    'normal:v':       'enterVisual',
    'normal:i':       'enterInsert',
    'normal:escape':  'clearSearch',

    // Visual mode — selection extension
    'visual:j':       'extendDown',
    'visual:k':       'extendUp',
    'visual:h':       'extendLeft',
    'visual:l':       'extendRight',
    'visual:)':       'extendSentenceForward',
    'visual:(':       'extendSentenceBackward',
    'visual:}':       'extendParagraphForward',
    'visual:{':       'extendParagraphBackward',
    'visual:w':       'extendWordForward',
    'visual:b':       'extendWordBackward',
    // Visual mode — annotation
    'visual:zy':      'highlightYellow',
    'visual:zr':      'highlightRed',
    'visual:zg':      'highlightGreen',
    'visual:zb':      'highlightBlue',
    'visual:zp':      'highlightPurple',
    'visual:za':      'addNote',
    'visual:y':       'copySelection',
    'visual:yy':      'yankParagraph',
    // Visual mode — swap anchor/focus
    'visual:o':       'swapVisualEnds',
    // Visual mode — exit
    'visual:v':       'exitMode',
    'visual:escape':  'exitMode',

    // Insert / passthrough mode
    'insert:escape':  'exitMode',
  },

  // ── State ─────────────────────────────────────────────────────────────────

  id: null,
  version: null,
  rootURI: null,

  _injectedReaders: new Set(),
  _readerState: new Map(),          // instanceID → state
  _readerStateByItemID: new Map(),  // itemID → state  (fallback lookup)
  _windows: new Set(),
  _readerListenerIDs: [],

  // Plugin-level cache: renderTextSelectionPopup params, regardless of which
  // reader fired them.  Used when per-reader state lookup fails.
  _lastSelectionParams: null,
  _lastSelectionTS: 0,

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this._registerPrefsPane();
    this._registerReaderListeners();
    Zotero.debug('[ZoteroVim] Initialized v' + version);
  },

  shutdown() {
    for (const listenerID of this._readerListenerIDs) {
      try { Zotero.Reader.unregisterEventListener(listenerID); } catch (_) {}
    }
    this._readerListenerIDs = [];
    for (const [, state] of this._readerState) {
      try { state.cleanup(); } catch (_) {}
    }
    this._readerState.clear();
    this._readerStateByItemID.clear();
    this._injectedReaders.clear();
    this._lastSelectionParams = null;
    for (const win of this._windows) { this._removeFromWindow(win); }
    this._windows.clear();
    Zotero.debug('[ZoteroVim] Shut down');
  },

  // ── Window management ─────────────────────────────────────────────────────

  addToWindow(win) {
    if (!win || this._windows.has(win)) return;
    this._windows.add(win);
  },

  removeFromWindow(win) {
    this._removeFromWindow(win);
    this._windows.delete(win);
  },

  _removeFromWindow(_win) {},

  // ── Preferences ──────────────────────────────────────────────────────────

  _registerPrefsPane() {
    if (!Zotero.PreferencePanes) return;
    Zotero.PreferencePanes.register({
      pluginID: this.id,
      src:      this.rootURI + 'content/preferences.xhtml',
      scripts:  [this.rootURI + 'content/prefs.js'],
      label:    'Zotero Vim',
      image:    this.rootURI + 'icons/vim.svg',
    });
  },

  getPref(key, defaultValue) {
    try {
      const fullKey = this.PREF_PREFIX + '.' + key;
      const ps = Services.prefs;
      const t = ps.getPrefType(fullKey);
      if (t === 0) return defaultValue;
      if (t === 128) return ps.getBoolPref(fullKey);
      if (t === 64)  return ps.getIntPref(fullKey);
      return ps.getStringPref(fullKey);
    } catch (_) { return defaultValue; }
  },

  setPref(key, value) {
    const fullKey = this.PREF_PREFIX + '.' + key;
    const ps = Services.prefs;
    if (typeof value === 'boolean')     ps.setBoolPref(fullKey, value);
    else if (typeof value === 'number') ps.setIntPref(fullKey, value);
    else                                ps.setStringPref(fullKey, String(value));
  },

  getBindings() {
    try {
      const raw = this.getPref('bindings', '');
      if (raw) return Object.assign({}, this.DEFAULT_BINDINGS, JSON.parse(raw));
    } catch (_) {}
    return Object.assign({}, this.DEFAULT_BINDINGS);
  },

  getScrollStep() { return this.getPref('scrollStep', 60); },

  getDefaultHighlightColor() {
    const name = this.getPref('defaultHighlightColor', 'yellow');
    return this.COLORS[name] || this.COLORS.yellow;
  },

  isModeEnabled(mode) {
    if (mode === 'normal') return true;
    return this.getPref('mode.' + mode + '.enabled', true);
  },

  // ── Reader event listeners ────────────────────────────────────────────────

  _registerReaderListeners() {
    this._readerListenerIDs.push(
      Zotero.Reader.registerEventListener(
        'renderToolbar',
        (event) => this._onRenderToolbar(event),
        this.id
      )
    );
    this._readerListenerIDs.push(
      Zotero.Reader.registerEventListener(
        'renderTextSelectionPopup',
        (event) => this._onTextSelectionPopup(event),
        this.id
      )
    );
  },

  _onRenderToolbar(event) {
    const { reader } = event;
    if (!reader || !reader._instanceID) return;
    const id = reader._instanceID;
    if (this._injectedReaders.has(id)) return;
    this._injectedReaders.add(id);
    this._waitAndInject(reader);
  },

  /**
   * Cache the selection params provided by Zotero for annotation creation.
   * Uses multiple lookup strategies to find the right state, since the
   * reader object in this event may differ from the one in renderToolbar.
   */
  _onTextSelectionPopup(event) {
    const params = event?.params;
    if (!params?.annotation || !params?.onAddAnnotation) return;

    const reader = event.reader;
    let state = null;

    // Strategy 1: match by _instanceID (normal case)
    if (reader?._instanceID) {
      state = this._readerState.get(reader._instanceID);
    }
    // Strategy 2: match by itemID
    if (!state && reader?.itemID) {
      state = this._readerStateByItemID.get(reader.itemID);
    }
    // Strategy 3: only one reader open
    if (!state && this._readerState.size === 1) {
      state = [...this._readerState.values()][0];
    }
    // Strategy 4: find a reader in visual mode
    if (!state) {
      for (const [, s] of this._readerState) {
        if (s.mode === 'visual') { state = s; break; }
      }
    }
    // Strategy 5: any reader
    if (!state && this._readerState.size > 0) {
      state = [...this._readerState.values()][0];
    }

    // Always cache at the plugin level — this covers cases where the
    // per-reader state lookup returns null.
    this._lastSelectionParams = params;
    this._lastSelectionTS = Date.now();
    Zotero.debug('[ZoteroVim] renderTextSelectionPopup: cached params globally');

    if (!state) return;
    state.selectionParams = params;

    if (this.isModeEnabled('visual') && state.mode === 'normal') {
      this._setMode(state, 'visual');
    }
  },

  // ── Reader injection ──────────────────────────────────────────────────────

  _waitAndInject(reader, attempts = 0) {
    if (attempts > 100) return;
    let pdfWin;
    try { pdfWin = reader._internalReader?._primaryView?._iframeWindow; } catch (_) {}
    if (!pdfWin) {
      setTimeout(() => this._waitAndInject(reader, attempts + 1), 100);
      return;
    }
    this._injectIntoReader(reader, pdfWin);
  },

  _injectIntoReader(reader, pdfWin) {
    const instanceID = reader._instanceID;
    Zotero.debug('[ZoteroVim] Injecting into reader ' + instanceID);

    const state = {
      mode: 'normal',
      keyBuffer: '',
      countBuffer: '',      // digit prefix typed before a command (e.g. "10" in "10G")
      keyTimeout: null,
      selectionParams: null,
      indicatorEl: null,
      hintMode: false,
      hintMap: {},
      visualCursor: null,   // { textNode, offset } — restored if selection lost
      reader: reader,       // reference for direct annotation creation
      pdfWin: pdfWin,       // stored for _setMode → _clearVisualHints
      cleanup: () => {},
    };
    this._readerState.set(instanceID, state);
    if (reader.itemID) {
      this._readerStateByItemID.set(reader.itemID, state);
    }

    const outerDoc = reader._iframeWindow?.document;
    if (outerDoc) {
      state.indicatorEl = this._createModeIndicator(outerDoc);
    }

    // Force text-layer spans to be selectable and show selection highlight.
    this._injectSelectionCSS(pdfWin);

    const keyHandler = (e) => this._onKeyDown(e, reader, state, pdfWin);
    // Register on the WINDOW (not document) so we capture keys before PDF.js's
    // own window-level keydown handlers (which handle j/k scrolling etc.).
    pdfWin.addEventListener('keydown', keyHandler, true);

    // Clear cached params when selection becomes collapsed.
    const selectionHandler = () => {
      try {
        const sel = pdfWin.getSelection?.();
        if (!sel || sel.isCollapsed) state.selectionParams = null;
      } catch (_) {}
    };
    pdfWin.document.addEventListener('selectionchange', selectionHandler);

    // ── Outer reader.html: Escape returns from annotation comment editing ──
    // When the user focuses a comment textarea (in the outer reader.html doc),
    // Escape should blur it and return focus+mode to the PDF viewer.
    // (outerDoc is already declared above for the mode indicator.)
    const outerEscapeHandler = (e) => {
      if (e.key !== 'Escape') return;
      const active = outerDoc?.activeElement;
      if (!active) return;
      if (active.tagName === 'TEXTAREA' || active.isContentEditable ||
          active.tagName === 'INPUT') {
        e.preventDefault();
        e.stopPropagation();
        active.blur();
        this._setMode(state, 'normal');
        setTimeout(() => { try { pdfWin.focus(); } catch (_) {} }, 30);
      }
    };
    if (outerDoc) {
      outerDoc.addEventListener('keydown', outerEscapeHandler, true);
    }

    state.cleanup = () => {
      pdfWin.removeEventListener('keydown', keyHandler, true);
      pdfWin.document.removeEventListener('selectionchange', selectionHandler);
      if (outerDoc) outerDoc.removeEventListener('keydown', outerEscapeHandler, true);
      state.indicatorEl?.remove();
      clearTimeout(state.keyTimeout);
      if (reader.itemID) this._readerStateByItemID.delete(reader.itemID);
    };
  },

  // ── Mode indicator ────────────────────────────────────────────────────────

  _createModeIndicator(doc) {
    const el = doc.createElement('div');
    el.id = 'zotero-vim-mode-indicator';
    el.setAttribute('style', [
      'position:fixed', 'bottom:10px', 'right:14px', 'z-index:9999',
      'font:bold 12px/1.4 monospace', 'color:#fff',
      'background:rgba(0,0,0,0.65)', 'padding:2px 8px',
      'border-radius:3px', 'pointer-events:none',
      'display:none', 'user-select:none',
    ].join(';'));
    doc.body?.appendChild(el);
    return el;
  },

  /** Inject CSS into the PDF.js iframe to ensure text is selectable. */
  _injectSelectionCSS(pdfWin) {
    try {
      const doc = pdfWin.document;
      if (doc.getElementById('zv-sel-css')) return;
      const s = doc.createElement('style');
      s.id = 'zv-sel-css';
      s.textContent = [
        // Force user-select on the text layer so programmatic selection shows.
        '.textLayer { user-select: text !important; -moz-user-select: text !important; }',
        '.textLayer span { user-select: text !important; cursor: text !important; }',
        // Visible selection colour in both light and dark themes.
        '.textLayer ::selection { background: rgba(0, 140, 255, 0.6) !important; color: inherit !important; }',
        '@media (prefers-color-scheme: dark) {',
        '  .textLayer ::selection { background: rgba(255, 180, 0, 0.75) !important; color: inherit !important; }',
        '}',
      ].join('\n');
      (doc.head || doc.documentElement).appendChild(s);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _injectSelectionCSS error: ' + e);
    }
  },

  /** Briefly flash a message in the mode indicator (for visible debugging). */
  _showStatus(state, msg, ms = 2000) {
    if (!state.indicatorEl) return;
    const el = state.indicatorEl;
    el.style.display = 'block';
    el.textContent = msg;
    el.style.background =
      msg.startsWith('✓') ? 'rgba(50,150,50,0.9)'    :  // green  — success
      msg.startsWith('→') ? 'rgba(60,100,180,0.9)'   :  // blue   — info/navigation
      msg.startsWith('▶') ? 'rgba(60,100,180,0.9)'   :  // blue   — action in progress
                            'rgba(180,40,40,0.9)';       // red    — error (✗ / other)
    clearTimeout(state._statusTimer);
    state._statusTimer = setTimeout(() => {
      if (state.mode === 'normal') el.style.display = 'none';
      else this._updateIndicator(state);  // restore mode colour
    }, ms);
  },

  _setMode(state, mode) {
    state.mode = mode;
    state.keyBuffer = '';
    clearTimeout(state.keyTimeout);
    state.keyTimeout = null;
    if (state.hintMode) this._clearVisualHints(state, state.pdfWin);
    this._updateIndicator(state);
  },

  /** Refresh the mode indicator text (mode + any pending key buffer). */
  _updateIndicator(state, bufferOverride) {
    if (!state.indicatorEl) return;
    const mode   = state.mode;
    const buffer = bufferOverride !== undefined ? bufferOverride : state.keyBuffer;
    if (mode === 'normal' && !buffer && !state.countBuffer) {
      state.indicatorEl.style.display = 'none';
      return;
    }
    state.indicatorEl.style.display = 'block';
    const prefix = (state.countBuffer && mode === 'normal') ? state.countBuffer : '';
    state.indicatorEl.textContent =
      '-- ' + mode.toUpperCase() + ' --' + (prefix || buffer ? '  ' + prefix + buffer : '');
    state.indicatorEl.style.background =
      mode === 'visual' ? 'rgba(80,120,200,0.85)' :
      mode === 'insert' ? 'rgba(50,150,80,0.85)'  : 'rgba(0,0,0,0.65)';
  },

  // ── Key handling ──────────────────────────────────────────────────────────

  _onKeyDown(event, reader, state, pdfWin) {
    // Hint mode: user is picking a selection starting point.
    if (state.hintMode) {
      event.preventDefault();
      event.stopPropagation();
      const key = event.key;
      if (key === 'Escape') {
        this._clearVisualHints(state, pdfWin);
        this._setMode(state, 'normal');
      } else if (/^[a-z]$/.test(key) && state.hintMap[key]) {
        this._selectHint(state, pdfWin, key);
      }
      return;
    }

    // Insert mode: pass through except Escape.
    if (state.mode === 'insert') {
      const k = this._keyString(event);
      if (k === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        this._setMode(state, 'normal');
      }
      return;
    }

    // Ignore when a form element is focused.
    const target = event.target;
    if (target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    )) return;

    const keyStr = this._keyString(event);
    if (!keyStr) return;

    // Accumulate a count prefix (1–9 to start, 0 to extend) in normal mode.
    if (state.mode === 'normal' && /^\d$/.test(keyStr)) {
      if (keyStr !== '0' || state.countBuffer) {
        state.countBuffer = (state.countBuffer || '') + keyStr;
        event.preventDefault();
        event.stopPropagation();
        this._updateIndicator(state);
        return;
      }
    }

    const newBuffer = state.keyBuffer + keyStr;
    const bindings  = this.getBindings();
    const modePrefix = state.mode + ':';

    const possible = Object.keys(bindings).filter(k => k.startsWith(modePrefix + newBuffer));
    const exact    = bindings[modePrefix + newBuffer];

    if (possible.length === 0 && !exact) {
      state.keyBuffer = '';
      state.countBuffer = '';
      clearTimeout(state.keyTimeout);
      state.keyTimeout = null;
      const sp = Object.keys(bindings).filter(k => k.startsWith(modePrefix + keyStr));
      const se = bindings[modePrefix + keyStr];
      if (sp.length === 0 && !se) return;
      this._processBuffer(keyStr, se, sp, modePrefix, bindings, state, reader, pdfWin, event);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this._processBuffer(newBuffer, exact, possible, modePrefix, bindings, state, reader, pdfWin, event);
  },

  _processBuffer(buffer, exact, possible, modePrefix, bindings, state, reader, pdfWin, event) {
    clearTimeout(state.keyTimeout);
    state.keyTimeout = null;
    const longerPossible = possible.filter(k => k.length > modePrefix.length + buffer.length);

    if (exact && longerPossible.length === 0) {
      state.keyBuffer = '';
      const count = state.countBuffer ? parseInt(state.countBuffer, 10) : 0;
      state.countBuffer = '';
      this._updateIndicator(state);   // clear buffer display before action
      this._executeAction(bindings[modePrefix + buffer], reader, state, pdfWin, count);
      return;
    }
    if (exact && longerPossible.length > 0) {
      state.keyBuffer = buffer;
      this._updateIndicator(state);
      state.keyTimeout = setTimeout(() => {
        state.keyBuffer = '';
        const count = state.countBuffer ? parseInt(state.countBuffer, 10) : 0;
        state.countBuffer = '';
        this._updateIndicator(state);
        this._executeAction(exact, reader, state, pdfWin, count);
      }, 800);
      return;
    }
    if (!exact && possible.length > 0) {
      state.keyBuffer = buffer;
      this._updateIndicator(state);   // show pending buffer (e.g. "z" waiting for next key)
      state.keyTimeout = setTimeout(() => {
        state.keyBuffer = '';
        state.countBuffer = '';
        this._updateIndicator(state);
      }, 1200);
      return;
    }
    state.keyBuffer = '';
    state.countBuffer = '';
    this._updateIndicator(state);
  },

  _keyString(event) {
    const key = event.key;
    if (!key || key === 'Dead' || key === 'Unidentified') return '';
    if (['Control', 'Alt', 'Meta', 'Shift', 'CapsLock'].includes(key)) return '';
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    parts.push(key.length === 1 ? key : key.toLowerCase());
    return parts.join('+');
  },

  // ── Action dispatcher ─────────────────────────────────────────────────────

  _executeAction(action, reader, state, pdfWin, count = 0) {
    Zotero.debug('[ZoteroVim] Action: ' + action + ' (mode:' + state.mode + ', count:' + count + ')');

    const step = this.getScrollStep();
    const getContainer = () =>
      pdfWin.PDFViewerApplication?.pdfViewer?.container ||
      pdfWin.document.getElementById('viewerContainer');
    const scrollBy  = (dy) => { try { getContainer()?.scrollBy(0, dy); } catch (_) {} };
    const viewportH = () => { try { return getContainer()?.clientHeight || 600; } catch (_) { return 600; } };

    // Scrolling / page navigation clears any active annotation selection so that
    // zb (recolorBlue) correctly falls through to the scroll-to-bottom path.
    const clearAnnotation = () => { state.lastAnnotationKey = null; };

    switch (action) {
      case 'scrollDown':    clearAnnotation(); scrollBy(step);                         break;
      case 'scrollUp':      clearAnnotation(); scrollBy(-step);                        break;
      case 'halfPageDown':  clearAnnotation(); scrollBy(Math.round(viewportH() / 2)); break;
      case 'halfPageUp':    clearAnnotation(); scrollBy(-Math.round(viewportH() / 2));break;
      case 'fullPageDown':  clearAnnotation(); scrollBy(viewportH());                  break;
      case 'fullPageUp':    clearAnnotation(); scrollBy(-viewportH());                 break;
      case 'scrollTop':    clearAnnotation(); this._scrollToPagePosition(pdfWin, 'top');    break;
      case 'scrollCenter': clearAnnotation(); this._scrollToPagePosition(pdfWin, 'center'); break;
      case 'scrollBottom': clearAnnotation(); this._scrollToPagePosition(pdfWin, 'bottom'); break;

      case 'prevPage':
        clearAnnotation();
        try { reader._internalReader.navigateToPreviousPage(); } catch (e) {
          Zotero.debug('[ZoteroVim] prevPage: ' + e); } break;
      case 'nextPage':
        clearAnnotation();
        try { reader._internalReader.navigateToNextPage(); } catch (e) {
          Zotero.debug('[ZoteroVim] nextPage: ' + e); } break;
      case 'firstPage':
        clearAnnotation();
        try { reader._internalReader.navigateToFirstPage(); } catch (e) {
          Zotero.debug('[ZoteroVim] firstPage: ' + e); } break;
      case 'lastPage':
        clearAnnotation();
        if (count > 0) {
          try {
            const readerWin = reader._iframeWindow;
            reader._internalReader.navigate(Cu.cloneInto({ pageIndex: count - 1 }, readerWin));
            Zotero.debug('[ZoteroVim] navigate pageIndex=' + (count - 1));
          } catch (e) {
            Zotero.debug('[ZoteroVim] goToPage: ' + e); }
        } else {
          try { reader._internalReader.navigateToLastPage(); } catch (e) {
            Zotero.debug('[ZoteroVim] lastPage: ' + e); }
        }
        break;

      case 'openSearch':      this._openSearch(reader, pdfWin);           break;
      case 'prevAnnotation':  this._navigateAnnotation(state, reader, -1); break;
      case 'nextAnnotation':  this._navigateAnnotation(state, reader, +1); break;
      case 'editAnnotation':    this._editAnnotation(state, reader);         break;
      case 'deleteAnnotation':  this._deleteAnnotation(state, reader);                        break;
      case 'recolorYellow':   this._recolorAnnotation(state, reader, this.COLORS.yellow); break;
      case 'recolorRed':      this._recolorAnnotation(state, reader, this.COLORS.red);    break;
      case 'recolorGreen':    this._recolorAnnotation(state, reader, this.COLORS.green);  break;
      case 'recolorBlue':
        if (state.lastAnnotationKey) {
          this._recolorAnnotation(state, reader, this.COLORS.blue);
        } else {
          this._scrollToPagePosition(pdfWin, 'bottom');
        }
        break;
      case 'recolorPurple':   this._recolorAnnotation(state, reader, this.COLORS.purple); break;
      case 'yankAnnotation':        this._yankAnnotation(state, reader);          break;
      case 'yankAnnotationComment': this._yankAnnotationComment(state, reader);  break;
      case 'yankParagraph':         this._yankParagraph(state, pdfWin);           break;
      case 'clearSearch':       this._clearSearch(pdfWin);                  break;

      case 'enterVisual':
        if (this.isModeEnabled('visual')) this._enterVisualMode(state, pdfWin);
        break;
      case 'enterInsert':
        if (this.isModeEnabled('insert')) {
          this._setMode(state, 'insert');
          // If an annotation is currently selected, focus its comment field.
          if (state.lastAnnotationKey) {
            this._focusAnnotationComment(state, reader);
          }
        }
        break;
      case 'exitMode':
        this._setMode(state, 'normal');
        try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
        break;

      // Visual selection via caretPositionFromPoint (j/k)
      // and Selection.modify() for character/word/paragraph.
      case 'extendDown':              this._extendByLine(state, pdfWin, +1);  break;
      case 'extendUp':                this._extendByLine(state, pdfWin, -1);  break;
      case 'extendRight':             this._extendByChar(state, pdfWin, +1);               break;
      case 'extendLeft':              this._extendByChar(state, pdfWin, -1);               break;
      case 'extendWordForward':        this._selModify(pdfWin, 'extend', 'forward',  'word'); break;
      case 'extendWordBackward':       this._selModify(pdfWin, 'extend', 'backward', 'word'); break;
      case 'extendSentenceForward':    this._extendBySentence(state, pdfWin, +1);             break;
      case 'extendSentenceBackward':   this._extendBySentence(state, pdfWin, -1);             break;
      case 'extendParagraphForward':   this._extendByParagraph(state, pdfWin, +1);            break;
      case 'extendParagraphBackward':  this._extendByParagraph(state, pdfWin, -1);            break;

      case 'highlightYellow':  this._highlight(state, reader, pdfWin, this.COLORS.yellow);  break;
      case 'highlightRed':     this._highlight(state, reader, pdfWin, this.COLORS.red);     break;
      case 'highlightGreen':   this._highlight(state, reader, pdfWin, this.COLORS.green);   break;
      case 'highlightBlue':    this._highlight(state, reader, pdfWin, this.COLORS.blue);    break;
      case 'highlightPurple':  this._highlight(state, reader, pdfWin, this.COLORS.purple);  break;
      case 'addNote':          this._addNote(state, reader, pdfWin);                         break;
      case 'copySelection':    this._copySelection(state, pdfWin);                           break;
      case 'swapVisualEnds':   this._swapVisualEnds(state, pdfWin);                          break;

      default: Zotero.debug('[ZoteroVim] Unknown action: ' + action);
    }
  },

  // ── Visual mode helpers ───────────────────────────────────────────────────

  _enterVisualMode(state, pdfWin) {
    state.visualCursor = null;   // always start fresh — old textNode may be stale
    this._setMode(state, 'visual');
    try {
      const sel = pdfWin.getSelection();
      if (sel && !sel.isCollapsed) return;   // keep existing mouse selection
    } catch (_) {}
    this._showVisualHints(state, pdfWin);
  },

  /**
   * Show Tridactyl-style letter hint badges at the start of each visible
   * sentence.  The user presses a letter to anchor selection at that point.
   */
  _showVisualHints(state, pdfWin) {
    this._clearVisualHints(state, pdfWin);
    const doc      = pdfWin.document;
    const hintChars = 'asdfjklghqwertyuiopzxcvbnm';
    const hints    = {};
    let charIdx    = 0;

    for (const { textNode, offset } of this._findSentenceStarts(pdfWin)) {
      if (charIdx >= hintChars.length) break;
      const letter = hintChars[charIdx++];

      // Compute badge position: rect of the character at this offset.
      let badgeLeft, badgeTop;
      try {
        const r = doc.createRange();
        r.setStart(textNode, offset);
        r.setEnd(textNode, Math.min(offset + 1, textNode.length));
        const rects = r.getClientRects();
        if (rects.length > 0) { badgeLeft = rects[0].left; badgeTop = rects[0].top; }
      } catch (_) {}
      if (badgeLeft === undefined) {
        const pr = textNode.parentElement?.getBoundingClientRect?.();
        if (!pr) { charIdx--; continue; }
        badgeLeft = pr.left; badgeTop = pr.top;
      }

      const badge = doc.createElement('div');
      badge.setAttribute('data-zv-hint', letter);
      badge.textContent = letter;
      badge.style.cssText =
        'position:fixed;' +
        'left:' + Math.max(0, Math.round(badgeLeft) - 2) + 'px;' +
        'top:'  + Math.round(badgeTop) + 'px;' +
        'background:#FFD400;color:#000;' +
        'font:bold 11px/1.4 monospace;' +
        'padding:0 3px;border-radius:2px;' +
        'z-index:99999;pointer-events:none;' +
        'border:1px solid #b8960c;' +
        'box-shadow:0 1px 3px rgba(0,0,0,.4);';
      doc.body.appendChild(badge);
      hints[letter] = { textNode, offset };
    }

    if (Object.keys(hints).length > 0) {
      state.hintMode = true;
      state.hintMap  = hints;
    } else {
      this._placeCursorAtFirstText(state, pdfWin);
    }
  },

  /**
   * Return { textNode, offset } pairs for every sentence start visible in the
   * PDF.js text layer.  Rules:
   *   1. First non-space character after a paragraph break (y-gap > 0.5 × lineH).
   *   2. First non-space character of a span when the previous span ended with
   *      sentence-ending punctuation (.!?) optionally followed by closing quotes.
   *   3. Positions within a span after the same punctuation + whitespace.
   */
  _findSentenceStarts(pdfWin) {
    const doc = pdfWin.document;
    const container =
      doc.getElementById('viewerContainer') ||
      doc.querySelector('.pdfViewer') || doc.body;
    const viewH = container.clientHeight;

    // Collect visible, non-empty text spans and sort top-to-bottom, left-to-right.
    const spans = Array.from(doc.querySelectorAll('.textLayer span')).filter(s => {
      const r = s.getBoundingClientRect();
      return r.top < viewH - 4 && r.bottom > 4 && r.width > 4 && r.height > 3 &&
             s.textContent.trim() && s.firstChild?.nodeType === 3;
    });
    spans.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const dy = ra.top - rb.top;
      return Math.abs(dy) > 5 ? dy : ra.left - rb.left;
    });

    const results = [];
    // Deduplicate: skip if we already have a hint on the same visual line.
    const lastHintTopAt = (rect) => {
      if (!results.length) return -Infinity;
      const prev = results[results.length - 1].textNode.parentElement?.getBoundingClientRect?.();
      return prev ? prev.top : -Infinity;
    };

    let prevRect = null;
    let prevText = '';

    for (const span of spans) {
      const textNode = span.firstChild;
      const text     = textNode.data;
      if (!text || !text.trim()) continue;
      const rect  = span.getBoundingClientRect();
      const lineH = Math.max(rect.height, 8);

      // Rule 1: large y-gap → paragraph break → sentence start
      const isNewBlock = !prevRect || rect.top > prevRect.bottom + lineH * 0.5;
      if (isNewBlock) {
        const off = text.search(/\S/);
        if (off >= 0 && Math.abs(rect.top - lastHintTopAt()) > 3) {
          results.push({ textNode, offset: off });
        }
      } else {
        // Rule 2: previous span ended a sentence
        if (/[.!?]['")\]]*\s*$/.test(prevText)) {
          const off = text.search(/\S/);
          if (off >= 0 && /[A-Z"'(\[]/.test(text[off]) &&
              Math.abs(rect.top - lastHintTopAt()) > 3) {
            results.push({ textNode, offset: off });
          }
        }

        // Rule 3: sentence starts inside this span
        const pat = /[.!?]['")\]]*\s+([A-Z"'(\[])/g;
        let m;
        while ((m = pat.exec(text)) !== null) {
          const off = m.index + m[0].length - m[1].length;
          // Compute y of this character to deduplicate against same-line hints
          let charTop = rect.top;
          try {
            const r = doc.createRange();
            r.setStart(textNode, off);
            r.setEnd(textNode, off + 1);
            const cr = r.getClientRects();
            if (cr.length > 0) charTop = cr[0].top;
          } catch (_) {}
          if (Math.abs(charTop - lastHintTopAt()) > 3) {
            results.push({ textNode, offset: off });
          }
        }
      }

      prevRect = rect;
      prevText = text;
    }

    return results;
  },

  _clearVisualHints(state, pdfWin) {
    state.hintMode = false;
    state.hintMap  = {};
    if (!pdfWin) return;
    try {
      for (const el of pdfWin.document.querySelectorAll('[data-zv-hint]')) el.remove();
    } catch (_) {}
  },

  _selectHint(state, pdfWin, letter) {
    const hint = state.hintMap?.[letter];
    this._clearVisualHints(state, pdfWin);
    if (!hint) return;
    try {
      const sel   = pdfWin.getSelection();
      const range = pdfWin.document.createRange();
      range.setStart(hint.textNode, hint.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      state.visualCursor = { textNode: hint.textNode, offset: hint.offset };
      pdfWin.focus();
      Zotero.debug('[ZoteroVim] Hint selected: ' + letter);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _selectHint error: ' + e);
    }
  },

  _placeCursorAtFirstText(state, pdfWin) {
    try {
      const span = pdfWin.document.querySelector('.textLayer span');
      if (!span) return;
      const textNode = span.firstChild;
      if (!textNode || textNode.nodeType !== 3) return;
      const sel   = pdfWin.getSelection();
      const range = pdfWin.document.createRange();
      range.setStart(textNode, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      state.visualCursor = { textNode, offset: 0 };
      pdfWin.focus();
    } catch (e) {
      Zotero.debug('[ZoteroVim] _placeCursorAtFirstText error: ' + e);
    }
  },

  /**
   * Extend selection up (direction=-1) or down (+1) by one line.
   *
   * PDF.js text spans are absolutely positioned so sel.modify('line') is
   * unreliable.  Instead we scan .textLayer spans for the nearest span whose
   * vertical midpoint is clearly above/below the current focus element, then
   * call sel.extend() to move the selection focus there.  sel.extend()
   * preserves the anchor, so the selection grows/shrinks correctly across
   * multiple j/k presses.
   */
  _extendByLine(state, pdfWin, direction) {
    try {
      pdfWin.focus();
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();
      if (!sel) return;

      // ── Ensure we have a selection anchor ──────────────────────────────
      // If the selection was lost (e.g. PDF.js cleared it), restore from the
      // saved visualCursor.  Otherwise save the current anchor.
      if (sel.rangeCount === 0 || sel.isCollapsed) {
        if (state.visualCursor) {
          try {
            const r = doc.createRange();
            r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          } catch (_) { return; }
        } else { return; }
      }
      // Always keep visualCursor in sync with the ANCHOR (not focus).
      state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };

      // ── Locate current focus element for geometry ───────────────────────
      const focusNode = sel.focusNode;
      if (!focusNode) return;
      const focusEl   = focusNode.nodeType === 3 ? focusNode.parentElement : focusNode;
      const focusRect = focusEl?.getBoundingClientRect?.();
      if (!focusRect || focusRect.height < 1) return;

      const focusMidX = (focusRect.left + focusRect.right) / 2;
      const focusMidY = (focusRect.top  + focusRect.bottom) / 2;
      const lineH     = Math.max(focusRect.height, 8);

      // ── Find target node / offset ──────────────────────────────────────
      let targetNode = null, targetOffset = 0;

      // Strategy 1: caretPositionFromPoint — native Gecko API.
      const targetY = focusMidY + direction * lineH * 1.5;
      const caret = doc.caretPositionFromPoint?.(focusMidX, targetY);
      if (caret?.offsetNode && caret.offsetNode !== focusNode) {
        targetNode   = caret.offsetNode;
        targetOffset = caret.offset;
        Zotero.debug('[ZoteroVim] _extendByLine: caretFromPoint → ' +
                     caret.offsetNode.textContent?.slice(0, 20));
      }

      // Strategy 2: scan .textLayer spans for nearest line.
      if (!targetNode) {
        const minDelta = lineH * 0.4;
        let bestSpan = null, bestAbsDy = Infinity, bestDist = Infinity;
        for (const span of doc.querySelectorAll('.textLayer span')) {
          const tn = span.firstChild;
          if (!tn || tn.nodeType !== 3 || !span.textContent.trim()) continue;
          const r = span.getBoundingClientRect();
          if (r.height < 2 || r.width < 2) continue;
          const midY = (r.top + r.bottom) / 2;
          const dy   = midY - focusMidY;
          if (direction > 0 && dy < minDelta)  continue;
          if (direction < 0 && dy > -minDelta) continue;
          const absDy = Math.abs(dy);
          const distX = Math.abs((r.left + r.right) / 2 - focusMidX);
          if (absDy < bestAbsDy - lineH * 0.4 ||
              (absDy < bestAbsDy + lineH * 0.4 && distX < bestDist)) {
            bestSpan = span; bestAbsDy = absDy; bestDist = distX;
          }
        }
        if (bestSpan?.firstChild?.nodeType === 3) {
          targetNode   = bestSpan.firstChild;
          targetOffset = 0;
          Zotero.debug('[ZoteroVim] _extendByLine: span fallback → ' +
                       targetNode.data?.slice(0, 20));
        }
      }

      if (!targetNode) {
        this._showStatus(state, '✗ j/k: no target node', 2000);
        Zotero.debug('[ZoteroVim] _extendByLine: could not find target node');
        return;
      }

      // ── Build range from saved anchor to new target ────────────────────
      // We use createRange + addRange instead of sel.extend() because
      // sel.extend() silently fails in PDF.js's non-editable text layer.
      const anchorNode   = state.visualCursor.textNode;
      const anchorOffset = state.visualCursor.offset;
      try {
        const range = doc.createRange();
        // Determine DOM order: is anchor before target?
        // Use the numeric constant (4) — Node is not in scope in the chrome sandbox.
        let anchorFirst = true;
        if (anchorNode !== targetNode) {
          const cmp = anchorNode.compareDocumentPosition(targetNode);
          anchorFirst = !!(cmp & 4);  // 4 = Node.DOCUMENT_POSITION_FOLLOWING
        } else {
          anchorFirst = anchorOffset <= targetOffset;
        }
        if (anchorFirst) {
          range.setStart(anchorNode, anchorOffset);
          range.setEnd(targetNode, targetOffset);
        } else {
          range.setStart(targetNode, targetOffset);
          range.setEnd(anchorNode, anchorOffset);
        }
        sel.removeAllRanges();
        sel.addRange(range);
        const selLen = sel.toString().length;
        Zotero.debug('[ZoteroVim] _extendByLine: range set, len=' + selLen);
        // Show selection length so user can verify j/k is working visually.
        this._showStatus(state, '▶ ' + selLen + ' chars', 600);
      } catch (e) {
        Zotero.debug('[ZoteroVim] _extendByLine range error: ' + e);
        this._showStatus(state, '✗ range err: ' + String(e).slice(0, 25), 3000);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByLine error: ' + e);
    }
  },

  /** Extend selection left/right by one character (h/l). */
  _extendByChar(state, pdfWin, direction) {
    // sel.modify works for character granularity in PDF.js.
    pdfWin.focus();
    const sel = pdfWin.getSelection();
    if (!sel) return;
    // Restore collapsed cursor from saved anchor if needed.
    if ((sel.rangeCount === 0 || sel.isCollapsed) && state.visualCursor) {
      try {
        const r = pdfWin.document.createRange();
        r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (_) {}
    }
    if (sel.rangeCount === 0) return;
    if (!state.visualCursor) {
      state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
    }
    sel.modify('extend', direction > 0 ? 'forward' : 'backward', 'character');
  },

  /**
   * Extend selection to the end (direction>0) or start (direction<0) of the
   * current paragraph.  Paragraph boundaries are detected as vertical gaps
   * between .textLayer spans that exceed 0.5× the local line height.
   *
   * Forward (}): extend to the end of the last span of the current paragraph.
   * Backward ({): extend to the start of the first span of the current
   *   paragraph (or the previous one if already at the start).
   */
  _extendByParagraph(state, pdfWin, direction) {
    try {
      pdfWin.focus();
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();
      if (!sel) return;

      // Restore/save anchor
      if ((sel.rangeCount === 0 || sel.isCollapsed) && state.visualCursor) {
        try {
          const r = doc.createRange();
          r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (_) { return; }
      }
      if (sel.rangeCount === 0) return;
      if (!state.visualCursor) {
        state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
      }

      // Collect and sort visible text spans top-to-bottom, left-to-right.
      const spans = Array.from(doc.querySelectorAll('.textLayer span')).filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 4 && r.height > 3 && s.textContent.trim() && s.firstChild?.nodeType === 3;
      });
      spans.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const dy = ra.top - rb.top;
        return Math.abs(dy) > 5 ? dy : ra.left - rb.left;
      });
      if (spans.length === 0) return;

      // Find which span contains the selection focus.
      const focusNode = sel.focusNode;
      const focusEl   = focusNode?.nodeType === 3 ? focusNode.parentElement : focusNode;
      let focusIdx    = spans.findIndex(s => s === focusEl || s.contains(focusEl));
      if (focusIdx < 0) focusIdx = direction > 0 ? 0 : spans.length - 1;

      // Line height for gap threshold.
      const fr          = spans[focusIdx].getBoundingClientRect();
      const lineH       = Math.max(fr.height, 8);
      const gapThreshold = lineH * 0.5;

      // Build paragraph boundary set: index i means gap between spans[i] and spans[i+1].
      const boundaries = [];
      for (let i = 0; i < spans.length - 1; i++) {
        const r1 = spans[i].getBoundingClientRect();
        const r2 = spans[i + 1].getBoundingClientRect();
        if (r2.top - r1.bottom > gapThreshold) boundaries.push(i);
      }

      let targetNode = null, targetOffset = 0;

      if (direction > 0) {
        // Forward: find first boundary index >= focusIdx.
        const bIdx = boundaries.find(b => b >= focusIdx);
        const lastSpan = bIdx !== undefined ? spans[bIdx] : spans[spans.length - 1];
        const tn = lastSpan.firstChild;
        if (tn && tn.nodeType === 3) { targetNode = tn; targetOffset = tn.data.length; }
      } else {
        // Backward: the current paragraph starts at the span right after the last
        // boundary whose index is < focusIdx (or spans[0] if none).
        const bBefore = boundaries.filter(b => b < focusIdx);
        const paraStart = bBefore.length > 0 ? bBefore[bBefore.length - 1] + 1 : 0;

        // If focus is already at the paragraph start, move to the previous paragraph's start.
        let startIdx = paraStart;
        if (focusIdx <= paraStart && bBefore.length > 0) {
          const bBefore2 = bBefore.slice(0, -1);
          startIdx = bBefore2.length > 0 ? bBefore2[bBefore2.length - 1] + 1 : 0;
        }

        const tn = spans[startIdx].firstChild;
        if (tn && tn.nodeType === 3) {
          const off = tn.data.search(/\S/);
          targetNode = tn; targetOffset = Math.max(0, off);
        }
      }

      if (!targetNode) return;

      // Build range from saved anchor to new target.
      const anchorNode   = state.visualCursor.textNode;
      const anchorOffset = state.visualCursor.offset;
      try {
        const range = doc.createRange();
        let anchorFirst = true;
        if (anchorNode !== targetNode) {
          anchorFirst = !!(anchorNode.compareDocumentPosition(targetNode) & 4);
        } else {
          anchorFirst = anchorOffset <= targetOffset;
        }
        if (anchorFirst) {
          range.setStart(anchorNode, anchorOffset);
          range.setEnd(targetNode, targetOffset);
        } else {
          range.setStart(targetNode, targetOffset);
          range.setEnd(anchorNode, anchorOffset);
        }
        sel.removeAllRanges();
        sel.addRange(range);
        const selLen = sel.toString().length;
        this._showStatus(state, '▶ ' + selLen + ' chars', 600);
        Zotero.debug('[ZoteroVim] _extendByParagraph dir=' + direction + ' len=' + selLen);
      } catch (e) {
        Zotero.debug('[ZoteroVim] _extendByParagraph range error: ' + e);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByParagraph error: ' + e);
    }
  },

  /**
   * Extend selection to the start of the next sentence (direction>0) or the
   * start of the current/previous sentence (direction<0).
   *
   * Sentence boundary: [.!?]['")\]]* followed by whitespace or end-of-node.
   *
   * Key: collect text nodes from ALL .textLayer spans (using querySelectorAll,
   * sorted by position) so multi-page documents work correctly.  A single
   * doc.querySelector('.textLayer') only returns the FIRST page's layer and
   * will miss nodes on page 2+.
   */
  _extendBySentence(state, pdfWin, direction) {
    try {
      pdfWin.focus();
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();
      if (!sel) return;

      // Restore anchor if selection is collapsed / gone.
      if ((sel.rangeCount === 0 || sel.isCollapsed) && state.visualCursor) {
        const vc = state.visualCursor;
        if (!vc.textNode.isConnected) {
          Zotero.debug('[ZoteroVim] _extendBySentence: visualCursor node detached');
          return;
        }
        try {
          const r = doc.createRange();
          r.setStart(vc.textNode, vc.offset);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (e) {
          Zotero.debug('[ZoteroVim] _extendBySentence: restore failed: ' + e);
          return;
        }
      }
      if (sel.rangeCount === 0) return;
      if (!state.visualCursor) {
        state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
      }

      // Build ordered list of non-empty text nodes from ALL .textLayer spans
      // (one .textLayer per PDF page — querySelectorAll returns them all).
      const spans = Array.from(doc.querySelectorAll('.textLayer span'));
      spans.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const dy = ra.top - rb.top;
        return Math.abs(dy) > 5 ? dy : ra.left - rb.left;
      });
      const textNodes = [];
      for (const sp of spans) {
        const tn = sp.firstChild;
        if (tn && tn.nodeType === 3 && tn.data?.trim()) textNodes.push(tn);
      }
      if (textNodes.length === 0) {
        Zotero.debug('[ZoteroVim] _extendBySentence: no text nodes found');
        return;
      }

      const focusNode   = sel.focusNode;
      const focusOffset = sel.focusOffset;

      // Find focusNode in our sorted list.
      let focusIdx = textNodes.indexOf(focusNode.nodeType === 3 ? focusNode : null);
      if (focusIdx < 0) {
        // focusNode might be an element wrapper — find the text node inside it.
        for (let i = 0; i < textNodes.length; i++) {
          if (textNodes[i].parentElement === focusNode ||
              focusNode?.contains?.(textNodes[i])) {
            focusIdx = i; break;
          }
        }
      }
      if (focusIdx < 0) {
        Zotero.debug('[ZoteroVim] _extendBySentence: focusNode not in textNodes ' +
                     '(type=' + focusNode?.nodeType + ' data="' +
                     (focusNode?.data || focusNode?.textContent || '').slice(0, 20) + '")');
        return;
      }

      // Sentence-end: [.!?] + optional closing chars + whitespace OR end of node.
      const SENT_END   = /[.!?]['")\]]*(?:\s+|$)/;
      const SENT_END_G = /[.!?]['")\]]*(?:\s+|$)/g;

      let targetNode = null, targetOffset = 0;

      if (direction > 0) {
        for (let i = focusIdx; i < textNodes.length; i++) {
          const tn       = textNodes[i];
          const text     = tn.data;
          const startPos = (i === focusIdx) ? focusOffset : 0;
          const sub      = text.slice(startPos);
          const m        = SENT_END.exec(sub);
          if (m) {
            const afterEnd = startPos + m.index + m[0].length;
            if (afterEnd < text.length) {
              targetNode = tn; targetOffset = afterEnd;
            } else {
              for (let j = i + 1; j < textNodes.length; j++) {
                const off = textNodes[j].data.search(/\S/);
                if (off >= 0) { targetNode = textNodes[j]; targetOffset = off; break; }
              }
            }
            break;
          }
        }
        if (!targetNode) {
          const last = textNodes[textNodes.length - 1];
          targetNode = last; targetOffset = last.data.length;
        }
      } else {
        let found = false;
        for (let i = focusIdx; i >= 0; i--) {
          const tn     = textNodes[i];
          const text   = tn.data;
          const endPos = (i === focusIdx) ? focusOffset : text.length;
          const sub    = text.slice(0, endPos);

          const matches = [];
          SENT_END_G.lastIndex = 0;
          let m;
          while ((m = SENT_END_G.exec(sub)) !== null) matches.push(m);

          if (matches.length > 0) {
            const last      = matches[matches.length - 1];
            const sentStart = last.index + last[0].length;
            if (i < focusIdx || sentStart < focusOffset - 1) {
              targetNode = tn; targetOffset = sentStart; found = true; break;
            }
          }
          // If previous node ended with sentence punctuation, this node starts a sentence.
          if (i > 0 && /[.!?]['")\]]*\s*$/.test(textNodes[i - 1].data)) {
            const off = text.search(/\S/);
            if (i < focusIdx || (off >= 0 && off < focusOffset - 1)) {
              targetNode = tn; targetOffset = Math.max(0, off); found = true; break;
            }
          }
        }
        if (!found) {
          targetNode   = textNodes[0];
          targetOffset = Math.max(0, textNodes[0].data.search(/\S/));
        }
      }

      if (!targetNode) return;

      // Build range from saved anchor to new target.
      const anchorNode   = state.visualCursor.textNode;
      const anchorOffset = state.visualCursor.offset;
      try {
        const range = doc.createRange();
        let anchorFirst = true;
        if (anchorNode !== targetNode) {
          anchorFirst = !!(anchorNode.compareDocumentPosition(targetNode) & 4);
        } else {
          anchorFirst = anchorOffset <= targetOffset;
        }
        if (anchorFirst) {
          range.setStart(anchorNode, anchorOffset);
          range.setEnd(targetNode, targetOffset);
        } else {
          range.setStart(targetNode, targetOffset);
          range.setEnd(anchorNode, anchorOffset);
        }
        sel.removeAllRanges();
        sel.addRange(range);
        const selLen = sel.toString().length;
        this._showStatus(state, '▶ ' + selLen + ' chars', 600);
        Zotero.debug('[ZoteroVim] _extendBySentence dir=' + direction +
                     ' focusIdx=' + focusIdx + ' len=' + selLen);
      } catch (e) {
        Zotero.debug('[ZoteroVim] _extendBySentence range error: ' + e);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendBySentence error: ' + e);
    }
  },

  /**
   * Scroll the PDF viewport so the current page is at the top (zt), center
   * (zz), or bottom (zb) of the visible area.
   */
  _scrollToPagePosition(pdfWin, position) {
    try {
      const container =
        pdfWin.PDFViewerApplication?.pdfViewer?.container ||
        pdfWin.document.getElementById('viewerContainer');
      if (!container) return;

      const pageNum = pdfWin.PDFViewerApplication?.pdfViewer?.currentPageNumber || 1;
      const pageEl  = pdfWin.document.querySelector(`.page[data-page-number="${pageNum}"]`);
      if (!pageEl) return;

      const pageTop = pageEl.offsetTop;
      const pageH   = pageEl.offsetHeight;
      const viewH   = container.clientHeight;

      let newTop;
      if (position === 'top')    newTop = pageTop;
      else if (position === 'bottom') newTop = pageTop + pageH - viewH;
      else                           newTop = pageTop + pageH / 2 - viewH / 2;   // center

      container.scrollTop = Math.max(0, newTop);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _scrollToPagePosition error: ' + e);
    }
  },

  /**
   * Visual mode `o` — swap selection anchor and focus (like Vim's o).
   * The visible highlighted range is unchanged; the logical cursor jumps to the
   * opposite end so subsequent j/k/h/l/w/b/(/)/… extend from there.
   *
   * Uses sel.setBaseAndExtent() to physically move the browser's anchor+focus,
   * so sel.modify() (used by word extension) also works correctly after the swap.
   */
  _swapVisualEnds(state, pdfWin) {
    try {
      pdfWin.focus();
      const sel = pdfWin.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      if (!state.visualCursor) return;

      const range          = sel.getRangeAt(0);
      const oldAnchorNode  = state.visualCursor.textNode;
      const oldAnchorOff   = state.visualCursor.offset;

      // Which end of the DOM range is our logical anchor?
      const anchorIsStart  =
        oldAnchorNode === range.startContainer && oldAnchorOff === range.startOffset;

      // Old focus = the other end of the range.
      const oldFocusNode = anchorIsStart ? range.endContainer   : range.startContainer;
      const oldFocusOff  = anchorIsStart ? range.endOffset       : range.startOffset;

      // Update our saved anchor to the old focus.
      state.visualCursor = { textNode: oldFocusNode, offset: oldFocusOff };

      // Move the browser selection so that:
      //   new anchor = oldFocus, new focus = oldAnchor
      // setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) is
      // supported in Gecko and allows "backward" selections where focus < anchor.
      try {
        sel.setBaseAndExtent(oldFocusNode, oldFocusOff, oldAnchorNode, oldAnchorOff);
        Zotero.debug('[ZoteroVim] _swapVisualEnds: setBaseAndExtent OK' +
                     ' newAnchorOff=' + oldFocusOff + ' newFocusOff=' + oldAnchorOff);
      } catch (e1) {
        Zotero.debug('[ZoteroVim] _swapVisualEnds: setBaseAndExtent failed: ' + e1);
        // Fallback: collapse to old focus then extend to old anchor.
        try {
          sel.collapse(oldFocusNode, oldFocusOff);
          sel.extend(oldAnchorNode, oldAnchorOff);
          Zotero.debug('[ZoteroVim] _swapVisualEnds: collapse+extend fallback OK');
        } catch (e2) {
          Zotero.debug('[ZoteroVim] _swapVisualEnds: fallback also failed: ' + e2);
        }
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _swapVisualEnds error: ' + e);
    }
  },

  /**
   * Collect client rects for exactly the selected text in `range`, avoiding
   * the spurious full-element rects that range.getClientRects() produces when
   * the selection spans multiple PDF.js text layers (one per page).
   *
   * Strategy: walk every text node covered by the range, create a precise
   * sub-range for each one's selected portion, and collect those rects.
   * Text-node rects are always tight bounds around actual glyphs.
   */
  _getRangeTextRects(range, doc) {
    const rects = [];
    const startNode = range.startContainer;
    const endNode   = range.endContainer;

    // Fast path: single text node.
    if (startNode === endNode && startNode.nodeType === 3) {
      for (const r of range.getClientRects()) {
        if (r.width > 1 && r.height > 1) rects.push(r);
      }
      return rects;
    }

    // Walk all text nodes under the common ancestor, collecting rects for
    // the selected portion of each one.
    const root   = range.commonAncestorContainer;
    const walker = doc.createTreeWalker(
      root.nodeType === 3 ? root.parentNode : root,
      0x4,  // SHOW_TEXT
      null
    );

    let started = false;
    let node;
    while ((node = walker.nextNode())) {
      if (!started) {
        if (node !== startNode) continue;
        started = true;
      }

      const startOff = (node === startNode) ? range.startOffset : 0;
      const endOff   = (node === endNode)   ? range.endOffset   : node.length;

      if (startOff < endOff) {
        try {
          const sub = doc.createRange();
          sub.setStart(node, startOff);
          sub.setEnd(node, endOff);
          for (const r of sub.getClientRects()) {
            if (r.width > 1 && r.height > 1) rects.push(r);
          }
        } catch (_) {}
      }

      if (node === endNode) break;
    }
    return rects;
  },

  /**
   * Walk the text-layer tree to find the next or previous text node adjacent
   * to `node`.  Used by _extendByChar to cross span boundaries.
   */
  _adjacentTextNode(node, doc, forward) {
    try {
      const root   = doc.querySelector('.textLayer') || doc.body;
      const walker = doc.createTreeWalker(root, 0x4 /* SHOW_TEXT */, null);
      const nodes  = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const idx = nodes.indexOf(node.nodeType === 3 ? node : null);
      if (idx < 0) {
        // node might be an element — find its first/last text child
        const elemIdx = nodes.findIndex(n => n.parentElement === node);
        if (elemIdx < 0) return null;
        return forward ? nodes[elemIdx + 1] ?? null : nodes[elemIdx - 1] ?? null;
      }
      return forward ? nodes[idx + 1] ?? null : nodes[idx - 1] ?? null;
    } catch (_) { return null; }
  },

  /** Extend selection using Gecko's Selection.modify() (for char/word/paragraph). */
  _selModify(pdfWin, alter, direction, granularity) {
    try {
      pdfWin.focus();
      const sel = pdfWin.getSelection();
      if (!sel) return;
      sel.modify(alter, direction, granularity);
      Zotero.debug('[ZoteroVim] selModify ' + direction + '/' + granularity + ' len=' + sel.toString().length);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _selModify error: ' + e);
    }
  },

  // ── Annotation helpers ────────────────────────────────────────────────────

  /**
   * Highlight the current selection.
   *
   * When Zotero's renderTextSelectionPopup has fired we have pre-computed
   * position data (params.annotation).  We use that data but create the
   * Zotero.Item directly so we can specify any color — onAddAnnotation
   * may silently ignore the color override we pass it.
   *
   * When no params are available (keyboard-built selection) we compute the
   * PDF-coordinate rects ourselves via _createAnnotationFromSelection.
   */
  _highlight(state, reader, pdfWin, color) {
    // Brief flash confirms the action fired (disappears when ✓/✗ arrives).
    const colorName = Object.entries(this.COLORS).find(([, v]) => v === color)?.[0] || color;
    this._showStatus(state, '▶ ' + colorName, 800);
    Zotero.debug('[ZoteroVim] _highlight: color=' + color + ' (' + colorName + ')');

    const params = state.selectionParams ||
      (Date.now() - this._lastSelectionTS < 10000 ? this._lastSelectionParams : null);
    Zotero.debug('[ZoteroVim] _highlight: hasParams=' + !!(params?.annotation) +
                 ' selText="' + (pdfWin.getSelection?.()?.toString?.() || '').slice(0, 40) + '"');
    if (params?.annotation) {
      state.selectionParams     = null;
      this._lastSelectionParams = null;
      Zotero.debug('[ZoteroVim] _highlight: using params path, ann.text="' +
                   (params.annotation.text || '').slice(0, 40) + '"');
      this._createAnnotationFromParams(state, reader, params.annotation, 'highlight', color);
      return;
    }
    this._createAnnotationFromSelection(reader, state, pdfWin, 'highlight', color);
  },

  _addNote(state, reader, pdfWin) {
    const params = state.selectionParams ||
      (Date.now() - this._lastSelectionTS < 10000 ? this._lastSelectionParams : null);
    if (params?.annotation) {
      state.selectionParams     = null;
      this._lastSelectionParams = null;
      this._createAnnotationFromParams(state, reader, params.annotation, 'note', null);
      return;
    }
    this._createAnnotationFromSelection(reader, state, pdfWin, 'note', null);
  },

  /**
   * Create a Zotero annotation item using position data already computed by
   * Zotero's reader (from renderTextSelectionPopup).  We bypass onAddAnnotation
   * so we can set any color without it being overridden.
   *
   * ann — the params.annotation object: { type, color, text, sortIndex, position }
   */
  async _createAnnotationFromParams(state, reader, ann, type, color) {
    try {
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) { this._showStatus(state, '✗ no attachment'); return; }

      const item = new Zotero.Item('annotation');
      item.libraryID            = attachment.libraryID;
      item.parentID             = attachment.id;
      item.annotationType       = type;
      if (color) item.annotationColor = color;
      item.annotationText       = (ann.text || '').normalize('NFKC').replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim();
      item.annotationComment    = '';
      item.annotationIsExternal = false;
      if (ann.sortIndex) item.annotationSortIndex = ann.sortIndex;
      if (ann.position)  item.annotationPosition  =
        typeof ann.position === 'string' ? ann.position : JSON.stringify(ann.position);

      await item.saveTx();
      Zotero.debug('[ZoteroVim] Created ' + type + ' id=' + item.id + ' color=' + color);
      state.lastAnnotationKey = item.key;
      this._showStatus(state, '✓ annotated', 1200);
      setTimeout(() => {
        this._setMode(state, 'normal');
        try { state.pdfWin?.focus(); } catch (_) {}
        try {
          const Cu = Components.utils;
          const readerWin = reader._iframeWindow;
          const ir = reader._internalReader;
          if (typeof ir?.setSelectedAnnotations === 'function' && readerWin) {
            ir.setSelectedAnnotations(Cu.cloneInto([item.key], readerWin));
          }
        } catch (_) {}
      }, 100);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _createAnnotationFromParams error: ' + e);
      this._showStatus(state, '✗ ' + (e.message || String(e)).slice(0, 40), 5000);
    }
  },

  /**
   * Compute PDF-coordinate rects from the current DOM selection and create
   * a Zotero annotation item directly via the Items API.
   *
   * This bypasses renderTextSelectionPopup entirely — useful when the
   * selection was built programmatically and that event didn't fire.
   */
  async _createAnnotationFromSelection(reader, state, pdfWin, type, color) {
    Zotero.debug('[ZoteroVim] _createAnnotation: start type=' + type + ' color=' + color);
    const sel = pdfWin.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      Zotero.debug('[ZoteroVim] _createAnnotation: no selection (isCollapsed=' + sel?.isCollapsed + ')');
      this._showStatus(state, '✗ no selection');
      return;
    }
    try {
      const range = sel.getRangeAt(0);
      // Use text-node-level rects to avoid the spurious full-page rects that
      // range.getClientRects() emits for cross-page selections.
      const clientRects = this._getRangeTextRects(range, pdfWin.document);
      Zotero.debug('[ZoteroVim] _createAnnotation: clientRects=' + clientRects.length);
      if (clientRects.length === 0) {
        this._showStatus(state, '✗ no rects');
        return;
      }

      const text = sel.toString().normalize('NFKC').replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim();
      Zotero.debug('[ZoteroVim] _createAnnotation: text="' + text.slice(0, 60) + '"');

      const pdfViewer = pdfWin.PDFViewerApplication?.pdfViewer;
      if (!pdfViewer) { this._showStatus(state, '✗ no pdfViewer'); return; }

      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) { this._showStatus(state, '✗ no attachment'); return; }

      // ── Group client rects by page ─────────────────────────────────────────
      // Match each screen rect to the .page element whose bounding rect
      // contains the rect's centre-y.
      const allPageEls = Array.from(
        pdfWin.document.querySelectorAll('.page[data-page-number]')
      );
      const pageBounds = allPageEls.map(el => ({
        el,
        pageIndex: parseInt(el.dataset.pageNumber) - 1,
        bounds: el.getBoundingClientRect(),
      }));
      const pageGroupMap = new Map();
      for (const rect of clientRects) {
        const cy = (rect.top + rect.bottom) / 2;
        for (const { el, pageIndex, bounds } of pageBounds) {
          if (cy >= bounds.top && cy <= bounds.bottom) {
            if (!pageGroupMap.has(pageIndex)) pageGroupMap.set(pageIndex, { el, rects: [] });
            pageGroupMap.get(pageIndex).rects.push(rect);
            break;
          }
        }
      }
      // Sort in document order; Zotero supports at most 2 pages per annotation.
      const pageGroups = [...pageGroupMap.entries()]
        .sort(([a], [b]) => a - b)
        .slice(0, 2)
        .map(([pageIndex, { el, rects }]) => ({ pageIndex, el, rects }));

      if (pageGroups.length === 0) { this._showStatus(state, '✗ no page el'); return; }
      Zotero.debug('[ZoteroVim] _createAnnotation: spanning ' + pageGroups.length + ' page(s)');

      // ── Convert screen rects → PDF coords for one page group ──────────────
      const toPdfRects = async ({ pageIndex, el: pageEl, rects: pageRects }) => {
        const pageView = pdfViewer._pages?.[pageIndex] ?? pdfViewer.getPageView?.(pageIndex);
        let scale, pdfPageH;
        if (pageView?.viewport) {
          scale    = pageView.viewport.scale;
          pdfPageH = pageView.viewport.height / scale;
        } else {
          const pdfDoc = pdfWin.PDFViewerApplication?.pdfDocument;
          if (!pdfDoc) return [];
          try {
            const pdfPage = await pdfDoc.getPage(pageIndex + 1);
            const vp      = pdfPage.getViewport({ scale: 1 });
            pdfPageH      = vp.height;
            const canvas    = pageEl.querySelector('canvas');
            const renderedW = canvas
              ? canvas.getBoundingClientRect().width
              : pageEl.getBoundingClientRect().width;
            scale = renderedW / vp.width;
          } catch (e) {
            Zotero.debug('[ZoteroVim] _createAnnotation: viewport err page ' + pageIndex + ': ' + e);
            return [];
          }
        }
        if (!isFinite(scale) || scale <= 0 || !isFinite(pdfPageH) || pdfPageH <= 0) return [];
        const pageRect = pageEl.getBoundingClientRect();
        const vp       = pageView?.viewport;
        return pageRects.map(r => {
          let x1, y1, x2, y2;
          if (vp?.convertToPdfPoint) {
            [x1, y2] = vp.convertToPdfPoint(r.left  - pageRect.left, r.top    - pageRect.top);
            [x2, y1] = vp.convertToPdfPoint(r.right - pageRect.left, r.bottom - pageRect.top);
          } else {
            x1 = (r.left  - pageRect.left) / scale;
            y1 = pdfPageH - (r.bottom - pageRect.top) / scale;
            x2 = (r.right - pageRect.left) / scale;
            y2 = pdfPageH - (r.top    - pageRect.top) / scale;
          }
          return [
            Math.round(Math.min(x1, x2) * 1000) / 1000,
            Math.round(Math.min(y1, y2) * 1000) / 1000,
            Math.round(Math.max(x1, x2) * 1000) / 1000,
            Math.round(Math.max(y1, y2) * 1000) / 1000,
          ];
        }).filter(r => r[2] > r[0] && r[3] > r[1]);
      };

      // ── Build a single annotation matching Zotero's format ─────────────────
      // Single-page:  { pageIndex, rects }
      // Two-page:     { pageIndex, rects, nextPageRects }  (Zotero's own format)
      const firstGroup    = pageGroups[0];
      const firstPdfRects = await toPdfRects(firstGroup);
      if (firstPdfRects.length === 0) {
        this._showStatus(state, '✗ bad rects');
        return;
      }

      const position = { pageIndex: firstGroup.pageIndex, rects: firstPdfRects };

      if (pageGroups.length === 2) {
        const nextPdfRects = await toPdfRects(pageGroups[1]);
        if (nextPdfRects.length > 0) position.nextPageRects = nextPdfRects;
      }

      // sortIndex from the first rect on the first page
      const pdfPageH0 = (() => {
        const pv = pdfViewer._pages?.[firstGroup.pageIndex] ?? pdfViewer.getPageView?.(firstGroup.pageIndex);
        return pv?.viewport ? pv.viewport.height / pv.viewport.scale : 0;
      })();
      const yTop  = Math.min(999999, Math.max(0, Math.round((pdfPageH0 - firstPdfRects[0][3]) * 100)));
      const xLeft = Math.min(99999,  Math.max(0, Math.round(firstPdfRects[0][0] * 100)));
      const sortIndex =
        String(firstGroup.pageIndex).padStart(5, '0') + '|' +
        String(yTop).padStart(6, '0') + '|' +
        String(xLeft).padStart(5, '0');

      const annotItem = new Zotero.Item('annotation');
      annotItem.libraryID            = attachment.libraryID;
      annotItem.parentID             = attachment.id;
      annotItem.annotationType       = type;
      if (color) annotItem.annotationColor = color;
      annotItem.annotationText       = text;
      annotItem.annotationComment    = '';
      annotItem.annotationIsExternal = false;
      annotItem.annotationSortIndex  = sortIndex;
      annotItem.annotationPosition   = JSON.stringify(position);

      Zotero.debug('[ZoteroVim] _createAnnotation: pos=' + annotItem.annotationPosition);
      try {
        await annotItem.saveTx();
      } catch (saveErr) {
        const msg = saveErr.message || String(saveErr);
        Zotero.debug('[ZoteroVim] saveTx FAILED: ' + msg);
        this._showStatus(state, '✗ ' + msg.slice(0, 45), 5000);
        return;
      }

      Zotero.debug('[ZoteroVim] Created ' + type + ' id=' + annotItem.id +
                   ' pages=' + pageGroups.map(g => g.pageIndex + 1).join('+'));

      state.lastAnnotationKey = annotItem.key;
      this._showStatus(state, '✓ annotated', 1200);
      try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
      setTimeout(() => {
        this._setMode(state, 'normal');
        try { pdfWin.focus(); } catch (_) {}
        try {
          const Cu = Components.utils;
          const readerWin = reader._iframeWindow;
          const ir = reader._internalReader;
          if (typeof ir?.setSelectedAnnotations === 'function' && readerWin) {
            ir.setSelectedAnnotations(Cu.cloneInto([annotItem.key], readerWin));
          }
        } catch (_) {}
      }, 100);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _createAnnotationFromSelection error: ' + e);
      this._showStatus(state, '✗ ' + String(e).slice(0, 28));
    }
  },

  _copySelection(state, pdfWin) {
    try {
      const sel = pdfWin.getSelection?.();
      if (sel && !sel.isCollapsed) {
        let text = sel.toString();

        // 1. Decompose Unicode ligatures and compatibility characters.
        //    NFKC turns ﬁ→fi, ﬂ→fl, ﬀ→ff, ﬃ→ffi, ﬄ→ffl, etc.
        text = text.normalize('NFKC');

        // 2. PDF.js stores each visual line as a separate span, so
        //    sel.toString() inserts \n at every line wrap even within a
        //    flowing paragraph.  Replace those with a single space.
        text = text.replace(/\n/g, ' ');

        // 3. Collapse any runs of multiple spaces left by the above.
        text = text.replace(/ {2,}/g, ' ').trim();

        const clipboardHelper = Components.classes['@mozilla.org/widget/clipboardhelper;1']
          .getService(Components.interfaces.nsIClipboardHelper);
        clipboardHelper.copyString(text);
        Zotero.debug('[ZoteroVim] Copied ' + text.length + ' chars');
        this._showStatus(state, '✓ copied ' + text.length + ' chars', 1200);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _copySelection error: ' + e);
    }
    this._setMode(state, 'normal');
    try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
    try { pdfWin.focus(); } catch (_) {}   // keep focus in PDF iframe
  },

  // ── Search helpers ────────────────────────────────────────────────────────

  _openSearch(reader, pdfWin) {
    // Primary: toggleFindPopup({open:true}) on _internalReader.
    // The {open:true} object crosses the chrome→reader.html compartment boundary
    // so it must be cloned.
    try {
      const ir = reader._internalReader;
      if (typeof ir?.toggleFindPopup === 'function') {
        ir.toggleFindPopup(Cu.cloneInto({ open: true }, reader._iframeWindow));
        Zotero.debug('[ZoteroVim] openSearch: toggleFindPopup OK');
        return;
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] openSearch toggleFindPopup error: ' + e);
    }

    // Fallback: focus the find-popup input in the reader.html DOM directly.
    try {
      const outerDoc = reader._iframeWindow?.document;
      const inp = outerDoc?.querySelector('.primary-view .find-popup input');
      if (inp) { inp.focus(); inp.select(); return; }
    } catch (_) {}
  },

  _clearSearch(pdfWin) {
    try {
      const evt = new pdfWin.KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      });
      pdfWin.document.dispatchEvent(evt);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _clearSearch error: ' + e);
    }
  },

  // ── Annotation navigation ─────────────────────────────────────────────────

  _navigateAnnotation(state, reader, direction) {
    try {
      const internalReader = reader._internalReader;
      if (!internalReader) {
        this._showStatus(state, '✗ no internalReader', 3000); return;
      }

      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) {
        this._showStatus(state, '✗ no attachment', 3000); return;
      }

      // getAnnotations() returns Zotero.Item[] directly — do NOT wrap in
      // Zotero.Items.get(), which expects IDs not Item objects.
      let annotations;
      try {
        annotations = attachment.getAnnotations()
          .filter(a => ['highlight', 'underline', 'note', 'text'].includes(a.annotationType));
      } catch (e) {
        this._showStatus(state, '✗ getAnnotations: ' + String(e).slice(0, 30), 4000);
        Zotero.debug('[ZoteroVim] getAnnotations error: ' + e);
        return;
      }

      if (annotations.length === 0) {
        this._showStatus(state, '✗ no annotations', 2000); return;
      }

      annotations.sort((a, b) => {
        const pa = a.annotationSortIndex || '', pb = b.annotationSortIndex || '';
        return pa < pb ? -1 : pa > pb ? 1 : 0;
      });

      // sortIndex "PPPPP|YYYYYY|XXXXX" — first segment is 0-based page index.
      const getSortPage = (a) =>
        parseInt((a.annotationSortIndex || '00000').split('|')[0], 10) || 0;

      // ── Sequential navigation: track last visited annotation ─────────────
      // If we know which annotation was last visited, just step ±1 in the list.
      let targetIdx = -1;
      if (state.lastAnnotationKey) {
        const lastIdx = annotations.findIndex(a => a.key === state.lastAnnotationKey);
        if (lastIdx >= 0) {
          targetIdx = (lastIdx + direction + annotations.length) % annotations.length;
        }
      }

      // First press (or unknown last annotation): find nearest from current page.
      if (targetIdx < 0) {
        let currentPage = 0;
        try {
          currentPage = (internalReader._primaryView?._iframeWindow
            ?.PDFViewerApplication?.pdfViewer?.currentPageNumber - 1) || 0;
        } catch (_) {}

        if (direction > 0) {
          targetIdx = annotations.findIndex(a => getSortPage(a) >= currentPage);
          if (targetIdx < 0) targetIdx = 0;
        } else {
          for (let i = annotations.length - 1; i >= 0; i--) {
            if (getSortPage(annotations[i]) <= currentPage) { targetIdx = i; break; }
          }
          if (targetIdx < 0) targetIdx = annotations.length - 1;
        }
      }

      const target = annotations[targetIdx];
      if (!target) return;

      state.lastAnnotationKey = target.key;

      // ── Page/position resolution ─────────────────────────────────────────
      let posPage = getSortPage(target);
      try {
        const parsed = JSON.parse(target.annotationPosition || '{}');
        if (typeof parsed.pageIndex === 'number') posPage = parsed.pageIndex;
      } catch (_) {}

      Zotero.debug('[ZoteroVim] navigateAnnotation → key=' + target.key +
                   ' page=' + posPage + ' idx=' + targetIdx + '/' + annotations.length);
      this._showStatus(state,
        '→ ann ' + (targetIdx + 1) + '/' + annotations.length +
        '  p.' + (posPage + 1), 2000);

      // ── Navigate to annotation ─────────────────────────────────────────
      // _internalReader lives in a different JS compartment (reader.html iframe).
      // Arrays/objects passed as arguments must be cloned into that compartment
      // with Cu.cloneInto() — otherwise the security wrapper blocks property
      // access and the calls silently fail or throw "Permission denied".
      const readerWin = reader._iframeWindow;
      const Cu = Components.utils;

      // setSelectedAnnotations: scrolls sidebar + shows selection box in PDF +
      // internally calls _lastView.navigate({annotationID}) for smooth scroll.
      // This is the only navigation call needed — do NOT also set currentPageNumber
      // or call scrollPageIntoView, as those cause jarring page jumps.
      let selectedOK = false;
      try {
        if (typeof internalReader.setSelectedAnnotations === 'function' && readerWin) {
          internalReader.setSelectedAnnotations(Cu.cloneInto([target.key], readerWin));
          selectedOK = true;
          Zotero.debug('[ZoteroVim] setSelectedAnnotations(' + target.key + ') OK');
        }
      } catch (e) {
        Zotero.debug('[ZoteroVim] setSelectedAnnotations error: ' + e);
      }

      // Fallback: navigate({annotationID}) directly (smooth, no jump).
      // Only used if setSelectedAnnotations is unavailable.
      if (!selectedOK) {
        try {
          if (typeof internalReader.navigate === 'function' && readerWin) {
            internalReader.navigate(Cu.cloneInto({ annotationID: target.key }, readerWin));
            Zotero.debug('[ZoteroVim] navigate({annotationID}) fallback OK');
          }
        } catch (e) {
          Zotero.debug('[ZoteroVim] navigate annotationID error: ' + e);
          // Last resort: jump to page (may be jarring).
          try {
            const pdfApp = internalReader._primaryView?._iframeWindow?.PDFViewerApplication;
            if (pdfApp?.pdfViewer) pdfApp.pdfViewer.currentPageNumber = posPage + 1;
          } catch (_) {}
        }
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _navigateAnnotation error: ' + e);
      this._showStatus(state, '✗ nav: ' + String(e).slice(0, 30), 4000);
    }
  },

  /**
   * Focus the comment field of the currently-selected annotation.
   * Called when `i` is pressed in normal mode with an annotation selected.
   *
   * The comment field is a contentEditable div with aria-label "Annotation comment"
   * inside the sidebar annotation card [data-sidebar-annotation-id="${key}"].
   */
  _focusAnnotationComment(state, reader) {
    const key = state.lastAnnotationKey;
    const outerDoc = reader._iframeWindow?.document;
    if (!outerDoc || !key) return;

    const tryFocus = (attempt) => {
      // Prefer the card for the specific annotation; fall back to any visible one.
      const commentEl =
        outerDoc.querySelector(`[data-sidebar-annotation-id="${key}"] div[aria-label="Annotation comment"]`) ||
        outerDoc.querySelector('div[aria-label="Annotation comment"]');

      if (commentEl && commentEl.isContentEditable) {
        const r = commentEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          commentEl.focus();
          // Place cursor at end of existing text.
          try {
            const sel = outerDoc.defaultView?.getSelection?.();
            if (sel) {
              const range = outerDoc.createRange();
              range.selectNodeContents(commentEl);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } catch (_) {}
          this._showStatus(state, '-- INSERT --  Esc to exit', 2000);
          Zotero.debug('[ZoteroVim] _focusAnnotationComment: focused key=' + key);
          return;
        }
      }

      if (attempt < 8) {
        setTimeout(() => tryFocus(attempt + 1), 200);
      }
      // Silently stop if not found — user is still in insert mode.
    };

    setTimeout(() => tryFocus(0), 100);
  },

  /**
   * Find an annotation's DOM element in the PDF layer.
   * Zotero may render annotations in a shadow root (_annotationRenderRootEl).
   */
  _findAnnotationElement(internalReader, key) {
    try {
      const pdfDoc = internalReader._primaryView?._iframeWindow?.document;
      if (!pdfDoc) return null;

      // Try normal (non-shadow) DOM first.
      let el = pdfDoc.querySelector(`[data-annotation-id="${key}"]`) ||
               pdfDoc.querySelector(`section[data-annotation-id="${key}"]`);
      if (el) return el;

      // Try via _annotationRenderRootEl (may be the shadow host or shadow root).
      const renderRoot = internalReader._primaryView?._annotationRenderRootEl;
      if (renderRoot) {
        el = (renderRoot.shadowRoot || renderRoot).querySelector?.(`[data-annotation-id="${key}"]`);
        if (el) return el;
      }
    } catch (_) {}
    return null;
  },

  /**
   * Delete the annotation currently selected with [ / ].
   * Clears the reader selection first, then calls eraseTx() on the item.
   */
  async _deleteAnnotation(state, reader) {
    const key = state.lastAnnotationKey;
    if (!key) {
      this._showStatus(state, '✗ navigate first with [ / ]', 2000);
      return;
    }
    try {
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) {
        this._showStatus(state, '✗ no attachment', 2000); return;
      }

      const annotations = attachment.getAnnotations();
      const target = annotations.find(a => a.key === key);
      if (!target) {
        this._showStatus(state, '✗ annotation not found', 2000); return;
      }

      // Clear reader selection before deleting.
      const Cu       = Components.utils;
      const readerWin = reader._iframeWindow;
      try {
        if (typeof reader._internalReader?.setSelectedAnnotations === 'function' && readerWin) {
          reader._internalReader.setSelectedAnnotations(Cu.cloneInto([], readerWin));
        }
      } catch (_) {}

      state.lastAnnotationKey = null;
      await target.eraseTx();

      this._showStatus(state, '✓ annotation deleted', 1500);
      Zotero.debug('[ZoteroVim] deleted annotation key=' + key);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _deleteAnnotation error: ' + e);
      this._showStatus(state, '✗ ' + String(e).slice(0, 35), 3000);
    }
  },

  /**
   * Change the colour of the currently-selected annotation (zy/zr/zg/zb/zp in
   * normal mode after [ / ] navigation).
   */
  async _recolorAnnotation(state, reader, color) {
    const key = state.lastAnnotationKey;
    if (!key) { this._showStatus(state, '✗ navigate first with [ / ]', 2000); return; }
    try {
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) { this._showStatus(state, '✗ no attachment', 2000); return; }

      const target = attachment.getAnnotations().find(a => a.key === key);
      if (!target) { this._showStatus(state, '✗ annotation not found', 2000); return; }

      const colorName = Object.entries(this.COLORS).find(([, v]) => v === color)?.[0] || color;
      target.annotationColor = color;
      await target.saveTx();

      this._showStatus(state, '✓ → ' + colorName, 1200);
      Zotero.debug('[ZoteroVim] recolorAnnotation key=' + key + ' color=' + color);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _recolorAnnotation error: ' + e);
      this._showStatus(state, '✗ ' + String(e).slice(0, 35), 3000);
    }
  },

  /**
   * Yank the highlighted text of the currently-selected annotation (y in normal
   * mode after [ / ] navigation).  Applies the same post-processing as
   * _copySelection: NFKC ligature normalization + newline → space.
   */
  _yankAnnotation(state, reader) {
    const key = state.lastAnnotationKey;
    if (!key) {
      this._showStatus(state, '✗ navigate first with [ / ]', 2000);
      return;
    }
    try {
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) { this._showStatus(state, '✗ no attachment', 2000); return; }

      const annotations = attachment.getAnnotations();
      const target = annotations.find(a => a.key === key);
      if (!target) { this._showStatus(state, '✗ annotation not found', 2000); return; }

      let text = target.annotationText || '';
      if (!text) { this._showStatus(state, '✗ annotation has no text', 2000); return; }

      text = text.normalize('NFKC').replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim();

      const clipboardHelper = Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper);
      clipboardHelper.copyString(text);

      this._showStatus(state, '✓ copied ' + text.length + ' chars', 1500);
      Zotero.debug('[ZoteroVim] yankAnnotation key=' + key + ' len=' + text.length);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _yankAnnotation error: ' + e);
      this._showStatus(state, '✗ ' + String(e).slice(0, 35), 3000);
    }
  },

  /**
   * yy in normal mode — copy the comment text of the selected annotation.
   */
  _yankAnnotationComment(state, reader) {
    const key = state.lastAnnotationKey;
    if (!key) { this._showStatus(state, '✗ navigate first with [ / ]', 2000); return; }
    try {
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) { this._showStatus(state, '✗ no attachment', 2000); return; }

      const annotations = attachment.getAnnotations();
      const target = annotations.find(a => a.key === key);
      if (!target) { this._showStatus(state, '✗ annotation not found', 2000); return; }

      const comment = (target.annotationComment || '').trim();
      if (!comment) { this._showStatus(state, '✗ annotation has no comment', 2000); return; }

      const text = comment.normalize('NFKC').replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim();
      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper).copyString(text);
      this._showStatus(state, '✓ copied comment (' + text.length + ' chars)', 1500);
      Zotero.debug('[ZoteroVim] yankAnnotationComment key=' + key + ' len=' + text.length);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _yankAnnotationComment error: ' + e);
      this._showStatus(state, '✗ ' + String(e).slice(0, 35), 3000);
    }
  },

  /**
   * yy in visual mode — copy the entire paragraph containing the selection,
   * regardless of how much is currently highlighted.
   * Uses the same gap-based paragraph detection as _extendByParagraph.
   */
  _yankParagraph(state, pdfWin) {
    try {
      pdfWin.focus();
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();

      // Find an element to anchor the paragraph search.
      const rawFocus = sel?.focusNode || state.visualCursor?.textNode;
      if (!rawFocus) { this._showStatus(state, '✗ no selection', 2000); return; }
      const focusEl = rawFocus.nodeType === 3 ? rawFocus.parentElement : rawFocus;

      // Collect and sort visible .textLayer spans (same as _extendByParagraph).
      const spans = Array.from(doc.querySelectorAll('.textLayer span')).filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 4 && r.height > 3 && s.textContent.trim() && s.firstChild?.nodeType === 3;
      });
      spans.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const dy = ra.top - rb.top;
        return Math.abs(dy) > 5 ? dy : ra.left - rb.left;
      });
      if (spans.length === 0) { this._showStatus(state, '✗ no text', 2000); return; }

      let focusIdx = spans.findIndex(s => s === focusEl || s.contains(focusEl));
      if (focusIdx < 0) focusIdx = 0;

      const lineH       = Math.max(spans[focusIdx].getBoundingClientRect().height, 8);
      const gapThreshold = lineH * 0.5;

      // Walk backward to find paragraph start.
      let paraStart = 0;
      for (let i = focusIdx; i > 0; i--) {
        const r1 = spans[i - 1].getBoundingClientRect();
        const r2 = spans[i].getBoundingClientRect();
        if (r2.top - r1.bottom > gapThreshold) { paraStart = i; break; }
      }

      // Walk forward to find paragraph end.
      let paraEnd = spans.length - 1;
      for (let i = focusIdx + 1; i < spans.length; i++) {
        const r1 = spans[i - 1].getBoundingClientRect();
        const r2 = spans[i].getBoundingClientRect();
        if (r2.top - r1.bottom > gapThreshold) { paraEnd = i - 1; break; }
      }

      // Concatenate span text and normalise.
      const parts = [];
      for (let i = paraStart; i <= paraEnd; i++) parts.push(spans[i].textContent);
      let text = parts.join('\n').normalize('NFKC').replace(/\n/g, ' ')
                      .replace(/ {2,}/g, ' ').trim();

      if (!text) { this._showStatus(state, '✗ no text', 2000); return; }

      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper).copyString(text);
      this._showStatus(state, '✓ copied paragraph (' + text.length + ' chars)', 1500);
      Zotero.debug('[ZoteroVim] yankParagraph spans=' + (paraEnd - paraStart + 1) +
                   ' len=' + text.length);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _yankParagraph error: ' + e);
      this._showStatus(state, '✗ ' + String(e).slice(0, 35), 3000);
    }
  },

  /**
   * After [/] navigation, pressing Enter in normal mode opens the annotation's
   * comment field for editing.
   *
   * Strategy:
   *   1. Click the annotation element in the PDF layer — identical to a manual
   *      click, which shows Zotero's selection box + annotation popup.
   *   2. Detect newly-appeared contenteditable elements (the comment input
   *      that appears in the popup) and focus the best candidate.
   *   3. Fall back to known sidebar selectors.
   */
  _editAnnotation(state, reader) {
    const key = state.lastAnnotationKey;
    if (!key) { this._showStatus(state, '✗ navigate first with [ / ]', 2000); return; }

    const ir = reader._internalReader;
    const outerDoc = reader._iframeWindow?.document;
    const pdfWin = ir?._primaryView?._iframeWindow;
    if (!outerDoc) { this._showStatus(state, '✗ no outer doc', 2000); return; }

    Zotero.debug('[ZoteroVim] _editAnnotation: key=' + key);

    const Cu = Components.utils;

    // Helper: place cursor at end of a contenteditable element.
    const moveCursorToEnd = (el) => {
      try {
        const range = outerDoc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = outerDoc.getSelection?.();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      } catch (_) {}
    };

    // Helper: is this element a usable editable field?
    const isUsable = (el) => {
      if (!el.isContentEditable && el.tagName !== 'TEXTAREA') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.readOnly && !el.disabled;
    };

    // Step 1: select the annotation (cloneInto to cross compartment boundary).
    // setSelectedAnnotations scrolls the sidebar to the annotation card,
    // shows the selection box in PDF, and auto-focuses the comment if empty.
    try {
      if (typeof ir?.setSelectedAnnotations === 'function') {
        ir.setSelectedAnnotations(Cu.cloneInto([key], reader._iframeWindow));
        Zotero.debug('[ZoteroVim] _editAnnotation: setSelectedAnnotations OK');
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _editAnnotation setSelectedAnnotations error: ' + e);
    }
    try {
      if (typeof ir?.navigate === 'function') {
        ir.navigate(Cu.cloneInto({ annotationID: key }, reader._iframeWindow));
      }
    } catch (_) {}

    // Step 2: wait for React to re-render the sidebar card, then focus comment.
    const tryFocus = (attempt) => {
      // Primary: Zotero's comment contenteditable has aria-label="Annotation comment".
      // Try key-specific ancestor first, then any visible one.
      const commentEl =
        outerDoc.querySelector(`[data-sidebar-annotation-id="${key}"] div[aria-label="Annotation comment"]`) ||
        outerDoc.querySelector(`[data-annotation-id="${key}"] div[aria-label="Annotation comment"]`)         ||
        outerDoc.querySelector(`div[aria-label="Annotation comment"]`);

      if (commentEl && isUsable(commentEl)) {
        commentEl.focus();
        moveCursorToEnd(commentEl);
        this._showStatus(state, '✓ editing comment', 1500);
        Zotero.debug('[ZoteroVim] _editAnnotation: focused via aria-label selector');
        return;
      }

      // Fallback: any visible contenteditable or textarea in the sidebar card.
      const fallback =
        outerDoc.querySelector(`[data-sidebar-annotation-id="${key}"] [contenteditable]`) ||
        outerDoc.querySelector(`[data-sidebar-annotation-id="${key}"] textarea`);
      if (fallback && isUsable(fallback)) {
        fallback.focus();
        if (fallback.tagName === 'TEXTAREA') {
          fallback.selectionStart = fallback.selectionEnd = fallback.value.length;
        } else {
          moveCursorToEnd(fallback);
        }
        this._showStatus(state, '✓ editing comment', 1500);
        return;
      }

      if (attempt < 10) {
        setTimeout(() => tryFocus(attempt + 1), 200);
        return;
      }

      // Debug on failure.
      try {
        const cards = outerDoc.querySelectorAll('[data-sidebar-annotation-id]');
        Zotero.debug('[ZoteroVim] _editAnnotation: gave up. key=' + key +
                     '  sidebar cards=' + cards.length);
        for (const c of Array.from(cards).slice(0, 3)) {
          Zotero.debug('  card id="' + c.getAttribute('data-sidebar-annotation-id') + '"');
        }
        const commentEls = outerDoc.querySelectorAll('div[aria-label="Annotation comment"]');
        Zotero.debug('  div[aria-label="Annotation comment"] count=' + commentEls.length);
      } catch (_) {}
      this._showStatus(state, '✗ comment field not found', 3000);
    };

    setTimeout(() => tryFocus(0), 350);
  },
};

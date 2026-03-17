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
 *   Existing reader tabs restored on startup may need a separate rescan pass,
 *   since they do not always re-fire the toolbar render hook we use below.
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
    'normal:H':       'scrollLeft',
    'normal:L':       'scrollRight',
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
    // Normal mode — filter sidebar by annotation colour
    'normal:Zy':      'filterYellow',
    'normal:Zr':      'filterRed',
    'normal:Zg':      'filterGreen',
    'normal:Zb':      'filterBlue',
    'normal:Zp':      'filterPurple',
    'normal:Za':      'filterClear',
    'normal:v':       'enterVisual',
    'normal:c':       'enterCursor',
    'normal:i':       'enterInsert',
    'normal:J':       'mainPrevTab',
    'normal:K':       'mainNextTab',
    'normal:ctrl+h':  'focusReaderSplitLeft',
    'normal:ctrl+j':  'focusReaderSplitDown',
    'normal:ctrl+k':  'focusReaderSplitUp',
    'normal:ctrl+l':  'focusReaderSplitRight',
    'normal:escape':  'clearSearch',
    // Normal mode — space-chord bindings (delegate to main window)
    'normal: e':   'toggleReaderSidebarOutline',
    'normal: -':   'toggleReaderSplitHorizontal',
    'normal: |':   'toggleReaderSplitVertical',
    'normal: ff':  'mainFuzzyAll',
    'normal: fb':  'mainFuzzyCollection',
    'normal: bj':  'mainTabPick',
    'normal: yy':  'mainYankCitekey',
    'normal: o':   'mainOpenPDF',
    'normal: q':   'mainClosePDF',

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
    'visual:0':       'extendLineStart',
    'visual:$':       'extendLineEnd',
    // Visual mode — annotation
    'visual:zy':      'highlightYellow',
    'visual:zr':      'highlightRed',
    'visual:zg':      'highlightGreen',
    'visual:zb':      'highlightBlue',
    'visual:zp':      'highlightPurple',
    'visual:za':      'addNote',
    'visual:i':       'addNote',
    'visual:y':       'copySelection',
    'visual:yy':      'yankParagraph',
    // Visual mode — search selection
    'visual:#':       'searchSelection',
    // Visual mode — swap anchor/focus
    'visual:o':       'swapVisualEnds',
    // Visual mode — exit
    'visual:v':       'exitMode',
    'visual:escape':  'exitMode',

    // Cursor mode — caret-style navigation without selection
    'cursor:j':       'cursorDown',
    'cursor:k':       'cursorUp',
    'cursor:h':       'cursorLeft',
    'cursor:l':       'cursorRight',
    'cursor:w':       'cursorWordForward',
    'cursor:W':       'cursorBigWordForward',
    'cursor:b':       'cursorWordBackward',
    'cursor:B':       'cursorBigWordBackward',
    'cursor:0':       'cursorLineStart',
    'cursor:$':       'cursorLineEnd',
    'cursor:v':       'cursorToVisual',
    'cursor:escape':  'exitMode',

    // Insert / passthrough mode
    'insert:escape':  'exitMode',

    // Main window — <space> chords (LazyVim-inspired)
    // Space key produces ' ' from _keyString, so <space>ff → buffer ' ff' → key 'main: ff'
    'main: ff':   'mainFuzzyAll',         // <space>ff  — fuzzy picker, all items
    'main: fb':   'mainFuzzyCollection',  // <space>fb  — fuzzy picker, current collection
    'main: bj':   'mainTabPick',          // <space>bj  — pick/open tab by hint
    'main: e':    'mainFocusTree',        // <space>e   — focus collection tree
    'main: yy':   'mainYankCitekey',      // <space>yy  — copy citekey of selected item
    'main: o':    'mainOpenPDF',          // <space>o   — open selected item's PDF
    'main: q':    'mainClosePDF',         // <space>q   — close active PDF tab
    'main: /':    'mainFocusSearch',      // <space>/   — focus Zotero search bar
    'main: wh':   'mainFocusLeft',        // <space>wh  — focus collection tree
    'main: wl':   'mainFocusRight',       // <space>wl  — focus detail pane
    'main: ww':   'mainFocusItems',       // <space>ww  — focus items list
    // Main window — panel-scoped navigation
    'main:h':     'mainTreeCollapse',
    'main:l':     'mainTreeExpand',
    'main:j':     'mainNavDown',
    'main:k':     'mainNavUp',
    'main:za':    'mainTreeToggle',
    'main:zo':    'mainTreeOpenOnly',
    'main:zc':    'mainTreeCloseOnly',
    'main:R':     'mainTreeExpandAll',
    'main:M':     'mainTreeCollapseAll',
    'main:backspace': 'mainTreeParent',
    'main:gg':    'mainNavFirst',
    'main:G':     'mainNavLast',
    'main:J':     'mainPrevTab',
    'main:K':     'mainNextTab',
    'main:enter': 'mainActivate',
    'main:return':'mainActivate',         // Enter — open PDF of selected item
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
  _mainWindowState: new Map(),   // win → mainWinState

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
    this._injectIntoMainWindow(win);
  },

  removeFromWindow(win) {
    this._removeFromWindow(win);
    this._windows.delete(win);
  },

  _removeFromWindow(win) {
    const s = this._mainWindowState.get(win);
    if (s) { try { s.cleanup(); } catch (_) {} this._mainWindowState.delete(win); }
  },

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

  isSmoothScrollEnabled() { return this.getPref('smoothScroll', true); },

  getSmoothScrollConfig() {
    const initialSpeed = this.getPref('smoothScroll.initialSpeed', 2000);
    const maxSpeed = Math.max(initialSpeed, this.getPref('smoothScroll.maxSpeed', 2000));
    return {
      initialSpeed,
      maxSpeed,
      acceleration: this.getPref('smoothScroll.acceleration', 2600),
      deceleration: this.getPref('smoothScroll.deceleration', 4200),
      stopOnRelease: this.getPref('smoothScroll.stopOnRelease', false),
    };
  },

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

  _ensureReaderInjected(reader) {
    const id = reader?._instanceID;
    if (!id) return false;
    if (this._injectedReaders.has(id) || this._readerState.has(id)) return false;
    this._injectedReaders.add(id);
    this._waitAndInject(reader);
    return true;
  },

  _onRenderToolbar(event) {
    const { reader } = event;
    this._ensureReaderInjected(reader);
  },

  _rescanSelectedReader(win) {
    try {
      const tabID = win?.Zotero_Tabs?.selectedID;
      if (!tabID) return;
      const reader = Zotero.Reader.getByTabID?.(tabID);
      if (reader) this._ensureReaderInjected(reader);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _rescanSelectedReader error: ' + e);
    }
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
      hintTargetMode: null,
      visualCursor: null,   // { textNode, offset } — restored if selection lost
      visualPreferredX: null,
      cursorPreferredX: null,
      cursorLastKey: '',
      cursorLastKeyTS: 0,
      filterColor: null,    // active colour filter hex string, or null for all
      smoothHold: {
        active: false,
        releasing: false,
        key: null,
        axis: null,
        direction: 0,
        speed: 0,
        rafId: null,
        lastTS: 0,
      },
      sidebarNavActive: false,
      sidebarOutlineIndex: -1,
      outlineExplorerOpen: false,
      outlineExplorerLoading: false,
      outlineExplorerTree: null,
      outlineExplorerVisible: [],
      outlineExplorerSelected: 0,
      outlineExplorerHintBuffer: '',
      _outlineExplorerHintTimer: null,
      outlineExplorerCmdBuffer: '',
      _outlineExplorerCmdTimer: null,
      _outlineExplorerOverlay: null,
      _outlineExplorerList: null,
      _outlineExplorerStatus: null,
      activePdfWin: pdfWin,
      _pdfViewHandlers: new Map(),
      _pdfViewSyncTimer: null,
      reader: reader,       // reference for direct annotation creation
      pdfWin: pdfWin,       // stored for _setMode → _clearVisualHints
      cleanup: () => {},
      executeAction: null,  // set below
    };
    this._readerState.set(instanceID, state);
    state.executeAction = (action, count) => {
      const activePdfWin = state.activePdfWin || this._activeReaderPdfWin(reader, pdfWin) || pdfWin;
      this._executeAction(action, reader, state, activePdfWin, count);
    };
    if (reader.itemID) {
      this._readerStateByItemID.set(reader.itemID, state);
    }

    const outerDoc = reader._iframeWindow?.document;
    if (outerDoc) {
      state.indicatorEl = this._createModeIndicator(outerDoc);
    }

    // Force text-layer spans to be selectable and show selection highlight.
    this._injectSelectionCSS(pdfWin);
    this._syncReaderPdfViewListeners(reader, state);
    state._pdfViewSyncTimer = setInterval(() => {
      this._syncReaderPdfViewListeners(reader, state);
    }, 800);

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
        setTimeout(() => {
          try {
            const targetWin = this._activeReaderPdfWin(reader, pdfWin) || pdfWin;
            targetWin.focus();
          } catch (_) {}
        }, 30);
      }
    };
    const outerKeyHandler = (e) => {
      if (!outerDoc) return;
      const active = outerDoc.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
        return;
      }
      const keyStr = this._keyString(e);
      if (!keyStr) return;
      const shouldHandle = state.sidebarNavActive || state.outlineExplorerOpen
        || !!state.keyBuffer || keyStr === ' ' || keyStr === 'escape';
      if (!shouldHandle) return;
      const activePdfWin = this._activeReaderPdfWin(reader, pdfWin) || pdfWin;
      this._onKeyDown(e, reader, state, activePdfWin);
    };
    if (outerDoc) {
      outerDoc.addEventListener('keydown', outerEscapeHandler, true);
      outerDoc.addEventListener('keydown', outerKeyHandler, true);
    }

    state.cleanup = () => {
      this._stopSmoothHoldScroll(state, pdfWin);
      this._closeReaderOutlineExplorer(state);
      clearInterval(state._pdfViewSyncTimer);
      this._clearReaderPdfViewListeners(state);
      if (outerDoc) outerDoc.removeEventListener('keydown', outerEscapeHandler, true);
      if (outerDoc) outerDoc.removeEventListener('keydown', outerKeyHandler, true);
      state.indicatorEl?.remove();
      try { for (const el of pdfWin.document.querySelectorAll('[data-zv-cursor]')) el.remove(); } catch (_) {}
      clearTimeout(state.keyTimeout);
      if (reader.itemID) this._readerStateByItemID.delete(reader.itemID);
    };
  },

  _activeReaderPdfWin(reader, fallback = null) {
    const focusedWin = Services.focus?.focusedWindow;
    const primaryWin = reader?._internalReader?._primaryView?._iframeWindow || fallback;
    const secondaryWin = reader?._internalReader?._secondaryView?._iframeWindow;
    if (focusedWin === secondaryWin) return secondaryWin;
    if (focusedWin === primaryWin) return primaryWin;
    return primaryWin || secondaryWin || fallback;
  },

  _syncReaderPdfViewListeners(reader, state) {
    if (!state?._pdfViewHandlers) return;

    const primaryWin = reader?._internalReader?._primaryView?._iframeWindow;
    const secondaryWin = reader?._internalReader?._secondaryView?._iframeWindow;
    const wantedWins = [primaryWin, secondaryWin].filter(Boolean);

    for (const [viewWin, handlers] of state._pdfViewHandlers.entries()) {
      if (wantedWins.includes(viewWin)) continue;
      try { viewWin.removeEventListener('keydown', handlers.keyDown, true); } catch (_) {}
      try { viewWin.removeEventListener('keyup', handlers.keyUp, true); } catch (_) {}
      try { viewWin.removeEventListener('blur', handlers.blur, true); } catch (_) {}
      try { viewWin.document.removeEventListener('selectionchange', handlers.selection); } catch (_) {}
      try { handlers.scrollEl?.removeEventListener('scroll', handlers.scroll, { passive: true }); } catch (_) {}
      state._pdfViewHandlers.delete(viewWin);
    }

    for (const viewWin of wantedWins) {
      if (state._pdfViewHandlers.has(viewWin)) continue;

      this._injectSelectionCSS(viewWin);
      const handlers = {
        keyDown: (e) => this._onKeyDown(e, reader, state, viewWin),
        keyUp: (e) => this._onKeyUp(e, state, viewWin),
        blur: () => this._stopSmoothHoldScroll(state, viewWin),
        selection: () => {
          try {
            const sel = viewWin.getSelection?.();
            if (!sel || sel.isCollapsed) state.selectionParams = null;
          } catch (_) {}
        },
        scroll: () => {
          if (state.mode === 'visual' || state.mode === 'cursor') {
            this._updateVisualCursor(state, viewWin, { autoPan: false });
          }
        },
        scrollEl: null,
      };

      try { viewWin.addEventListener('keydown', handlers.keyDown, true); } catch (_) {}
      try { viewWin.addEventListener('keyup', handlers.keyUp, true); } catch (_) {}
      try { viewWin.addEventListener('blur', handlers.blur, true); } catch (_) {}
      try { viewWin.document.addEventListener('selectionchange', handlers.selection); } catch (_) {}
      try {
        handlers.scrollEl = viewWin.document.getElementById('viewerContainer')
          || viewWin.document.querySelector('.pdfViewer');
        handlers.scrollEl?.addEventListener('scroll', handlers.scroll, { passive: true });
      } catch (_) {}

      state._pdfViewHandlers.set(viewWin, handlers);
    }
  },

  _clearReaderPdfViewListeners(state) {
    if (!state?._pdfViewHandlers) return;
    for (const [viewWin, handlers] of state._pdfViewHandlers.entries()) {
      try { viewWin.removeEventListener('keydown', handlers.keyDown, true); } catch (_) {}
      try { viewWin.removeEventListener('keyup', handlers.keyUp, true); } catch (_) {}
      try { viewWin.removeEventListener('blur', handlers.blur, true); } catch (_) {}
      try { viewWin.document.removeEventListener('selectionchange', handlers.selection); } catch (_) {}
      try { handlers.scrollEl?.removeEventListener('scroll', handlers.scroll, { passive: true }); } catch (_) {}
    }
    state._pdfViewHandlers.clear();
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
        // Blinking cursor animation for visual mode.
        '@keyframes zv-cursor-blink {',
        '  0%, 100% { opacity: 1; }',
        '  50% { opacity: 0; }',
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
    if (mode !== 'normal') this._stopSmoothHoldScroll(state, state.pdfWin);
    state.mode = mode;
    state.keyBuffer = '';
    clearTimeout(state.keyTimeout);
    state.keyTimeout = null;
    if (state.hintMode) this._clearVisualHints(state, state.pdfWin);
    // Remove visual cursor whenever leaving visual mode.
    if (mode !== 'visual' && state.pdfWin) {
      try {
        for (const el of state.pdfWin.document.querySelectorAll('[data-zv-cursor]')) el.remove();
      } catch (_) {}
    }
    if (mode === 'cursor') this._ensureCursorCaret(state, state.pdfWin);
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
      mode === 'cursor' ? 'rgba(180,120,40,0.9)'  :
      mode === 'insert' ? 'rgba(50,150,80,0.85)'  : 'rgba(0,0,0,0.65)';
  },

  // ── Key handling ──────────────────────────────────────────────────────────

  _smoothHoldSpecForEvent(event, state) {
    if (!this.isSmoothScrollEnabled()) return false;
    if (state.mode !== 'normal') return false;
    if (state.countBuffer || state.keyBuffer) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!['j', 'k', 'H', 'L'].includes(event.key)) return false;

    const bindings = this.getBindings();
    const action = bindings['normal:' + event.key];
    if (action === 'scrollDown')  return { key: event.key, axis: 'y', direction: 1 };
    if (action === 'scrollUp')    return { key: event.key, axis: 'y', direction: -1 };
    if (action === 'scrollRight') return { key: event.key, axis: 'x', direction: 1 };
    if (action === 'scrollLeft')  return { key: event.key, axis: 'x', direction: -1 };
    return null;
  },

  _startSmoothHoldScroll(state, pdfWin, spec) {
    const hold = state.smoothHold;
    if (!hold) return;

    if (hold.active && hold.key === spec.key) return;

    const config = this.getSmoothScrollConfig();
    const sameVector = hold.axis === spec.axis && hold.direction === spec.direction;

    hold.active = true;
    hold.releasing = false;
    hold.key = spec.key;
    hold.axis = spec.axis;
    hold.direction = spec.direction;
    hold.lastTS = 0;
    hold.speed = sameVector ? Math.max(config.initialSpeed, hold.speed) : config.initialSpeed;

    // Immediate response on keydown so short taps still feel consistent.
    const kick = hold.direction * (config.initialSpeed / 120);
    const kickDX = hold.axis === 'x' ? kick : 0;
    const kickDY = hold.axis === 'y' ? kick : 0;
    this._scrollContainerBy(this._getScrollContainer(pdfWin), kickDX, kickDY, { forceInstant: true });

    if (hold.rafId) return;

    const tick = (ts) => {
      if ((!hold.active && !hold.releasing) || !hold.direction || !hold.axis) {
        hold.rafId = null;
        hold.lastTS = 0;
        return;
      }

      const frameConfig = this.getSmoothScrollConfig();

      if (!hold.lastTS) {
        hold.lastTS = ts;
      }
      const dt = Math.min(0.05, Math.max(0.001, (ts - hold.lastTS) / 1000));
      hold.lastTS = ts;

      if (hold.active) {
        hold.speed = Math.min(frameConfig.maxSpeed, Math.max(frameConfig.initialSpeed, hold.speed + frameConfig.acceleration * dt));
      } else if (hold.releasing) {
        hold.speed = Math.max(0, hold.speed - frameConfig.deceleration * dt);
        if (hold.speed <= 0) {
          this._stopSmoothHoldScroll(state, pdfWin, true);
          return;
        }
      }

      const delta = hold.direction * hold.speed * dt;
      const dx = hold.axis === 'x' ? delta : 0;
      const dy = hold.axis === 'y' ? delta : 0;
      this._scrollContainerBy(this._getScrollContainer(pdfWin), dx, dy, { forceInstant: true });
      hold.rafId = pdfWin.requestAnimationFrame(tick);
    };

    hold.rafId = pdfWin.requestAnimationFrame(tick);
  },

  _stopSmoothHoldScroll(state, pdfWin, immediate = true) {
    const hold = state?.smoothHold;
    if (!hold) return;
    if (!immediate) {
      hold.active = false;
      hold.releasing = true;
      hold.key = null;
      return;
    }
    hold.active = false;
    hold.releasing = false;
    hold.key = null;
    hold.axis = null;
    hold.direction = 0;
    hold.speed = 0;
    hold.lastTS = 0;
    if (hold.rafId) {
      try { pdfWin?.cancelAnimationFrame(hold.rafId); } catch (_) {}
      hold.rafId = null;
    }
  },

  _onKeyUp(event, state, pdfWin) {
    if (!this.isSmoothScrollEnabled()) return;
    if (!['j', 'k', 'H', 'L'].includes(event.key)) return;
    if (state?.smoothHold?.key === event.key) {
      const config = this.getSmoothScrollConfig();
      this._stopSmoothHoldScroll(state, pdfWin, !!config.stopOnRelease);
    }
  },

  _onKeyDown(event, reader, state, pdfWin) {
    state.activePdfWin = pdfWin || state.activePdfWin;

    if (state.outlineExplorerOpen) {
      if (this._onReaderOutlineExplorerKeyDown(event, reader, state, pdfWin)) {
        return;
      }
    }

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

    const holdSpec = this._smoothHoldSpecForEvent(event, state);
    if (holdSpec) {
      event.preventDefault();
      event.stopPropagation();
      this._startSmoothHoldScroll(state, pdfWin, holdSpec);
      return;
    }

    const keyStr = this._keyString(event);
    if (!keyStr) return;

    if (state.mode === 'cursor' && !state.countBuffer && !state.keyBuffer) {
      if (['j', 'k', 'h', 'l', 'w', 'W', 'b', 'B', '$'].includes(keyStr)) {
        const now = Date.now();
        if (state.cursorLastKey === keyStr && now - state.cursorLastKeyTS < 35) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        state.cursorLastKey = keyStr;
        state.cursorLastKeyTS = now;
      }
    }

    // Accumulate a count prefix (1–9 to start, 0 to extend) in normal mode.
    if ((state.mode === 'normal' || state.mode === 'cursor') && /^\d$/.test(keyStr)) {
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

    const possible = Object.keys(bindings).filter(k => this._bindingMatchesPrefix(k, modePrefix, newBuffer));
    const exact    = bindings[modePrefix + newBuffer];

    if (possible.length === 0 && !exact) {
      state.keyBuffer = '';
      state.countBuffer = '';
      clearTimeout(state.keyTimeout);
      state.keyTimeout = null;
      const sp = Object.keys(bindings).filter(k => this._bindingMatchesPrefix(k, modePrefix, keyStr));
      const se = bindings[modePrefix + keyStr];
      if (sp.length === 0 && !se) return;
      this._processBuffer(keyStr, se, sp, modePrefix, bindings, state);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this._processBuffer(newBuffer, exact, possible, modePrefix, bindings, state);
  },

  _processBuffer(buffer, exact, possible, modePrefix, bindings, state) {
    clearTimeout(state.keyTimeout);
    state.keyTimeout = null;
    const longerPossible = possible.filter(k => k.length > modePrefix.length + buffer.length);

    if (exact && longerPossible.length === 0) {
      state.keyBuffer = '';
      const count = state.countBuffer ? parseInt(state.countBuffer, 10) : 0;
      state.countBuffer = '';
      this._updateIndicator(state);   // clear buffer display before action
      state.executeAction(bindings[modePrefix + buffer], count);
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
        state.executeAction(exact, count);
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

  _bindingMatchesPrefix(bindingKey, modePrefix, buffer) {
    if (!bindingKey.startsWith(modePrefix)) return false;
    const tail = bindingKey.slice(modePrefix.length);
    if (!tail.startsWith(buffer)) return false;

    // Prevent single-letter keys like "c" from waiting on ctrl/alt combos
    // such as "ctrl+d" due naive string prefix overlap.
    if (!buffer.includes('+') && buffer.length === 1 && /^[A-Za-z]$/.test(buffer)) {
      if (tail.startsWith('ctrl+') || tail.startsWith('alt+')) return false;
    }
    return true;
  },

  // ── Action dispatcher ─────────────────────────────────────────────────────

  _executeAction(action, reader, state, pdfWin, count = 0) {
    try {
      Zotero.debug('[ZoteroVim] Action: ' + action + ' (mode:' + state.mode + ', count:' + count + ')');

      if (this._handleReaderSidebarAction(state, reader, pdfWin, action)) {
        return;
      }

      const step = this.getScrollStep();
      const getContainer = () => this._getScrollContainer(pdfWin);
      const scrollBy  = (dy) => this._scrollContainerBy(getContainer(), 0, dy);
      const scrollXBy = (dx) => this._scrollContainerBy(getContainer(), dx, 0);
      const viewportH = () => { try { return getContainer()?.clientHeight || 600; } catch (_) { return 600; } };

      // Scrolling / page navigation clears any active annotation selection so that
      // zb (recolorBlue) correctly falls through to the scroll-to-bottom path.
      const clearAnnotation = () => { state.lastAnnotationKey = null; };

      switch (action) {
        case 'scrollDown':    clearAnnotation(); scrollBy(step);                         break;
        case 'scrollUp':      clearAnnotation(); scrollBy(-step);                        break;
        case 'scrollLeft':    clearAnnotation(); scrollXBy(-step);                       break;
        case 'scrollRight':   clearAnnotation(); scrollXBy(step);                        break;
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
        case 'filterYellow':    this._filterByColor(state, reader, this.COLORS.yellow); break;
        case 'filterRed':       this._filterByColor(state, reader, this.COLORS.red);    break;
        case 'filterGreen':     this._filterByColor(state, reader, this.COLORS.green);  break;
        case 'filterBlue':      this._filterByColor(state, reader, this.COLORS.blue);   break;
        case 'filterPurple':    this._filterByColor(state, reader, this.COLORS.purple); break;
        case 'filterClear':     this._filterByColor(state, reader, null);               break;
        case 'yankAnnotation':        this._yankAnnotation(state, reader);          break;
        case 'yankAnnotationComment': this._yankAnnotationComment(state, reader);  break;
        case 'yankParagraph':         this._yankParagraph(state, pdfWin);           break;
        case 'clearSearch':       this._clearSearch(pdfWin);                  break;

        case 'enterVisual':
          if (this.isModeEnabled('visual')) this._enterVisualMode(state, pdfWin);
          break;
        case 'enterCursor':
          if (this.isModeEnabled('cursor')) this._enterCursorMode(state, pdfWin);
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
        case 'extendWordForward':        this._extendByWord(state, pdfWin, 'forward', false);   break;
        case 'extendWordBackward':       this._extendByWord(state, pdfWin, 'backward', false);  break;
        case 'extendLineStart':          this._extendToLineBoundary(state, pdfWin, false);      break;
        case 'extendLineEnd':            this._extendToLineBoundary(state, pdfWin, true);       break;
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
        case 'searchSelection':  this._searchSelection(state, reader, pdfWin);                 break;
        case 'swapVisualEnds':   this._swapVisualEnds(state, pdfWin);                          break;

      // Cursor mode navigation
        case 'cursorDown':            this._cursorMoveLine(state, pdfWin, +1, count);          break;
        case 'cursorUp':              this._cursorMoveLine(state, pdfWin, -1, count);          break;
        case 'cursorLeft':            this._cursorMoveByGranularity(state, pdfWin, 'backward', 'character', count); break;
        case 'cursorRight':           this._cursorMoveByGranularity(state, pdfWin, 'forward', 'character', count);  break;
        case 'cursorWordForward':     this._cursorMoveByGranularity(state, pdfWin, 'forward', 'word', count);       break;
        case 'cursorBigWordForward':  this._cursorMoveByGranularity(state, pdfWin, 'forward', 'bigword', count);    break;
        case 'cursorWordBackward':    this._cursorMoveByGranularity(state, pdfWin, 'backward', 'word', count);      break;
        case 'cursorBigWordBackward': this._cursorMoveByGranularity(state, pdfWin, 'backward', 'bigword', count);   break;
        case 'cursorLineStart':       this._cursorMoveToLineBoundary(state, pdfWin, false);                          break;
        case 'cursorLineEnd':         this._cursorMoveToLineBoundary(state, pdfWin, true);                           break;
        case 'cursorToVisual':        this._cursorToVisual(state, pdfWin);                      break;

      // Delegate main-window actions from reader context
        case 'mainFuzzyAll':
        case 'mainFuzzyCollection':
        case 'mainTabPick':
        case 'mainYankCitekey':
        case 'mainOpenPDF':
        case 'mainClosePDF':
        case 'mainPrevTab':
        case 'mainNextTab':
          this._delegateToMainWindow(action, count); break;

        case 'toggleReaderSplitHorizontal':
          this._toggleReaderSplit(state, reader, 'horizontal'); break;
        case 'toggleReaderSplitVertical':
          this._toggleReaderSplit(state, reader, 'vertical'); break;
        case 'focusReaderSplitLeft':
          this._focusReaderSplit(state, reader, 'left', pdfWin); break;
        case 'focusReaderSplitDown':
          this._focusReaderSplit(state, reader, 'down', pdfWin); break;
        case 'focusReaderSplitUp':
          this._focusReaderSplit(state, reader, 'up', pdfWin); break;
        case 'focusReaderSplitRight':
          this._focusReaderSplit(state, reader, 'right', pdfWin); break;

        default: Zotero.debug('[ZoteroVim] Unknown action: ' + action);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _executeAction error (' + action + '): ' + e);
    }
  },

  _handleReaderSidebarAction(state, reader, pdfWin, action) {
    if (!pdfWin) return false;

    if (action === 'toggleReaderSidebarOutline') {
      this._toggleReaderOutlineExplorer(state, reader, pdfWin);
      return true;
    }

    if (action === 'focusReaderSidebar') {
      this._focusReaderOutlineExplorer(state, reader, pdfWin);
      return true;
    }

    if (!state.outlineExplorerOpen) return false;

    switch (action) {
      case 'scrollDown':
        this._moveReaderOutlineExplorer(state, +1);
        return true;
      case 'scrollUp':
        this._moveReaderOutlineExplorer(state, -1);
        return true;
      case 'nextPage':
        this._toggleReaderOutlineExplorerNode(state, true);
        return true;
      case 'prevPage':
        this._toggleReaderOutlineExplorerNode(state, false);
        return true;
      case 'editAnnotation':
        this._activateReaderOutlineExplorer(state, reader, pdfWin);
        return true;
      case 'exitMode':
        this._closeReaderOutlineExplorer(state, pdfWin);
        return true;
      default:
        return false;
    }
  },

  _onReaderOutlineExplorerKeyDown(event, reader, state, pdfWin) {
    const keyStr = this._keyString(event);
    if (!keyStr) return false;

    if (keyStr === 'g') {
      event.preventDefault(); event.stopPropagation();
      this._handleReaderOutlineExplorerG(state);
      return true;
    }
    if (keyStr === 'G') {
      event.preventDefault(); event.stopPropagation();
      this._jumpReaderOutlineBoundary(state, true);
      return true;
    }
    if (keyStr === 'ctrl+d') {
      event.preventDefault(); event.stopPropagation();
      this._moveReaderOutlineExplorer(state, +1, this._readerOutlineFastStep(state));
      return true;
    }
    if (keyStr === 'ctrl+u') {
      event.preventDefault(); event.stopPropagation();
      this._moveReaderOutlineExplorer(state, -1, this._readerOutlineFastStep(state));
      return true;
    }
    if (keyStr === 'M') {
      event.preventDefault(); event.stopPropagation();
      this._setReaderOutlineAllExpanded(state, false);
      return true;
    }
    if (keyStr === 'R') {
      event.preventDefault(); event.stopPropagation();
      this._setReaderOutlineAllExpanded(state, true);
      return true;
    }

    const hintKey = this._readerOutlineExplorerHintKey(event);
    if (hintKey) {
      event.preventDefault(); event.stopPropagation();
      this._handleReaderOutlineExplorerHint(state, hintKey);
      return true;
    }

    switch (keyStr) {
      case 'j':
        event.preventDefault(); event.stopPropagation();
        this._moveReaderOutlineExplorer(state, +1, 1);
        return true;
      case 'k':
        event.preventDefault(); event.stopPropagation();
        this._moveReaderOutlineExplorer(state, -1, 1);
        return true;
      case 'l':
        event.preventDefault(); event.stopPropagation();
        this._toggleReaderOutlineExplorerNode(state, true);
        return true;
      case 'h':
        event.preventDefault(); event.stopPropagation();
        this._toggleReaderOutlineExplorerNode(state, false);
        return true;
      case 'enter':
      case 'return':
        event.preventDefault(); event.stopPropagation();
        this._activateReaderOutlineExplorer(state, reader, pdfWin);
        return true;
      case 'escape':
        event.preventDefault(); event.stopPropagation();
        this._closeReaderOutlineExplorer(state, pdfWin);
        return true;
      case 'ctrl+h':
        event.preventDefault(); event.stopPropagation();
        this._focusReaderOutlineExplorer(state, reader, pdfWin);
        return true;
      default:
        return false;
    }
  },

  async _toggleReaderOutlineExplorer(state, reader, pdfWin) {
    if (state.outlineExplorerOpen) {
      this._closeReaderOutlineExplorer(state, pdfWin);
      return;
    }
    await this._openReaderOutlineExplorer(state, reader, pdfWin);
  },

  async _focusReaderOutlineExplorer(state, reader, pdfWin) {
    if (!state.outlineExplorerOpen) {
      await this._openReaderOutlineExplorer(state, reader, pdfWin);
      return;
    }
    try { state._outlineExplorerOverlay?.focus?.(); } catch (_) {}
    if (!state.outlineExplorerVisible?.length && !state.outlineExplorerLoading) {
      await this._loadReaderOutlineExplorer(state, reader, pdfWin);
    }
  },

  async _openReaderOutlineExplorer(state, reader, pdfWin) {
    if (state.outlineExplorerOpen) return;
    state.outlineExplorerOpen = true;
    this._createReaderOutlineExplorer(state, pdfWin);
    this._renderReaderOutlineExplorer(state);
    try { state._outlineExplorerOverlay?.focus?.(); } catch (_) {}
    await this._loadReaderOutlineExplorer(state, reader, pdfWin);
  },

  _closeReaderOutlineExplorer(state, pdfWin = null) {
    state.outlineExplorerOpen = false;
    state.outlineExplorerLoading = false;
    this._clearReaderOutlineExplorerHintBuffer(state);
    this._clearReaderOutlineExplorerCmdBuffer(state);
    try {
      const overlay = state._outlineExplorerOverlay;
      if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
    } catch (_) {}
    state._outlineExplorerOverlay = null;
    state._outlineExplorerList = null;
    state._outlineExplorerStatus = null;
    state.outlineExplorerVisible = [];
    state.outlineExplorerSelected = 0;
    state.sidebarNavActive = false;
    if (pdfWin) {
      setTimeout(() => { try { pdfWin.focus(); } catch (_) {} }, 30);
    }
  },

  _createReaderOutlineExplorer(state, pdfWin) {
    const doc = pdfWin.document;
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);
    const root = doc.body || doc.documentElement;

    const overlay = h('div');
    overlay.id = 'zv-outline-explorer';
    overlay.tabIndex = -1;
    overlay.style.cssText =
      'position:fixed;top:0;left:0;bottom:0;width:320px;z-index:99998;' +
      'background:rgba(24,24,37,0.96);color:#cdd6f4;border-right:1px solid #313244;' +
      'display:flex;flex-direction:column;box-shadow:12px 0 40px rgba(0,0,0,0.35);font:13px/1.35 monospace;';

    const header = h('div');
    header.style.cssText = 'padding:12px 14px;border-bottom:1px solid #313244;font-weight:bold;letter-spacing:0.04em;';
    header.textContent = 'Outline Explorer';

    const list = h('div');
    list.style.cssText = 'flex:1;overflow:auto;padding:8px 0;';

    const status = h('div');
    status.style.cssText = 'padding:6px 12px;border-top:1px solid #313244;color:#6c7086;font-size:11px;';
    status.textContent =
      'j/k move  ·  Ctrl+d/u fast  ·  gg/G top/bottom  ·  R/M expand/collapse all  ·  Enter jump';

    overlay.appendChild(header);
    overlay.appendChild(list);
    overlay.appendChild(status);
    root.appendChild(overlay);

    state._outlineExplorerOverlay = overlay;
    state._outlineExplorerList = list;
    state._outlineExplorerStatus = status;
  },

  async _loadReaderOutlineExplorer(state, reader, pdfWin) {
    state.outlineExplorerLoading = true;
    this._renderReaderOutlineExplorer(state);
    try {
      if (!state.outlineExplorerTree) {
        state.outlineExplorerTree = await this._fetchReaderOutlineTree(reader, pdfWin);
      }
      this._refreshReaderOutlineExplorer(state);
      // Best effort: preselect nearest/current outline entry when metadata is
      // available; otherwise fall back to the first item.
      if (!this._selectCurrentReaderOutlineEntry(state, pdfWin)) {
        state.outlineExplorerSelected = 0;
      }
      if (!state.outlineExplorerVisible.length) {
        this._setReaderOutlineExplorerStatus(state, 'No outline available');
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _loadReaderOutlineExplorer error: ' + e);
      state.outlineExplorerTree = [];
      this._refreshReaderOutlineExplorer(state);
      this._setReaderOutlineExplorerStatus(state, 'Error loading outline');
    }
    state.outlineExplorerLoading = false;
    this._renderReaderOutlineExplorer(state);
  },

  async _fetchReaderOutlineTree(reader, pdfWin) {
    const app = pdfWin.PDFViewerApplication || reader?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication;
    const pdfDoc = app?.pdfDocument;
    let outline = null;
    if (typeof pdfDoc?.getOutline === 'function') {
      outline = await pdfDoc.getOutline();
    }
    if (!outline?.length) {
      outline = this._readReaderOutlineFromDom(reader, pdfWin);
    }
    if (!outline?.length) return [];

    let nextID = 0;
    const build = async (nodes, depth = 0, parentID = null) => Promise.all(nodes.map(async (node) => {
      const item = {
        id: 'outline-' + (++nextID),
        parentID,
        depth,
        title: String(node.title || node.label || '(untitled)').replace(/\s+/g, ' ').trim() || '(untitled)',
        dest: node.dest ?? null,
        url: node.url ?? null,
        pageIndex: typeof node.pageIndex === 'number' ? node.pageIndex : null,
        expanded: depth === 0,
        children: [],
        hint: '',
      };
      item.pageIndex = await this._resolveReaderOutlinePageIndex(item, item.dest, pdfDoc);
      item.children = await build(node.items || node.children || [], depth + 1, item.id);
      return item;
    }));

    const tree = await build(outline, 0, null);
    this._enrichReaderOutlineTreeFromDom(tree, reader, pdfWin);
    return tree;
  },

  _readReaderOutlineAnchors(reader, pdfWin) {
    const els = this._readerSidebarElements(reader, pdfWin);
    const doc = els?.doc;
    const root = doc?.querySelector('#outlineView') || doc?.querySelector('[role="tree"], .outline, .outlineView');
    if (!root) return [];
    return Array.from(root.querySelectorAll('a')).filter((el) => el.textContent?.trim()).map((el) => {
      const href = el.getAttribute('href') || '';
      const hash = href.replace(/^[^#]*#?/, '');
      const pageNumber = parseInt(el.dataset?.pageNumber || '', 10);
      const hashMatch = hash.match(/(?:^|[&?#])page=(\d+)/i);
      const hashPage = hashMatch ? parseInt(hashMatch[1], 10) : NaN;
      return {
        title: el.textContent.trim().replace(/\s+/g, ' '),
        url: href || null,
        pageIndex: Number.isFinite(pageNumber) ? pageNumber - 1
          : (Number.isFinite(hashPage) && hashPage > 0 ? hashPage - 1 : null),
      };
    });
  },

  _flattenReaderOutlineTree(nodes) {
    const flat = [];
    const visit = (node) => {
      flat.push(node);
      for (const child of node.children || []) visit(child);
    };
    for (const node of nodes || []) visit(node);
    return flat;
  },

  _enrichReaderOutlineTreeFromDom(tree, reader, pdfWin) {
    const domAnchors = this._readReaderOutlineAnchors(reader, pdfWin);
    if (!domAnchors.length) return;

    const flat = this._flattenReaderOutlineTree(tree);
    if (!flat.length) return;

    let anchorPos = 0;
    for (let i = 0; i < flat.length && anchorPos < domAnchors.length; i++) {
      const item = flat[i];
      const itemTitle = String(item.title || '').replace(/\s+/g, ' ').trim();

      let matchedIdx = -1;
      for (let j = anchorPos; j < Math.min(domAnchors.length, anchorPos + 8); j++) {
        if (domAnchors[j].title === itemTitle) {
          matchedIdx = j;
          break;
        }
      }
      if (matchedIdx < 0) matchedIdx = anchorPos;

      const anchor = domAnchors[matchedIdx];
      if (typeof item.pageIndex !== 'number' && typeof anchor.pageIndex === 'number') {
        item.pageIndex = anchor.pageIndex;
      }
      if (!item.url && anchor.url) {
        item.url = anchor.url;
      }
      anchorPos = Math.min(domAnchors.length, matchedIdx + 1);
    }
  },

  _readReaderOutlineFromDom(reader, pdfWin) {
    return this._readReaderOutlineAnchors(reader, pdfWin).map((anchor) => ({
      title: anchor.title,
      url: anchor.url,
      pageIndex: anchor.pageIndex,
      items: [],
    }));
  },

  _refreshReaderOutlineExplorer(state) {
    const visible = [];
    const visit = (node) => {
      visible.push(node);
      if (node.expanded) {
        for (const child of node.children || []) visit(child);
      }
    };
    for (const node of state.outlineExplorerTree || []) visit(node);
    state.outlineExplorerVisible = visible;
    if (!visible.length) {
      state.outlineExplorerSelected = 0;
      return;
    }
    const hints = this._buildReaderOutlineExplorerHints(visible.length);
    visible.forEach((item, idx) => { item.hint = hints[idx] || ''; });
    state.outlineExplorerSelected = Math.max(0, Math.min(state.outlineExplorerSelected, visible.length - 1));
  },

  _renderReaderOutlineExplorer(state) {
    const list = state._outlineExplorerList;
    if (!list) return;
    const doc = list.ownerDocument;
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);
    while (list.firstChild) list.removeChild(list.firstChild);

    if (state.outlineExplorerLoading) {
      const loading = h('div');
      loading.style.cssText = 'padding:12px 14px;color:#6c7086;';
      loading.textContent = 'Loading outline...';
      list.appendChild(loading);
      return;
    }

    const items = state.outlineExplorerVisible || [];
    if (!items.length) {
      const empty = h('div');
      empty.style.cssText = 'padding:12px 14px;color:#6c7086;';
      empty.textContent = 'No outline available';
      list.appendChild(empty);
      return;
    }

    const frag = doc.createDocumentFragment();
    items.forEach((item, idx) => {
      const row = h('div');
      const hasChildren = !!item.children?.length;
      const isSel = idx === state.outlineExplorerSelected;
      row.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:6px 12px 6px ' + (12 + item.depth * 16) + 'px;' +
        'cursor:pointer;border-left:3px solid ' + (isSel ? '#89b4fa' : 'transparent') + ';' +
        'background:' + (isSel ? '#313244' : 'transparent') + ';';

      const twisty = h('span');
      twisty.style.cssText = 'display:inline-block;width:10px;color:#89b4fa;flex:0 0 10px;';
      twisty.textContent = hasChildren ? (item.expanded ? '▾' : '▸') : '·';

      const hint = h('span');
      hint.style.cssText = 'display:inline-block;min-width:22px;color:#f9e2af;flex:0 0 auto;font-weight:bold;';
      hint.textContent = item.hint || '';

      const title = h('span');
      title.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      title.textContent = item.title;

      row.appendChild(hint);
      row.appendChild(twisty);
      row.appendChild(title);
      row.addEventListener('click', () => {
        state.outlineExplorerSelected = idx;
        this._renderReaderOutlineExplorer(state);
      });
      row.addEventListener('dblclick', () => {
        state.outlineExplorerSelected = idx;
        this._activateReaderOutlineExplorer(state, state.reader, state.pdfWin);
      });
      frag.appendChild(row);
    });
    list.appendChild(frag);
    const selRow = list.children[state.outlineExplorerSelected];
    if (selRow) selRow.scrollIntoView({ block: 'nearest' });
  },

  _moveReaderOutlineExplorer(state, dir, amount = 1) {
    const items = state.outlineExplorerVisible || [];
    if (!items.length) return;
    this._clearReaderOutlineExplorerHintBuffer(state);
    this._clearReaderOutlineExplorerCmdBuffer(state);
    const step = Math.max(1, amount || 1);
    state.outlineExplorerSelected = Math.max(0, Math.min(items.length - 1, state.outlineExplorerSelected + dir * step));
    this._renderReaderOutlineExplorer(state);
  },

  _toggleReaderOutlineExplorerNode(state, expand) {
    const entry = (state.outlineExplorerVisible || [])[state.outlineExplorerSelected];
    if (!entry || !entry.children?.length) return;
    this._clearReaderOutlineExplorerHintBuffer(state);
    this._clearReaderOutlineExplorerCmdBuffer(state);
    if (expand) {
      entry.expanded = true;
    } else if (entry.expanded) {
      entry.expanded = false;
    } else if (entry.parentID) {
      const parentIdx = (state.outlineExplorerVisible || []).findIndex((it) => it.id === entry.parentID);
      if (parentIdx >= 0) state.outlineExplorerSelected = parentIdx;
    }
    this._refreshReaderOutlineExplorer(state);
    this._renderReaderOutlineExplorer(state);
  },

  async _activateReaderOutlineExplorer(state, reader, pdfWin) {
    const entry = (state.outlineExplorerVisible || [])[state.outlineExplorerSelected];
    if (!entry) return;
    this._clearReaderOutlineExplorerHintBuffer(state);
    this._clearReaderOutlineExplorerCmdBuffer(state);
    const ok = await this._goToReaderOutlineEntry(reader, pdfWin, entry);
    if (!ok) {
      this._setReaderOutlineExplorerStatus(state, 'Jump failed');
      return;
    }
    this._closeReaderOutlineExplorer(state, pdfWin);
    this._setMode(state, 'normal');
  },

  async _goToReaderOutlineEntry(reader, pdfWin, entry) {
    try {
      const app = pdfWin.PDFViewerApplication || reader?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication;
      const pdfDoc = app?.pdfDocument;
      const linkService = app?.pdfLinkService;
      const originalDest = entry.dest;

      if (originalDest && typeof linkService?.getDestinationHash === 'function' && typeof linkService?.setHash === 'function') {
        try {
          const hash = linkService.getDestinationHash(originalDest);
          if (hash) {
            linkService.setHash(String(hash).replace(/^#/, ''));
            return true;
          }
        } catch (_) {}
      }

      if (entry.url && typeof linkService?.setHash === 'function') {
        const hash = String(entry.url).replace(/^[^#]*#?/, '');
        if (hash) {
          linkService.setHash(hash);
          return true;
        }
      }

      if (originalDest && typeof linkService?.goToDestination === 'function') {
        try {
          await linkService.goToDestination(originalDest);
          return true;
        } catch (_) {}
      }
      if (originalDest && typeof linkService?.navigateTo === 'function') {
        try {
          await linkService.navigateTo(originalDest);
          return true;
        } catch (_) {}
      }

      let dest = originalDest;
      if (typeof dest === 'string' && typeof pdfDoc?.getDestination === 'function') {
        dest = await pdfDoc.getDestination(dest);
      }
      if (dest && typeof linkService?.getDestinationHash === 'function' && typeof linkService?.setHash === 'function') {
        try {
          const hash = linkService.getDestinationHash(dest);
          if (hash) {
            linkService.setHash(String(hash).replace(/^#/, ''));
            return true;
          }
        } catch (_) {}
      }
      if (dest && typeof linkService?.goToDestination === 'function') {
        try {
          await linkService.goToDestination(dest);
          return true;
        } catch (_) {}
      }
      if (dest && typeof linkService?.navigateTo === 'function') {
        try {
          await linkService.navigateTo(dest);
          return true;
        } catch (_) {}
      }

      if (this._clickNativeReaderOutlineEntry(reader, pdfWin, entry)) {
        return true;
      }

      const resolvedPageIndex = await this._resolveReaderOutlinePageIndex(entry, dest, pdfDoc);
      if (typeof resolvedPageIndex === 'number') {
        const readerWin = reader?._iframeWindow || pdfWin;
        const payload = Components.utils.cloneInto({ pageIndex: resolvedPageIndex }, readerWin);
        reader?._internalReader?.navigate?.(payload);
        return true;
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _goToReaderOutlineEntry error: ' + e);
    }
    return false;
  },

  _clickNativeReaderOutlineEntry(reader, pdfWin, entry) {
    try {
      const els = this._readerSidebarElements(reader, pdfWin);
      const doc = els?.doc;
      if (!doc) return false;
      const anchors = Array.from(doc.querySelectorAll('#outlineView a, [role="tree"] a, .outline a'));
      if (!anchors.length) return false;

      const wantedHash = String(entry.url || '').replace(/^[^#]*#?/, '');
      const wantedTitle = String(entry.title || '').replace(/\s+/g, ' ').trim();
      const match = anchors.find((a) => {
        const hrefHash = String(a.getAttribute('href') || '').replace(/^[^#]*#?/, '');
        const title = String(a.textContent || '').replace(/\s+/g, ' ').trim();
        if (wantedHash && hrefHash && hrefHash === wantedHash) return true;
        if (wantedTitle && title === wantedTitle) return true;
        return false;
      });
      if (!match) return false;
      match.click();
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _clickNativeReaderOutlineEntry error: ' + e);
      return false;
    }
  },

  async _resolveReaderOutlinePageIndex(entry, dest, pdfDoc) {
    if (typeof entry?.pageIndex === 'number') return entry.pageIndex;

    const urlInfo = await this._resolveReaderOutlineUrlInfo(entry?.url, pdfDoc);
    if (typeof urlInfo.pageIndex === 'number') {
      return urlInfo.pageIndex;
    }
    if (!dest && urlInfo.dest) {
      dest = urlInfo.dest;
    }

    if (Array.isArray(dest) && dest.length > 0) {
      const first = dest[0];
      if (typeof first === 'number' && Number.isFinite(first)) return first;
      if (first && typeof pdfDoc?.getPageIndex === 'function') {
        try {
          const idx = await pdfDoc.getPageIndex(first);
          if (Number.isFinite(idx)) return idx;
        } catch (_) {}
      }
    }

    return null;
  },

  async _resolveReaderOutlineUrlInfo(url, pdfDoc) {
    const result = { pageIndex: null, dest: null };
    const raw = String(url || '');
    if (!raw) return result;

    const hash = raw.replace(/^[^#]*#?/, '');
    const pageMatch = hash.match(/(?:^|[&?])page=(\d+)/i);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      if (Number.isFinite(pageNum) && pageNum > 0) {
        result.pageIndex = pageNum - 1;
        return result;
      }
    }

    const namedDestMatch = hash.match(/(?:^|[&?])(nameddest|dest)=([^&]+)/i);
    if (!namedDestMatch) return result;

    const namedDest = decodeURIComponent(namedDestMatch[2] || '');
    if (!namedDest) return result;

    result.dest = namedDest;
    if (typeof pdfDoc?.getDestination !== 'function') return result;

    try {
      const resolvedDest = await pdfDoc.getDestination(namedDest);
      result.dest = resolvedDest || namedDest;
      if (Array.isArray(resolvedDest) && resolvedDest.length > 0) {
        const first = resolvedDest[0];
        if (typeof first === 'number' && Number.isFinite(first)) {
          result.pageIndex = first;
          return result;
        }
        if (first && typeof pdfDoc?.getPageIndex === 'function') {
          const idx = await pdfDoc.getPageIndex(first);
          if (Number.isFinite(idx)) {
            result.pageIndex = idx;
            return result;
          }
        }
      }
    } catch (_) {}

    return result;
  },

  _setReaderOutlineExplorerStatus(state, text) {
    if (state._outlineExplorerStatus) {
      state._outlineExplorerStatus.textContent = text;
    }
  },

  _readerOutlineExplorerHintAlphabet() {
    // Exclude h/j/k/l and g because they are navigation commands.
    return 'asdfqwertyuiopzxcvbnm1234567890';
  },

  _buildReaderOutlineExplorerHints(count) {
    const alphabet = this._readerOutlineExplorerHintAlphabet();
    const base = alphabet.length;
    if (count <= base) {
      return alphabet.slice(0, count).split('');
    }
    const hints = [];
    for (let i = 0; i < count; i++) {
      const first = Math.floor(i / base);
      const second = i % base;
      hints.push(alphabet[first] + alphabet[second]);
    }
    return hints;
  },

  _readerOutlineExplorerHintKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return '';
    const key = String(event.key || '').toLowerCase();
    return this._readerOutlineExplorerHintAlphabet().includes(key) ? key : '';
  },

  _handleReaderOutlineExplorerHint(state, key) {
    const items = state.outlineExplorerVisible || [];
    if (!items.length) return;
    const nextBuffer = (state.outlineExplorerHintBuffer || '') + key;
    const matches = items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.hint && item.hint.startsWith(nextBuffer));

    if (!matches.length) {
      state.outlineExplorerHintBuffer = '';
      this._setReaderOutlineExplorerStatus(state, 'Hint not found');
      return;
    }

    state.outlineExplorerHintBuffer = nextBuffer;
    clearTimeout(state._outlineExplorerHintTimer);
    state._outlineExplorerHintTimer = setTimeout(() => {
      this._clearReaderOutlineExplorerHintBuffer(state);
    }, 1200);

    const exact = matches.find(({ item }) => item.hint === nextBuffer);
    if (exact) {
      state.outlineExplorerSelected = exact.idx;
      this._renderReaderOutlineExplorer(state);
      this._clearReaderOutlineExplorerHintBuffer(state, false);
      this._setReaderOutlineExplorerStatus(state, 'Selected ' + exact.item.hint + '  ·  Enter jump');
      return;
    }

    this._setReaderOutlineExplorerStatus(state, 'Hint: ' + nextBuffer);
  },

  _clearReaderOutlineExplorerHintBuffer(state, resetStatus = true) {
    state.outlineExplorerHintBuffer = '';
    clearTimeout(state._outlineExplorerHintTimer);
    state._outlineExplorerHintTimer = null;
    if (resetStatus && state._outlineExplorerStatus) {
      state._outlineExplorerStatus.textContent = 'j/k move  ·  l expand  ·  h collapse  ·  Enter jump  ·  Esc close';
    }
  },

  _handleReaderOutlineExplorerG(state) {
    if (state.outlineExplorerCmdBuffer === 'g') {
      this._jumpReaderOutlineBoundary(state, false);
      this._clearReaderOutlineExplorerCmdBuffer(state);
      return;
    }
    state.outlineExplorerCmdBuffer = 'g';
    clearTimeout(state._outlineExplorerCmdTimer);
    state._outlineExplorerCmdTimer = setTimeout(() => {
      this._clearReaderOutlineExplorerCmdBuffer(state);
    }, 700);
    this._setReaderOutlineExplorerStatus(state, 'g … (gg top)');
  },

  _clearReaderOutlineExplorerCmdBuffer(state, resetStatus = true) {
    state.outlineExplorerCmdBuffer = '';
    clearTimeout(state._outlineExplorerCmdTimer);
    state._outlineExplorerCmdTimer = null;
    if (resetStatus && state._outlineExplorerStatus && !state.outlineExplorerHintBuffer) {
      state._outlineExplorerStatus.textContent =
        'j/k move  ·  Ctrl+d/u fast  ·  gg/G top/bottom  ·  R/M expand/collapse all  ·  Enter jump';
    }
  },

  _jumpReaderOutlineBoundary(state, toBottom) {
    const items = state.outlineExplorerVisible || [];
    if (!items.length) return;
    this._clearReaderOutlineExplorerHintBuffer(state);
    this._clearReaderOutlineExplorerCmdBuffer(state, false);
    state.outlineExplorerSelected = toBottom ? items.length - 1 : 0;
    this._renderReaderOutlineExplorer(state);
    this._setReaderOutlineExplorerStatus(state, toBottom ? 'Bottom' : 'Top');
  },

  _readerOutlineFastStep(state) {
    const items = state.outlineExplorerVisible || [];
    return Math.max(5, Math.floor(items.length / 10) || 10);
  },

  _setReaderOutlineAllExpanded(state, expand) {
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.children?.length) node.expanded = !!expand;
        walk(node.children || []);
      }
    };
    walk(state.outlineExplorerTree || []);
    this._refreshReaderOutlineExplorer(state);
    state.outlineExplorerSelected = Math.max(0, Math.min(state.outlineExplorerSelected, (state.outlineExplorerVisible.length || 1) - 1));
    this._renderReaderOutlineExplorer(state);
    this._setReaderOutlineExplorerStatus(state, expand ? 'Expanded all' : 'Collapsed all');
  },

  _selectCurrentReaderOutlineEntry(state, pdfWin) {
    const items = state.outlineExplorerVisible || [];
    if (!items.length) return false;

    const nativeSelected = this._findNativeCurrentOutlineSelection(state.reader, pdfWin);
    if (nativeSelected) {
      const byNative = this._findReaderOutlineIndexBySignature(items, nativeSelected);
      if (byNative >= 0) {
        state.outlineExplorerSelected = byNative;
        this._renderReaderOutlineExplorer(state);
        return true;
      }
    }

    const currentPageIndex = Math.max(0, (pdfWin.PDFViewerApplication?.pdfViewer?.currentPageNumber || 1) - 1);
    let bestIdx = -1;
    let bestPage = -Infinity;
    for (let i = 0; i < items.length; i++) {
      const pageIndex = items[i].pageIndex;
      if (typeof pageIndex !== 'number') continue;
      if (pageIndex <= currentPageIndex && pageIndex >= bestPage) {
        bestPage = pageIndex;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      bestIdx = items.findIndex((item) => typeof item.pageIndex === 'number');
    }
    if (bestIdx >= 0) {
      state.outlineExplorerSelected = bestIdx;
      this._renderReaderOutlineExplorer(state);
      return true;
    }
    return false;
  },

  _findNativeCurrentOutlineSelection(reader, pdfWin) {
    try {
      const els = this._readerSidebarElements(reader, pdfWin);
      const doc = els?.doc;
      if (!doc) return null;
      const root = doc.querySelector('#outlineView, [role="tree"], .outline, .outlineView');
      if (!root) return null;
      const anchor = root.querySelector(
        'a.selected, .selected > a, [aria-current="true"], [aria-selected="true"], a:focus'
      );
      if (!anchor) return null;
      const title = String(anchor.textContent || '').replace(/\s+/g, ' ').trim();
      const url = String(anchor.getAttribute('href') || '');
      const hash = url.replace(/^[^#]*#?/, '');
      return { title, hash };
    } catch (_) {
      return null;
    }
  },

  _findReaderOutlineIndexBySignature(items, sig) {
    if (!sig) return -1;
    const wantedTitle = String(sig.title || '').replace(/\s+/g, ' ').trim();
    const wantedHash = String(sig.hash || '');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = String(item.title || '').replace(/\s+/g, ' ').trim();
      const hash = String(item.url || '').replace(/^[^#]*#?/, '');
      if (wantedHash && hash && wantedHash === hash) return i;
      if (wantedTitle && title && wantedTitle === title) return i;
    }
    return -1;
  },

  _readerSidebarDocs(reader, pdfWin) {
    const docs = [];
    const pushDoc = (d) => {
      if (!d) return;
      if (docs.includes(d)) return;
      docs.push(d);
    };
    pushDoc(reader?._iframeWindow?.document);
    pushDoc(pdfWin?.document);
    return docs;
  },

  _readerSidebarElements(reader, pdfWin) {
    const docs = this._readerSidebarDocs(reader, pdfWin);
    let fallback = null;
    for (const doc of docs) {
      const sidebarToggle = doc.querySelector('#sidebarToggle, button[aria-controls="sidebarContainer"]');
      const sidebarContainer = doc.querySelector('#sidebarContainer');
      const outerContainer = doc.querySelector('#outerContainer');
      const outlineTab = doc.querySelector(
        '#viewOutline, button[aria-controls="outlineView"], button[data-l10n-id="pdfjs-toggle-sidebar-outline-button"]'
      );
      const outlineView = doc.querySelector('#outlineView');
      const candidate = { doc, sidebarToggle, sidebarContainer, outerContainer, outlineTab, outlineView };
      if (sidebarToggle || sidebarContainer || outerContainer || outlineTab || outlineView) {
        return candidate;
      }
      fallback = candidate;
    }
    return fallback;
  },

  _readerIsSidebarOpen(reader, pdfWin, els = null) {
    const e = els || this._readerSidebarElements(reader, pdfWin);
    if (!e) return false;
    const isVisible = (el) => {
      if (!el) return false;
      try {
        if (el.offsetParent !== null) return true;
        if ((el.getClientRects?.().length || 0) > 0) return true;
      } catch (_) {}
      return false;
    };
    const openByClass = e.outerContainer?.classList?.contains('sidebarOpen');
    const openByContainer = !!(e.sidebarContainer &&
      (e.sidebarContainer.classList?.contains('visible') || e.sidebarContainer.classList?.contains('open')));
    const openByAria = e.sidebarToggle?.getAttribute?.('aria-expanded') === 'true';
    const openByToggleClass = !!(e.sidebarToggle?.classList?.contains('toggled') ||
      e.sidebarToggle?.classList?.contains('checked'));
    const openByVisibility = isVisible(e.sidebarContainer) || isVisible(e.outlineView);
    return !!(openByClass || openByContainer || openByAria || openByToggleClass || openByVisibility);
  },

  _readerSetSidebarOpen(state, reader, pdfWin, open) {
    let els = this._readerSidebarElements(reader, pdfWin);
    if (!els) return false;

    const current = this._readerIsSidebarOpen(reader, pdfWin, els);
    if (current === open) return current;

    // Prefer internalReader API when available; fall back to DOM click.
    let attemptedApi = false;
    let attemptedDom = false;
    try {
      const ir = reader?._internalReader;
      const readerWin = reader?._iframeWindow || pdfWin;
      if (typeof ir?.setSidebarOpen === 'function') {
        attemptedApi = true;
        try {
          ir.setSidebarOpen(Components.utils.cloneInto({ open }, readerWin));
        } catch (_) {
          ir.setSidebarOpen(open);
        }
      } else if (typeof ir?.toggleSidebar === 'function') {
        attemptedApi = true;
        ir.toggleSidebar();
      }
    } catch (_) {}

    els = this._readerSidebarElements(reader, pdfWin);
    let now = this._readerIsSidebarOpen(reader, pdfWin, els);
    if (now !== open) {
      try {
        if (els?.sidebarToggle?.click) {
          attemptedDom = true;
          els.sidebarToggle.click();
        }
      } catch (_) {}
      els = this._readerSidebarElements(reader, pdfWin);
      now = this._readerIsSidebarOpen(reader, pdfWin, els);
    }

    if (now !== open && !attemptedApi && !attemptedDom) {
      this._showStatus(state, '✗ sidebar toggle failed', 1200);
    }
    return now;
  },

  _readerActivateOutlineTab(reader, pdfWin) {
    let els = this._readerSidebarElements(reader, pdfWin);
    if (!els) return false;
    try {
      const ir = reader?._internalReader;
      const readerWin = reader?._iframeWindow || pdfWin;
      if (typeof ir?.setSidebarView === 'function') {
        try {
          ir.setSidebarView(Components.utils.cloneInto({ view: 'outline' }, readerWin));
        } catch (_) {
          ir.setSidebarView('outline');
        }
      }
    } catch (_) {}
    try { els.outlineTab?.click?.(); } catch (_) {}
    els = this._readerSidebarElements(reader, pdfWin);
    return !!els?.outlineView;
  },

  _readerGetOutlineItems(reader, pdfWin) {
    const els = this._readerSidebarElements(reader, pdfWin);
    const doc = els?.doc;
    if (!doc) return [];
    const root = doc.querySelector('#outlineView, [id*="outline" i], [data-l10n-id*="outline" i]') ||
      doc.querySelector('[role="tree"], .outline, .outlineView');
    if (!root) return [];
    return Array.from(root.querySelectorAll('a, [role="treeitem"], button')).filter((a) => {
      if (!a || !a.textContent?.trim()) return false;
      return a.offsetParent !== null || (a.getClientRects?.().length || 0) > 0;
    });
  },

  _readerOutlineFocusTarget(reader, pdfWin) {
    const els = this._readerSidebarElements(reader, pdfWin);
    const doc = els?.doc;
    if (!doc) return null;
    const root = doc.querySelector('#outlineView, [id*="outline" i], [data-l10n-id*="outline" i]') ||
      doc.querySelector('[role="tree"], .outline, .outlineView');
    if (!root) return null;
    const firstItem = root.querySelector('a, [role="treeitem"], button, [tabindex]');
    return firstItem || root;
  },

  _readerOutlineSendKey(reader, pdfWin, key) {
    const target = this._readerOutlineFocusTarget(reader, pdfWin);
    if (!target) return false;
    try { target.focus(); } catch (_) {}
    try {
      const ev = new target.ownerDocument.defaultView.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(ev);
      return true;
    } catch (_) {
      return false;
    }
  },

  _readerSetOutlineSelection(state, reader, pdfWin, idx) {
    const items = this._readerGetOutlineItems(reader, pdfWin);
    if (!items.length) {
      state.sidebarOutlineIndex = -1;
      return false;
    }
    const next = Math.max(0, Math.min(items.length - 1, idx));
    const doc = items[0].ownerDocument;
    for (const el of doc.querySelectorAll('[data-zv-outline-selected="1"]')) {
      el.removeAttribute('data-zv-outline-selected');
      el.style.outline = '';
      el.style.background = '';
    }
    const target = items[next];
    target.setAttribute('data-zv-outline-selected', '1');
    target.style.outline = '1px solid rgba(137,180,250,0.9)';
    target.style.background = 'rgba(137,180,250,0.15)';
    target.scrollIntoView({ block: 'nearest' });
    state.sidebarOutlineIndex = next;
    try { target.focus(); } catch (_) {}
    return true;
  },

  _readerFocusSidebarOutline(state, reader, pdfWin, opts = null) {
    const openIfNeeded = !!opts?.openIfNeeded;
    const isOpen = this._readerIsSidebarOpen(reader, pdfWin);
    if (!isOpen && !openIfNeeded) {
      // Fallback: some builds report open-state unreliably, so attempt
      // to switch to outline view and proceed if entries are available.
      this._readerActivateOutlineTab(reader, pdfWin);
      if (!this._readerGetOutlineItems(reader, pdfWin).length && !this._readerOutlineFocusTarget(reader, pdfWin)) {
        this._showStatus(state, '✗ sidebar closed', 1200);
        return false;
      }
    }
    if (!isOpen && openIfNeeded) {
      this._readerSetSidebarOpen(state, reader, pdfWin, true);
    }
    this._readerActivateOutlineTab(reader, pdfWin);
    const ok = state.sidebarOutlineIndex < 0
      ? this._readerSetOutlineSelection(state, reader, pdfWin, 0)
      : this._readerSetOutlineSelection(state, reader, pdfWin, state.sidebarOutlineIndex);
    const hasFallbackTarget = !!this._readerOutlineFocusTarget(reader, pdfWin);
    if (!ok && !hasFallbackTarget) {
      state.sidebarNavActive = false;
      state.sidebarOutlineIndex = -1;
      this._showStatus(state, '✗ outline not available', 1200);
      return false;
    }
    state.sidebarNavActive = true;
    this._showStatus(state, ok ? '▶ outline' : '▶ outline (kbd)', 900);
    return true;
  },

  _readerToggleSidebarOutline(state, reader, pdfWin) {
    const wasOpen = this._readerIsSidebarOpen(reader, pdfWin);
    if (wasOpen) {
      this._readerSetSidebarOpen(state, reader, pdfWin, false);
      state.sidebarNavActive = false;
      state.sidebarOutlineIndex = -1;
      this._showStatus(state, '→ sidebar toggled', 900);
      return;
    }

    this._readerSetSidebarOpen(state, reader, pdfWin, true);
    const focused = this._readerFocusSidebarOutline(state, reader, pdfWin, { openIfNeeded: true });
    if (!focused) {
      // Even when outline items are not ready yet, keep this action truthful.
      this._showStatus(state, '→ sidebar toggled', 900);
    }
  },

  _readerOutlineMove(state, reader, pdfWin, dir) {
    const items = this._readerGetOutlineItems(reader, pdfWin);
    if (!items.length) {
      const key = dir > 0 ? 'ArrowDown' : 'ArrowUp';
      if (!this._readerOutlineSendKey(reader, pdfWin, key)) {
        state.sidebarNavActive = false;
        this._showStatus(state, '✗ no outline entries', 1200);
      }
      return;
    }
    const base = state.sidebarOutlineIndex < 0 ? 0 : state.sidebarOutlineIndex;
    const next = Math.max(0, Math.min(items.length - 1, base + dir));
    this._readerSetOutlineSelection(state, reader, pdfWin, next);
  },

  _readerOutlineToggleExpand(state, reader, pdfWin, expand) {
    const items = this._readerGetOutlineItems(reader, pdfWin);
    if (!items.length) {
      const key = expand ? 'ArrowRight' : 'ArrowLeft';
      if (!this._readerOutlineSendKey(reader, pdfWin, key)) state.sidebarNavActive = false;
      return;
    }
    if (state.sidebarOutlineIndex < 0) {
      this._readerSetOutlineSelection(state, reader, pdfWin, 0);
    }
    const item = items[Math.max(0, state.sidebarOutlineIndex)];
    if (!item) return;
    const outlineItem = item.closest('.outlineItem');
    const toggler = outlineItem?.querySelector(':scope > .outlineItemToggler')
      || outlineItem?.querySelector('.outlineItemToggler');
    if (!toggler) return;
    const isCollapsed = toggler.classList.contains('outlineItemsHidden');
    if (expand && isCollapsed) toggler.click();
    if (!expand && !isCollapsed) toggler.click();
    // Outline structure changed after toggle; refresh visible list and keep cursor nearby.
    this._readerSetOutlineSelection(state, reader, pdfWin, state.sidebarOutlineIndex);
  },

  _readerOutlineActivate(state, reader, pdfWin) {
    const items = this._readerGetOutlineItems(reader, pdfWin);
    if (!items.length) {
      if (!this._readerOutlineSendKey(reader, pdfWin, 'Enter')) {
        state.sidebarNavActive = false;
      }
      state.sidebarNavActive = false;
      this._setMode(state, 'normal');
      setTimeout(() => { try { pdfWin.focus(); } catch (_) {} }, 30);
      return;
    }
    if (state.sidebarOutlineIndex < 0) {
      this._readerSetOutlineSelection(state, reader, pdfWin, 0);
    }
    const item = items[Math.max(0, state.sidebarOutlineIndex)];
    if (!item) return;
    try { item.click(); } catch (_) {}
    state.sidebarNavActive = false;
    this._setMode(state, 'normal');
    setTimeout(() => { try { pdfWin.focus(); } catch (_) {} }, 30);
    this._showStatus(state, '▶ jumped', 900);
  },

  // ── Visual mode helpers ───────────────────────────────────────────────────

  _enterVisualMode(state, pdfWin) {
    state.visualCursor = null;   // always start fresh — old textNode may be stale
    state.visualPreferredX = null;
    this._setMode(state, 'visual');
    try {
      const sel = pdfWin.getSelection();
      if (sel && !sel.isCollapsed) {
        state.visualPreferredX = this._cursorCurrentX(pdfWin.document, sel, null);
        return;   // keep existing mouse selection
      }
    } catch (_) {}
    this._showVisualHints(state, pdfWin, 'visual');
  },

  _enterCursorMode(state, pdfWin) {
    state.visualCursor = null;
    state.cursorPreferredX = null;
    this._setMode(state, 'cursor');
    this._showVisualHints(state, pdfWin, 'cursor');
  },

  _ensureCursorCaret(state, pdfWin) {
    try {
      const sel = pdfWin.getSelection();
      if (!sel) return false;
      if (sel.rangeCount > 0 && !sel.isCollapsed) {
        const r = sel.getRangeAt(0);
        const c = pdfWin.document.createRange();
        c.setStart(r.endContainer, r.endOffset);
        c.collapse(true);
        sel.removeAllRanges();
        sel.addRange(c);
      }
      if (sel.rangeCount > 0 && sel.isCollapsed) return true;

      if (state.visualCursor?.textNode?.isConnected) {
        const r = pdfWin.document.createRange();
        r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }

      const span = pdfWin.document.querySelector('.textLayer span');
      const tn = span?.firstChild;
      if (tn && tn.nodeType === 3) {
        const r = pdfWin.document.createRange();
        r.setStart(tn, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        state.visualCursor = { textNode: tn, offset: 0 };
        return true;
      }
    } catch (_) {}
    return false;
  },

  _cursorToVisual(state, pdfWin) {
    try {
      const sel = pdfWin.getSelection();
      if (!sel || sel.rangeCount === 0) {
        if (!this._ensureCursorCaret(state, pdfWin)) return;
      }
      const anchorNode = sel.anchorNode;
      const anchorOffset = sel.anchorOffset;
      this._setMode(state, 'visual');
      state.visualCursor = { textNode: anchorNode, offset: anchorOffset };
      this._updateVisualCursor(state, pdfWin);
    } catch (_) {}
  },

  _cursorMoveByGranularity(state, pdfWin, direction, granularity, count = 0) {
    try {
      if (!this._ensureCursorCaret(state, pdfWin)) return;
      const times = Math.max(1, count || 1);
      if (granularity === 'word' || granularity === 'bigword') {
        this._cursorMoveWord(state, pdfWin, direction, granularity === 'bigword', times);
        state.cursorPreferredX = this._cursorCurrentX(pdfWin.document, pdfWin.getSelection(), state.cursorPreferredX);
      } else {
        const sel = pdfWin.getSelection();
        if (!sel) return;
        for (let i = 0; i < times; i++) {
          sel.modify('move', direction, granularity);
        }
        state.visualCursor = { textNode: sel.focusNode, offset: sel.focusOffset };
        state.cursorPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.cursorPreferredX);
      }
      this._updateVisualCursor(state, pdfWin);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _cursorMoveByGranularity error: ' + e);
    }
  },

  _cursorMoveLine(state, pdfWin, direction, count = 0) {
    try {
      const times = Math.max(1, count || 1);
      for (let i = 0; i < times; i++) {
        if (!this._cursorMoveLineOnce(state, pdfWin, direction)) break;
      }
      this._updateVisualCursor(state, pdfWin);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _cursorMoveLine error: ' + e);
    }
  },

  _cursorMoveLineOnce(state, pdfWin, direction) {
    try {
      if (!this._ensureCursorCaret(state, pdfWin)) return false;
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();
      if (!sel?.focusNode) return false;
      const target = this._lineMoveTarget(doc, sel.focusNode, sel.focusOffset, direction, state.cursorPreferredX);
      if (!target?.node) return false;

      const c = doc.createRange();
      c.setStart(target.node, Math.max(0, Math.min(target.offset, target.node.length)));
      c.collapse(true);
      sel.removeAllRanges();
      sel.addRange(c);
      state.visualCursor = {
        textNode: target.node,
        offset: Math.max(0, Math.min(target.offset, target.node.length)),
      };
      if (!Number.isFinite(state.cursorPreferredX)) {
        state.cursorPreferredX = this._cursorCurrentX(doc, sel, null);
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  _cursorVisibleLines(doc) {
    const spans = [];
    for (const span of doc.querySelectorAll('.textLayer span')) {
      const tn = span.firstChild;
      if (!tn || tn.nodeType !== 3 || !span.textContent.trim()) continue;
      const r = span.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      spans.push({ tn, rect: r, midY: (r.top + r.bottom) / 2 });
    }

    spans.sort((a, b) => {
      const dy = a.midY - b.midY;
      return Math.abs(dy) > 4 ? dy : a.rect.left - b.rect.left;
    });

    const lines = [];
    for (const s of spans) {
      const last = lines[lines.length - 1];
      if (!last || Math.abs(last.midY - s.midY) > 4) {
        lines.push({ midY: s.midY, top: s.rect.top, bottom: s.rect.bottom, spans: [s] });
      } else {
        last.spans.push(s);
        last.top = Math.min(last.top, s.rect.top);
        last.bottom = Math.max(last.bottom, s.rect.bottom);
      }
    }
    return lines;
  },

  _lineMoveTarget(doc, focusNode, focusOffset, direction, preferredX = null) {
    const focusEl = focusNode?.nodeType === 3 ? focusNode.parentElement : focusNode;
    const focusRect = focusEl?.getBoundingClientRect?.();
    if (!focusRect) return null;

    let focusX = Number.isFinite(preferredX) ? preferredX : (focusRect.left + focusRect.right) / 2;
    try {
      if (focusNode?.nodeType === 3 && focusNode.length > 0) {
        const off = Math.max(0, Math.min(focusOffset || 0, focusNode.length - 1));
        const r = doc.createRange();
        r.setStart(focusNode, off);
        r.setEnd(focusNode, Math.min(focusNode.length, off + 1));
        const rects = r.getClientRects();
        if (!Number.isFinite(preferredX) && rects.length) focusX = (rects[0].left + rects[0].right) / 2;
      }
    } catch (_) {}

    const focusY = (focusRect.top + focusRect.bottom) / 2;
    const lines = this._cursorVisibleLines(doc);
    if (!lines.length) return null;

    let curLineIdx = lines.findIndex(l => focusY >= l.top - 1 && focusY <= l.bottom + 1);
    if (curLineIdx < 0) {
      let best = Infinity;
      for (let i = 0; i < lines.length; i++) {
        const d = Math.abs(lines[i].midY - focusY);
        if (d < best) { best = d; curLineIdx = i; }
      }
    }
    if (curLineIdx < 0) return null;

    const targetLineIdx = curLineIdx + (direction > 0 ? 1 : -1);
    if (targetLineIdx < 0 || targetLineIdx >= lines.length) return null;
    const targetLine = lines[targetLineIdx];

    let bestSpan = null;
    let bestDist = Infinity;
    for (const s of targetLine.spans) {
      const distX = Math.abs(((s.rect.left + s.rect.right) / 2) - focusX);
      if (distX < bestDist) {
        bestDist = distX;
        bestSpan = s;
      }
    }
    const node = bestSpan?.tn || null;
    if (!node) return null;

    let offset = 0;
    try {
      const cp = doc.caretPositionFromPoint?.(focusX, targetLine.midY);
      if (cp?.offsetNode === node && typeof cp.offset === 'number') {
        offset = cp.offset;
      }
    } catch (_) {}

    return { node, offset };
  },

  _cursorCurrentX(doc, sel, fallback = null) {
    try {
      if (!sel?.focusNode) return fallback;
      const focusNode = sel.focusNode;
      if (focusNode.nodeType === 3 && focusNode.length > 0) {
        const off = Math.max(0, Math.min(sel.focusOffset || 0, focusNode.length - 1));
        const r = doc.createRange();
        r.setStart(focusNode, off);
        r.setEnd(focusNode, Math.min(focusNode.length, off + 1));
        const rects = r.getClientRects();
        if (rects.length) return (rects[0].left + rects[0].right) / 2;
      }
      const el = focusNode.nodeType === 3 ? focusNode.parentElement : focusNode;
      const rect = el?.getBoundingClientRect?.();
      if (rect) return (rect.left + rect.right) / 2;
    } catch (_) {}
    return fallback;
  },

  _setVisualSelectionFromAnchor(state, pdfWin, targetNode, targetOffset, opts = null) {
    try {
      const sel = pdfWin.getSelection();
      if (!sel || !state.visualCursor?.textNode?.isConnected) return false;

      const anchorNode = state.visualCursor.textNode;
      const anchorOffset = state.visualCursor.offset;

      if (typeof sel.setBaseAndExtent === 'function') {
        sel.setBaseAndExtent(anchorNode, anchorOffset, targetNode, targetOffset);
      } else {
        // Fallback keeps anchor fixed using collapse+extend.
        sel.removeAllRanges();
        sel.collapse(anchorNode, anchorOffset);
        sel.extend(targetNode, targetOffset);
      }

      if (opts?.updatePreferredX !== false) {
        state.visualPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.visualPreferredX);
      }
      this._updateVisualCursor(state, pdfWin);
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _setVisualSelectionFromAnchor error: ' + e);
      return false;
    }
  },

  _cursorOrderedTextNodes(doc) {
    const spans = [];
    for (const span of doc.querySelectorAll('.textLayer span')) {
      const tn = span.firstChild;
      if (!tn || tn.nodeType !== 3) continue;
      if (!tn.data) continue;
      const r = span.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      spans.push({ tn, rect: r });
    }
    spans.sort((a, b) => {
      const dy = a.rect.top - b.rect.top;
      return Math.abs(dy) > 4 ? dy : a.rect.left - b.rect.left;
    });
    return spans.map(s => s.tn);
  },

  _cursorNodeIndex(nodes, node) {
    if (!node) return -1;
    if (node.nodeType === 3) return nodes.indexOf(node);
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].parentElement === node || node.contains?.(nodes[i])) return i;
    }
    return -1;
  },

  _isKeywordChar(ch) {
    return /^[A-Za-z0-9_]$/.test(ch || '');
  },

  _cursorCharAt(nodes, idx, off) {
    if (idx < 0 || idx >= nodes.length) return null;
    const n = nodes[idx];
    if (off < 0 || off >= n.length) return null;
    return n.data.charAt(off);
  },

  _cursorAdvancePos(nodes, pos) {
    let { idx, off } = pos;
    if (idx < 0 || idx >= nodes.length) return pos;
    if (off < nodes[idx].length) off++;
    while (idx < nodes.length && off >= nodes[idx].length) {
      idx++;
      off = 0;
      if (idx >= nodes.length) {
        return { idx: nodes.length - 1, off: nodes[nodes.length - 1].length };
      }
    }
    return { idx, off };
  },

  _cursorRetreatPos(nodes, pos) {
    let { idx, off } = pos;
    if (idx < 0 || idx >= nodes.length) return pos;
    if (off > 0) off--;
    else {
      idx--;
      while (idx >= 0 && nodes[idx].length === 0) idx--;
      if (idx < 0) return { idx: 0, off: 0 };
      off = Math.max(0, nodes[idx].length - 1);
    }
    return { idx, off };
  },

  _cursorSkipForward(nodes, pos, pred) {
    let cur = { idx: pos.idx, off: pos.off };
    while (cur.idx >= 0 && cur.idx < nodes.length) {
      const ch = this._cursorCharAt(nodes, cur.idx, cur.off);
      if (ch === null || !pred(ch)) break;
      const next = this._cursorAdvancePos(nodes, cur);
      if (next.idx === cur.idx && next.off === cur.off) break;
      cur = next;
      if (cur.idx === nodes.length - 1 && cur.off >= nodes[cur.idx].length) break;
    }
    return cur;
  },

  _cursorSkipBackward(nodes, pos, pred) {
    let cur = { idx: pos.idx, off: pos.off };
    while (cur.idx >= 0 && cur.idx < nodes.length) {
      const ch = this._cursorCharAt(nodes, cur.idx, cur.off);
      if (ch === null || !pred(ch)) break;
      const prev = this._cursorRetreatPos(nodes, cur);
      if (prev.idx === cur.idx && prev.off === cur.off) break;
      cur = prev;
    }
    return cur;
  },

  _cursorMoveWord(state, pdfWin, direction, bigWord, count) {
    const doc = pdfWin.document;
    const sel = pdfWin.getSelection();
    if (!sel) return;
    const nodes = this._cursorOrderedTextNodes(doc);
    if (!nodes.length) return;

    let idx = this._cursorNodeIndex(nodes, sel.focusNode);
    if (idx < 0) idx = 0;
    const off = Math.max(0, Math.min(sel.focusOffset || 0, nodes[idx].length));
    const pos = this._cursorComputeWordPosition(nodes, { idx, off }, direction, bigWord, count);

    const targetNode = nodes[Math.max(0, Math.min(pos.idx, nodes.length - 1))];
    const targetOff = Math.max(0, Math.min(pos.off, targetNode.length));
    const r = doc.createRange();
    r.setStart(targetNode, targetOff);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    state.visualCursor = { textNode: targetNode, offset: targetOff };
  },

  _cursorMoveToLineBoundary(state, pdfWin, toEnd) {
    try {
      if (!this._ensureCursorCaret(state, pdfWin)) return;
      const sel = pdfWin.getSelection();
      if (!sel?.focusNode) return;
      const target = this._lineBoundaryTarget(pdfWin.document, sel.focusNode, sel.focusOffset, toEnd);
      if (!target?.node) return;

      const r = pdfWin.document.createRange();
      r.setStart(target.node, target.offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      state.visualCursor = { textNode: target.node, offset: target.offset };
      state.cursorPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.cursorPreferredX);
      this._updateVisualCursor(state, pdfWin);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _cursorMoveToLineBoundary error: ' + e);
    }
  },

  _lineBoundaryTarget(doc, focusNode, focusOffset, toEnd) {
    const focusEl = focusNode?.nodeType === 3 ? focusNode.parentElement : focusNode;
    const focusRect = focusEl?.getBoundingClientRect?.();
    if (!focusRect) return null;

    const focusY = (focusRect.top + focusRect.bottom) / 2;
    const lines = this._cursorVisibleLines(doc);
    if (!lines.length) return null;

    let curLineIdx = lines.findIndex(l => focusY >= l.top - 1 && focusY <= l.bottom + 1);
    if (curLineIdx < 0) {
      let best = Infinity;
      for (let i = 0; i < lines.length; i++) {
        const d = Math.abs(lines[i].midY - focusY);
        if (d < best) { best = d; curLineIdx = i; }
      }
    }
    if (curLineIdx < 0) return null;

    const spans = lines[curLineIdx].spans;
    if (!spans?.length) return null;
    const targetSpan = toEnd ? spans[spans.length - 1] : spans[0];
    const node = targetSpan?.tn || null;
    if (!node) return null;
    const offset = toEnd ? node.length : 0;
    return { node, offset };
  },

  _extendToLineBoundary(state, pdfWin, toEnd) {
    try {
      pdfWin.focus();
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();
      if (!sel) return;

      if ((sel.rangeCount === 0 || sel.isCollapsed) && state.visualCursor?.textNode?.isConnected) {
        const r = doc.createRange();
        r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      if (sel.rangeCount === 0) return;

      if (!state.visualCursor || !state.visualCursor.textNode?.isConnected) {
        state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
      }

      const target = this._lineBoundaryTarget(doc, sel.focusNode, sel.focusOffset, toEnd);
      if (!target?.node) return;
      this._setVisualSelectionFromAnchor(state, pdfWin, target.node, target.offset);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendToLineBoundary error: ' + e);
    }
  },

  _cursorComputeWordPosition(nodes, startPos, direction, bigWord, count) {
    let pos = { idx: startPos.idx, off: startPos.off };
    const isSpace = (ch) => /\s/.test(ch);

    for (let i = 0; i < count; i++) {
      if (direction === 'forward') {
        let ch = this._cursorCharAt(nodes, pos.idx, pos.off);
        if (ch === null) break;

        if (isSpace(ch)) {
          pos = this._cursorSkipForward(nodes, pos, isSpace);
          continue;
        }

        const groupPred = bigWord
          ? (c) => !isSpace(c)
          : (this._isKeywordChar(ch)
            ? this._isKeywordChar.bind(this)
            : (c) => !isSpace(c) && !this._isKeywordChar(c));
        pos = this._cursorSkipForward(nodes, pos, groupPred);
        pos = this._cursorSkipForward(nodes, pos, isSpace);
      } else {
        pos = this._cursorRetreatPos(nodes, pos);
        pos = this._cursorSkipBackward(nodes, pos, isSpace);
        let ch = this._cursorCharAt(nodes, pos.idx, pos.off);
        if (ch === null) break;

        const groupPred = bigWord
          ? (c) => !isSpace(c)
          : (this._isKeywordChar(ch)
            ? this._isKeywordChar.bind(this)
            : (c) => !isSpace(c) && !this._isKeywordChar(c));

        while (true) {
          const prev = this._cursorRetreatPos(nodes, pos);
          if (prev.idx === pos.idx && prev.off === pos.off) break;
          const prevCh = this._cursorCharAt(nodes, prev.idx, prev.off);
          if (prevCh === null || !groupPred(prevCh)) break;
          pos = prev;
          if (pos.idx === 0 && pos.off === 0) break;
        }
      }
    }

    return pos;
  },

  _extendByWord(state, pdfWin, direction, bigWord) {
    try {
      pdfWin.focus();
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();
      if (!sel) return;

      if ((sel.rangeCount === 0 || sel.isCollapsed) && state.visualCursor?.textNode?.isConnected) {
        const r = doc.createRange();
        r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      if (sel.rangeCount === 0) return;

      if (!state.visualCursor || !state.visualCursor.textNode?.isConnected) {
        state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
      }

      const nodes = this._cursorOrderedTextNodes(doc);
      if (!nodes.length) return;
      let idx = this._cursorNodeIndex(nodes, sel.focusNode);
      if (idx < 0) idx = 0;
      const off = Math.max(0, Math.min(sel.focusOffset || 0, nodes[idx].length));
      const pos = this._cursorComputeWordPosition(nodes, { idx, off }, direction, bigWord, 1);
      const targetNode = nodes[Math.max(0, Math.min(pos.idx, nodes.length - 1))];
      const targetOffset = Math.max(0, Math.min(pos.off, targetNode.length));
      this._setVisualSelectionFromAnchor(state, pdfWin, targetNode, targetOffset);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByWord error: ' + e);
    }
  },

  /**
   * Show Tridactyl-style letter hint badges at the start of each visible
   * sentence.  The user presses a letter to anchor selection at that point.
   */
  _showVisualHints(state, pdfWin, targetMode = 'visual') {
    this._clearVisualHints(state, pdfWin);
    const doc      = pdfWin.document;
    const hintChars = 'asdfjklghqwertyuiopzxcvbnm';
    const hints    = {};
    let charIdx    = 0;

    const starts = targetMode === 'cursor'
      ? this._findCursorStartsFast(pdfWin)
      : this._findSentenceStarts(pdfWin);

    for (const { textNode, offset } of starts) {
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
      state.hintTargetMode = targetMode;
    } else {
      this._placeCursorAtFirstText(state, pdfWin);
    }
  },

  _findCursorStartsFast(pdfWin) {
    const doc = pdfWin.document;
    const container =
      doc.getElementById('viewerContainer') ||
      doc.querySelector('.pdfViewer') ||
      doc.body;
    const viewRect = container.getBoundingClientRect?.() || {
      top: 0,
      bottom: container.clientHeight || 0,
      left: 0,
      right: container.clientWidth || 0,
    };

    const spans = [];
    for (const span of doc.querySelectorAll('.textLayer span')) {
      const tn = span.firstChild;
      if (!tn || tn.nodeType !== 3) continue;
      const txt = tn.data;
      if (!txt || !txt.trim()) continue;
      const r = span.getBoundingClientRect();
      if (r.bottom < viewRect.top + 2 || r.top > viewRect.bottom - 2) continue;
      if (r.right < viewRect.left + 2 || r.left > viewRect.right - 2) continue;
      if (r.width < 3 || r.height < 3) continue;
      spans.push({ tn, rect: r });
      if (spans.length >= 120) break;
    }

    spans.sort((a, b) => {
      const dy = a.rect.top - b.rect.top;
      return Math.abs(dy) > 4 ? dy : a.rect.left - b.rect.left;
    });

    const starts = [];
    let lastTop = -Infinity;
    for (const s of spans) {
      if (Math.abs(s.rect.top - lastTop) < 4) continue;
      const off = s.tn.data.search(/\S/);
      if (off < 0) continue;
      starts.push({ textNode: s.tn, offset: off });
      lastTop = s.rect.top;
      if (starts.length >= 26) break;
    }
    return starts;
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
    state.hintTargetMode = null;
    if (!pdfWin) return;
    try {
      for (const el of pdfWin.document.querySelectorAll('[data-zv-hint]')) el.remove();
    } catch (_) {}
  },

  /**
   * Place or update a blinking cursor element at the current selection focus
   * in the PDF.js iframe.  Call this after every visual selection change.
   *
   * The cursor appears at the "active" (focus) end — the end that moves when
   * the user presses j/k/h/l/w/b etc.  After pressing `o` to swap ends, the
   * cursor jumps to the other end.
   */
  _updateVisualCursor(state, pdfWin, opts = null) {
    const doc = pdfWin.document;
    for (const el of doc.querySelectorAll('[data-zv-cursor]')) el.remove();
    if (state.mode !== 'visual' && state.mode !== 'cursor') return;

    // Prefer the selection's focus end; fall back to the saved anchor.
    let focusNode = null, focusOffset = 0;
    try {
      const sel = pdfWin.getSelection();
      if (sel?.focusNode) { focusNode = sel.focusNode; focusOffset = sel.focusOffset; }
    } catch (_) {}
    if (!focusNode && state.visualCursor) {
      focusNode   = state.visualCursor.textNode;
      focusOffset = state.visualCursor.offset;
    }
    if (!focusNode) return;

    // Get the bounding rect of the character at the focus position.
    let rect = null;
    try {
      if (focusNode.nodeType === 3 && focusNode.length > 0) {
        const r   = doc.createRange();
        const off = Math.min(focusOffset, focusNode.length - 1);
        r.setStart(focusNode, off);
        r.setEnd(focusNode, off + 1);
        const rects = r.getClientRects();
        if (rects.length > 0) rect = rects[0];
      }
    } catch (_) {}
    if (!rect) {
      const el = focusNode.nodeType === 3 ? focusNode.parentElement : focusNode;
      rect = el?.getBoundingClientRect?.() || null;
    }
    if (!rect || rect.height < 1) return;

    const shouldAutoPan = opts?.autoPan !== undefined
      ? !!opts.autoPan
      : (state.mode === 'visual' || state.mode === 'cursor');
    if (shouldAutoPan) {
      this._autoPanToKeepRectVisible(state, pdfWin, rect);
    }

    const cursor = doc.createElement('div');
    cursor.setAttribute('data-zv-cursor', '1');
    cursor.style.cssText =
      'position:fixed;' +
      'left:'   + Math.round(rect.left)   + 'px;' +
      'top:'    + Math.round(rect.top)    + 'px;' +
      'width:2px;' +
      'height:' + Math.round(rect.height) + 'px;' +
      'background:#ff4500;' +
      'z-index:99998;' +
      'pointer-events:none;' +
      'animation:zv-cursor-blink 1s step-end infinite;';
    doc.body.appendChild(cursor);
  },

  _autoPanToKeepRectVisible(state, pdfWin, rect) {
    try {
      const container = this._getScrollContainer(pdfWin);
      if (!container) return;
      const cr = container.getBoundingClientRect?.();
      if (!cr) return;

      const marginY = 28;
      const marginX = 20;
      let dy = 0;
      let dx = 0;

      if (rect.bottom > cr.bottom - marginY) {
        dy = rect.bottom - (cr.bottom - marginY);
      } else if (rect.top < cr.top + marginY) {
        dy = rect.top - (cr.top + marginY);
      }

      if (rect.right > cr.right - marginX) {
        dx = rect.right - (cr.right - marginX);
      } else if (rect.left < cr.left + marginX) {
        dx = rect.left - (cr.left + marginX);
      }

      if (dx || dy) {
        // Clamp per-update pan to avoid large jumps on irregular text geometry.
        const maxPan = 120;
        dx = Math.max(-maxPan, Math.min(maxPan, dx));
        dy = Math.max(-maxPan, Math.min(maxPan, dy));
        // Keep cursor tracking tight in visual mode; avoid smooth lag here.
        this._scrollContainerBy(container, dx, dy, { forceInstant: true });
      }
    } catch (_) {}
  },

  _selectHint(state, pdfWin, letter) {
    const targetMode = state.hintTargetMode;
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
      if (targetMode === 'visual') {
        state.visualPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.visualPreferredX);
      } else if (targetMode === 'cursor') {
        state.cursorPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.cursorPreferredX);
      }
      pdfWin.focus();
      this._updateVisualCursor(state, pdfWin);
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
      this._updateVisualCursor(state, pdfWin);
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
      if ((sel.rangeCount === 0 || sel.isCollapsed) && state.visualCursor?.textNode?.isConnected) {
        const restore = doc.createRange();
        restore.setStart(state.visualCursor.textNode, state.visualCursor.offset);
        restore.collapse(true);
        sel.removeAllRanges();
        sel.addRange(restore);
      }
      if (sel.rangeCount === 0) return;
      if (!state.visualCursor || !state.visualCursor.textNode?.isConnected) {
        state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
      }

      if (!Number.isFinite(state.visualPreferredX)) {
        state.visualPreferredX = this._cursorCurrentX(doc, sel, null);
      }

      const target = this._lineMoveTarget(
        doc,
        sel.focusNode,
        sel.focusOffset,
        direction,
        state.visualPreferredX
      );
      if (!target?.node) return;

      if (this._setVisualSelectionFromAnchor(state, pdfWin, target.node, target.offset, { updatePreferredX: false })) {
        const selLen = sel.toString().length;
        this._showStatus(state, '▶ ' + selLen + ' chars', 400);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByLine error: ' + e);
    }
  },

  /** Extend selection left/right by one character (h/l). */
  _extendByChar(state, pdfWin, direction) {
    try {
      pdfWin.focus();
      const doc = pdfWin.document;
      const sel = pdfWin.getSelection();
      if (!sel) return;

      if ((sel.rangeCount === 0 || sel.isCollapsed) && state.visualCursor?.textNode?.isConnected) {
        const r = doc.createRange();
        r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      if (sel.rangeCount === 0) return;
      if (!state.visualCursor || !state.visualCursor.textNode?.isConnected) {
        state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
      }

      const nodes = this._cursorOrderedTextNodes(doc);
      if (!nodes.length) return;
      let idx = this._cursorNodeIndex(nodes, sel.focusNode);
      if (idx < 0) idx = 0;
      let pos = { idx, off: Math.max(0, Math.min(sel.focusOffset || 0, nodes[idx].length)) };
      pos = direction > 0 ? this._cursorAdvancePos(nodes, pos) : this._cursorRetreatPos(nodes, pos);

      const targetNode = nodes[Math.max(0, Math.min(pos.idx, nodes.length - 1))];
      const targetOffset = Math.max(0, Math.min(pos.off, targetNode.length));
      this._setVisualSelectionFromAnchor(state, pdfWin, targetNode, targetOffset);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByChar error: ' + e);
    }
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
        this._updateVisualCursor(state, pdfWin);
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
        this._updateVisualCursor(state, pdfWin);
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

      this._scrollContainerTo(container, Math.max(0, newTop));
    } catch (e) {
      Zotero.debug('[ZoteroVim] _scrollToPagePosition error: ' + e);
    }
  },

  _getScrollContainer(pdfWin) {
    return pdfWin.PDFViewerApplication?.pdfViewer?.container ||
           pdfWin.document.getElementById('viewerContainer');
  },

  _scrollContainerBy(container, dx, dy, opts = null) {
    if (!container) return;
    this._applyScrollBehavior(container, opts);
    try {
      container.scrollBy(dx, dy);
    } catch (_) {
      try { container.scrollBy(dx, dy); } catch (_) {}
    }
  },

  _scrollContainerTo(container, top, opts = null) {
    if (!container) return;
    this._applyScrollBehavior(container, opts);
    try {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo(0, top);
      } else {
        container.scrollTop = top;
      }
    } catch (_) {
      try { container.scrollTop = top; } catch (_) {}
    }
  },

  _applyScrollBehavior(container, opts = null) {
    if (!container?.style) return;
    try {
      if (opts?.forceInstant) {
        container.style.scrollBehavior = 'auto';
      } else {
        container.style.scrollBehavior = this.isSmoothScrollEnabled() ? 'smooth' : 'auto';
      }
    } catch (_) {}
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
      state.visualPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.visualPreferredX);
      this._updateVisualCursor(state, pdfWin);
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
  _highlight(state, reader, pdfWin, color, opts = null) {
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
      this._createAnnotationFromParams(state, reader, params.annotation, 'highlight', color, opts);
      return;
    }
    this._createAnnotationFromSelection(reader, state, pdfWin, 'highlight', color, opts);
  },

  _addNote(state, reader, pdfWin) {
    const noteColor = this.getDefaultHighlightColor();
    this._showStatus(state, '▶ note', 800);
    const params = state.selectionParams ||
      (Date.now() - this._lastSelectionTS < 10000 ? this._lastSelectionParams : null);
    if (params?.annotation) {
      state.selectionParams     = null;
      this._lastSelectionParams = null;
      // Zotero's text-selection "add note" workflow is highlight + comment.
      this._createAnnotationFromParams(state, reader, params.annotation, 'highlight', noteColor, {
        focusComment: true,
      });
      return;
    }
    this._createAnnotationFromSelection(reader, state, pdfWin, 'highlight', noteColor, {
      focusComment: true,
    });
  },

  /**
   * Create a Zotero annotation item using position data already computed by
   * Zotero's reader (from renderTextSelectionPopup).  We bypass onAddAnnotation
   * so we can set any color without it being overridden.
   *
   * ann — the params.annotation object: { type, color, text, sortIndex, position }
   */
  async _createAnnotationFromParams(state, reader, ann, type, color, opts = null) {
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
      if (ann.sortIndex)   item.annotationSortIndex = ann.sortIndex;
      if (ann.pageLabel)   item.annotationPageLabel = ann.pageLabel;
      if (ann.position)    item.annotationPosition  =
        typeof ann.position === 'string' ? ann.position : JSON.stringify(ann.position);

      Zotero.debug('[ZoteroVim] _createAnnotationFromParams:'
        + ' sortIndex=' + JSON.stringify(ann.sortIndex)
        + ' pageLabel=' + JSON.stringify(ann.pageLabel)
        + ' item.annotationSortIndex=' + JSON.stringify(item.annotationSortIndex)
        + ' item.annotationPageLabel=' + JSON.stringify(item.annotationPageLabel));

      await item.saveTx();
      Zotero.debug('[ZoteroVim] Created ' + type + ' id=' + item.id + ' color=' + color);
      state.lastAnnotationKey = item.key;
      this._showStatus(state, '✓ annotated', 1200);
      if (opts?.focusComment) {
        this._enterInsertForAnnotation(state, reader, item.key);
        return;
      }
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
  async _createAnnotationFromSelection(reader, state, pdfWin, type, color, opts = null) {
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

      // sortIndex: Zotero's exact format is PPPPP|OOOOOO|TTTTT
      //   PPPPP  — 0-based page index, 5 digits
      //   OOOOOO — character offset within page chars array, 6 digits
      //            (we lack that data from the DOM, so use 000000)
      //   TTTTT  — floor(pageHeight - rect_top) in PDF user units, 5 digits
      //            rect_top = firstPdfRects[0][3] (top edge in PDF coords)
      const pdfPageH0 = (() => {
        const pv = pdfViewer._pages?.[firstGroup.pageIndex] ?? pdfViewer.getPageView?.(firstGroup.pageIndex);
        return pv?.viewport ? pv.viewport.height / pv.viewport.scale : 0;
      })();
      const top = Math.min(99999, Math.max(0, Math.floor(pdfPageH0 - firstPdfRects[0][3])));
      const sortIndex =
        String(firstGroup.pageIndex).padStart(5, '0') + '|' +
        '000000' + '|' +
        String(top).padStart(5, '0');

      // pageLabel: use PDF.js's own label array (handles roman numerals, etc.)
      // or fall back to 1-based page number.
      const pageLabel = (() => {
        try {
          return pdfWin.PDFViewerApplication?.pdfViewer?._pageLabels?.[firstGroup.pageIndex]
            || String(firstGroup.pageIndex + 1);
        } catch (_) { return String(firstGroup.pageIndex + 1); }
      })();

      const annotItem = new Zotero.Item('annotation');
      annotItem.libraryID            = attachment.libraryID;
      annotItem.parentID             = attachment.id;
      annotItem.annotationType       = type;
      if (color) annotItem.annotationColor = color;
      annotItem.annotationText       = text;
      annotItem.annotationComment    = '';
      annotItem.annotationIsExternal = false;
      annotItem.annotationSortIndex  = sortIndex;
      annotItem.annotationPageLabel  = pageLabel;
      annotItem.annotationPosition   = JSON.stringify(position);

      Zotero.debug('[ZoteroVim] _createAnnotationFromSelection:'
        + ' pageIndex=' + firstGroup.pageIndex
        + ' pdfPageH0=' + pdfPageH0
        + ' rect[3]=' + (firstPdfRects[0]?.[3])
        + ' top=' + top
        + ' sortIndex=' + sortIndex
        + ' pageLabel=' + pageLabel
        + ' item.annotationSortIndex=' + JSON.stringify(annotItem.annotationSortIndex)
        + ' item.annotationPageLabel=' + JSON.stringify(annotItem.annotationPageLabel));

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
      if (opts?.focusComment) {
        this._enterInsertForAnnotation(state, reader, annotItem.key);
        return;
      }
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

  _searchSelection(state, reader, pdfWin) {
    try {
      const sel = pdfWin.getSelection?.();
      if (!sel || sel.isCollapsed) return;

      let text = sel.toString()
        .normalize('NFKC')
        .replace(/\n/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();
      if (!text) return;

      const readerWin = reader._iframeWindow;
      const ir = reader._internalReader;

      // Open the find popup. Internally it focuses the input after 100 ms.
      if (typeof ir?.toggleFindPopup === 'function') {
        ir.toggleFindPopup(Cu.cloneInto({ open: true }, readerWin));
      }

      // After the popup has rendered and focused the input (100 ms internally),
      // set its value and fire an `input` event so React's onChange updates the
      // query state and triggers the search.
      setTimeout(() => {
        try {
          const inp = readerWin.document.querySelector('.primary-view .find-popup input');
          if (!inp) { Zotero.debug('[ZoteroVim] find input not found'); return; }
          inp.value = text;
          inp.dispatchEvent(new readerWin.Event('input', { bubbles: true }));
          Zotero.debug('[ZoteroVim] find input set: "' + text + '"');
        } catch (e2) {
          Zotero.debug('[ZoteroVim] fill find input error: ' + e2);
        }
      }, 200);

      Zotero.debug('[ZoteroVim] searchSelection: "' + text + '"');
    } catch (e) {
      Zotero.debug('[ZoteroVim] _searchSelection error: ' + e);
    }
    this._setMode(state, 'normal');
    try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
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

      // Respect active colour filter — mirror what the sidebar is showing.
      if (state.filterColor) {
        annotations = annotations.filter(a => a.annotationColor === state.filterColor);
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
  _focusAnnotationComment(state, reader, opts = null) {
    const key = state.lastAnnotationKey;
    const outerDoc = reader._iframeWindow?.document;
    if (!outerDoc || !key) return;
    const maxAttempts = Math.max(1, Number(opts?.maxAttempts || 8));
    const retryDelayMs = Math.max(50, Number(opts?.retryDelayMs || 200));
    const initialDelayMs = Math.max(0, Number(opts?.initialDelayMs || 100));

    const tryFocus = (attempt) => {
      const commentEl = this._findCommentEditorElement(outerDoc, key);
      if (commentEl) {
        this._focusCommentEditorElement(state, outerDoc, commentEl);
        this._showStatus(state, '-- INSERT --  Esc to exit', 2000);
        Zotero.debug('[ZoteroVim] _focusAnnotationComment: focused key=' + key);
        return;
      }

      if (attempt < maxAttempts) {
        setTimeout(() => tryFocus(attempt + 1), retryDelayMs);
      }
      // Silently stop if not found — user is still in insert mode.
    };

    setTimeout(() => tryFocus(0), initialDelayMs);
  },

  _enterInsertForAnnotation(state, reader, annotationKey) {
    try {
      state.lastAnnotationKey = annotationKey;
      this._setMode(state, 'normal');

      const readerWin = reader?._iframeWindow;
      const ir = reader?._internalReader;
      if (typeof ir?.setSelectedAnnotations === 'function' && readerWin) {
        ir.setSelectedAnnotations(Components.utils.cloneInto([annotationKey], readerWin));
      }
      if (typeof ir?.navigate === 'function' && readerWin) {
        ir.navigate(Components.utils.cloneInto({ annotationID: annotationKey }, readerWin));
      }

      // Reuse robust edit flow so newly created annotations can reliably enter
      // an editable comment state across Zotero UI variants.
      this._editAnnotation(state, reader);

      // Some Zotero builds only materialize the input after Enter on a selected
      // annotation. Trigger it programmatically so za/i does not require manual Enter.
      setTimeout(() => this._triggerAnnotationEditEnter(reader), 140);
      setTimeout(() => this._triggerAnnotationEditEnter(reader), 420);

      // Keep a fallback focus pass in case the edit flow race-misses render.
      this._focusAnnotationComment(state, reader, {
        maxAttempts: 18,
        retryDelayMs: 220,
        initialDelayMs: 450,
      });
    } catch (e) {
      Zotero.debug('[ZoteroVim] _enterInsertForAnnotation error: ' + e);
    }
  },

  _findCommentEditorElement(outerDoc, key) {
    const keySelector = key ? `[data-sidebar-annotation-id="${key}"], [data-annotation-id="${key}"]` : null;
    const selectors = [
      `[data-sidebar-annotation-id="${key}"] [aria-label="Annotation comment"]`,
      `[data-annotation-id="${key}"] [aria-label="Annotation comment"]`,
      `[data-sidebar-annotation-id="${key}"] textarea`,
      `[data-sidebar-annotation-id="${key}"] [contenteditable="true"]`,
      '[aria-label="Annotation comment"]',
      'textarea[aria-label="Annotation comment"]',
      'div[aria-label="Annotation comment"]',
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]',
    ];

    const pool = [];
    const seen = new Set();
    const pushUnique = (el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      pool.push(el);
    };

    for (const sel of selectors) {
      const direct = outerDoc.querySelector(sel);
      pushUnique(direct);
      for (const deepEl of this._queryDeepElements(outerDoc, sel)) {
        pushUnique(deepEl);
      }
    }

    const scored = [];
    for (const el of pool) {
      if (!this._isFocusableCommentEditor(el)) continue;
      let score = 0;
      const label = (el.getAttribute?.('aria-label') || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      const cls = (el.className || '').toString().toLowerCase();
      const role = (el.getAttribute?.('role') || '').toLowerCase();

      if (label.includes('annotation comment') || label.includes('comment')) score += 8;
      if (role === 'textbox') score += 3;
      if (id.includes('comment') || cls.includes('comment') || cls.includes('annotation')) score += 2;

      if (keySelector && el.closest?.(keySelector)) score += 10;
      scored.push({ el, score });
    }

    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].el;
  },

  _triggerAnnotationEditEnter(reader) {
    try {
      const outerWin = reader?._iframeWindow;
      const outerDoc = outerWin?.document;
      const pdfWin = reader?._internalReader?._primaryView?._iframeWindow;
      if (!outerWin || !outerDoc) return;

      const dispatchEnter = (target, winObj) => {
        if (!target || typeof target.dispatchEvent !== 'function') return;
        const evt = new winObj.KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(evt);
      };

      dispatchEnter(outerDoc.activeElement, outerWin);
      dispatchEnter(outerDoc, outerWin);

      if (pdfWin) {
        dispatchEnter(pdfWin.document?.activeElement, pdfWin);
        dispatchEnter(pdfWin.document, pdfWin);
        dispatchEnter(pdfWin, pdfWin);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _triggerAnnotationEditEnter error: ' + e);
    }
  },

  _queryDeepElements(root, selector) {
    const results = [];
    const queue = [root];
    const seen = new Set();

    while (queue.length) {
      const node = queue.shift();
      if (!node || seen.has(node)) continue;
      seen.add(node);

      try {
        if (typeof node.querySelectorAll === 'function') {
          for (const el of node.querySelectorAll(selector)) results.push(el);
        }
      } catch (_) {}

      let descendants = [];
      try {
        if (typeof node.querySelectorAll === 'function') {
          descendants = node.querySelectorAll('*');
        }
      } catch (_) {}
      for (const el of descendants) {
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
    }

    return results;
  },

  _isFocusableCommentEditor(el) {
    if (!el) return false;
    const tag = el.tagName;
    const role = (el.getAttribute?.('role') || '').toLowerCase();
    const isEditable = el.isContentEditable || tag === 'TEXTAREA' || tag === 'INPUT' || role === 'textbox';
    if (!isEditable || el.readOnly || el.disabled) return false;
    const r = el.getBoundingClientRect?.();
    return !!(r && r.width > 0 && r.height > 0);
  },

  _focusCommentEditorElement(state, outerDoc, el) {
    try { el.focus(); } catch (_) {}
    // Enter insert mode only once we have an actual focusable editor.
    if (state?.mode !== 'insert') this._setMode(state, 'insert');
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const len = el.value?.length || 0;
        el.selectionStart = len;
        el.selectionEnd = len;
        return;
      }

      const sel = outerDoc.defaultView?.getSelection?.();
      if (sel) {
        const range = outerDoc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) {}
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
   * Filter the annotations sidebar to show only annotations of the given colour.
   * Pass null to clear the colour filter.
   */
  _filterByColor(state, reader, color) {
    try {
      const readerWin = reader._iframeWindow;
      const filter = Cu.cloneInto({ colors: color ? [color] : [] }, readerWin);
      reader._internalReader.setFilter(filter);
      state.filterColor = color || null;
      const colorName = color
        ? (Object.entries(this.COLORS).find(([, v]) => v === color)?.[0] || color)
        : null;
      this._showStatus(state, colorName ? '✓ filter: ' + colorName : '✓ filter cleared', 1200);
      Zotero.debug('[ZoteroVim] filterByColor: ' + (color || 'clear'));
    } catch (e) {
      Zotero.debug('[ZoteroVim] _filterByColor error: ' + e);
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

  // ── Main window injection ─────────────────────────────────────────────────

  _injectIntoMainWindow(win) {
    Zotero.debug('[ZoteroVim] Injecting into main window');

    // Main window is a XUL document — must use HTML namespace for HTML elements.
    const _H = 'http://www.w3.org/1999/xhtml';
    const statusEl = win.document.createElementNS(_H, 'div');
    statusEl.setAttribute('style', [
      'position:fixed', 'bottom:10px', 'right:14px', 'z-index:99999',
      'font:bold 12px/1.4 monospace', 'color:#fff',
      'background:rgba(0,0,0,0.65)', 'padding:2px 8px',
      'border-radius:3px', 'pointer-events:none',
      'display:none', 'user-select:none',
    ].join(';'));
    (win.document.body || win.document.documentElement).appendChild(statusEl);

    const mainWinState = {
      mode: 'main',
      keyBuffer: '',
      countBuffer: '',
      keyTimeout: null,
      indicatorEl: null,    // _updateIndicator no-ops for main window
      statusEl,
      activePanelFocus: 'items',  // 'items' | 'collections'
      pickerOpen: false,
      _pickerOverlay: null,
      _pickerInput: null,
      _pickerResults: null,
      _pickerFiltered: [],
      _pickerItems: [],
      _pickerSelected: 0,
      _pickerWin: win,
      _pickerCleanup: null,
      executeAction: null,  // set below
      cleanup: () => {},
    };
    mainWinState.executeAction = (action, count) =>
      this._executeMainAction(action, win, mainWinState, count);
    this._mainWindowState.set(win, mainWinState);

    const readerScanHandler = () => this._rescanSelectedReader(win);
    readerScanHandler();
    const readerScanTimer = win.setInterval(readerScanHandler, 1000);

    const keyHandler = (e) => this._onMainKeyDown(e, win, mainWinState);
    win.document.addEventListener('keydown', keyHandler, true);

    mainWinState.cleanup = () => {
      win.clearInterval(readerScanTimer);
      win.document.removeEventListener('keydown', keyHandler, true);
      this._closeFuzzyPicker(win, mainWinState);
      clearTimeout(mainWinState.keyTimeout);
      clearTimeout(mainWinState._statusTimer);
      try { statusEl.remove(); } catch (_) {}
    };
  },

  _onMainKeyDown(e, win, winState) {
    // When picker is open, delegate to _onPickerKeyDown.  Nav keys get full
    // preventDefault+stopPropagation; regular keys only get stopPropagation
    // so they still reach the input element and filter results.
    if (winState.pickerOpen) {
      this._onPickerKeyDown(e, win, winState);
      return;
    }

    // Skip when any text-entry element is focused — this covers the main
    // search bar, tag search bar, and any other input/textarea/contenteditable
    // in the Zotero UI.  XUL textbox elements expose localName 'input' after
    // Zotero 7's HTML conversion, but we also guard 'textbox' and 'search'
    // for safety.  Without this guard the space leader key is swallowed and
    // can't be typed in search fields.
    const active = win.document.activeElement;
    if (active) {
      const tag = active.tagName  || '';
      const loc = active.localName || '';
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable
        || loc === 'input' || loc === 'textarea' || loc === 'textbox' || loc === 'search'
        || (active.shadowRoot && active.shadowRoot.querySelector('input, textarea'));
      if (isInput) {
        // Allow Escape to blur the search bar and return to vim navigation
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          active.blur();
        }
        return;
      }
    }

    // Skip when focus is inside an embedded browser element (PDF reader)
    if (active && active.localName === 'browser') return;

    // Skip when the selected tab is a reader tab, not the main library pane
    try {
      const tabID = win.Zotero_Tabs?.selectedID;
      if (tabID && Zotero.Reader.getByTabID?.(tabID)) return;
    } catch (_) {}

    const keyStr = this._keyString(e);
    if (!keyStr) return;

    // Count prefix digits
    if (/^\d$/.test(keyStr) && (keyStr !== '0' || winState.countBuffer)) {
      winState.countBuffer = (winState.countBuffer || '') + keyStr;
      e.preventDefault(); e.stopPropagation();
      return;
    }

    const newBuffer  = winState.keyBuffer + keyStr;
    const bindings   = this.getBindings();
    const modePrefix = 'main:';

    const possible = Object.keys(bindings).filter(k => k.startsWith(modePrefix + newBuffer));
    const exact    = bindings[modePrefix + newBuffer];

    if (possible.length === 0 && !exact) {
      winState.keyBuffer = '';
      winState.countBuffer = '';
      clearTimeout(winState.keyTimeout);
      winState.keyTimeout = null;
      // Try single-key fallback
      const sp = Object.keys(bindings).filter(k => k.startsWith(modePrefix + keyStr));
      const se = bindings[modePrefix + keyStr];
      if (sp.length === 0 && !se) return;
      e.preventDefault(); e.stopPropagation();
      this._processBuffer(keyStr, se, sp, modePrefix, bindings, winState);
      return;
    }

    e.preventDefault(); e.stopPropagation();
    this._processBuffer(newBuffer, exact, possible, modePrefix, bindings, winState);
  },

  _executeMainAction(action, win, winState, count) {
    this._mainSyncFocusedPanel(win, winState);
    Zotero.debug('[ZoteroVim] Main action: ' + action + ' count:' + count);
    switch (action) {
      case 'mainFuzzyAll':         this._openFuzzyPicker(win, winState, 'all');         break;
      case 'mainFuzzyCollection':  this._openFuzzyPicker(win, winState, 'collection');  break;
      case 'mainTabPick':          this._openFuzzyPicker(win, winState, 'tabs');        break;
      case 'mainFocusTree':
      case 'mainFocusLeft':        this._mainFocusPanel(win, winState, 'collections');  break;
      case 'mainFocusItems':
      case 'mainFocusRight':       this._mainFocusPanel(win, winState, 'items');        break;
      case 'mainYankCitekey':      this._mainYankCitekey(win, winState);               break;
      case 'mainOpenPDF':
                                   this._mainOpenPDF(win, winState);                   break;
      case 'mainActivate':         this._mainActivate(win, winState);                  break;
      case 'mainClosePDF':         this._mainClosePDF(win);                            break;
      case 'mainPrevTab':          this._mainCycleTab(win, -1);                        break;
      case 'mainNextTab':          this._mainCycleTab(win, +1);                        break;
      case 'mainFocusSearch':      this._mainFocusSearch(win);                         break;
      case 'mainNavDown':          this._mainNavigate(win, winState, +1, count);       break;
      case 'mainNavUp':            this._mainNavigate(win, winState, -1, count);       break;
      case 'mainTreeToggle':       this._mainTreeToggle(win, winState);                break;
      case 'mainTreeOpenOnly':     this._mainTreeOpenOnly(win, winState);              break;
      case 'mainTreeCloseOnly':    this._mainTreeCloseOnly(win, winState);             break;
      case 'mainTreeExpand':       this._mainTreeExpand(win, winState);                break;
      case 'mainTreeCollapse':     this._mainTreeCollapse(win, winState);              break;
      case 'mainTreeParent':       this._mainTreeParent(win, winState);                break;
      case 'mainTreeExpandAll':    this._mainTreeExpandAll(win, winState);             break;
      case 'mainTreeCollapseAll':  this._mainTreeCollapseAll(win, winState);           break;
      case 'mainNavFirst':         this._mainNavigate(win, winState, 'first', 0);      break;
      case 'mainNavLast':          this._mainNavigate(win, winState, 'last',  count);  break;
      default: Zotero.debug('[ZoteroVim] Unknown main action: ' + action);
    }
  },

  _delegateToMainWindow(action, count) {
    const entry = [...this._mainWindowState.entries()][0];
    if (!entry) return;
    const [mainWin, mainState] = entry;
    this._executeMainAction(action, mainWin, mainState, count);
  },

  _mainSyncFocusedPanel(win, winState) {
    const panel = this._mainDetectFocusedPanel(win, winState);
    if (panel) winState.activePanelFocus = panel;
    return winState.activePanelFocus;
  },

  _mainDetectFocusedPanel(win, winState) {
    const active = win?.document?.activeElement;
    const zp = win?.ZoteroPane;
    const cv = zp?.collectionsView;
    const iv = zp?.itemsView;

    const isWithin = (root, node) => {
      if (!root || !node) return false;
      if (root === node) return true;
      try {
        if (typeof root.contains === 'function' && root.contains(node)) return true;
      } catch (_) {}
      return false;
    };

    const collectionTargets = [
      cv?.tree,
      cv?.domEl,
      win?.document?.getElementById('collection-tree'),
      win?.document?.getElementById('zotero-collections-tree'),
      win?.document?.querySelector('#zotero-collections-tree .virtualized-table'),
    ].filter(Boolean);

    const itemTargets = [
      iv?.tree,
      iv?.domEl,
      win?.document?.getElementById('item-tree-main-default'),
      win?.document?.getElementById('zotero-items-tree'),
      win?.document?.querySelector('#zotero-items-tree .virtualized-table'),
    ].filter(Boolean);

    if (active) {
      for (const target of collectionTargets) {
        if (isWithin(target, active) || isWithin(active, target)) return 'collections';
      }
      for (const target of itemTargets) {
        if (isWithin(target, active) || isWithin(active, target)) return 'items';
      }
      if (active.id === 'collection-tree' || active.id === 'zotero-collections-tree') return 'collections';
      if (active.id === 'item-tree-main-default' || active.id === 'zotero-items-tree') return 'items';
    }

    if (cv?.selection?.count) return 'collections';
    return winState?.activePanelFocus || 'items';
  },

  _toggleReaderSplit(state, reader, orientation) {
    if (!reader) {
      this._showStatus(state, '✗ reader not ready', 1200);
      return;
    }

    const method = orientation === 'vertical' ? 'toggleVerticalSplit' : 'toggleHorizontalSplit';
    const ir = reader._internalReader;
    let ok = false;

    try {
      if (typeof reader[method] === 'function') {
        reader[method]();
        ok = true;
      } else if (typeof ir?.[method] === 'function') {
        ir[method]();
        ok = true;
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _toggleReaderSplit ' + method + ' error: ' + e);
    }

    if (!ok) {
      this._showStatus(state, '✗ split unsupported', 1400);
      return;
    }

    setTimeout(() => this._syncReaderPdfViewListeners(reader, state), 60);
    setTimeout(() => this._syncReaderPdfViewListeners(reader, state), 220);

    this._showStatus(state, orientation === 'vertical' ? '→ split vertical' : '→ split horizontal', 900);
  },

  _focusReaderSplit(state, reader, direction, pdfWin) {
    const ir = reader?._internalReader;
    const splitType = String(ir?.splitType || '');
    if (!reader || !ir || !['vertical', 'horizontal'].includes(splitType)) {
      this._showStatus(state, '✗ split inactive', 1200);
      return;
    }

    const primaryWin = ir._primaryView?._iframeWindow || pdfWin;
    const secondaryWin = ir._secondaryView?._iframeWindow;
    if (!primaryWin || !secondaryWin) {
      this._showStatus(state, '✗ split view unavailable', 1400);
      return;
    }

    const focusedWin = Services.focus?.focusedWindow;
    let current = null;
    if (focusedWin === secondaryWin) current = 'secondary';
    else if (focusedWin === primaryWin || focusedWin === pdfWin) current = 'primary';

    let target = null;
    if (splitType === 'vertical') {
      if (direction === 'left') target = 'primary';
      else if (direction === 'right') target = 'secondary';
      else target = current === 'secondary' ? 'primary' : 'secondary';
    } else {
      if (direction === 'up') target = 'primary';
      else if (direction === 'down') target = 'secondary';
      else target = current === 'secondary' ? 'primary' : 'secondary';
    }

    const targetWin = target === 'secondary' ? secondaryWin : primaryWin;
    try {
      state.activePdfWin = targetWin;
      targetWin.focus();
      targetWin.document?.body?.focus?.();
      this._showStatus(state, target === 'secondary' ? '▶ split B' : '▶ split A', 700);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _focusReaderSplit error: ' + e);
      this._showStatus(state, '✗ focus failed', 1200);
    }
  },

  _mainNavigate(win, winState, dir, count) {
    try {
      const zp = win.ZoteroPane;
      if (this._mainSyncFocusedPanel(win, winState) === 'collections') {
        const cv = zp.collectionsView;
        if (!cv) return;
        const cur  = cv.selection?.focused ?? 0;
        const last = (cv.rowCount || 1) - 1;
        const next = dir === 'first' ? 0
                   : dir === 'last'  ? last
                   : Math.max(0, Math.min(last, cur + dir * Math.max(1, count)));
        cv.selection.select(next);
        cv.ensureRowIsVisible?.(next);
      } else {
        const iv = zp.itemsView;
        if (!iv) return;
        const cur  = iv.selection?.focused ?? 0;
        const last = (iv.rowCount || 1) - 1;
        const next = dir === 'first' ? 0
                   : dir === 'last'  ? (count > 0 ? Math.min(count - 1, last) : last)
                   : Math.max(0, Math.min(last, cur + dir * Math.max(1, count)));
        iv.selection.select(next);
        iv.ensureRowIsVisible?.(next);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainNavigate error: ' + e);
    }
  },

  _mainActivate(win, winState) {
    const panel = this._mainSyncFocusedPanel(win, winState);
    if (panel === 'collections') {
      this._mainFocusPanel(win, winState, 'items');
      this._mainShowStatus(win, '▶ items', 900);
      return;
    }
    this._mainOpenPDF(win, winState);
  },

  _mainCollectionsView(win, winState, { requireFocused = true } = {}) {
    const panel = this._mainSyncFocusedPanel(win, winState);
    if (requireFocused && panel !== 'collections') {
      this._mainShowStatus(win, '✗ focus collections tree first');
      return null;
    }
    const cv = win?.ZoteroPane?.collectionsView;
    if (!cv) {
      this._mainShowStatus(win, '✗ collections tree unavailable');
      return null;
    }
    return cv;
  },

  _mainTreeExpand(win, winState) {
    const panel = this._mainSyncFocusedPanel(win, winState);
    if (panel !== 'collections') {
      this._mainFocusPanel(win, winState, 'items');
      this._mainShowStatus(win, '▶ items', 900);
      return;
    }

    const cv = this._mainCollectionsView(win, winState);
    if (!cv) return;
    const idx = cv.selection?.focused ?? -1;
    if (idx < 0) return;

    if (cv.isContainer?.(idx) && !cv.isContainerOpen?.(idx) && !cv.isContainerEmpty?.(idx)) {
      cv.toggleOpenState?.(idx);
      this._mainShowStatus(win, '→ expanded');
      return;
    }
    this._mainFocusPanel(win, winState, 'items');
    this._mainShowStatus(win, '▶ items', 900);
  },

  async _mainTreeToggle(win, winState) {
    try {
      const cv = this._mainEnsureCollectionsFocus(win, winState, { ensureSelection: false });
      if (!cv) return;
      const idx = this._mainResolveCollectionsRow(cv);
      if (idx < 0) return;
      if (!cv.isContainer?.(idx) || cv.isContainerEmpty?.(idx)) {
        this._mainShowStatus(win, '→ no child collections', 1000);
        this._mainRefocusCollectionsTree(win, cv);
        return;
      }
      const isOpen = !!cv.isContainerOpen?.(idx);
      await cv.toggleOpenState?.(idx);
      this._mainRefocusCollectionsTree(win, cv);
      this._mainShowStatus(win, isOpen ? '→ collapsed' : '→ expanded', 900);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainTreeToggle error: ' + e);
      this._mainShowStatus(win, '✗ toggle failed');
    }
  },

  async _mainTreeOpenOnly(win, winState) {
    try {
      const cv = this._mainEnsureCollectionsFocus(win, winState, { ensureSelection: false });
      if (!cv) return;
      const idx = this._mainResolveCollectionsRow(cv);
      if (idx < 0) return;
      if (!cv.isContainer?.(idx) || cv.isContainerEmpty?.(idx)) {
        this._mainShowStatus(win, '→ no child collections', 1000);
        this._mainRefocusCollectionsTree(win, cv);
        return;
      }
      if (cv.isContainerOpen?.(idx)) {
        this._mainRefocusCollectionsTree(win, cv);
        this._mainShowStatus(win, '→ already expanded', 900);
        return;
      }
      await cv.toggleOpenState?.(idx);
      this._mainRefocusCollectionsTree(win, cv);
      this._mainShowStatus(win, '→ expanded', 900);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainTreeOpenOnly error: ' + e);
      this._mainShowStatus(win, '✗ open failed');
    }
  },

  async _mainTreeCloseOnly(win, winState) {
    try {
      const cv = this._mainEnsureCollectionsFocus(win, winState, { ensureSelection: false });
      if (!cv) return;
      const idx = this._mainResolveCollectionsRow(cv);
      if (idx < 0) return;
      if (!cv.isContainer?.(idx) || cv.isContainerEmpty?.(idx)) {
        this._mainShowStatus(win, '→ no child collections', 1000);
        this._mainRefocusCollectionsTree(win, cv);
        return;
      }
      if (!cv.isContainerOpen?.(idx)) {
        this._mainRefocusCollectionsTree(win, cv);
        this._mainShowStatus(win, '→ already collapsed', 900);
        return;
      }
      await cv.toggleOpenState?.(idx);
      this._mainRefocusCollectionsTree(win, cv);
      this._mainShowStatus(win, '→ collapsed', 900);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainTreeCloseOnly error: ' + e);
      this._mainShowStatus(win, '✗ collapse failed');
    }
  },

  _mainEnsureCollectionsFocus(win, winState, opts = null) {
    const cv = win?.ZoteroPane?.collectionsView;
    if (!cv) {
      this._mainShowStatus(win, '✗ collections tree unavailable');
      return null;
    }
    try { cv.focus?.(); } catch (_) {}
    if (opts?.ensureSelection !== false) {
      this._mainEnsureCollectionsSelection(cv, { fallbackToFirst: opts?.fallbackToFirst !== false });
    }
    winState.activePanelFocus = 'collections';
    return cv;
  },

  _mainResolveCollectionsRow(cv) {
    try {
      if (!cv) return -1;
      const focused = Number.isInteger(cv.selection?.focused) ? cv.selection.focused : -1;
      if (focused >= 0 && cv.getRow?.(focused)) return focused;

      const selectedCollectionID = cv.getSelectedCollection?.(true);
      if (selectedCollectionID) {
        const selectedIdx = cv.getRowIndexByID?.('C' + selectedCollectionID);
        if (typeof selectedIdx === 'number' && selectedIdx >= 0) return selectedIdx;
      }
    } catch (_) {}
    return -1;
  },

  _mainEnsureCollectionsSelection(cv, opts = null) {
    try {
      if (!cv?.selection) return;
      const focused = Number.isInteger(cv.selection.focused) ? cv.selection.focused : -1;
      if (cv.selection.count > 0 && focused >= 0) return;
      const resolved = this._mainResolveCollectionsRow(cv);
      if (resolved >= 0) {
        cv.selection.select?.(resolved);
        cv.ensureRowIsVisible?.(resolved);
        return;
      }
      if (opts?.fallbackToFirst === false) return;
      if ((cv.rowCount || 0) <= 0) return;
      const idx = focused >= 0 ? Math.min(focused, cv.rowCount - 1) : 0;
      cv.selection.select?.(idx);
      cv.ensureRowIsVisible?.(idx);
    } catch (_) {}
  },

  _mainEnsureItemsSelection(iv) {
    try {
      if (!iv?.selection) return;
      const focused = Number.isInteger(iv.selection.focused) ? iv.selection.focused : -1;
      if (iv.selection.count > 0 && focused >= 0) return;
      if ((iv.rowCount || 0) <= 0) return;
      const idx = focused >= 0 ? Math.min(focused, iv.rowCount - 1) : 0;
      iv.selection.select?.(idx);
      iv.ensureRowIsVisible?.(idx);
    } catch (_) {}
  },

  _mainRefocusCollectionsTree(win, cv) {
    const doc = win?.document;
    const target = cv?.tree
      || doc?.getElementById('collection-tree')
      || doc?.querySelector('#zotero-collections-tree .virtualized-table')
      || doc?.getElementById('zotero-collections-tree');
    try { cv?.focus?.(); } catch (_) {}
    try { target?.focus?.(); } catch (_) {}
    setTimeout(() => {
      try { cv?.focus?.(); } catch (_) {}
      try { target?.focus?.(); } catch (_) {}
    }, 30);
  },

  _mainTreeCollapse(win, winState) {
    const panel = this._mainSyncFocusedPanel(win, winState);
    if (panel !== 'collections') {
      this._mainFocusPanel(win, winState, 'collections');
      this._mainShowStatus(win, '▶ collections', 900);
      return;
    }

    const cv = this._mainCollectionsView(win, winState);
    if (!cv) return;
    const idx = cv.selection?.focused ?? -1;
    if (idx < 0) return;

    if (cv.isContainer?.(idx) && cv.isContainerOpen?.(idx)) {
      cv.toggleOpenState?.(idx);
      this._mainShowStatus(win, '→ collapsed');
      return;
    }
    this._mainTreeParent(win, winState, { silentIfMissing: true });
  },

  _mainTreeParent(win, winState, opts = null) {
    const cv = this._mainCollectionsView(win, winState);
    if (!cv) return;
    const idx = cv.selection?.focused ?? -1;
    if (idx < 0) return;

    const parent = cv.getParentIndex?.(idx);
    if (typeof parent === 'number' && parent >= 0) {
      cv.selection?.select?.(parent);
      cv.ensureRowIsVisible?.(parent);
      this._mainShowStatus(win, '→ parent', 900);
      return;
    }
    if (!opts?.silentIfMissing) this._mainShowStatus(win, '→ top level', 900);
  },

  _mainTreeExpandAll(win, winState) {
    const cv = this._mainCollectionsView(win, winState);
    if (!cv) return;

    let changed = false;
    const maxPasses = Math.min(300, Math.max(25, (cv.rowCount || 0) + 10));
    for (let pass = 0; pass < maxPasses; pass++) {
      let passChanged = false;
      const rows = cv.rowCount || 0;
      for (let i = 0; i < rows; i++) {
        if (!cv.isContainer?.(i) || cv.isContainerOpen?.(i) || cv.isContainerEmpty?.(i)) continue;
        cv.toggleOpenState?.(i);
        passChanged = true;
        changed = true;
      }
      if (!passChanged) break;
    }
    this._mainShowStatus(win, changed ? '→ expanded all' : '→ already expanded', 900);
  },

  _mainTreeCollapseAll(win, winState) {
    const cv = this._mainCollectionsView(win, winState);
    if (!cv) return;

    let changed = false;
    for (let i = (cv.rowCount || 0) - 1; i >= 0; i--) {
      if (!cv.isContainer?.(i) || !cv.isContainerOpen?.(i)) continue;
      cv.toggleOpenState?.(i);
      changed = true;
    }
    this._mainShowStatus(win, changed ? '→ collapsed all' : '→ already collapsed', 900);
  },

  _mainFocusPanel(win, winState, panel) {
    try {
      const target = panel === 'collections'
        ? (win.ZoteroPane?.collectionsView?.tree
          || win.document.getElementById('collection-tree')
          || win.document.querySelector('#zotero-collections-tree .virtualized-table')
          || win.document.getElementById('zotero-collections-tree'))
        : (win.ZoteroPane?.itemsView?.tree
          || win.document.getElementById('item-tree-main-default')
          || win.document.querySelector('#zotero-items-tree .virtualized-table')
          || win.document.getElementById('zotero-items-tree'));
      if (target?.focus) target.focus();
      winState.activePanelFocus = panel;
      if (panel === 'collections') {
        this._mainEnsureCollectionsSelection(win.ZoteroPane?.collectionsView);
      } else {
        this._mainEnsureItemsSelection(win.ZoteroPane?.itemsView);
      }
      Zotero.debug('[ZoteroVim] _mainFocusPanel: ' + panel);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainFocusPanel error: ' + e);
    }
  },

  _mainOpenPDF(win, winState) {
    try {
      let items = win.ZoteroPane.getSelectedItems();
      if (!items.length) {
        this._mainEnsureItemsSelection(win.ZoteroPane?.itemsView);
        items = win.ZoteroPane.getSelectedItems();
      }
      if (!items.length) { this._mainShowStatus(win, '✗ No item selected'); return; }
      const item = items[0];
      let attID;
      if (item.isAttachment()) {
        attID = item.id;
      } else {
        const atts = item.getAttachments()
          .map(id => Zotero.Items.get(id))
          .filter(a => a && a.isAttachment() && a.attachmentContentType === 'application/pdf');
        if (!atts.length) { this._mainShowStatus(win, '✗ No PDF attachment'); return; }
        attID = atts[0].id;
      }
      win.ZoteroPane.viewAttachment(attID);
      Zotero.debug('[ZoteroVim] _mainOpenPDF: attID=' + attID);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainOpenPDF error: ' + e);
      this._mainShowStatus(win, '✗ ' + String(e).slice(0, 40));
    }
  },

  _mainClosePDF(win) {
    try {
      const tabs = win.Zotero_Tabs;
      if (tabs) tabs.close(tabs.selectedID);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainClosePDF error: ' + e);
    }
  },

  _mainCycleTab(win, dir) {
    try {
      const tabs = win.Zotero_Tabs;
      if (!tabs) return;

      const directFns = dir < 0
        ? ['selectPrev', 'selectPrevious', 'prev']
        : ['selectNext', 'next'];
      for (const fn of directFns) {
        if (typeof tabs[fn] === 'function') {
          tabs[fn]();
          return;
        }
      }

      const list = Array.isArray(tabs._tabs)
        ? tabs._tabs
        : (Array.isArray(tabs.tabs) ? tabs.tabs : null);
      const selectedID = tabs.selectedID || tabs._selectedID;
      if (!list || list.length < 2 || !selectedID) return;

      const ids = list
        .map(t => t?.id || t?.tabID || t?.dataset?.id)
        .filter(Boolean);
      const curIdx = ids.indexOf(selectedID);
      if (curIdx < 0) return;

      const nextIdx = (curIdx + dir + ids.length) % ids.length;
      const nextID = ids[nextIdx];
      if (!nextID) return;

      const selectFns = ['select', 'selectTab', 'showTab'];
      for (const fn of selectFns) {
        if (typeof tabs[fn] === 'function') {
          tabs[fn](nextID);
          return;
        }
      }

      tabs.selectedID = nextID;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainCycleTab error: ' + e);
    }
  },

  _mainFocusSearch(win) {
    try {
      const el = win.document.querySelector('#zotero-tb-search-input') ||
                 win.document.querySelector('#zotero-tb-search input') ||
                 win.document.querySelector('input[type="search"]');
      if (el) { el.focus(); el.select(); }
      else Zotero.debug('[ZoteroVim] _mainFocusSearch: search input not found');
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainFocusSearch error: ' + e);
    }
  },

  _mainYankCitekey(win, winState) {
    try {
      const items = win.ZoteroPane.getSelectedItems();
      if (!items.length) { this._mainShowStatus(win, '✗ No item selected'); return; }
      const item    = items[0];
      const citekey = Zotero.BetterBibTeX?.KeyManager?.get(item.id)?.citationKey;
      if (!citekey) { this._mainShowStatus(win, '✗ No citekey (BBT not ready?)'); return; }
      const clip = Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper);
      clip.copyString(citekey);
      this._mainShowStatus(win, '✓ @' + citekey);
      Zotero.debug('[ZoteroVim] _mainYankCitekey: @' + citekey);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainYankCitekey error: ' + e);
      this._mainShowStatus(win, '✗ ' + String(e).slice(0, 40));
    }
  },

  _mainShowStatus(win, msg, ms = 2000) {
    try {
      const winState = this._mainWindowState.get(win);
      const el = winState?.statusEl;
      if (!el) return;
      el.style.display = 'block';
      el.textContent = msg;
      el.style.background =
        msg.startsWith('✓') ? 'rgba(50,150,50,0.9)'   :
        msg.startsWith('→') ? 'rgba(60,100,180,0.9)'  :
        msg.startsWith('▶') ? 'rgba(60,100,180,0.9)'  :
                              'rgba(180,40,40,0.9)';
      clearTimeout(winState._statusTimer);
      winState._statusTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainShowStatus error: ' + e);
    }
  },

  // ── Fuzzy picker ──────────────────────────────────────────────────────────

  async _openFuzzyPicker(win, winState, scope) {
    if (winState.pickerOpen) return;
    winState.pickerOpen  = true;
    winState._pickerWin  = win;

    const doc  = win.document;
    const root = doc.body || doc.documentElement;
    // XUL document — must use HTML namespace so CSS (position:fixed, flex) works.
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);

    // ── Build overlay DOM ───────────────────────────────────────────────────
    const overlay = h('div');
    overlay.id = 'zv-picker-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;' +
      'background:rgba(0,0,0,0.6);z-index:99999;' +
      'display:flex;align-items:flex-start;justify-content:center;padding-top:10vh;';

    const modal = h('div');
    modal.style.cssText =
      'background:#1e1e2e;color:#cdd6f4;width:60vw;max-height:70vh;' +
      'border-radius:8px;overflow:hidden;display:flex;flex-direction:column;' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.8);font:13px/1.4 monospace;';

    const inputWrap = h('div');
    inputWrap.style.cssText = 'padding:10px 12px;border-bottom:1px solid #313244;';

    const input = h('input');
    input.type = 'text';
    input.placeholder = scope === 'tabs' ? 'Pick tab by hint or search tab title...' : 'Search items...';
    input.style.cssText =
      'width:100%;box-sizing:border-box;background:#313244;color:#cdd6f4;' +
      'border:none;outline:none;border-radius:4px;padding:6px 10px;font:13px/1 monospace;';

    const results = h('div');
    results.style.cssText = 'overflow-y:auto;flex:1;max-height:55vh;';
    const loadingMsg = h('div');
    loadingMsg.style.cssText = 'padding:12px;color:#6c7086';
    loadingMsg.textContent = 'Loading…';
    results.appendChild(loadingMsg);

    const hintBar = h('div');
    hintBar.style.cssText =
      'padding:4px 12px;font-size:11px;color:#6c7086;border-top:1px solid #313244;flex-shrink:0;';
    hintBar.textContent = scope === 'tabs'
      ? 'Type hint letter (empty query) or search title  ·  Ctrl+j/k navigate  ·  Enter select  ·  Esc close'
      : 'Ctrl+j/k navigate  ·  Enter select  ·  y yank citation  ·  yy yank citekey  ·  Esc close';

    inputWrap.appendChild(input);
    modal.appendChild(inputWrap);
    modal.appendChild(results);
    modal.appendChild(hintBar);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    winState._pickerOverlay  = overlay;
    winState._pickerInput    = input;
    winState._pickerResults  = results;
    winState._pickerSelected = 0;
    winState._pickerFiltered = [];
    winState._pickerLastKey  = null;
    winState._pickerYTimer   = null;
    winState._pickerScope    = scope;

    // Dismiss on backdrop click
    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) this._closeFuzzyPicker(win, winState);
    });

    const onInput = () => {
      winState._pickerSelected = 0;
      this._filterAndRenderPicker(winState, input.value);
    };

    input.addEventListener('input', onInput);

    winState._pickerCleanup = () => {
      try { input.removeEventListener('input', onInput); } catch (_) {}
      clearTimeout(winState._pickerYTimer);
    };

    setTimeout(() => { try { input.focus(); } catch (_) {} }, 30);

    // ── Load items ──────────────────────────────────────────────────────────
    try {
      if (scope === 'tabs') {
        winState._pickerItems = this._buildTabPickerItems(win);
      } else {
        const libID = Zotero.Libraries.userLibraryID;
        let items;
        if (scope === 'collection') {
          const cv   = win.ZoteroPane.collectionsView;
          const coll = cv?.getSelectedCollection?.();
          // getChildItems is synchronous; getAll is async - must await
          items = coll ? Array.from(coll.getChildItems(false, false) || [])
                       : Array.from((await Zotero.Items.getAll(libID, true, false)) || []);
        } else {
          // onlyTopLevel=true avoids duplicates from child items; deleted=false
          items = Array.from((await Zotero.Items.getAll(libID, true, false)) || []);
        }
        items = items.filter(item => !item.isAttachment() && !item.isNote());

        winState._pickerItems = items.map(item => {
          const citekey  = Zotero.BetterBibTeX?.KeyManager?.get(item.id)?.citationKey || '';
          const title    = item.getField('title') || '';
          const year     = item.getField('year')  || '';
          const creators = item.getCreators?.() || [];
          const author   = creators.length > 0
            ? (creators[0].lastName || creators[0].name || '') : '';
          return {
            id: item.id, citekey, title, year, author,
            searchStr: [citekey, title, author, year].join(' ').toLowerCase(),
          };
        });
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _openFuzzyPicker load error: ' + e);
      while (results.firstChild) results.removeChild(results.firstChild);
      const errEl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      errEl.style.cssText = 'padding:12px;color:#f38ba8';
      errEl.textContent = 'Error loading items: ' + String(e).slice(0, 80);
      results.appendChild(errEl);
      return;
    }

    this._filterAndRenderPicker(winState, '');
  },

  _filterAndRenderPicker(winState, query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      winState._pickerFiltered = winState._pickerItems.slice(0, 100);
    } else {
      // Sequential fuzzy: each character of the query must appear in order
      winState._pickerFiltered = winState._pickerItems.filter(it => {
        let idx = 0;
        for (const c of q) {
          const found = it.searchStr.indexOf(c, idx);
          if (found < 0) return false;
          idx = found + 1;
        }
        return true;
      }).slice(0, 100);
    }
    this._renderPickerResults(winState);
  },

  _onPickerKeyDown(e, win, winState) {
    const k = e.key;
    const keyLower = String(k || '').toLowerCase();
    const code = String(e.code || '');
    const maxIdx = Math.max(0, (winState._pickerFiltered.length || 1) - 1);

    if (k === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(winState._pickerYTimer);
      winState._pickerLastKey = null;
      this._closeFuzzyPicker(win, winState);
      return;
    }
    if (k === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(winState._pickerYTimer);
      winState._pickerLastKey = null;
      this._pickerSelectItem(win, winState);
      return;
    }
    const isCtrlDown = e.ctrlKey && (keyLower === 'n' || keyLower === 'j' || code === 'KeyN' || code === 'KeyJ');
    const isCtrlUp = e.ctrlKey && (keyLower === 'p' || keyLower === 'k' || code === 'KeyP' || code === 'KeyK');

    if (k === 'ArrowDown' || isCtrlDown) {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(winState._pickerYTimer);
      winState._pickerLastKey = null;
      winState._pickerSelected = Math.min(winState._pickerSelected + 1, maxIdx);
      this._renderPickerResults(winState);
      return;
    }
    if (k === 'ArrowUp' || isCtrlUp) {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(winState._pickerYTimer);
      winState._pickerLastKey = null;
      winState._pickerSelected = Math.max(winState._pickerSelected - 1, 0);
      this._renderPickerResults(winState);
      return;
    }
    if (winState._pickerScope === 'tabs' && !e.ctrlKey && !e.metaKey && !e.altKey && k.length === 1) {
      const query = (winState._pickerInput?.value || '').trim();
      if (!query) {
        const idx = this._pickerIndexFromHint(k, winState._pickerFiltered.length || 0);
        if (idx >= 0) {
          e.preventDefault(); e.stopPropagation();
          clearTimeout(winState._pickerYTimer);
          winState._pickerLastKey = null;
          winState._pickerSelected = idx;
          this._pickerSelectItem(win, winState);
          return;
        }
      }
    }
    // y = yank full citation; yy = yank citekey only
    if (k === 'y') {
      if (winState._pickerScope === 'tabs') {
        e.stopPropagation();
        return;
      }
      e.preventDefault(); e.stopPropagation();
      if (winState._pickerLastKey === 'y') {
        clearTimeout(winState._pickerYTimer);
        winState._pickerLastKey = null;
        this._pickerYankCitekey(win, winState);
      } else {
        winState._pickerLastKey = 'y';
        clearTimeout(winState._pickerYTimer);
        winState._pickerYTimer = setTimeout(() => {
          winState._pickerLastKey = null;
          this._pickerYankCitation(win, winState);
        }, 400);
      }
      return;
    }
    // All other keys: stop Zotero from reacting but allow the key to type in
    // the input element (no preventDefault).
    e.stopPropagation();
    winState._pickerLastKey = null;
    clearTimeout(winState._pickerYTimer);
  },

  _pickerYankCitation(win, winState) {
    const item = (winState._pickerFiltered || [])[winState._pickerSelected];
    if (!item) return;
    const parts = [];
    if (item.citekey) parts.push('@' + item.citekey);
    if (item.title)   parts.push(item.title);
    const meta = [item.author, item.year].filter(Boolean).join(', ');
    if (meta) parts.push('(' + meta + ')');
    const text = parts.join('  ');
    try {
      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper)
        .copyString(text);
      this._mainShowStatus(win, '✓ ' + (item.citekey ? '@' + item.citekey : item.title));
    } catch (e) {
      Zotero.debug('[ZoteroVim] _pickerYankCitation error: ' + e);
    }
    this._closeFuzzyPicker(win, winState);
  },

  _renderPickerResults(winState) {
    const container = winState._pickerResults;
    if (!container) return;
    const items    = winState._pickerFiltered || [];
    const selected = winState._pickerSelected;
    const doc = container.ownerDocument;
    const H   = 'http://www.w3.org/1999/xhtml';
    const h   = (tag) => doc.createElementNS(H, tag);

    while (container.firstChild) container.removeChild(container.firstChild);

    if (items.length === 0) {
      const noEl = h('div');
      noEl.style.cssText = 'padding:12px;color:#6c7086';
      noEl.textContent = 'No results';
      container.appendChild(noEl);
      return;
    }

    const frag = doc.createDocumentFragment();
    const win  = winState._pickerWin;
    const isTabPicker = winState._pickerScope === 'tabs';

    items.forEach((item, i) => {
      const row = h('div');
      const isSel = i === selected;
      row.style.cssText =
        'padding:6px 12px;cursor:pointer;border-left:3px solid ' +
        (isSel ? '#89b4fa;background:#313244;' : 'transparent;');

      const line1 = h('div');
      const cite  = h('span');
      cite.style.cssText = 'color:#89b4fa;font-weight:bold;margin-right:8px;';
      if (isTabPicker) {
        const hint = this._pickerHintForIndex(i);
        cite.textContent = hint ? '[' + hint + ']' : '[' + String(i + 1) + ']';
      } else {
        cite.textContent = item.citekey ? '@' + item.citekey : '(no citekey)';
      }
      const titleSpan = h('span');
      titleSpan.style.cssText = 'color:#cdd6f4;';
      titleSpan.textContent   = item.title.length > 72
        ? item.title.slice(0, 72) + '…' : item.title;
      line1.appendChild(cite);
      line1.appendChild(titleSpan);

      const meta = h('div');
      meta.style.cssText = 'color:#6c7086;font-size:11px;margin-top:1px;padding-left:2px;';
      meta.textContent   = isTabPicker
        ? [item.kind, item.selected ? 'selected' : ''].filter(Boolean).join(' · ')
        : [item.author, item.year].filter(Boolean).join(', ');

      row.appendChild(line1);
      row.appendChild(meta);
      frag.appendChild(row);

      row.addEventListener('click', () => {
        winState._pickerSelected = i;
        this._pickerSelectItem(win, winState);
      });
      row.addEventListener('mouseenter', () => {
        winState._pickerSelected = i;
        this._renderPickerResults(winState);
      });
    });

    container.appendChild(frag);

    // Scroll selected row into view
    if (container.children[selected]) {
      container.children[selected].scrollIntoView({ block: 'nearest' });
    }
  },

  _pickerSelectItem(win, winState) {
    const item = (winState._pickerFiltered || [])[winState._pickerSelected];
    if (!item) return;
    try {
      if (winState._pickerScope === 'tabs') {
        this._mainSelectTab(win, item.id);
        Zotero.debug('[ZoteroVim] pickerSelectTab: id=' + item.id);
      } else {
        win.ZoteroPane.selectItem(item.id);
        Zotero.debug('[ZoteroVim] pickerSelectItem: id=' + item.id);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _pickerSelectItem error: ' + e);
    }
    this._closeFuzzyPicker(win, winState);
  },

  _buildTabPickerItems(win) {
    try {
      const tabs = win.Zotero_Tabs;
      if (!tabs) return [];
      const list = Array.isArray(tabs._tabs)
        ? tabs._tabs
        : (Array.isArray(tabs.tabs) ? tabs.tabs : []);
      const selectedID = tabs.selectedID || tabs._selectedID;
      return list
        .map((tab, i) => {
          const id = tab?.id || tab?.tabID || tab?.dataset?.id;
          if (!id) return null;
          const title = (tab?.title || tab?.label || tab?.name || tab?.dataset?.title || '').trim() || id;
          const typeRaw = tab?.type || tab?.mode || tab?.dataset?.type || '';
          const kind = String(typeRaw || (String(id).includes('reader') ? 'reader' : 'tab'));
          const selected = selectedID ? id === selectedID : false;
          return {
            id,
            title,
            kind,
            selected,
            order: i + 1,
            searchStr: [title, id, kind, selected ? 'selected current' : ''].join(' ').toLowerCase(),
          };
        })
        .filter(Boolean);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _buildTabPickerItems error: ' + e);
      return [];
    }
  },

  _mainSelectTab(win, tabID) {
    try {
      const tabs = win.Zotero_Tabs;
      if (!tabs || !tabID) return;
      const selectFns = ['select', 'selectTab', 'showTab'];
      for (const fn of selectFns) {
        if (typeof tabs[fn] === 'function') {
          tabs[fn](tabID);
          return;
        }
      }
      tabs.selectedID = tabID;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainSelectTab error: ' + e);
    }
  },

  _pickerHintAlphabet() {
    return 'asdfghjklqwertyuiopzxcvbnm1234567890';
  },

  _pickerHintForIndex(i) {
    const alphabet = this._pickerHintAlphabet();
    if (i < 0 || i >= alphabet.length) return '';
    return alphabet[i];
  },

  _pickerIndexFromHint(key, count) {
    const alphabet = this._pickerHintAlphabet();
    const idx = alphabet.indexOf(String(key || '').toLowerCase());
    return (idx >= 0 && idx < count) ? idx : -1;
  },

  _pickerYankCitekey(win, winState) {
    const item = (winState._pickerFiltered || [])[winState._pickerSelected];
    if (!item) return;
    if (!item.citekey) {
      this._mainShowStatus(win, '✗ No citekey');
      this._closeFuzzyPicker(win, winState);
      return;
    }
    try {
      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper)
        .copyString(item.citekey);
      this._mainShowStatus(win, '✓ @' + item.citekey);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _pickerYankCitekey error: ' + e);
    }
    this._closeFuzzyPicker(win, winState);
  },

  _closeFuzzyPicker(win, winState) {
    if (!winState || !winState.pickerOpen) return;
    winState.pickerOpen = false;
    try { winState._pickerCleanup?.(); } catch (_) {}
    try {
      const ov = winState._pickerOverlay;
      if (ov?.parentNode) ov.parentNode.removeChild(ov);
    } catch (_) {}
    winState._pickerOverlay  = null;
    winState._pickerInput    = null;
    winState._pickerResults  = null;
    winState._pickerFiltered = [];
    winState._pickerCleanup  = null;
    winState._pickerLastKey  = null;
    winState._pickerScope    = null;
  },
};

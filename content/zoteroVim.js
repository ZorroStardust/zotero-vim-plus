/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */

/**
 * Zotero Vim Plus — main plugin object.
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
    'normal:n':       'findNext',
    'normal:N':       'findPrevious',
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
    'normal: n':   'mainNotesLayout',
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
    'main: n':    'mainNotesLayout',      // <space>n   — notes layout (current item + all notes)
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
      label:    'Zotero Vim Plus',
      image:    this.rootURI + 'icons/icon-64x64.png',
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

  isNoteEditorVimEnabled() {
    return this.getPref('noteEditor.enabled', true);
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
    const id = reader?._instanceID;
    if (attempts > 100) {
      this._injectedReaders.delete(id);
      return;
    }
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
      const currentReader = state.reader;
      const activePdfWin = state.activePdfWin || this._activeReaderPdfWin(currentReader, pdfWin) || pdfWin;
      this._executeAction(action, currentReader, state, activePdfWin, count);
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

    // Note: Zotero's reader React app forwards PDF.js iframe keydown events to
    // its KeyboardManager (which starts Read Aloud on 'l'/'r' etc.) via a
    // direct call, `view._onKeyDown(event)` (see reader's pdf-view.js).  That
    // forwarding cannot be stopped by DOM propagation control at this level —
    // and native keydown from the PDF.js iframe never reaches reader.html
    // anyway.  We intercept the forwarding callback instead via
    // _patchReaderKeyForwarding() so that keys consumed by vim are not also
    // handled by Zotero (Read Aloud, hand/pointer tools, find, etc.).

    // Vim-style search flow: Zotero's find popup keeps focus in its input, so
    // pressing n/N after searching would type into the box.  When Enter or
    // Shift+Enter is pressed inside the find popup, wait for Zotero to process
    // the key, then blur the input and return focus to the PDF — back in
    // Normal mode, where `n`/`N` now cycle the matches.
    const findBarReturnBridge = (e) => {
      if (e.key !== 'Enter') return;
      const active = outerDoc?.activeElement;
      if (!active || active.tagName !== 'INPUT') return;
      if (typeof active.closest !== 'function' || !active.closest('.find-popup')) return;
      setTimeout(() => {
        try {
          active.blur();
          const targetWin = this._activeReaderPdfWin(reader, pdfWin) || pdfWin;
          targetWin.focus();
        } catch (_) {}
      }, 150);
    };

    if (outerDoc) {
      outerDoc.addEventListener('keydown', outerEscapeHandler, true);
      outerDoc.addEventListener('keydown', outerKeyHandler, true);
      outerDoc.addEventListener('keydown', findBarReturnBridge, true);
    }

    state.cleanup = () => {
      this._stopSmoothHoldScroll(state, pdfWin);
      this._closeReaderOutlineExplorer(state);
      clearInterval(state._pdfViewSyncTimer);
      this._restoreReaderKeyForwarding(reader, state);
      this._clearReaderPdfViewListeners(state);
      if (outerDoc) outerDoc.removeEventListener('keydown', outerEscapeHandler, true);
      if (outerDoc) outerDoc.removeEventListener('keydown', outerKeyHandler, true);
      if (outerDoc) outerDoc.removeEventListener('keydown', findBarReturnBridge, true);
      state.indicatorEl?.remove();
      try { for (const el of pdfWin.document.querySelectorAll('[data-zv-cursor]')) el.remove(); } catch (_) {}
      clearTimeout(state.keyTimeout);
      if (reader.itemID) this._readerStateByItemID.delete(reader.itemID);
      if (reader._instanceID) this._injectedReaders.delete(reader._instanceID);
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

    if (state.activePdfWin && !wantedWins.includes(state.activePdfWin)) {
      state.activePdfWin = primaryWin || secondaryWin || null;
    }

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

    this._patchReaderKeyForwarding(reader, state);
  },

  /**
   * Patch Zotero's reader views (PDF.js PdfView instances) so that keydown
   * events they forward to the reader app's KeyboardManager are dropped when
   * vim consumes the key.  Without this, Zotero's built-in shortcuts (Read
   * Aloud on 'l'/'r', hand tool on 'h', pointer tool on 's', find on Ctrl+F,
   * …) fire even though vim already handled the key — the forwarding is a
   * direct JS call (view._onKeyDown) that DOM stopPropagation cannot stop.
   *
   * Re-applied periodically by _syncReaderPdfViewListeners() so that it
   * survives view recreation (file switches, split-view toggles) and readers
   * restored from a previous session (where Zotero's keydown listener on the
   * PDF.js window is registered before ours).
   */
  _patchReaderKeyForwarding(reader, state) {
    try {
      const internal = reader?._internalReader;
      const views = [internal?._primaryView, internal?._secondaryView];
      for (let view of views) {
        if (!view) continue;
        // Work on the raw content object — assignments through an Xray would
        // only touch the Xray shadow, not the view Zotero actually calls.
        try { view = Components.utils.unwrap(view); } catch (_) {}
        if (typeof view._onKeyDown !== 'function') continue;
        const patches = state.zvKeyPatches = state.zvKeyPatches || new Map();
        if (patches.has(view)) continue;
        const zv = this;
        const orig = view._onKeyDown;
        const wrapperFn = function (event) {
          try {
            if (zv._readerConsumesKey(state, zv._keyString(event))) return;
          } catch (_) {}
          return orig.call(view, event);
        };
        let exported;
        try {
          // Export the wrapper into the content compartment so the reader
          // React app can invoke it without a security error.
          exported = Components.utils.exportFunction(wrapperFn, view);
        } catch (_) {
          exported = wrapperFn;
        }
        view._onKeyDown = exported;
        patches.set(view, { orig, exported });
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _patchReaderKeyForwarding error: ' + e);
    }
  },

  _restoreReaderKeyForwarding(reader, state) {
    try {
      const patches = state?.zvKeyPatches;
      if (!patches) return;
      for (const [view, patch] of patches) {
        try {
          if (view && patch && typeof patch.orig === 'function'
            && typeof view._onKeyDown === 'function') {
            view._onKeyDown = patch.orig;
          }
        } catch (_) {}
      }
      patches.clear();
    } catch (e) {
      Zotero.debug('[ZoteroVim] _restoreReaderKeyForwarding error: ' + e);
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
      event.stopImmediatePropagation();
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
        event.stopImmediatePropagation();
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
      event.stopImmediatePropagation();
      this._startSmoothHoldScroll(state, pdfWin, holdSpec);
      return;
    }

    const keyStr = this._keyString(event);
    if (!keyStr) return;

    const bindings = this.getBindings();
    const modePrefix = state.mode + ':';
    const directAction = bindings[modePrefix + keyStr];
    if (event.repeat && (directAction === 'mainPrevTab' || directAction === 'mainNextTab')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (state.mode === 'cursor' && !state.countBuffer && !state.keyBuffer) {
      if (['j', 'k', 'h', 'l', 'w', 'W', 'b', 'B', '$'].includes(keyStr)) {
        const now = Date.now();
        if (state.cursorLastKey === keyStr && now - state.cursorLastKeyTS < 35) {
          event.preventDefault();
          event.stopImmediatePropagation();
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
        event.stopImmediatePropagation();
        this._updateIndicator(state);
        return;
      }
    }

    const newBuffer = state.keyBuffer + keyStr;

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
      event.preventDefault();
      event.stopImmediatePropagation();
      this._processBuffer(keyStr, se, sp, modePrefix, bindings, state);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
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

  /**
   * Whether vim would consume the given key in the reader's current mode —
   * i.e. the key is an exact binding or a prefix of one.  Used to decide
   * whether Zotero's forwarded keydown (KeyboardManager) should be allowed to
   * handle the key too (Read Aloud, hand/pointer tools, find, …).
   */
  _readerConsumesKey(state, keyStr) {
    if (!keyStr) return false;
    if (state.mode === 'insert' && keyStr !== 'escape') return false;
    const modePrefix = state.mode + ':';
    const bindings = this.getBindings();
    if (bindings[modePrefix + keyStr]) return true;
    return Object.keys(bindings).some(k => k.startsWith(modePrefix + keyStr));
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
      // Count prefixes (e.g. `3j`, `5l`, `2ctrl+f`) multiply the step or page
      // count; `G`/`gg` with a count jump to that page number.
      const n = Math.max(1, count || 1);

      // Scrolling / page navigation clears any active annotation selection so that
      // zb (recolorBlue) correctly falls through to the scroll-to-bottom path.
      const clearAnnotation = () => { state.lastAnnotationKey = null; };

      switch (action) {
        case 'scrollDown':    clearAnnotation(); scrollBy(step * n);                      break;
        case 'scrollUp':      clearAnnotation(); scrollBy(-step * n);                     break;
        case 'scrollLeft':    clearAnnotation(); scrollXBy(-step * n);                    break;
        case 'scrollRight':   clearAnnotation(); scrollXBy(step * n);                     break;
        case 'halfPageDown':  clearAnnotation(); scrollBy(Math.round(viewportH() / 2) * n); break;
        case 'halfPageUp':    clearAnnotation(); scrollBy(-Math.round(viewportH() / 2) * n);break;
        case 'fullPageDown':  clearAnnotation(); scrollBy(viewportH() * n);               break;
        case 'fullPageUp':    clearAnnotation(); scrollBy(-viewportH() * n);              break;
        case 'scrollTop':    clearAnnotation(); this._scrollToPagePosition(pdfWin, 'top');    break;
        case 'scrollCenter': clearAnnotation(); this._scrollToPagePosition(pdfWin, 'center'); break;
        case 'scrollBottom': clearAnnotation(); this._scrollToPagePosition(pdfWin, 'bottom'); break;

        case 'prevPage':
          clearAnnotation();
          if (!this._viewHasPageNav(reader)) {
            this._showStatus(state, '✗ Page navigation not supported here', 1500);
            break;
          }
          for (let i = 0; i < n; i++) {
            try { reader._internalReader.navigateToPreviousPage(); } catch (e) {
              Zotero.debug('[ZoteroVim] prevPage: ' + e); break; }
          }
          break;
        case 'nextPage':
          clearAnnotation();
          if (!this._viewHasPageNav(reader)) {
            this._showStatus(state, '✗ Page navigation not supported here', 1500);
            break;
          }
          for (let i = 0; i < n; i++) {
            try { reader._internalReader.navigateToNextPage(); } catch (e) {
              Zotero.debug('[ZoteroVim] nextPage: ' + e); break; }
          }
          break;
        case 'firstPage':
          clearAnnotation();
          if (!this._viewHasPageNav(reader)) {
            // Snapshot-like views have no pages: gg scrolls to the top.
            const c = getContainer();
            if (c) this._scrollContainerTo(c, 0);
            break;
          }
          if (count > 0) {
            try {
              const readerWin = reader._iframeWindow;
              reader._internalReader?.navigate?.(Cu.cloneInto({ pageIndex: count - 1 }, readerWin));
            } catch (e) {
              Zotero.debug('[ZoteroVim] goToPage: ' + e); }
          } else {
            try { reader._internalReader.navigateToFirstPage(); } catch (e) {
              Zotero.debug('[ZoteroVim] firstPage: ' + e); }
          }
          break;
        case 'lastPage':
          clearAnnotation();
          if (!this._viewHasPageNav(reader)) {
            // Snapshot-like views have no pages: G scrolls to the bottom.
            const c = getContainer();
            if (c) this._scrollContainerTo(c, Math.max(0, (c.scrollHeight || 0) - (c.clientHeight || 0)));
            break;
          }
          if (count > 0) {
            try {
              const readerWin = reader._iframeWindow;
              reader._internalReader?.navigate?.(Cu.cloneInto({ pageIndex: count - 1 }, readerWin));
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
        case 'clearSearch':       this._clearSearch(reader, pdfWin);         break;
        case 'findNext':
          if (!this._isSearchActive(reader)) {
            this._showStatus(state, 'No active search — press / to search', 1500);
            break;
          }
          try { reader._internalReader?.findNext?.(); } catch (e) {
            Zotero.debug('[ZoteroVim] findNext: ' + e); }
          break;
        case 'findPrevious':
          if (!this._isSearchActive(reader)) {
            this._showStatus(state, 'No active search — press / to search', 1500);
            break;
          }
          try { reader._internalReader?.findPrevious?.(); } catch (e) {
            Zotero.debug('[ZoteroVim] findPrevious: ' + e); }
          break;

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
        case 'mainNotesLayout':
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
};

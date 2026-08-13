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
    'normal: m':   'toggleMarksExplorer',

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
    Zotero.debug('[ZoteroVim] Initialized v' + version + ' on Zotero ' + (Zotero.version || '?'));
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
    if (this._prefsPaneRegistered) return;
    if (!Zotero.PreferencePanes) return;
    this._prefsPaneRegistered = true;
    Zotero.PreferencePanes.register({
      // A stable id is required: without one Zotero generates a random pane
      // id on every startup, so `lastSelectedPrefPane` points to a stale id
      // after a restart and the first settings open ends up in a degraded
      // window state (unselectable pane, dead controls until reopened).
      id:       'zotero-vim-plus-prefs',
      pluginID: this.id,
      src:      this.rootURI + 'content/preferences.xhtml',
      scripts:  [this.rootURI + 'content/i18n.js', this.rootURI + 'content/prefs.js'],
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

  // 'step' | 'follow' | 'trapezoid'. Defaults to 'follow'; migrates the
  // legacy smoothScroll bool (when explicitly set: true → trapezoid,
  // false → step).
  getScrollMode() {
    const mode = this.getPref('scroll.mode', '');
    if (mode === 'step' || mode === 'follow' || mode === 'trapezoid') return mode;
    let legacySet = false;
    try {
      legacySet = Services.prefs.getPrefType(this.PREF_PREFIX + '.smoothScroll') !== 0;
    } catch (_) {}
    if (legacySet) return this.getPref('smoothScroll', true) ? 'trapezoid' : 'step';
    return 'follow';
  },

  isSmoothScrollEnabled() { return this.getScrollMode() !== 'step'; },

  getSmoothScrollConfig() {
    const initialSpeed = this.getPref('smoothScroll.initialSpeed', 2000);
    const maxSpeed = Math.max(initialSpeed, this.getPref('smoothScroll.maxSpeed', 2000));
    return {
      mode: this.getScrollMode(),
      initialSpeed,
      maxSpeed,
      acceleration: this.getPref('smoothScroll.acceleration', 2600),
      deceleration: this.getPref('smoothScroll.deceleration', 4200),
      stopOnRelease: this.getPref('smoothScroll.stopOnRelease', false),
      followSpeed: this.getPref('smoothScroll.followSpeed', 2000),
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
    if (this._readerListenersRegistered) return;
    try {
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
      // Flag only after successful registration, so a pre-init failure (e.g.
      // Zotero.Reader not ready yet) can be retried by the post-init init().
      this._readerListenersRegistered = true;
      Zotero.debug('[ZoteroVim] reader listeners registered');
      try { zvLogFile('reader listeners registered'); } catch (_) {}
    } catch (e) {
      this._readerListenerIDs = [];
      Zotero.debug('[ZoteroVim] _registerReaderListeners failed: ' + e);
    }
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
    try {
      zvLogFile('renderToolbar reader ' + (reader?._instanceID || '?'));
    } catch (_) {}
    this._ensureReaderInjected(reader);
  },

  /**
   * Periodically ensure every open reader is injected.  Enumerates readers
   * from Zotero.Reader._readers (an array of ReaderTab/ReaderWindow in
   * Zotero 9; a Map in some 7/8 builds), falling back to tab enumeration.
   * Restored readers never fire renderToolbar after the plugin's listeners
   * are registered, so without this sweep they stay dead (no key handling,
   * no persisted marks) until the user switches items.
   */
  _rescanSelectedReader(win) {
    try {
      const readers = [];
      const all = Zotero.Reader._readers;
      if (Array.isArray(all)) {
        for (const r of all) readers.push(r);
      } else if (all && typeof all.values === 'function') {
        for (const r of all.values()) readers.push(r);
      }
      // Tab-based fallback (Zotero 7/8 style; Zotero 9's Zotero_Tabs has no
      // public .tabs property — only _tabs).
      if (readers.length === 0) {
        const tabs = win?.Zotero_Tabs?._tabs || win?.Zotero_Tabs?.tabs;
        if (Array.isArray(tabs)) {
          for (const tab of tabs) {
            if (!tab?.id) continue;
            try {
              const reader = Zotero.Reader.getByTabID?.(tab.id);
              if (reader) readers.push(reader);
            } catch (_) {}
          }
        }
      }
      let injected = 0;
      for (const reader of readers) {
        if (this._ensureReaderInjected(reader)) injected++;
      }
      if (readers.length > 0) {
        this._logRescan('readers=' + readers.length + ' newlyInjected=' + injected);
        try {
          zvLogFile('rescan readers=' + readers.length + ' newlyInjected=' + injected);
        } catch (_) {}
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _rescanSelectedReader error: ' + e);
    }
  },

  /** Rate-limited scan logging (at most one line per 5 s). */
  _logRescan(msg) {
    const now = Date.now();
    if (this._lastScanLogTS && now - this._lastScanLogTS < 5000) return;
    this._lastScanLogTS = now;
    Zotero.debug('[ZoteroVim] rescan: ' + msg);
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
    if (attempts > 300) {
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
    try { zvLogFile('inject reader ' + instanceID + ' itemID=' + (reader.itemID || '?')); } catch (_) {}

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
      marks: {},            // vim-style marks: char → { pageIndex, ratio, key, ts }
      marksExplorerOpen: false,
      marksExplorerSelected: 0,
      _marksExplorerOverlay: null,
      _marksExplorerList: null,
      _marksExplorerStatus: null,
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
    this._loadPersistedMarks(state, reader);

    const outerDoc = reader._iframeWindow?.document;
    if (outerDoc) {
      state.indicatorEl = this._createModeIndicator(outerDoc);
    }

    // Force text-layer spans to be selectable and show selection highlight.
    this._injectSelectionCSS(pdfWin);
    this._syncReaderPdfViewListeners(reader, state);
    state._pdfViewSyncTimer = setInterval(() => {
      this._syncReaderPdfViewListeners(reader, state);
    }, 250);

    // ── Outer reader.html: hand over to Zotero's native comment editors ──
    // When the user focuses a native editable in reader.html (the annotation
    // popup's comment editor or the sidebar comment field) while the plugin's
    // own overlay is open, save and close the overlay and leave the native
    // editor in control — no focus fight with the insert watchdog.  The
    // overlay lives in the PDF iframe document and focusin does not cross
    // documents, so this listener can only fire for native reader.html
    // editables.  Escape inside native editors is left entirely to Zotero.
    const outerFocusinHandover = (e) => {
      if (state.mode !== 'insert' || !state._commentOverlayInput) return;
      const t = e.target;
      if (!t) return;
      if (t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT' && !t.isContentEditable) return;
      this._handOverAnnotationInsert(state, reader);
    };
    const outerKeyHandler = (e) => {
      if (!outerDoc) return;
      const active = outerDoc.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
        // Throttled trace: confirms the plugin skipped the key because a
        // native editor was focused.
        const now = Date.now();
        if (now - (state._lastSkipTraceTS || 0) > 500) {
          state._lastSkipTraceTS = now;
          try { zvLogFile('[ZoteroVim] trace: skipKey native-editable=' + zvEl(active)
            + ' key=' + e.key + ' win=' + zvWin()); } catch (_) {}
        }
        return;
      }
      const keyStr = this._keyString(e);
      if (!keyStr) return;
      // Forward every key that lands on the reader's outer document.  After a
      // Zotero restart the restored reader may have focus here (not in the PDF
      // iframe), so a whitelist would drop hjkl etc.  Unbound keys pass
      // through untouched (no preventDefault in _onKeyDown).
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
      outerDoc.addEventListener('focusin', outerFocusinHandover, true);
      outerDoc.addEventListener('keydown', outerKeyHandler, true);
      outerDoc.addEventListener('keydown', findBarReturnBridge, true);
    }

    // ── TEMP DIAGNOSTIC (remove after debugging): trace insert-mode events ──
    // Logs every keydown/blur/pointerdown in the reader document while insert
    // mode is active and an editable is focused, plus the OS-focused window.
    // Output goes to <profile>/zv-startup.log with the "[ZoteroVim] trace:"
    // prefix so failures are diagnosable without the Error Console.
    // Stored on the reader state so _enterAnnotationInsertMode can reset the
    // budget for each insert session.
    const zvTrace = state._zvTrace = { n: 0, max: 600 };
    const zvT = (msg) => {
      if (zvTrace.n >= zvTrace.max) return;
      zvTrace.n++;
      try { zvLogFile('[ZoteroVim] trace: ' + msg); } catch (_) {}
    };
    const zvIsEd = (el) => !!(el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'));
    const zvEl = (el) => {
      if (!el) return 'null';
      return el.tagName + '.' + String(el.className || '').split(' ')[0] + (el.id ? '#' + el.id : '');
    };
    const zvWin = () => {
      try {
        const fw = Services.focus.focusedWindow;
        if (fw === outerDoc?.defaultView) return 'readerWin';
        if (fw === pdfWin) return 'pdfWin';
        return (fw?.location?.href || '?');
      } catch (_) { return '?'; }
    };
    const zvRect = (el) => {
      try {
        const r = el.getBoundingClientRect();
        return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top);
      } catch (_) { return '?'; }
    };
    const zvKeyTrace = (e) => {
      // Log any keydown aimed at an editable (even after mode flipped) —
      // missing keydowns while an editor is focused means keystrokes never
      // reach the reader document at all.
      if (!zvIsEd(e.target)) return;
      const act = outerDoc?.activeElement;
      zvT('keydown key=' + e.key + ' code=' + e.code + ' target=' + zvEl(e.target)
        + ' active=' + zvEl(act) + ' mode=' + state.mode + ' rect=' + zvRect(e.target)
        + ' win=' + zvWin() + ' hasFocus=' + !!outerDoc?.hasFocus?.());
      setTimeout(() => {
        if (zvTrace.n < zvTrace.max) {
          zvTrace.n++;
          try { zvLogFile('[ZoteroVim] trace:   after keydown: defaultPrevented=' + e.defaultPrevented
            + ' activeSame=' + (outerDoc?.activeElement === act) + ' connected=' + e.target.isConnected); } catch (_) {}
        }
      }, 0);
    };
    const zvBlurTrace = (e) => {
      if (!zvIsEd(e.target)) return;
      const t = e.target;
      zvT('focusout from=' + zvEl(t) + ' to=' + zvEl(e.relatedTarget) + ' win=' + zvWin()
        + ' connected=' + t.isConnected
        + ' popup=' + !!outerDoc?.querySelector('.annotation-popup')
        + ' activeAfter=' + zvEl(outerDoc?.activeElement)
        + ' mode=' + state.mode);
    };
    const zvFocusinTrace = (e) => {
      const t = e.target;
      if (!t || t.nodeType !== 1) return;
      zvT('focusin target=' + zvEl(t) + ' editable=' + zvIsEd(t)
        + ' win=' + zvWin() + ' mode=' + state.mode
        + ' hasFocus=' + !!outerDoc?.hasFocus?.());
    };
    const zvPointerTrace = (e) => {
      if (state.mode !== 'insert') return;
      zvT('pointerdown target=' + zvEl(e.target) + ' active=' + zvEl(outerDoc?.activeElement)
        + ' win=' + zvWin());
      setTimeout(() => {
        if (zvTrace.n < zvTrace.max) {
          zvTrace.n++;
          try { zvLogFile('[ZoteroVim] trace:   after pointerdown: active=' + zvEl(outerDoc?.activeElement)
            + ' popup=' + !!outerDoc?.querySelector('.annotation-popup')); } catch (_) {}
        }
      }, 0);
    };
    // Detect removal of the annotation popup / comment editor from the DOM —
    // a removed focused element blurs to body with relatedTarget null.
    const zvMutationTrace = (muts) => {
      if (state.mode !== 'insert') return;
      for (const m of muts) {
        for (const node of m.removedNodes) {
          if (!node || node.nodeType !== 1) continue;
          if (node.classList?.contains('annotation-popup') || node.querySelector?.('.annotation-popup')
              || (node.classList?.contains('content') && zvIsEd(node))) {
            zvT('removed from DOM: ' + zvEl(node));
          }
        }
      }
    };
    let zvObserver = null;
    try {
      if (typeof outerDoc?.body?.addEventListener === 'function'
          && typeof outerDoc.defaultView?.MutationObserver === 'function') {
        zvObserver = new outerDoc.defaultView.MutationObserver(zvMutationTrace);
        zvObserver.observe(outerDoc.body, { childList: true, subtree: true });
      }
    } catch (_) {}
    if (outerDoc) {
      outerDoc.addEventListener('keydown', zvKeyTrace, true);
      outerDoc.addEventListener('focusout', zvBlurTrace, true);
      outerDoc.addEventListener('focusin', zvFocusinTrace, true);
      outerDoc.addEventListener('pointerdown', zvPointerTrace, true);
    }

    state.cleanup = () => {
      this._stopSmoothHoldScroll(state, pdfWin);
      this._closeReaderOutlineExplorer(state);
      clearInterval(state._pdfViewSyncTimer);
      this._restoreReaderKeyForwarding(reader, state);
      this._restoreAnnotationDeletionFlag(state, reader);
      this._clearReaderPdfViewListeners(state);
      if (outerDoc) outerDoc.removeEventListener('focusin', outerFocusinHandover, true);
      if (outerDoc) outerDoc.removeEventListener('keydown', outerKeyHandler, true);
      if (outerDoc) outerDoc.removeEventListener('keydown', findBarReturnBridge, true);
      if (outerDoc) {
        outerDoc.removeEventListener('keydown', zvKeyTrace, true);
        outerDoc.removeEventListener('focusout', zvBlurTrace, true);
        outerDoc.removeEventListener('focusin', zvFocusinTrace, true);
        outerDoc.removeEventListener('pointerdown', zvPointerTrace, true);
      }
      try { zvObserver?.disconnect(); } catch (_) {}
      state.indicatorEl?.remove();
      try { for (const el of pdfWin.document.querySelectorAll('[data-zv-cursor]')) el.remove(); } catch (_) {}
      clearTimeout(state.keyTimeout);
      clearTimeout(state.insertWatchdog);
      clearTimeout(state._commentAutosaveTimer);
      // Best-effort save if the reader goes away while the overlay is open.
      try { this._saveAndCloseAnnotationCommentOverlay(state); } catch (_) {}
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

  /**
   * Whether a Zotero-native editable in reader.html (annotation popup comment
   * editor, sidebar comment field, find input, …) currently has DOM focus.
   * While one does, the plugin stays completely inert — no key consumption,
   * no focus moves — so native editing works exactly as without the plugin.
   */
  _nativeEditableFocused(reader) {
    try {
      const active = reader?._iframeWindow?.document?.activeElement;
      if (!active) return false;
      return active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable;
    } catch (_) {}
    return false;
  },

  /**
   * Route a main-window keydown into the selected reader.  After a Zotero
   * restart, restored reader tabs keep focus on the main window's <browser>
   * element — the PDF iframe never receives focus, so its own keydown
   * handler is never invoked and only J/K (special-cased in the main window
   * handler) work.  This forwards every other key (hjkl, `x, <space>…)
   * to the reader's _onKeyDown and then focuses the PDF iframe, so the
   * first keypress acts as the "click" and every later key flows straight
   * into the iframe.  Unbound keys pass through untouched (no preventDefault).
   */
  _forwardReaderKey(e, win) {
    try {
      const tabID = win?.Zotero_Tabs?.selectedID;
      if (!tabID) {
        Zotero.debug('[ZoteroVim] _forwardReaderKey: no selected tab');
        return;
      }
      const reader = Zotero.Reader.getByTabID?.(tabID);
      if (!reader) {
        Zotero.debug('[ZoteroVim] _forwardReaderKey: no reader for tab ' + tabID);
        return;
      }
      this._ensureReaderInjected(reader);
      const state = this._readerState.get(reader._instanceID);
      if (!state) {
        Zotero.debug('[ZoteroVim] _forwardReaderKey: no state for ' + reader._instanceID);
        return;
      }
      // A Zotero-native editor has focus — leave the keystroke alone; do not
      // steal focus to the PDF iframe.
      if (this._nativeEditableFocused(reader)) return;
      const pdfWin = state.activePdfWin || this._activeReaderPdfWin(reader) || state.pdfWin;
      if (!pdfWin) {
        Zotero.debug('[ZoteroVim] _forwardReaderKey: no pdfWin for ' + reader._instanceID);
        return;
      }
      try { pdfWin.focus(); } catch (_) {}
      this._onKeyDown(e, reader, state, pdfWin);
    } catch (err) {
      Zotero.debug('[ZoteroVim] _forwardReaderKey error: ' + err);
    }
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
        keyDown: (e) => {
          // Trace IME-related keydowns (Process / composing) in the PDF
          // window — this is where OS focus sits, so composition events
          // start here.  Throttled to ~2 lines/second.
          if (state.mode === 'insert' && (e.key === 'Process' || e.isComposing)) {
            const now = Date.now();
            if (now - (state._lastProcessTraceTS || 0) > 500) {
              state._lastProcessTraceTS = now;
              try {
                zvLogFile('[ZoteroVim] trace: keydown pdf key=' + e.key
                  + ' code=' + e.code + ' isComposing=' + e.isComposing
                  + ' target=' + (e.target?.tagName || '?'));
              } catch (_) {}
            }
          }
          this._onKeyDown(e, reader, state, viewWin);
        },
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
    this._patchReaderTextAnnotationFocus(reader, state);
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
        const patches = state.zvKeyPatches = state.zvKeyPatches || new Map();
        if (patches.has(view)) {
          // Zotero may replace _onKeyDown when recreating reader internals —
          // if the stored wrapper is no longer installed, re-patch.
          const patch = patches.get(view);
          try {
            if (view._onKeyDown === patch.exported) continue;
            try {
              zvLogFile('[ZoteroVim] trace: _onKeyDown replaced by Zotero — re-patching');
            } catch (_) {}
            patches.delete(view);
          } catch (_) {}
        }
        if (typeof view._onKeyDown !== 'function') {
          const logged = state._patchMissingLogged = state._patchMissingLogged || new Set();
          if (!logged.has(view)) {
            logged.add(view);
            try { zvLogFile('[ZoteroVim] trace: no _onKeyDown on view — key forwarding patch skipped'); } catch (_) {}
          }
          continue;
        }
        const zv = this;
        const orig = view._onKeyDown;
        const wrapperFn = function (event) {
          try {
            // A native reader.html editor has DOM focus — keep Zotero's own
            // shortcut handling quiet too (OS focus may still sit in this
            // PDF window), so the keystroke never reaches the KeyboardManager.
            if (zv._nativeEditableFocused(reader)) return;
            const keyStr = zv._keyString(event);
            if (zv._readerConsumesKey(state, keyStr)) {
              const n = state._dropTraceN = (state._dropTraceN || 0) + 1;
              if (n <= 40) {
                try { zvLogFile('[ZoteroVim] trace: dropForward key=' + keyStr
                  + ' mode=' + state.mode); } catch (_) {}
              }
              return;
            }
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

  /**
   * Make Zotero treat the plugin's comment-overlay textarea as its own
   * focused text annotation while it has focus.
   *
   * Zotero 9's PdfView._handleKeyDown() is a bound capture listener on the
   * PDF iframe window that runs before anything we can register, and it
   * opens the annotation popup on plain Enter BEFORE calling view._onKeyDown
   * (which our _patchReaderKeyForwarding wraps) — so that wrapper can never
   * see Enter.  _handleKeyDown() early-returns on
   * `this._textAnnotationFocused()`, which is a dynamic method call we CAN
   * intercept: while our textarea is focused the wrapper returns true and
   * Zotero skips all its key/pointer handling — no popup, and its
   * preventDefault() no longer eats the native Enter newline.
   *
   * Re-applied periodically by _syncReaderPdfViewListeners() (view
   * recreation, restored sessions); views without the method (EPUB/snapshot)
   * are skipped.
   */
  _patchReaderTextAnnotationFocus(reader, state) {
    try {
      const internal = reader?._internalReader;
      const views = [internal?._primaryView, internal?._secondaryView];
      for (let view of views) {
        if (!view) continue;
        try { view = Components.utils.unwrap(view); } catch (_) {}
        const patches = state.zvTextFocusPatches = state.zvTextFocusPatches || new Map();
        if (patches.has(view)) {
          const patch = patches.get(view);
          try {
            if (view._textAnnotationFocused === patch.exported) continue;
            try {
              zvLogFile('[ZoteroVim] trace: _textAnnotationFocused replaced — re-patching');
            } catch (_) {}
            patches.delete(view);
          } catch (_) {}
        }
        if (typeof view._textAnnotationFocused !== 'function') continue;
        const orig = view._textAnnotationFocused;
        const wrapperFn = function () {
          try {
            const input = state._commentOverlayInput;
            if (input?.isConnected
                && view._iframeWindow?.document?.activeElement === input) {
              return true;
            }
          } catch (_) {}
          return orig.call(view);
        };
        let exported;
        try {
          exported = Components.utils.exportFunction(wrapperFn, view);
        } catch (_) {
          exported = wrapperFn;
        }
        view._textAnnotationFocused = exported;
        patches.set(view, { orig, exported });
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _patchReaderTextAnnotationFocus error: ' + e);
    }
  },

  _restoreReaderKeyForwarding(reader, state) {
    try {
      const patches = state?.zvKeyPatches;
      if (patches) {
        for (const [view, patch] of patches) {
          try {
            if (view && patch && typeof patch.orig === 'function'
              && typeof view._onKeyDown === 'function') {
              view._onKeyDown = patch.orig;
            }
          } catch (_) {}
        }
        patches.clear();
      }
      const textFocusPatches = state?.zvTextFocusPatches;
      if (textFocusPatches) {
        for (const [view, patch] of textFocusPatches) {
          try {
            if (view && patch && typeof patch.orig === 'function') {
              view._textAnnotationFocused = patch.orig;
            }
          } catch (_) {}
        }
        textFocusPatches.clear();
      }
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
    // Stop the insert-mode focus watchdog when leaving insert mode.
    if (mode !== 'insert') {
      clearTimeout(state.insertWatchdog);
      state.insertWatchdog = null;
    }
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
    const startSpeed = config.mode === 'follow' ? config.followSpeed : config.initialSpeed;

    hold.active = true;
    hold.releasing = false;
    hold.key = spec.key;
    hold.axis = spec.axis;
    hold.direction = spec.direction;
    hold.lastTS = 0;
    hold.speed = sameVector ? Math.max(startSpeed, hold.speed) : startSpeed;

    // Immediate response on keydown so short taps still feel consistent.
    const kick = hold.direction * (startSpeed / 120);
    const kickDX = hold.axis === 'x' ? kick : 0;
    const kickDY = hold.axis === 'y' ? kick : 0;
    this._scrollContainerBy(this._getScrollContainer(pdfWin), kickDX, kickDY);

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
        if (frameConfig.mode === 'follow') {
          // Constant-velocity mode: no acceleration curve.
          hold.speed = frameConfig.followSpeed;
        } else {
          hold.speed = Math.min(frameConfig.maxSpeed, Math.max(frameConfig.initialSpeed, hold.speed + frameConfig.acceleration * dt));
        }
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
      this._scrollContainerBy(this._getScrollContainer(pdfWin), dx, dy);
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
      // Follow mode stops instantly by design; trapezoid decelerates unless
      // "stop immediately on release" is enabled.
      const immediate = config.mode === 'follow' || !!config.stopOnRelease;
      this._stopSmoothHoldScroll(state, pdfWin, immediate);
    }
  },

  /**
   * Show a "PDF loading…" status when a scroll action runs while the PDF
   * document has not finished loading (rate-limited to once per 2 s).
   * Only page-based (PDF) views are gated on pdfDocument — EPUB/snapshot
   * scroll containers are not.  Called from both the smooth-hold path and
   * the classic scroll path in _executeAction.
   */
  _maybePdfLoadingStatus(state, pdfWin, reader) {
    try {
      if (!this._viewHasPageNav(reader)) return;
      if (pdfWin.PDFViewerApplication?.pdfDocument) return;
      const now = Date.now();
      if (state._scrollDuringLoadTS && now - state._scrollDuringLoadTS < 2000) return;
      state._scrollDuringLoadTS = now;
      this._showStatus(state, 'PDF loading…', 1500);
      try { zvLogFile('scroll during pdf load (no pdfDocument)'); } catch (_) {}
    } catch (_) {}
  },

  _onKeyDown(event, reader, state, pdfWin) {
    state.activePdfWin = pdfWin || state.activePdfWin;

    // While a Zotero-native editor (annotation popup / sidebar comment /
    // find input) has DOM focus, the plugin is completely inert: it must
    // never consume keys or move focus, otherwise typing in Zotero's own
    // editors loses focus.
    if (this._nativeEditableFocused(reader)) return;

    if (state.outlineExplorerOpen) {
      if (this._onReaderOutlineExplorerKeyDown(event, reader, state, pdfWin)) {
        return;
      }
    }

    if (state.marksExplorerOpen) {
      if (this._onReaderMarksExplorerKeyDown(event, reader, state, pdfWin)) {
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
        // Escape while editing an annotation comment: save and close the
        // plugin's comment overlay.
        event.preventDefault();
        event.stopImmediatePropagation();
        this._exitAnnotationInsert(state, reader);
        return;
      }
      // While the plugin's own comment overlay is focused, keep Zotero's
      // same-window capture listener from also acting on the key (Enter
      // opens the annotation popup, Backspace deletes the annotation).
      // stopImmediatePropagation without preventDefault: the textarea still
      // receives the native keystroke.
      const t = event.target;
      if (state._commentOverlayInput && t === state._commentOverlayInput) {
        event.stopImmediatePropagation();
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
      this._maybePdfLoadingStatus(state, pdfWin, reader);
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
    // Skipped while a prefix key is pending (e.g. mark chords "m1" / "`1")
    // so digits can act as mark characters there.
    if ((state.mode === 'normal' || state.mode === 'cursor') && !state.keyBuffer
        && /^\d$/.test(keyStr)) {
      if (keyStr !== '0' || state.countBuffer) {
        state.countBuffer = (state.countBuffer || '') + keyStr;
        event.preventDefault();
        event.stopImmediatePropagation();
        this._updateIndicator(state);
        return;
      }
    }

    // Mark chords (vim-style): "m<x>" set, "`<x>" jump, "dm<x>" delete,
    // "dM" delete all.  Reserved while unbound — skipped if the user binds
    // 'm' or '`' explicitly.  Chords only start from an empty keyBuffer so
    // that "<space>m" etc. still reach the binding table.
    if (state.mode === 'normal' && !bindings['normal:m'] && !bindings['normal:`']) {
      if (!state.keyBuffer && (keyStr === 'm' || keyStr === '`')) {
        state.keyBuffer = keyStr;
        state.countBuffer = '';
        this._armMarkKeyTimeout(state);
        event.preventDefault();
        event.stopImmediatePropagation();
        this._updateIndicator(state);
        return;
      }
      if (state.keyBuffer === 'm' && /^[a-z0-9]$/.test(keyStr)) {
        this._clearMarkKey(state);
        this._setMark(state, reader, pdfWin, keyStr);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (state.keyBuffer === '`' && /^[a-z0-9]$/.test(keyStr)) {
        this._clearMarkKey(state);
        this._jumpMark(state, reader, pdfWin, keyStr);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (state.keyBuffer === 'd' && keyStr === 'm') {
        state.keyBuffer = 'dm';
        this._armMarkKeyTimeout(state);
        event.preventDefault();
        event.stopImmediatePropagation();
        this._updateIndicator(state);
        return;
      }
      if (state.keyBuffer === 'd' && keyStr === 'M') {
        this._clearMarkKey(state);
        this._clearAllMarks(state, reader);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (state.keyBuffer === 'dm' && /^[a-z0-9]$/.test(keyStr)) {
        this._clearMarkKey(state);
        this._delMark(state, reader, keyStr);
        event.preventDefault();
        event.stopImmediatePropagation();
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

  /**
   * Escape pressed while editing an annotation comment: save the overlay's
   * text as the official annotation comment (saveTx), close the overlay,
   * return to normal mode and hand focus back to the PDF view.
   */
  async _exitAnnotationInsert(state, reader) {
    state._composing = false;
    state._composingSince = 0;
    const hadOverlay = !!(state._commentOverlay || state._commentOverlayInput);
    let saved = true;
    if (hadOverlay) {
      try { saved = await this._saveAndCloseAnnotationCommentOverlay(state); } catch (_) {}
    }
    this._setMode(state, 'normal');
    this._restoreAnnotationDeletionFlag(state, reader);
    try {
      const targetWin = this._activeReaderPdfWin?.(reader) || state.activePdfWin || state.pdfWin;
      targetWin?.focus();
    } catch (_) {}
    if (hadOverlay) {
      this._showStatus(state, saved ? '✓ saved' : '✗ save failed', saved ? 1200 : 2500);
    }
  },

  /**
   * Hand the annotation comment over to a Zotero-native editor (annotation
   * popup or sidebar comment field) that just received focus: save and close
   * the plugin's overlay, return to normal mode, and — unlike
   * _exitAnnotationInsert — leave focus exactly where the user put it so the
   * native editor works without a focus fight.
   */
  async _handOverAnnotationInsert(state, reader) {
    state._composing = false;
    state._composingSince = 0;
    // Kill the focus watchdog before the async save so it cannot steal focus
    // back from the native editor.
    this._setMode(state, 'normal');
    this._restoreAnnotationDeletionFlag(state, reader);
    let saved = true;
    try { saved = await this._saveAndCloseAnnotationCommentOverlay(state); } catch (_) {}
    try { zvLogFile('[ZoteroVim] insert: handed over to native editor, saved=' + saved); } catch (_) {}
  },

  /**
   * Arm the pending-key timeout for mark chords ("m", "`", "dm").
   * Clears a stale prefix so a later key never mis-fires a mark command.
   */
  _armMarkKeyTimeout(state) {
    clearTimeout(state.keyTimeout);
    state.keyTimeout = setTimeout(() => {
      state.keyBuffer = '';
      state.countBuffer = '';
      this._updateIndicator(state);
    }, 1200);
  },

  /** Clear the pending mark prefix and its timeout. */
  _clearMarkKey(state) {
    clearTimeout(state.keyTimeout);
    state.keyTimeout = null;
    state.keyBuffer = '';
    state.countBuffer = '';
    this._updateIndicator(state);
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
    if (state.mode === 'insert') {
      // Escape always exits insert mode.
      if (keyStr === 'escape') return true;
      // While editing an annotation comment the plugin traps printable
      // characters, Backspace/Delete and Enter itself (Zotero's focus
      // machinery prevents the editor from receiving real keydowns) — keep
      // Zotero's KeyboardManager from also acting on them (toggling the
      // pointer tool on 's', deleting annotations on Backspace/Delete, …).
      // This also stays active during IME composition (the composition is
      // browser-managed; consuming the forwarded copies only suppresses
      // Zotero's shortcuts) and during stuck sessions.
      if (state.lastAnnotationKey
          && (keyStr.length === 1 || keyStr === 'backspace'
              || keyStr === 'delete' || keyStr === 'enter')) return true;
      return false;
    }
    // The marks explorer overlay consumes every key.
    if (state.marksExplorerOpen) return true;
    // A pending mark prefix ("m", "`", "dm") means the next alphanumeric key
    // is consumed as a mark character — do not forward it to Zotero (which
    // would e.g. toggle the pointer tool on "ms").
    if (state.mode === 'normal' && state.keyBuffer
        && (state.keyBuffer === 'm' || state.keyBuffer === '`' || state.keyBuffer === 'dm')
        && /^[a-z0-9]$/.test(keyStr)) return true;
    // "dM" deletes all marks — the "M" is consumed by the mark chord.
    if (state.mode === 'normal' && state.keyBuffer === 'd' && keyStr === 'M') return true;
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
      const scrollBy  = (dy, opts) => this._scrollContainerBy(getContainer(), 0, dy, opts);
      const scrollXBy = (dx, opts) => this._scrollContainerBy(getContainer(), dx, 0, opts);
      const viewportH = () => { try { return getContainer()?.clientHeight || 600; } catch (_) { return 600; } };
      // Count prefixes (e.g. `3j`, `5l`, `2ctrl+f`) multiply the step or page
      // count; `G`/`gg` with a count jump to that page number.
      const n = Math.max(1, count || 1);

      // Scrolling / page navigation clears any active annotation selection so that
      // zb (recolorBlue) correctly falls through to the scroll-to-bottom path.
      const clearAnnotation = () => { state.lastAnnotationKey = null; };

      // While the PDF document is still loading there is nothing rendered to
      // scroll — give feedback so the plugin's aliveness is visible (the
      // injection itself completes in milliseconds; the wait is PDF.js).
      if ([
        'scrollDown', 'scrollUp', 'scrollLeft', 'scrollRight',
        'halfPageDown', 'halfPageUp', 'fullPageDown', 'fullPageUp',
        'scrollTop', 'scrollCenter', 'scrollBottom',
      ].includes(action)) {
        this._maybePdfLoadingStatus(state, pdfWin, reader);
      }

      switch (action) {
        case 'scrollDown':    clearAnnotation(); scrollBy(step * n);                      break;
        case 'scrollUp':      clearAnnotation(); scrollBy(-step * n);                     break;
        case 'scrollLeft':    clearAnnotation(); scrollXBy(-step * n);                    break;
        case 'scrollRight':   clearAnnotation(); scrollXBy(step * n);                     break;
        case 'halfPageDown':  clearAnnotation(); scrollBy(Math.round(viewportH() / 2) * n, { smooth: true }); break;
        case 'halfPageUp':    clearAnnotation(); scrollBy(-Math.round(viewportH() / 2) * n, { smooth: true });break;
        case 'fullPageDown':  clearAnnotation(); scrollBy(viewportH() * n, { smooth: true });               break;
        case 'fullPageUp':    clearAnnotation(); scrollBy(-viewportH() * n, { smooth: true });              break;
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
        case 'editAnnotation':    this._enterAnnotationInsertMode(state, reader); break;
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
            // If an annotation is currently selected, focus its comment field
            // (in-page popup flow).  The key survives scrolls via Zotero's
            // own selection state (lastAnnotationKey is cleared by scrolling).
            if (this._selectedAnnotationKey(state, reader)) {
              this._enterAnnotationInsertMode(state, reader);
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

    if (action === 'toggleMarksExplorer') {
      this._toggleReaderMarksExplorer(state, reader, pdfWin);
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

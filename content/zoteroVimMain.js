/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */

/**
 * Zotero Vim Plus — main-window methods: window injection, note
 * editor, split views, fuzzy picker, notes layout. Loaded by
 * bootstrap.js after zoteroVim.js and zoteroVimReader.js.
 */

Object.assign(ZoteroVim, {
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
      notesLayoutOpen: false,
      _notesOverlay: null,
      _notesStatusEl: null,
      _notesListPane: null,
      _notesPreviewPane: null,
      _notesFocusPane: 'list',
      _notesCurrentList: null,
      _notesAllList: null,
      _notesCurrentRows: [],
      _notesAllRows: [],
      _notesNavRows: [],
      _notesSelected: 0,
      _notesHintBuffer: '',
      _notesHintTimer: null,
      _notesCmdBuffer: '',
      _notesCmdTimer: null,
      _lastDedupedAction: '',
      _lastDedupedActionTS: 0,
      _contextNoteEditorWin: null,
      _contextNoteEditorDoc: null,
      _contextNoteEditorKeyHandler: null,
      _contextNoteMode: 'normal',
      _contextNoteKeyBuffer: '',
      _contextNoteMainBuffer: '',
      _contextNoteCountBuffer: '',
      _contextNoteKeyTimeout: null,
      _contextNoteLastYank: '',
      executeAction: null,  // set below
      cleanup: () => {},
    };
    mainWinState.executeAction = (action, count) =>
      this._executeMainAction(action, win, mainWinState, count);
    this._mainWindowState.set(win, mainWinState);

    const readerScanHandler = () => {
      this._rescanSelectedReader(win);
      this._syncMainContextNoteListener(win, mainWinState);
    };
    readerScanHandler();
    const readerScanTimer = win.setInterval(readerScanHandler, 1000);

    const keyHandler = (e) => this._onMainKeyDown(e, win, mainWinState);
    win.document.addEventListener('keydown', keyHandler, true);

    // Window-level capture listener while the picker is open: window capture
    // runs before ANY document listener, so picker keys (Ctrl+j/k, arrows,
    // Ctrl+o, y/yy, Enter, Escape) are handled even if something at the
    // document level would otherwise swallow them (e.g. browser-style
    // shortcuts such as Ctrl+j).  _onPickerKeyDown guards re-entrancy with
    // the _zvPickerHandled flag.
    const pickerWindowKeyHandler = (e) => {
      if (mainWinState.pickerOpen) this._onPickerKeyDown(e, win, mainWinState);
    };
    win.addEventListener('keydown', pickerWindowKeyHandler, true);

    mainWinState.cleanup = () => {
      win.clearInterval(readerScanTimer);
      win.removeEventListener('keydown', pickerWindowKeyHandler, true);
      win.document.removeEventListener('keydown', keyHandler, true);
      this._closeFuzzyPicker(win, mainWinState);
      this._closeMainNotesLayout(win, mainWinState);
      this._clearMainContextNoteListener(mainWinState);
      clearTimeout(mainWinState.keyTimeout);
      clearTimeout(mainWinState._statusTimer);
      clearTimeout(mainWinState._notesHintTimer);
      clearTimeout(mainWinState._notesCmdTimer);
      clearTimeout(mainWinState._contextNoteKeyTimeout);
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

    if (winState.notesLayoutOpen) {
      this._onMainNotesKeyDown(e, win, winState);
      return;
    }

    // In standalone note tabs, route keys to note-vim first.
    // This prevents main item-list handlers from stealing hjkl/backspace.
    if (this.isNoteEditorVimEnabled() && this._isStandaloneNoteTabSelected(win)) {
      const noteMode = String(winState?._contextNoteMode || 'normal');
      const keyStr = this._keyString(e);

      // Keep global tab cycling available in note Normal mode.
      if (noteMode === 'normal' && (keyStr === 'J' || keyStr === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        if (keyStr === 'J') this._executeMainAction('mainPrevTab', win, winState, 1);
        else this._executeMainAction('mainNextTab', win, winState, 1);
        return;
      }

      this._onMainContextNoteKeyDown(e, win, winState);
      if (!e.defaultPrevented && noteMode === 'normal') {
        e.preventDefault();
        e.stopPropagation();
      }
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

    const keyStr = this._keyString(e);
    if (!keyStr) return;

    // Keep tab cycling responsive even when a heavy reader tab is still loading.
    // In that phase focus is often on <browser> and normal reader listeners are not ready.
    const bindings = this.getBindings();
    const modePrefix = 'main:';
    const directAction = bindings[modePrefix + keyStr];
    if (directAction === 'mainPrevTab' || directAction === 'mainNextTab') {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      this._executeMainAction(directAction, win, winState, 1);
      return;
    }

    // Skip when focus is inside an embedded browser element (PDF reader)
    if (active && active.localName === 'browser') return;

    // Skip when the selected tab is a reader tab, not the main library pane
    try {
      const tabID = win.Zotero_Tabs?.selectedID;
      if (tabID && Zotero.Reader.getByTabID?.(tabID)) return;
    } catch (_) {}

    // Count prefix digits
    if (/^\d$/.test(keyStr) && (keyStr !== '0' || winState.countBuffer)) {
      winState.countBuffer = (winState.countBuffer || '') + keyStr;
      e.preventDefault(); e.stopPropagation();
      return;
    }

    const newBuffer  = winState.keyBuffer + keyStr;

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
    if (action === 'mainPrevTab' || action === 'mainNextTab') {
      const now = Date.now();
      if (winState._lastDedupedAction === action && now - (winState._lastDedupedActionTS || 0) < 220) {
        return;
      }
      winState._lastDedupedAction = action;
      winState._lastDedupedActionTS = now;
    }

    this._mainSyncFocusedPanel(win, winState);
    Zotero.debug('[ZoteroVim] Main action: ' + action + ' count:' + count);
    switch (action) {
      case 'mainFuzzyAll':         this._openFuzzyPicker(win, winState, 'all');         break;
      case 'mainFuzzyCollection':  this._openFuzzyPicker(win, winState, 'collection');  break;
      case 'mainTabPick':          this._openFuzzyPicker(win, winState, 'tabs');        break;
      case 'mainNotesLayout':      this._toggleMainNotesLayout(win, winState);          break;
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
    const fallbackPrimaryWin = ir?._primaryView?._iframeWindow || state?.activePdfWin || null;
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

    const syncAndRecoverFocus = () => {
      this._syncReaderPdfViewListeners(reader, state);

      const irNow = reader?._internalReader;
      const splitTypeNow = String(irNow?.splitType || '');
      const primaryNow = irNow?._primaryView?._iframeWindow || fallbackPrimaryWin;
      const secondaryNow = irNow?._secondaryView?._iframeWindow;
      const splitActive = !!(primaryNow && secondaryNow && ['vertical', 'horizontal'].includes(splitTypeNow));

      // When split is just closed, focus can remain on a defunct secondary iframe.
      // Pull focus back to a live reader pane so hjkl continues to work immediately.
      if (!splitActive && primaryNow) {
        this._focusReaderPdfWindow(primaryNow, state);
      }
    };

    setTimeout(syncAndRecoverFocus, 60);
    setTimeout(syncAndRecoverFocus, 220);

    this._showStatus(state, orientation === 'vertical' ? '→ split vertical' : '→ split horizontal', 900);
  },

  _getActiveContextNoteEditor(win) {
    try {
      const contextPane = win?.ZoteroContextPane;
      if (!contextPane || contextPane.collapsed) return null;
      if (contextPane.context?.mode !== 'notes') return null;
      return contextPane.activeEditor || null;
    } catch (_) {
      return null;
    }
  },

  _getSelectedMainTab(win) {
    try {
      const tabs = win?.Zotero_Tabs;
      if (!tabs) return null;
      const list = Array.isArray(tabs._tabs)
        ? tabs._tabs
        : (Array.isArray(tabs.tabs) ? tabs.tabs : []);
      const selectedID = tabs.selectedID || tabs._selectedID;
      if (!selectedID || !Array.isArray(list) || !list.length) return null;
      return list.find((tab) => {
        const id = tab?.id || tab?.tabID || tab?.dataset?.id;
        return id === selectedID;
      }) || null;
    } catch (_) {
      return null;
    }
  },

  _isStandaloneNoteTabSelected(win) {
    try {
      const tab = this._getSelectedMainTab(win);
      if (!tab) return false;
      const text = [
        tab?.type,
        tab?.mode,
        tab?.kind,
        tab?.dataset?.type,
        tab?.id,
        tab?.tabID,
        tab?.title,
        tab?.label,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!text) return false;
      if (/\breader\b|\bpdf\b/.test(text)) return false;
      return /\bnote\b|\bnotes\b/.test(text);
    } catch (_) {
      return false;
    }
  },

  _scanStandaloneNoteEditorWindowFromMainDocument(win) {
    try {
      const doc = win?.document;
      if (!doc) return null;
      const nodes = Array.from(doc.querySelectorAll('browser, iframe'));
      const candidates = [];
      for (const node of nodes) {
        let cw = null;
        try { cw = node?.contentWindow || null; } catch (_) { cw = null; }
        if (cw) candidates.push(cw);
      }

      const focusedWin = Services.focus?.focusedWindow || null;
      if (focusedWin && candidates.includes(focusedWin) && this._isLikelyMainNoteEditorWindow(focusedWin, win)) {
        return focusedWin;
      }

      for (const candidate of candidates) {
        if (this._isLikelyMainNoteEditorWindow(candidate, win)) {
          return candidate;
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  },

  _isLikelyMainNoteEditorWindow(noteWin, mainWin = null) {
    try {
      if (!noteWin) return false;
      if (mainWin && noteWin === mainWin) return false;
      if (noteWin.PDFViewerApplication) return false;

      const doc = noteWin.document;
      if (!doc) return false;

      const href = String(noteWin.location?.href || '').toLowerCase();
      if (href.includes('reader.html') || href.includes('pdf.js')) return false;

      const body = doc.body;
      const editableBody = !!(body && (body.isContentEditable || String(body.getAttribute?.('contenteditable') || '').toLowerCase() === 'true'));
      const editableNode = !!doc.querySelector?.('[contenteditable="true"], .ProseMirror, .editor-core, .editor, .tox-edit-area iframe');
      const designModeOn = String(doc.designMode || '').toLowerCase() === 'on';

      return editableBody || editableNode || designModeOn;
    } catch (_) {
      return false;
    }
  },

  _getActiveStandaloneNoteEditorWindow(win) {
    try {
      const tab = this._getSelectedMainTab(win);
      const maybeNoteTab = this._isStandaloneNoteTabSelected(win);

      const focusedWin = Services.focus?.focusedWindow || null;
      if (this._isLikelyMainNoteEditorWindow(focusedWin, win)) {
        return focusedWin;
      }

      if (!maybeNoteTab) return null;

      const nestedCandidates = [
        tab?.browser?.contentWindow,
        tab?.iframe?.contentWindow,
        tab?._iframe?.contentWindow,
        tab?.contentWindow,
        tab?._iframeWindow,
      ];
      for (const candidate of nestedCandidates) {
        if (this._isLikelyMainNoteEditorWindow(candidate, win)) {
          return candidate;
        }
      }

      const scanned = this._scanStandaloneNoteEditorWindowFromMainDocument(win);
      if (this._isLikelyMainNoteEditorWindow(scanned, win)) return scanned;
      return null;
    } catch (_) {
      return null;
    }
  },

  _getActiveMainNoteEditorWindow(win) {
    try {
      const contextEditor = this._getActiveContextNoteEditor(win);
      const contextWin = this._getContextNoteEditorWindow(contextEditor);
      if (this._isLikelyMainNoteEditorWindow(contextWin, win)) return contextWin;

      return this._getActiveStandaloneNoteEditorWindow(win);
    } catch (_) {
      return null;
    }
  },

  _getContextNoteEditorWindow(noteEditor) {
    try {
      return noteEditor?._iframe?.contentWindow || noteEditor?._editorInstance?._iframeWindow || null;
    } catch (_) {
      return null;
    }
  },

  _clearMainContextNoteListener(winState) {
    this._clearMainContextNoteKeyState(winState);
    const noteWin = winState?._contextNoteEditorWin;
    const noteDoc = winState?._contextNoteEditorDoc;
    const handler = winState?._contextNoteEditorKeyHandler;
    if (noteWin && handler) {
      try { noteWin.removeEventListener('keydown', handler, true); } catch (_) {}
    }
    if (noteDoc && handler) {
      try { noteDoc.removeEventListener('keydown', handler, true); } catch (_) {}
    }
    if (winState) {
      winState._contextNoteEditorWin = null;
      winState._contextNoteEditorDoc = null;
      winState._contextNoteEditorKeyHandler = null;
    }
  },

  _syncMainContextNoteListener(win, winState) {
    if (!this.isNoteEditorVimEnabled()) {
      this._clearMainContextNoteListener(winState);
      return;
    }

    const noteWin = this._getActiveMainNoteEditorWindow(win);
    const noteDoc = noteWin?.document || null;
    if (noteWin === winState?._contextNoteEditorWin && noteDoc === winState?._contextNoteEditorDoc) return;

    this._clearMainContextNoteListener(winState);

    if (!noteWin || !winState) return;
    const handler = (event) => this._onMainContextNoteKeyDown(event, win, winState);
    try { noteWin.addEventListener('keydown', handler, true); } catch (_) { return; }
    try { noteDoc?.addEventListener('keydown', handler, true); } catch (_) {}
    winState._contextNoteEditorWin = noteWin;
    winState._contextNoteEditorDoc = noteDoc;
    winState._contextNoteEditorKeyHandler = handler;
    if (!winState._contextNoteMode) winState._contextNoteMode = 'normal';
    this._syncNoteCursorVisualState(noteDoc, winState._contextNoteMode || 'normal');
    this._mainShowStatus(win, '-- NOTE ' + String(winState._contextNoteMode || 'normal').toUpperCase() + ' --', 1200);
  },

  _onMainContextNoteKeyDown(event, win, winState) {
    if (!winState) return;
    if (!this.isNoteEditorVimEnabled()) return;
    const keyStr = this._keyString(event);
    if (!keyStr) return;

    const isCtrlH = keyStr === 'ctrl+h'
      || keyStr === 'ctrl+backspace'
      || ((event.ctrlKey || event.metaKey) && (event.key === 'h' || event.key === 'H' || event.code === 'KeyH'));

    if (isCtrlH) {
      this._clearMainContextNoteKeyState(winState);
      event.preventDefault();
      event.stopPropagation();
      void this._focusReaderContent(win);
      return;
    }

    if (keyStr === 'ctrl+l') {
      this._clearMainContextNoteKeyState(winState);
      event.preventDefault();
      event.stopPropagation();
      void this._focusContextNoteEditor(win);
      this._mainShowStatus(win, '▶ note', 700);
      return;
    }

    const mode = winState._contextNoteMode || 'normal';

    if (mode === 'insert') {
      if (keyStr === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        this._clearMainContextNoteKeyState(winState);
        winState._contextNoteMode = 'normal';
        this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'normal', event.target);
        this._mainShowStatus(win, '-- NOTE NORMAL --', 900);
      }
      return;
    }

    if (keyStr === 'i') {
      event.preventDefault();
      event.stopPropagation();
      this._clearMainContextNoteKeyState(winState);
      winState._contextNoteMode = 'insert';
      this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'insert', event.target);
      this._mainShowStatus(win, '-- NOTE INSERT --', 900);
      return;
    }

    if (keyStr === 'escape') {
      event.preventDefault();
      event.stopPropagation();
      this._clearMainContextNoteKeyState(winState);
      winState._contextNoteMode = 'normal';
      this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'normal', event.target);
      this._mainShowStatus(win, '-- NOTE NORMAL --', 700);
      return;
    }

    const handled = this._handleMainContextNoteNormalKey(event, keyStr, win, winState);
    if (handled) {
      if (String(winState._contextNoteMode || 'normal') === 'normal') {
        this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'normal', event.target);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // In note Normal mode, unbound keys should not be typed into the editor.
    event.preventDefault();
    event.stopPropagation();
  },

  _clearMainContextNoteKeyState(winState) {
    if (!winState) return;
    winState._contextNoteKeyBuffer = '';
    winState._contextNoteMainBuffer = '';
    winState._contextNoteCountBuffer = '';
    clearTimeout(winState._contextNoteKeyTimeout);
    winState._contextNoteKeyTimeout = null;
  },

  _syncNoteCursorVisualState(noteDoc, mode = 'normal', target = null) {
    const doc = noteDoc || target?.ownerDocument || null;
    if (!doc) return;
    this._ensureNoteCursorVisualStyle(doc);

    const html = doc.documentElement;
    if (!html) return;
    const normalClass = 'zv-note-normal-mode';
    const insertClass = 'zv-note-insert-mode';
    const isNormal = String(mode || 'normal') === 'normal';

    if (isNormal) {
      html.classList.add(normalClass);
      html.classList.remove(insertClass);
    } else {
      html.classList.remove(normalClass);
      html.classList.add(insertClass);
    }

    const editableEl = this._resolveEditableFromTarget(target)
      || this._resolveEditableFromTarget(doc.activeElement)
      || this._findEditableInDocument(doc);
    if (!editableEl) return;

    this._noteRestoreLineCaret(editableEl);
  },

  _ensureNoteCursorVisualStyle(doc) {
    try {
      if (!doc) return;
      let style = doc.getElementById('zv-note-caret-style');
      if (!style) {
        style = doc.createElement('style');
        style.id = 'zv-note-caret-style';
        (doc.head || doc.documentElement || doc.body)?.appendChild(style);
      }
      style.textContent = [
        'html.zv-note-normal-mode, html.zv-note-normal-mode body,',
        'html.zv-note-normal-mode [contenteditable="true"], html.zv-note-normal-mode textarea, html.zv-note-normal-mode input {',
        '  caret-color: rgb(96, 150, 255) !important;',
        '  caret-animation: auto !important;',
        '}',
        'html.zv-note-insert-mode, html.zv-note-insert-mode body,',
        'html.zv-note-insert-mode [contenteditable="true"], html.zv-note-insert-mode textarea, html.zv-note-insert-mode input {',
        '  caret-color: rgb(255, 148, 77) !important;',
        '  caret-animation: auto !important;',
        '}',
        '@media (prefers-color-scheme: dark) {',
        '  html.zv-note-normal-mode, html.zv-note-normal-mode body,',
        '  html.zv-note-normal-mode [contenteditable="true"], html.zv-note-normal-mode textarea, html.zv-note-normal-mode input {',
        '    caret-color: rgb(180, 206, 255) !important;',
        '  }',
        '  html.zv-note-insert-mode, html.zv-note-insert-mode body,',
        '  html.zv-note-insert-mode [contenteditable="true"], html.zv-note-insert-mode textarea, html.zv-note-insert-mode input {',
        '    caret-color: rgb(255, 176, 118) !important;',
        '  }',
        '}',
      ].join('\n');
    } catch (_) {}
  },

  _findEditableInDocument(doc) {
    if (!doc) return null;
    try {
      const active = doc.activeElement;
      if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return active;
    } catch (_) {}
    try {
      return doc.querySelector?.('[contenteditable="true"], .ProseMirror, .editor-core, .editor') || null;
    } catch (_) {
      return null;
    }
  },

  _noteRestoreLineCaret(editableEl) {
    const doc = editableEl?.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel) return false;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      if (!sel.rangeCount) {
        sel.selectAllChildren(editableEl);
        sel.collapseToEnd();
        return true;
      }
      if (!sel.isCollapsed) sel.collapseToStart();
      return true;
    } catch (_) {
      return false;
    }
  },

  _handleMainBindingsInNoteNormal(keyStr, win, winState) {
    if (!winState || !keyStr) return false;

    const bindings = this.getBindings();
    const modePrefix = 'main:';
    const mainBuffer = String(winState._contextNoteMainBuffer || '');

    // Keep Shift+J/K global tab switching available in note Normal mode.
    if (!mainBuffer && (keyStr === 'J' || keyStr === 'K')) {
      const action = bindings[modePrefix + keyStr];
      if (action === 'mainPrevTab' || action === 'mainNextTab') {
        this._clearMainContextNoteKeyState(winState);
        this._executeMainAction(action, win, winState, 1);
        return true;
      }
    }

    // Bridge <space> leader bindings from main mode while focus is in note editor.
    if (mainBuffer || keyStr === ' ') {
      const candidate = mainBuffer + keyStr;
      const possible = Object.keys(bindings).filter((k) => this._bindingMatchesPrefix(k, modePrefix, candidate));
      const exact = bindings[modePrefix + candidate];

      if (possible.length === 0 && !exact) {
        this._clearMainContextNoteKeyState(winState);
        return true;
      }

      if (!exact) {
        winState._contextNoteMainBuffer = candidate;
        clearTimeout(winState._contextNoteKeyTimeout);
        winState._contextNoteKeyTimeout = setTimeout(() => this._clearMainContextNoteKeyState(winState), 1200);
        return true;
      }

      this._clearMainContextNoteKeyState(winState);
      this._executeMainAction(exact, win, winState, 1);
      return true;
    }

    return false;
  },

  _handleMainContextNoteNormalKey(event, keyStr, win, winState) {
    const editableEl = this._resolveEditableFromTarget(event.target);
    if (!editableEl) {
      this._clearMainContextNoteKeyState(winState);
      return false;
    }

    this._noteNormalizeCaretForNormalOps(editableEl);

    if (this._handleMainBindingsInNoteNormal(keyStr, win, winState)) {
      return true;
    }

    if (/^\d$/.test(keyStr) && (keyStr !== '0' || winState._contextNoteCountBuffer)) {
      winState._contextNoteCountBuffer = (winState._contextNoteCountBuffer || '') + keyStr;
      clearTimeout(winState._contextNoteKeyTimeout);
      winState._contextNoteKeyTimeout = setTimeout(() => this._clearMainContextNoteKeyState(winState), 1200);
      return true;
    }

    const newBuffer = (winState._contextNoteKeyBuffer || '') + keyStr;
    const command = this._matchMainContextNoteCommand(newBuffer, keyStr);

    if (command === 'pending') {
      winState._contextNoteKeyBuffer = newBuffer;
      clearTimeout(winState._contextNoteKeyTimeout);
      winState._contextNoteKeyTimeout = setTimeout(() => this._clearMainContextNoteKeyState(winState), 1200);
      return true;
    }

    if (!command) {
      this._clearMainContextNoteKeyState(winState);
      const fallback = this._matchMainContextNoteCommand(keyStr, keyStr);
      if (!fallback || fallback === 'pending') return false;
      return this._executeMainContextNoteCommand(editableEl, fallback, 1, win, winState);
    }

    const count = parseInt(winState._contextNoteCountBuffer || '0', 10) || 1;
    this._clearMainContextNoteKeyState(winState);
    return this._executeMainContextNoteCommand(editableEl, command, count, win, winState);
  },

  _matchMainContextNoteCommand(buffer, keyStr) {
    if (buffer === 'g') return 'pending';
    if (buffer === 'd') return 'pending';
    if (buffer === 'y') return 'pending';
    if (buffer === 'c') return 'pending';
    if (buffer === 'di' || buffer === 'yi' || buffer === 'ci') return 'pending';
    if (buffer === 'diw' || buffer === 'yiw' || buffer === 'ciw') return buffer;

    const opMotions = new Set(['h', 'j', 'k', 'l', 'w', 'W', 'e', 'E', 'b', 'B', '0', '^', '$', 'G']);
    if (buffer.length === 2 && (buffer[0] === 'd' || buffer[0] === 'y' || buffer[0] === 'c') && opMotions.has(buffer[1])) {
      return buffer;
    }

    if (buffer === 'gg') return 'gg';
    if (buffer === 'dd') return 'dd';
    if (buffer === 'yy') return 'yy';
    if (['h', 'j', 'k', 'l', 'w', 'W', 'e', 'E', 'b', 'B', '0', '^', '$', 'G', 'x', 'a', 'A', 'I', 'o', 'O', 'p', 'P', 'u', 'ctrl+r'].includes(buffer)) return buffer;
    if (['h', 'j', 'k', 'l', 'w', 'W', 'e', 'E', 'b', 'B', '0', '^', '$', 'G', 'x', 'a', 'A', 'I', 'o', 'O', 'p', 'P', 'u', 'ctrl+r'].includes(keyStr)) return keyStr;
    return null;
  },

  _executeMainContextNoteCommand(editableEl, command, count, win, winState) {
    if (!editableEl) return false;

    if (/^[dyc][hjklwebWEB0\^\$G]$/.test(command)) {
      return this._noteOperateByMotion(editableEl, command[0], command[1], count, win, winState);
    }
    if (/^[dyc]iw$/.test(command)) {
      return this._noteOperateTextObject(editableEl, command[0], 'iw', count, win, winState);
    }

    switch (command) {
      case 'h':
      case 'j':
      case 'k':
      case 'l':
      case 'w':
      case 'W':
      case 'e':
      case 'E':
      case 'b':
      case 'B':
      case '0':
      case '^':
      case '$':
        return this._moveNoteCaretByKey(editableEl, command, count);
      case 'a':
      case 'A':
      case 'I':
      case 'o':
      case 'O': {
        const placement = command === 'a' ? 'append-char'
          : command === 'A' ? 'append-line'
            : command === 'I' ? 'insert-line-start'
              : command === 'o' ? 'open-below'
                : 'open-above';
        const switched = this._noteSwitchToInsert(editableEl, placement);
        if (switched) {
          winState._contextNoteMode = 'insert';
          this._syncNoteCursorVisualState(editableEl.ownerDocument || null, 'insert', editableEl);
          this._mainShowStatus(win, '-- NOTE INSERT --', 900);
        }
        return switched;
      }
      case 'gg':
        return this._noteGoToLine(editableEl, count);
      case 'G':
        return count > 1
          ? this._noteGoToLine(editableEl, count)
          : this._noteGoToLastLine(editableEl);
      case 'x':
        return this._noteDeleteChar(editableEl, count);
      case 'u':
        return this._noteUndoRedo(editableEl, false);
      case 'ctrl+r':
        return this._noteUndoRedo(editableEl, true);
      case 'p':
        return this._notePasteRegister(editableEl, winState, false);
      case 'P':
        return this._notePasteRegister(editableEl, winState, true);
      case 'dd': {
        const deletedText = this._noteDeleteLines(editableEl, count);
        if (deletedText) {
          winState._contextNoteLastYank = deletedText;
          this._mainShowStatus(win, '▶ dd', 700);
          return true;
        }
        return false;
      }
      case 'yy': {
        const yankedText = this._noteYankLines(editableEl, count);
        if (yankedText) {
          winState._contextNoteLastYank = yankedText;
          this._mainShowStatus(win, '✓ yy', 900);
          return true;
        }
        return false;
      }
      default:
        this._clearMainContextNoteKeyState(winState);
        return false;
    }
  },

  _moveNoteCaretByKey(editableEl, keyStr, count = 1) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify) return false;

    const map = {
      h: ['backward', 'character'],
      l: ['forward', 'character'],
      j: ['forward', 'line'],
      k: ['backward', 'line'],
      w: ['forward', 'word'],
      W: ['forward', 'word'],
      e: ['forward', 'word'],
      E: ['forward', 'word'],
      b: ['backward', 'word'],
      B: ['backward', 'word'],
      '0': ['backward', 'lineboundary'],
      '^': ['backward', 'lineboundary'],
      '$': ['forward', 'lineboundary'],
    };

    const spec = map[keyStr];
    if (!spec) return false;

    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }

    try {
      if (!sel.isCollapsed) sel.collapseToStart();
    } catch (_) {}

    try {
      const steps = Math.max(1, count || 1);
      const preserveLineStart = (keyStr === 'j' || keyStr === 'k')
        ? this._noteIsCaretAtLineStart(editableEl)
        : false;
      for (let i = 0; i < steps; i += 1) {
        sel.modify('move', spec[0], spec[1]);
        if (preserveLineStart && (keyStr === 'j' || keyStr === 'k')) {
          sel.modify('move', 'backward', 'lineboundary');
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteIsCaretAtLineStart(editableEl) {
    const doc = editableEl?.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify || !sel.rangeCount) return false;

    let bookmark = null;
    try {
      if (!sel.isCollapsed) sel.collapseToStart();
      bookmark = sel.getRangeAt(0).cloneRange();
      sel.modify('extend', 'backward', 'lineboundary');
      const atStart = sel.isCollapsed || String(sel.toString() || '').length === 0;
      sel.removeAllRanges();
      sel.addRange(bookmark);
      return atStart;
    } catch (_) {
      try {
        if (bookmark) {
          sel.removeAllRanges();
          sel.addRange(bookmark);
        }
      } catch (_) {}
      return false;
    }
  },

  _noteGoToLine(editableEl, lineNumber) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify) return false;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      sel.selectAllChildren(editableEl);
      sel.collapseToStart();
      const target = Math.max(1, lineNumber || 1);
      for (let i = 1; i < target; i += 1) {
        sel.modify('move', 'forward', 'line');
      }
      sel.modify('move', 'backward', 'lineboundary');
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteGoToLastLine(editableEl) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel) return false;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      sel.selectAllChildren(editableEl);
      sel.collapseToEnd();
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteDeleteChar(editableEl, count = 1) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify || !sel.deleteFromDocument) return false;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      if (sel.isCollapsed) {
        const steps = Math.max(1, count || 1);
        for (let i = 0; i < steps; i += 1) {
          sel.modify('extend', 'forward', 'character');
        }
      }
      sel.deleteFromDocument();
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteSelectRangeByMotion(editableEl, motion, count = 1) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify) return null;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }

    try {
      if (!sel.isCollapsed) sel.collapseToStart();
    } catch (_) {}

    try {
      const steps = Math.max(1, count || 1);
      if (motion === 'G') {
        for (let i = 0; i < steps; i += 1) {
          sel.modify('extend', 'forward', 'documentboundary');
        }
        return sel;
      }

      const map = {
        h: ['backward', 'character'],
        l: ['forward', 'character'],
        j: ['forward', 'line'],
        k: ['backward', 'line'],
        w: ['forward', 'word'],
        W: ['forward', 'word'],
        e: ['forward', 'word'],
        E: ['forward', 'word'],
        b: ['backward', 'word'],
        B: ['backward', 'word'],
        '0': ['backward', 'lineboundary'],
        '^': ['backward', 'lineboundary'],
        '$': ['forward', 'lineboundary'],
      };

      const spec = map[motion];
      if (!spec) return null;
      for (let i = 0; i < steps; i += 1) {
        sel.modify('extend', spec[0], spec[1]);
      }
      return sel;
    } catch (_) {
      return null;
    }
  },

  _noteOperateByMotion(editableEl, operator, motion, count, win, winState) {
    const sel = this._noteSelectRangeByMotion(editableEl, motion, count);
    if (!sel || sel.isCollapsed) return false;

    const text = String(sel.toString() || '');
    if (!text) return false;

    if (operator === 'y') {
      try {
        Components.classes['@mozilla.org/widget/clipboardhelper;1']
          .getService(Components.interfaces.nsIClipboardHelper)
          .copyString(text);
        if (winState) winState._contextNoteLastYank = text;
        try { sel.collapseToStart(); } catch (_) {}
        this._mainShowStatus(win, '✓ y' + motion, 900);
        return true;
      } catch (_) {
        return false;
      }
    }

    if (operator === 'd') {
      if (!sel.deleteFromDocument) return false;
      try {
        sel.deleteFromDocument();
        if (winState) winState._contextNoteLastYank = text;
        this._mainShowStatus(win, '▶ d' + motion, 800);
        return true;
      } catch (_) {
        return false;
      }
    }

    if (operator === 'c') {
      if (!sel.deleteFromDocument) return false;
      try {
        sel.deleteFromDocument();
        if (winState) winState._contextNoteLastYank = text;
        if (winState) winState._contextNoteMode = 'insert';
        this._mainShowStatus(win, '-- NOTE INSERT --', 900);
        return true;
      } catch (_) {
        return false;
      }
    }

    return false;
  },

  _noteSelectInnerWord(editableEl, count = 1) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify) return null;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      if (!sel.isCollapsed) sel.collapseToStart();
      sel.modify('move', 'backward', 'word');
      sel.modify('extend', 'forward', 'word');
      const steps = Math.max(1, count || 1);
      for (let i = 1; i < steps; i += 1) {
        sel.modify('extend', 'forward', 'word');
      }
      return sel;
    } catch (_) {
      return null;
    }
  },

  _noteNormalizeCaretForNormalOps(editableEl) {
    const doc = editableEl?.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel) return;
    try {
      if (!sel.rangeCount) {
        sel.selectAllChildren(editableEl);
        sel.collapseToStart();
        return;
      }
      if (!sel.isCollapsed) sel.collapseToStart();
    } catch (_) {}
  },

  _noteOperateTextObject(editableEl, operator, textObject, count, win, winState) {
    if (textObject !== 'iw') return false;
    const sel = this._noteSelectInnerWord(editableEl, count);
    if (!sel || sel.isCollapsed) return false;

    const text = String(sel.toString() || '');
    if (!text) return false;

    if (operator === 'y') {
      try {
        Components.classes['@mozilla.org/widget/clipboardhelper;1']
          .getService(Components.interfaces.nsIClipboardHelper)
          .copyString(text);
        if (winState) winState._contextNoteLastYank = text;
        try { sel.collapseToStart(); } catch (_) {}
        this._mainShowStatus(win, '✓ yiw', 900);
        return true;
      } catch (_) {
        return false;
      }
    }

    if (operator === 'd' || operator === 'c') {
      if (!sel.deleteFromDocument) return false;
      try {
        sel.deleteFromDocument();
        if (winState) winState._contextNoteLastYank = text;
        if (operator === 'c') {
          if (winState) winState._contextNoteMode = 'insert';
          this._mainShowStatus(win, '-- NOTE INSERT --', 900);
        } else {
          this._mainShowStatus(win, '▶ diw', 800);
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    return false;
  },

  _noteUndoRedo(editableEl, redo = false) {
    const doc = editableEl.ownerDocument;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }

    try {
      const cmd = redo ? 'redo' : 'undo';
      if (!doc.queryCommandSupported || doc.queryCommandSupported(cmd)) {
        if (doc.execCommand(cmd)) return true;
      }
    } catch (_) {}

    try {
      const winObj = doc.defaultView;
      if (!winObj || !winObj.KeyboardEvent) return false;
      const ev = new winObj.KeyboardEvent('keydown', {
        key: redo ? 'z' : 'z',
        ctrlKey: true,
        shiftKey: !!redo,
        bubbles: true,
        cancelable: true,
      });
      editableEl.dispatchEvent(ev);
      return true;
    } catch (_) {
      return false;
    }
  },

  _selectNoteLines(editableEl, count = 1) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify) return null;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      if (!sel.isCollapsed) sel.collapseToStart();
      sel.modify('move', 'backward', 'lineboundary');
      sel.modify('extend', 'forward', 'lineboundary');
      const steps = Math.max(1, count || 1);
      for (let i = 1; i < steps; i += 1) {
        sel.modify('extend', 'forward', 'line');
        sel.modify('extend', 'forward', 'lineboundary');
      }
      return sel;
    } catch (_) {
      return null;
    }
  },

  _noteDeleteLines(editableEl, count = 1) {
    const sel = this._selectNoteLines(editableEl, count);
    if (!sel || !sel.deleteFromDocument || sel.isCollapsed) return false;
    const text = String(sel.toString() || '');
    if (!text) return false;
    try {
      sel.deleteFromDocument();
      return text;
    } catch (_) {
      return '';
    }
  },

  _noteYankLines(editableEl, count = 1) {
    const sel = this._selectNoteLines(editableEl, count);
    if (!sel || sel.isCollapsed) return '';
    const text = String(sel.toString() || '');
    if (!text) return '';
    try {
      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper)
        .copyString(text);
      sel.collapseToStart();
      return text;
    } catch (_) {
      return '';
    }
  },

  _noteEnterInsertAt(editableEl, placement) {
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify) return false;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      if (!sel.isCollapsed) sel.collapseToEnd();
      if (placement === 'append-char') {
        sel.modify('move', 'forward', 'character');
      } else if (placement === 'append-line') {
        sel.modify('move', 'forward', 'lineboundary');
      } else if (placement === 'insert-line-start') {
        sel.modify('move', 'backward', 'lineboundary');
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteSwitchToInsert(editableEl, placement) {
    if (placement === 'open-below') return this._noteOpenLine(editableEl, false);
    if (placement === 'open-above') return this._noteOpenLine(editableEl, true);
    return this._noteEnterInsertAt(editableEl, placement);
  },

  _noteOpenLine(editableEl, above = false) {
    const doc = editableEl.ownerDocument;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }

    const tag = String(editableEl.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      return this._noteOpenLineInTextControl(editableEl, above);
    }

    if (editableEl.isContentEditable) {
      return this._noteOpenLineInContentEditable(editableEl, above);
    }

    const sel = doc?.getSelection?.();
    if (!sel || !sel.modify) return false;
    try {
      if (!sel.isCollapsed) sel.collapseToEnd();
      sel.modify('move', above ? 'backward' : 'forward', 'lineboundary');
      return this._noteInsertTextAtCaret(editableEl, '\n');
    } catch (_) {
      return false;
    }
  },

  _noteOpenLineInTextControl(editableEl, above = false) {
    try {
      const el = editableEl;
      const value = String(el.value || '');
      const caret = Number(el.selectionStart || 0);
      const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
      let lineEnd = value.indexOf('\n', caret);
      if (lineEnd < 0) lineEnd = value.length;

      const insertPos = above ? lineStart : lineEnd;
      el.value = value.slice(0, insertPos) + '\n' + value.slice(insertPos);

      const nextCaret = above ? insertPos : (insertPos + 1);
      el.selectionStart = nextCaret;
      el.selectionEnd = nextCaret;
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteOpenLineInContentEditable(editableEl, above = false) {
    const doc = editableEl?.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!doc || !sel) return false;

    try {
      const lineEl = this._noteGetTopLevelLineNode(editableEl, sel);
      const preferredTag = String(lineEl?.tagName || '').toUpperCase();
      const newLine = this._noteCreateEmptyLineElement(doc, preferredTag);

      if (lineEl && lineEl.parentNode === editableEl) {
        if (above) {
          editableEl.insertBefore(newLine, lineEl);
        } else {
          editableEl.insertBefore(newLine, lineEl.nextSibling);
        }
      } else if (above) {
        editableEl.insertBefore(newLine, editableEl.firstChild);
      } else {
        editableEl.appendChild(newLine);
      }

      const range = doc.createRange();
      range.selectNodeContents(newLine);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteGetTopLevelLineNode(editableEl, sel) {
    if (!editableEl || !sel) return null;

    let node = sel.focusNode || sel.anchorNode || null;
    if (node && node.nodeType !== 1) node = node.parentElement;

    while (node && node !== editableEl) {
      if (node.parentNode === editableEl) return node;
      node = node.parentNode;
    }

    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const container = range.startContainer;
      if (container === editableEl) {
        const offset = Math.max(0, Math.min(range.startOffset, editableEl.childNodes.length));
        if (offset < editableEl.childNodes.length) return editableEl.childNodes[offset];
        if (offset > 0) return editableEl.childNodes[offset - 1];
      }
    }

    return null;
  },

  _noteCreateEmptyLineElement(doc, preferredTag = '') {
    const allowedTags = new Set([
      'P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    ]);
    const tag = allowedTags.has(preferredTag) ? preferredTag.toLowerCase() : 'p';
    const newLine = doc.createElement(tag);
    newLine.appendChild(doc.createElement('br'));
    return newLine;
  },

  _noteInsertParagraphAtCaret(editableEl) {
    const doc = editableEl?.ownerDocument;
    if (!doc) return false;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }

    try {
      if (!doc.queryCommandSupported || doc.queryCommandSupported('insertParagraph')) {
        if (doc.execCommand('insertParagraph')) return true;
      }
    } catch (_) {}

    try {
      const winObj = doc.defaultView;
      if (!winObj || !winObj.KeyboardEvent) return false;
      const keyDown = new winObj.KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      const keyPress = new winObj.KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      const keyUp = new winObj.KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      editableEl.dispatchEvent(keyDown);
      editableEl.dispatchEvent(keyPress);
      editableEl.dispatchEvent(keyUp);
      return true;
    } catch (_) {
      return false;
    }
  },

  _notePasteRegister(editableEl, winState, before = false) {
    const text = String(winState?._contextNoteLastYank || '');
    if (!text) return false;
    if (!before) this._moveNoteCaretByKey(editableEl, 'l', 1);
    return this._noteInsertTextAtCaret(editableEl, text);
  },

  _noteInsertTextAtCaret(editableEl, text) {
    if (!editableEl || !text) return false;
    const tag = String(editableEl.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      try {
        const el = editableEl;
        const start = Number(el.selectionStart || 0);
        const end = Number(el.selectionEnd || start);
        const value = String(el.value || '');
        el.value = value.slice(0, start) + text + value.slice(end);
        const pos = start + text.length;
        el.selectionStart = pos;
        el.selectionEnd = pos;
        return true;
      } catch (_) {
        return false;
      }
    }

    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    if (!sel) return false;
    if (doc.activeElement !== editableEl) {
      try { editableEl.focus({ preventScroll: true }); } catch (_) { try { editableEl.focus(); } catch (_) {} }
    }
    try {
      if (sel.rangeCount === 0) {
        const r = doc.createRange();
        r.selectNodeContents(editableEl);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = doc.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (_) {
      return false;
    }
  },

  _resolveEditableFromTarget(target) {
    if (!target) return null;
    let el = target.nodeType === 1 ? target : target.parentElement;
    while (el) {
      if (el.isContentEditable) return el;
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return el;
      el = el.parentElement;
    }
    return null;
  },

  async _focusReaderContent(win) {
    try {
      const tabID = win?.Zotero_Tabs?.selectedID;
      const reader = tabID ? Zotero.Reader.getByTabID?.(tabID) : null;
      if (!reader) return false;
      const state = this._readerState.get(reader._instanceID)
        || this._readerStateByItemID.get(reader.itemID)
        || null;
      const targetWin = state?.activePdfWin || this._activeReaderPdfWin(reader, null);
      if (targetWin && this._focusReaderPdfWindow(targetWin, state)) {
        return true;
      }
      await reader.focus?.();
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _focusReaderContent error: ' + e);
      return false;
    }
  },

  _focusReaderPdfWindow(viewWin, state = null) {
    if (!viewWin) return false;

    try {
      if (state) state.activePdfWin = viewWin;
      viewWin.focus?.();

      const doc = viewWin.document;
      const focusTarget = doc?.querySelector?.([
        '#viewerContainer',
        '#viewer',
        '.pdfViewer',
        '.page[data-page-number]',
        '.textLayer',
        'body',
      ].join(','));

      focusTarget?.focus?.({ preventScroll: true });
      doc?.documentElement?.focus?.({ preventScroll: true });
      doc?.body?.focus?.({ preventScroll: true });
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _focusReaderPdfWindow error: ' + e);
      return false;
    }
  },

  async _focusContextNoteEditor(win) {
    try {
      const noteEditor = this._getActiveContextNoteEditor(win);
      if (noteEditor?.focus) {
        await noteEditor.focus();
        return true;
      }

      const noteWin = this._getActiveMainNoteEditorWindow(win);
      if (!noteWin) return false;
      noteWin.focus?.();
      const doc = noteWin.document;
      const target = doc?.querySelector?.('[contenteditable="true"], .ProseMirror, .editor, .editor-core, body') || doc?.body || null;
      target?.focus?.({ preventScroll: true });
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _focusContextNoteEditor error: ' + e);
      return false;
    }
  },

  async _openNoteInReaderContextPane(win, noteID) {
    try {
      const tabID = win?.Zotero_Tabs?.selectedID;
      const reader = tabID ? Zotero.Reader.getByTabID?.(tabID) : null;
      if (!reader || !noteID) return false;

      const noteItem = Zotero.Items.get(noteID);
      if (!noteItem?.isNote?.()) return false;

      const contextPane = win.ZoteroContextPane;
      const contextRoot = contextPane?.context;
      if (!contextPane || !contextRoot) return false;

      const attachment = Zotero.Items.get(reader.itemID);
      const libraryID = attachment?.libraryID || noteItem.libraryID;

      if (contextPane.collapsed) {
        contextPane.collapsed = false;
      }
      contextRoot.mode = 'notes';
      if (typeof contextRoot._selectNotesContext === 'function') {
        contextRoot._selectNotesContext(libraryID);
      }

      const notesContext = contextRoot._getNotesContext?.(libraryID)
        || contextRoot._getCurrentNotesContext?.();
      if (!notesContext || typeof notesContext._setPinnedNote !== 'function') return false;

      notesContext.updateNotesListFromCache?.();
      notesContext._setPinnedNote(noteItem);
      contextPane.updateAddToNote?.();
      const winState = this._mainWindowState.get(win);
      if (winState) this._syncMainContextNoteListener(win, winState);
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _openNoteInReaderContextPane error: ' + e);
      return false;
    }
  },

  _focusReaderSplit(state, reader, direction, pdfWin) {
    const ir = reader?._internalReader;
    const splitType = String(ir?.splitType || '');
    const mainWin = Zotero.getMainWindow?.() || null;
    const noteEditor = this._getActiveMainNoteEditorWindow(mainWin);
    if (!reader || !ir || !['vertical', 'horizontal'].includes(splitType)) {
      if (direction === 'right' && noteEditor) {
        void this._focusContextNoteEditor(mainWin);
        this._showStatus(state, '▶ note', 700);
        return;
      }
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
    else if (state.activePdfWin === secondaryWin) current = 'secondary';
    else if (state.activePdfWin === primaryWin) current = 'primary';

    if (direction === 'right' && splitType === 'vertical' && current === 'secondary' && noteEditor) {
      void this._focusContextNoteEditor(mainWin);
      this._showStatus(state, '▶ note', 700);
      return;
    }

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
      if (!this._focusReaderPdfWindow(targetWin, state)) {
        throw new Error('focus helper failed');
      }
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
        const firstPdf = atts[0];
        if (!firstPdf) { this._mainShowStatus(win, '✗ No PDF attachment'); return; }
        attID = firstPdf.id;
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
          this._postMainTabSwitchRecover(win);
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
          this._postMainTabSwitchRecover(win);
          return;
        }
      }

      tabs.selectedID = nextID;
      this._postMainTabSwitchRecover(win);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainCycleTab error: ' + e);
    }
  },

  _postMainTabSwitchRecover(win) {
    if (!win) return;

    const run = () => {
      try { this._rescanSelectedReader(win); } catch (_) {}
      try {
        const winState = this._mainWindowState.get(win);
        if (winState) this._syncMainContextNoteListener(win, winState);
      } catch (_) {}
      this._recoverMainTabFocusAfterSwitch(win);
    };

    // Tab content (especially large readers) may need multiple ticks to become focusable.
    setTimeout(run, 0);
    setTimeout(run, 60);
    setTimeout(run, 180);
    setTimeout(run, 420);
    setTimeout(run, 900);
  },

  _recoverMainTabFocusAfterSwitch(win) {
    void this._focusReaderContent(win)
      .then((focusedReader) => {
        if (focusedReader) return;
        if (this._isStandaloneNoteTabSelected(win)) return;

        const doc = win?.document;
        const active = doc?.activeElement;
        if (!active) return;

        const isSearchFocus = active.id === 'zotero-tb-search-input'
          || (typeof active.closest === 'function' && !!active.closest('#zotero-tb-search'))
          || (String(active.tagName || '').toUpperCase() === 'INPUT'
            && String(active.type || '').toLowerCase() === 'search')
          || String(active.localName || '').toLowerCase() === 'search';
        if (!isSearchFocus) return;

        const winState = this._mainWindowState.get(win);
        if (!winState) return;

        try { active.blur?.(); } catch (_) {}
        const panel = this._mainSyncFocusedPanel(win, winState);
        this._mainFocusPanel(win, winState, panel === 'collections' ? 'collections' : 'items');
      })
      .catch((e) => {
        Zotero.debug('[ZoteroVim] _recoverMainTabFocusAfterSwitch error: ' + e);
      });
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
    if (winState.notesLayoutOpen) this._closeMainNotesLayout(win, winState);
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
      : 'Ctrl+j/k navigate  ·  Enter select  ·  Ctrl+o open PDF  ·  y yank citation  ·  yy yank citekey  ·  Esc close';

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
    // The picker is also routed through a window-level capture listener
    // (registered in _injectIntoMainWindow) so that keys like Ctrl+j/k are
    // seen before any document-level handler could swallow them.  Guard
    // against the same event being processed twice.
    if (e._zvPickerHandled) return;
    try { e._zvPickerHandled = true; } catch (_) {}
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
    // Ctrl+o = open the PDF of the selected item (items scope only — in the
    // tab picker 'o' stays a hint letter).  A bare 'o' always types into the
    // search box so queries containing 'o' are unaffected.  _pickerSelectItem
    // selects the item and closes the picker; _mainOpenPDF then opens its PDF
    // attachment.
    if (e.ctrlKey && !e.altKey && !e.shiftKey && keyLower === 'o' && winState._pickerScope !== 'tabs') {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(winState._pickerYTimer);
      winState._pickerLastKey = null;
      this._pickerSelectItem(win, winState);
      this._mainOpenPDF(win, winState);
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
          this._postMainTabSwitchRecover(win);
          return;
        }
      }
      tabs.selectedID = tabID;
      this._postMainTabSwitchRecover(win);
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

  _toggleMainNotesLayout(win, winState) {
    if (winState.notesLayoutOpen) {
      this._closeMainNotesLayout(win, winState);
      return;
    }
    this._openMainNotesLayout(win, winState);
  },

  _onMainNotesKeyDown(e, win, winState) {
    if (!winState.notesLayoutOpen) return;
    const keyStr = this._keyString(e);
    const key = String(e.key || '');
    const focusPane = winState._notesFocusPane || 'list';

    if (focusPane === 'preview') {
      switch (keyStr) {
        case 'escape':
          e.preventDefault();
          e.stopPropagation();
          this._closeMainNotesLayout(win, winState);
          return;
        case 'n':
          e.preventDefault();
          e.stopPropagation();
          void this._mainNotesCreateAndOpen(win, winState, { usePreviousItem: true, openTarget: 'context' });
          return;
        case 'N':
          e.preventDefault();
          e.stopPropagation();
          void this._mainNotesCreateAndOpen(win, winState, { usePreviousItem: false, openTarget: 'tab' });
          return;
        case 'enter':
        case 'return':
          e.preventDefault();
          e.stopPropagation();
          void this._mainNotesOpenSelected(win, winState, { openTarget: e.shiftKey ? 'tab' : 'context' });
          return;
        case 'ctrl+h':
          e.preventDefault();
          e.stopPropagation();
          this._mainNotesSetFocusPane(winState, 'list');
          this._setMainNotesLayoutStatus(winState, 'Focus list');
          return;
        case 'j':
        case 'arrowdown':
          e.preventDefault();
          e.stopPropagation();
          this._mainNotesScrollPreview(winState, +90);
          return;
        case 'k':
        case 'arrowup':
          e.preventDefault();
          e.stopPropagation();
          this._mainNotesScrollPreview(winState, -90);
          return;
        case 'ctrl+d':
          e.preventDefault();
          e.stopPropagation();
          this._mainNotesScrollPreview(winState, this._mainNotesPreviewStep(winState));
          return;
        case 'ctrl+u':
          e.preventDefault();
          e.stopPropagation();
          this._mainNotesScrollPreview(winState, -this._mainNotesPreviewStep(winState));
          return;
        default:
          e.stopPropagation();
          return;
      }
    }

    if (keyStr === 'g') {
      e.preventDefault();
      e.stopPropagation();
      if (winState._notesCmdBuffer === 'g') {
        winState._notesSelected = 0;
        this._clearMainNotesCmdBuffer(winState, false);
        this._refreshMainNotesLayout(win, winState);
      } else {
        winState._notesCmdBuffer = 'g';
        clearTimeout(winState._notesCmdTimer);
        winState._notesCmdTimer = setTimeout(() => this._clearMainNotesCmdBuffer(winState), 700);
        this._setMainNotesLayoutStatus(winState, 'g ... (gg top)');
      }
      return;
    }

    // 'n' is a command key (create note), not a hint key.
    if (keyStr === 'n') {
      e.preventDefault();
      e.stopPropagation();
      void this._mainNotesCreateAndOpen(win, winState, { usePreviousItem: true, openTarget: 'context' });
      return;
    }

    const hintKey = this._mainNotesHintKey(e);
    if (hintKey) {
      e.preventDefault();
      e.stopPropagation();
      this._mainNotesSelectByHint(winState, hintKey);
      return;
    }

    switch (keyStr) {
      case 'escape':
        e.preventDefault();
        e.stopPropagation();
        this._closeMainNotesLayout(win, winState);
        return;
      case 'j':
      case 'arrowdown':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesMoveSelection(win, winState, +1, 1);
        return;
      case 'k':
      case 'arrowup':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesMoveSelection(win, winState, -1, 1);
        return;
      case 'h':
      case 'ctrl+h':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesSetFocusPane(winState, 'list');
        this._setMainNotesLayoutStatus(winState, 'Focus list');
        return;
      case 'ctrl+l':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesSetFocusPane(winState, 'preview');
        this._setMainNotesLayoutStatus(winState, 'Focus preview');
        return;
      case 'ctrl+j':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesSwitchSection(win, winState, 'all');
        return;
      case 'ctrl+k':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesSwitchSection(win, winState, 'current');
        return;
      case 'j':
      case 'arrowdown':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesMoveSelection(win, winState, +1, 1);
        return;
      case 'k':
      case 'arrowup':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesMoveSelection(win, winState, -1, 1);
        return;
      case 'ctrl+d':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesMoveSelection(win, winState, +1, this._mainNotesFastStep(winState));
        return;
      case 'ctrl+u':
        e.preventDefault();
        e.stopPropagation();
        this._mainNotesMoveSelection(win, winState, -1, this._mainNotesFastStep(winState));
        return;
      case 'G':
        e.preventDefault();
        e.stopPropagation();
        winState._notesSelected = Math.max(0, (winState._notesNavRows || []).length - 1);
        this._clearMainNotesCmdBuffer(winState, false);
        this._refreshMainNotesLayout(win, winState);
        return;
      case 'enter':
      case 'return':
        e.preventDefault();
        e.stopPropagation();
        void this._mainNotesOpenSelected(win, winState, { openTarget: e.shiftKey ? 'tab' : 'context' });
        return;
      case 'N':
        e.preventDefault();
        e.stopPropagation();
        void this._mainNotesCreateAndOpen(win, winState, { usePreviousItem: false, openTarget: 'tab' });
        return;
      default:
        this._clearMainNotesHintBuffer(winState, false);
        this._clearMainNotesCmdBuffer(winState, false);
        e.stopPropagation();
    }
  },

  async _mainNotesCreateAndOpen(win, winState, opts = null) {
    try {
      const usePreviousItem = !!opts?.usePreviousItem;
      const openTarget = (opts?.openTarget === 'tab') ? 'tab' : 'context';
      const createdNoteID = usePreviousItem
        ? await this._createMainPreviousChildNote(win, winState)
        : await this._createMainCurrentChildNote(win);
      if (!createdNoteID) return;

      if (openTarget === 'context' && await this._openNoteInReaderContextPane(win, createdNoteID)) {
        this._closeMainNotesLayout(win, winState);
        this._mainShowStatus(win, '✓ new child note', 1200);
        return;
      }

      await this._openNoteByTarget(win, createdNoteID, { openInWindow: false });
      this._closeMainNotesLayout(win, winState);
      this._mainShowStatus(win, '✓ new child note', 1200);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainNotesCreateAndOpen error: ' + e);
      this._mainShowStatus(win, '✗ create note failed');
    }
  },

  async _openMainNotesLayout(win, winState) {
    if (!winState || winState.notesLayoutOpen) return;
    this._closeFuzzyPicker(win, winState);

    const doc = win.document;
    const root = doc.body || doc.documentElement;
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);

    const overlay = h('div');
    overlay.id = 'zv-notes-layout-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.62);z-index:99999;' +
      'display:flex;align-items:center;justify-content:center;padding:4vh 4vw;';

    const modal = h('div');
    modal.style.cssText =
      'width:min(1100px, 92vw);height:min(760px, 88vh);background:#10141b;color:#e8edf5;' +
      'border:1px solid #2b3442;border-radius:10px;overflow:hidden;' +
      'display:flex;flex-direction:column;box-shadow:0 22px 72px rgba(0,0,0,0.62);' +
      'font:13px/1.45 monospace;';

    const header = h('div');
    header.style.cssText =
      'padding:10px 14px;background:#16202d;border-bottom:1px solid #2b3442;' +
      'display:flex;justify-content:space-between;align-items:center;gap:10px;';
    const title = h('div');
    title.textContent = 'Notes Layout';
    title.style.cssText = 'font-weight:700;letter-spacing:0.2px;';
    const hint = h('div');
    hint.textContent = 'j/k move  ·  Ctrl+d/u fast  ·  Ctrl+j/k section  ·  Ctrl+h/l list/preview  ·  n/N new  ·  Enter/Shift+Enter open';
    hint.style.cssText = 'font-size:11px;color:#9db0c9;';
    header.appendChild(title);
    header.appendChild(hint);

    const body = h('div');
    body.style.cssText = 'display:grid;grid-template-columns:minmax(320px, 38%) 1fr;min-height:0;';

    const listPane = h('div');
    listPane.style.cssText =
      'display:grid;grid-template-rows:auto minmax(0,1fr) auto minmax(0,1fr);' +
      'min-height:0;border-right:1px solid #2b3442;background:#0f141d;';

    const currentWrap = h('section');
    currentWrap.style.cssText = 'display:contents;';
    const currentHead = h('div');
    currentHead.textContent = 'Current item notes';
    currentHead.style.cssText =
      'padding:8px 12px;background:#121a25;color:#7db1ff;font-weight:700;' +
      'border-bottom:1px solid #2b3442;';
    const currentList = h('div');
    currentList.style.cssText = 'overflow:auto;padding:8px 8px 10px 8px;';

    const allWrap = h('section');
    allWrap.style.cssText = 'display:contents;';
    const allHead = h('div');
    allHead.textContent = 'All notes in library';
    allHead.style.cssText =
      'padding:8px 12px;background:#121a25;color:#8fd4aa;font-weight:700;' +
      'border-top:1px solid #2b3442;border-bottom:1px solid #2b3442;';
    const allList = h('div');
    allList.style.cssText = 'overflow:auto;padding:8px 8px 10px 8px;';

    const previewPane = h('div');
    previewPane.style.cssText = 'overflow:auto;padding:14px 16px 16px 16px;background:#111825;';

    currentWrap.appendChild(currentHead);
    currentWrap.appendChild(currentList);
    allWrap.appendChild(allHead);
    allWrap.appendChild(allList);
    listPane.appendChild(currentWrap);
    listPane.appendChild(allWrap);

    body.appendChild(listPane);
    body.appendChild(previewPane);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) this._closeMainNotesLayout(win, winState);
    });

    winState.notesLayoutOpen = true;
    winState._notesOverlay = overlay;
    winState._notesStatusEl = hint;
    winState._notesListPane = listPane;
    winState._notesPreviewPane = previewPane;
    winState._notesFocusPane = 'list';
    winState._notesCurrentList = currentList;
    winState._notesAllList = allList;
    winState._notesCurrentRows = [];
    winState._notesAllRows = [];
    winState._notesNavRows = [];
    winState._notesSelected = 0;
    this._clearMainNotesHintBuffer(winState, false);
    this._clearMainNotesCmdBuffer(winState, false);
    this._mainNotesSetFocusPane(winState, 'list');

    this._renderMainNotesSection(currentList, [{
      title: 'Loading current item notes...',
      text: '',
      meta: '',
    }], { loading: true });
    this._renderMainNotesSection(allList, [{
      title: 'Loading all notes...',
      text: '',
      meta: '',
    }], { loading: true });
    this._renderMainNotesPreview(winState._notesPreviewPane, null, {
      loading: true,
      message: 'Loading note preview...',
    });

    try { overlay.focus?.(); } catch (_) {}

    try {
      const payload = await this._collectMainNotesRows(win);
      if (!winState.notesLayoutOpen) return;
      winState._notesCurrentRows = Array.from(payload.current || []);
      winState._notesAllRows = Array.from(payload.all || []);
      this._refreshMainNotesLayout(win, winState);
      if (payload.filteredMachineCount > 0) {
        this._mainShowStatus(win, '→ hidden ' + payload.filteredMachineCount + ' machine notes', 1800);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _openMainNotesLayout error: ' + e);
      if (!winState.notesLayoutOpen) return;
      winState._notesCurrentRows = [];
      winState._notesAllRows = [];
      this._renderMainNotesSection(currentList, [], {
        emptyMessage: 'Failed to load current item notes.',
      });
      this._renderMainNotesSection(allList, [], {
        emptyMessage: 'Failed to load library notes.',
      });
      this._renderMainNotesPreview(winState._notesPreviewPane, null, {
        message: 'Failed to load note preview.',
      });
      this._mainShowStatus(win, '✗ failed to load notes');
    }
  },

  _notesLayoutHintAlphabet() {
    return this._readerOutlineExplorerHintAlphabet();
  },

  _buildMainNotesHints(count) {
    const alphabet = this._notesLayoutHintAlphabet();
    const base = alphabet.length;
    if (count <= base) return alphabet.slice(0, count).split('');
    const hints = [];
    for (let i = 0; i < count; i++) {
      const first = Math.floor(i / base);
      const second = i % base;
      hints.push(alphabet[first] + alphabet[second]);
    }
    return hints;
  },

  _mainNotesHintKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return '';
    const key = String(event.key || '').toLowerCase();
    return this._notesLayoutHintAlphabet().includes(key) ? key : '';
  },

  _setMainNotesLayoutStatus(winState, text = null) {
    if (!winState?._notesStatusEl) return;
    winState._notesStatusEl.textContent = text ||
      'j/k move  ·  Ctrl+d/u fast  ·  Ctrl+j/k section  ·  Ctrl+h/l list/preview  ·  n/N new  ·  Enter/Shift+Enter open';
  },

  _mainNotesSetFocusPane(winState, pane) {
    const focusPane = pane === 'preview' ? 'preview' : 'list';
    winState._notesFocusPane = focusPane;
    const listPane = winState._notesListPane;
    const previewPane = winState._notesPreviewPane;
    if (listPane) {
      listPane.style.boxShadow = focusPane === 'list' ? 'inset 0 0 0 1px rgba(98,156,236,0.75)' : 'none';
    }
    if (previewPane) {
      previewPane.style.boxShadow = focusPane === 'preview' ? 'inset 0 0 0 1px rgba(98,156,236,0.75)' : 'none';
    }
  },

  _mainNotesPreviewStep(winState) {
    const el = winState?._notesPreviewPane;
    if (!el) return 240;
    return Math.max(120, Math.floor((el.clientHeight || 480) * 0.55));
  },

  _mainNotesScrollPreview(winState, delta) {
    const el = winState?._notesPreviewPane;
    if (!el || !delta) return;
    try { el.scrollBy({ top: delta, behavior: 'auto' }); } catch (_) { el.scrollTop += delta; }
  },

  _clearMainNotesHintBuffer(winState, resetStatus = true) {
    winState._notesHintBuffer = '';
    clearTimeout(winState._notesHintTimer);
    winState._notesHintTimer = null;
    if (resetStatus) this._setMainNotesLayoutStatus(winState, null);
  },

  _clearMainNotesCmdBuffer(winState, resetStatus = true) {
    winState._notesCmdBuffer = '';
    clearTimeout(winState._notesCmdTimer);
    winState._notesCmdTimer = null;
    if (resetStatus && !winState._notesHintBuffer) this._setMainNotesLayoutStatus(winState, null);
  },

  _refreshMainNotesLayout(win, winState) {
    const currentRows = Array.from(winState._notesCurrentRows || []);
    const allRows = Array.from(winState._notesAllRows || []);
    const navRows = [];
    for (const row of currentRows) navRows.push({ section: 'current', row });
    for (const row of allRows) navRows.push({ section: 'all', row });
    winState._notesNavRows = navRows;
    if (!navRows.length) {
      winState._notesSelected = 0;
      this._renderMainNotesSection(winState._notesCurrentList, currentRows, {
        emptyMessage: 'No notes under current item.',
      });
      this._renderMainNotesSection(winState._notesAllList, allRows, {
        emptyMessage: 'No notes found in library.',
      });
      this._renderMainNotesPreview(winState._notesPreviewPane, null, {
        message: 'No note selected.',
      });
      return;
    }

    winState._notesSelected = Math.max(0, Math.min(winState._notesSelected || 0, navRows.length - 1));
    const hints = this._buildMainNotesHints(navRows.length);
    const hintByID = new Map();
    const selectedID = navRows[winState._notesSelected]?.row?.id;
    const selectedEntry = navRows[winState._notesSelected] || null;

    for (let i = 0; i < navRows.length; i++) {
      const id = navRows[i]?.row?.id;
      if (!id) continue;
      hintByID.set(id, hints[i] || '');
    }

    this._renderMainNotesSection(winState._notesCurrentList, currentRows, {
      emptyMessage: 'No notes under current item.',
      selectedID,
      hintByID,
      onPick: (rowID) => {
        const idx = navRows.findIndex(entry => entry.row?.id === rowID);
        if (idx >= 0) {
          winState._notesSelected = idx;
          this._refreshMainNotesLayout(win, winState);
        }
      },
      onOpen: async (rowID) => {
        const idx = navRows.findIndex(entry => entry.row?.id === rowID);
        if (idx >= 0) winState._notesSelected = idx;
        await this._mainNotesOpenSelected(win, winState);
      },
    });

    this._renderMainNotesSection(winState._notesAllList, allRows, {
      emptyMessage: 'No notes found in library.',
      selectedID,
      hintByID,
      onPick: (rowID) => {
        const idx = navRows.findIndex(entry => entry.row?.id === rowID);
        if (idx >= 0) {
          winState._notesSelected = idx;
          this._refreshMainNotesLayout(win, winState);
        }
      },
      onOpen: async (rowID) => {
        const idx = navRows.findIndex(entry => entry.row?.id === rowID);
        if (idx >= 0) winState._notesSelected = idx;
        await this._mainNotesOpenSelected(win, winState);
      },
    });

    this._renderMainNotesPreview(winState._notesPreviewPane, selectedEntry, null);
  },

  _mainNotesMoveSelection(win, winState, direction, step) {
    const rows = winState._notesNavRows || [];
    if (!rows.length) return;
    this._clearMainNotesHintBuffer(winState, false);
    this._clearMainNotesCmdBuffer(winState, false);
    const delta = Math.max(1, step || 1) * (direction >= 0 ? 1 : -1);
    winState._notesSelected = Math.max(0, Math.min(rows.length - 1, winState._notesSelected + delta));
    this._refreshMainNotesLayout(win, winState);
  },

  _mainNotesSwitchSection(win, winState, section) {
    const rows = winState._notesNavRows || [];
    if (!rows.length) return;
    this._clearMainNotesHintBuffer(winState, false);
    this._clearMainNotesCmdBuffer(winState, false);

    const current = rows[winState._notesSelected];
    if (current?.section === section) return;

    const targetRows = rows.filter(r => r.section === section);
    if (!targetRows.length) return;

    const sameSectionRows = rows.filter(r => r.section === (current?.section || 'current'));
    const localIndex = Math.max(0, sameSectionRows.findIndex(r => r.row?.id === current?.row?.id));
    const target = targetRows[Math.min(localIndex, targetRows.length - 1)];
    const nextIndex = rows.findIndex(r => r.row?.id === target.row?.id);
    if (nextIndex >= 0) {
      winState._notesSelected = nextIndex;
      this._mainNotesSetFocusPane(winState, 'list');
      this._refreshMainNotesLayout(win, winState);
    }
  },

  _mainNotesFastStep(winState) {
    const total = (winState._notesNavRows || []).length;
    return Math.max(5, Math.floor(total / 10) || 10);
  },

  _mainNotesSelectByHint(winState, key) {
    const rows = winState._notesNavRows || [];
    if (!rows.length) return;

    const hints = this._buildMainNotesHints(rows.length);
    const buffer = (winState._notesHintBuffer || '') + String(key || '').toLowerCase();
    const matches = hints
      .map((hint, idx) => ({ hint, idx }))
      .filter(({ hint }) => hint && hint.startsWith(buffer));

    if (!matches.length) {
      this._clearMainNotesHintBuffer(winState, false);
      this._setMainNotesLayoutStatus(winState, 'Hint not found');
      return;
    }

    winState._notesHintBuffer = buffer;
    clearTimeout(winState._notesHintTimer);
    winState._notesHintTimer = setTimeout(() => this._clearMainNotesHintBuffer(winState), 1200);

    const exact = matches.find(v => v.hint === buffer);
    if (exact) {
      winState._notesSelected = exact.idx;
      this._clearMainNotesHintBuffer(winState, false);
      this._setMainNotesLayoutStatus(winState, 'Selected ' + exact.hint + '  ·  Enter open');
    } else {
      this._setMainNotesLayoutStatus(winState, 'Hint: ' + buffer);
    }
  },

  async _mainNotesOpenSelected(win, winState, opts = null) {
    const rows = winState._notesNavRows || [];
    if (!rows.length) return;
    const selected = rows[winState._notesSelected]?.row;
    const noteID = selected?.id;
    if (!noteID) return;
    const openTarget = (opts?.openTarget === 'tab') ? 'tab' : 'context';

    try {
      if (openTarget === 'context' && await this._openNoteInReaderContextPane(win, noteID)) {
        this._closeMainNotesLayout(win, winState);
        return;
      }

      await this._openNoteByTarget(win, noteID, { openInWindow: false });
      this._closeMainNotesLayout(win, winState);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _mainNotesOpenSelected error: ' + e);
      this._mainShowStatus(win, '✗ open note failed');
    }
  },

  async _openNoteByTarget(win, noteID, opts = null) {
    try {
      const openInWindow = !!opts?.openInWindow;
      try { await win?.ZoteroPane?.selectItem?.(noteID); } catch (_) {}
      if (typeof win?.ZoteroPane?.openNote === 'function') {
        await win.ZoteroPane.openNote(noteID, { openInWindow: !!openInWindow });
      } else {
        await Zotero.Notes.open(noteID, null, { openInWindow: !!openInWindow });
      }
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _openNoteByTarget error: ' + e);
      throw e;
    }
  },

  _getMainCurrentBaseItem(win) {
    const selected = Array.from(win?.ZoteroPane?.getSelectedItems?.() || []);
    let currentBaseItem = selected[0] || null;
    if (currentBaseItem?.isAttachment?.() && currentBaseItem.parentItemID) {
      currentBaseItem = Zotero.Items.get(currentBaseItem.parentItemID) || currentBaseItem;
    }
    return currentBaseItem || null;
  },

  async _createMainCurrentChildNote(win) {
    const currentBaseItem = this._getMainCurrentBaseItem(win);
    if (!currentBaseItem) {
      this._mainShowStatus(win, '✗ no current item selected');
      return null;
    }

    if (currentBaseItem?.isNote?.()) {
      this._mainShowStatus(win, '✗ select a parent item to create child note');
      return null;
    }

    if (currentBaseItem?.isAttachment?.()) {
      this._mainShowStatus(win, '✗ select a parent item to create child note');
      return null;
    }

    try {
      const note = new Zotero.Item('note');
      note.libraryID = currentBaseItem.libraryID || Zotero.Libraries.userLibraryID;
      note.parentID = currentBaseItem.id;
      note.setNote('<p></p>');
      await note.saveTx();
      return note.id || null;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _createMainCurrentChildNote error: ' + e);
      this._mainShowStatus(win, '✗ create note failed');
      return null;
    }
  },

  _getMainNotesSelectedBaseItem(winState) {
    try {
      const rows = winState?._notesNavRows || [];
      const selected = rows[winState?._notesSelected]?.row;
      const noteID = selected?.id;
      if (!noteID) return null;
      const note = Zotero.Items.get(noteID);
      if (!note?.isNote?.()) return null;
      let baseItem = note.parentID ? Zotero.Items.get(note.parentID) : null;
      if (baseItem?.isAttachment?.() && baseItem.parentItemID) {
        baseItem = Zotero.Items.get(baseItem.parentItemID) || baseItem;
      }
      return baseItem || null;
    } catch (_) {
      return null;
    }
  },

  async _createMainPreviousChildNote(win, winState) {
    const previousBaseItem = this._getMainNotesSelectedBaseItem(winState);
    if (!previousBaseItem) {
      this._mainShowStatus(win, '✗ no previous item from selected note');
      return null;
    }

    if (previousBaseItem?.isNote?.() || previousBaseItem?.isAttachment?.()) {
      this._mainShowStatus(win, '✗ selected note has no valid parent item');
      return null;
    }

    try {
      const note = new Zotero.Item('note');
      note.libraryID = previousBaseItem.libraryID || Zotero.Libraries.userLibraryID;
      note.parentID = previousBaseItem.id;
      note.setNote('<p></p>');
      await note.saveTx();
      return note.id || null;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _createMainPreviousChildNote error: ' + e);
      this._mainShowStatus(win, '✗ create note failed');
      return null;
    }
  },

  async _collectMainNotesRows(win) {
    const rowsFromNotes = (notes, label = '', opts = null) => {
      const out = [];
      let filteredMachineCount = 0;
      for (const note of notes) {
        if (!note?.isNote?.()) continue;
        const noteHTML = String(note.getNote?.() || '');
        const noteText = this._extractNotePlainText(win.document, noteHTML);
        const title = (note.getDisplayTitle?.() || note.getNoteTitle?.() || note.getField?.('title') || '').trim() || 'Untitled note';
        const tags = Array.from(note.getTags?.() || []).map(t => String(t?.tag || '')).filter(Boolean);
        if (opts?.hideMachineRecords && this._shouldHideInAllNotes(note, title, noteText, noteHTML, tags)) {
          filteredMachineCount++;
          continue;
        }
        out.push({
          id: note.id,
          title,
          text: noteText || '(empty)',
          meta: label || (tags.length ? ('tags: ' + tags.slice(0, 4).join(', ')) : ''),
          dateModified: String(note.dateModified || ''),
        });
      }
      return { rows: out, filteredMachineCount };
    };

    const currentBaseItem = this._getMainCurrentBaseItem(win);

    let currentNotes = [];
    if (currentBaseItem?.isNote?.()) {
      currentNotes = [currentBaseItem];
    } else if (currentBaseItem?.getNotes) {
      currentNotes = Array.from(currentBaseItem.getNotes() || [])
        .map(id => Zotero.Items.get(id))
        .filter(Boolean);
    }

    const currentLabel = currentBaseItem
      ? ((currentBaseItem.getDisplayTitle?.() || currentBaseItem.getField?.('title') || '').trim() || 'Current item')
      : '';
    const currentRows = rowsFromNotes(currentNotes, currentLabel ? ('from: ' + currentLabel) : '').rows;

    const libID = Zotero.Libraries.userLibraryID;
    await Zotero.Schema.schemaUpdatePromise;
    const s = new Zotero.Search();
    s.libraryID = libID;
    s.addCondition('itemType', 'is', 'note');
    const noteIDs = await s.search();
    const allNotes = Zotero.Items.get(noteIDs).filter(item => item?.isNote?.() && !item.deleted);
    const allNoteRows = rowsFromNotes(allNotes, '', { hideMachineRecords: true });
    const allRows = allNoteRows.rows
      .sort((a, b) => (Date.parse(b.dateModified) || 0) - (Date.parse(a.dateModified) || 0))
      .slice(0, 400);

    return { current: currentRows, all: allRows, filteredMachineCount: allNoteRows.filteredMachineCount || 0 };
  },

  _isMachineRecordNote(title, text) {
    const t = String(title || '').trim();
    const s = String(text || '').trim();
    const combined = (t + ' ' + s).trim();
    if (!combined) return true;

    const hasLetterOrCJK = /[A-Za-z\u4E00-\u9FFF]/.test(combined);
    const compact = combined.replace(/\s+/g, '');
    const noiseOnly = compact.replace(/[0-9:\-/.TZ+_#@,;|()[\]{}]/g, '');
    if (!hasLetterOrCJK && compact.length > 0 && noiseOnly.length <= 2) return true;

    const shortText = s.length <= 120;
    const tsOnly = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)
      || /^\d{10,13}$/.test(s)
      || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(s);
    if (shortText && tsOnly) return true;

    const keyValueLines = s.split(/\n+/).map(v => v.trim()).filter(Boolean);
    if (keyValueLines.length > 0 && keyValueLines.length <= 4) {
      const metaKey = /^(timestamp|time|created|updated|modified|date|last\s*sync|synced|epoch|mtime|ctime)\s*[:=]/i;
      const allMetaKV = keyValueLines.every(line => {
        if (!metaKey.test(line)) return false;
        const value = line.replace(/^[^:=]+[:=]\s*/, '');
        return value.length > 0 && value.length <= 60;
      });
      if (allMetaKV) return true;
    }

    const looksLikeLogTitle = /^(timestamp|time\s*record|sync\s*record|machine\s*record|auto\s*record)$/i.test(t);
    if (looksLikeLogTitle && shortText) return true;

    return false;
  },

  _looksLikeMachineJSON(text) {
    const s = String(text || '').trim();
    if (!s || s.length > 2000) return false;
    if (!((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')))) return false;
    try {
      const obj = JSON.parse(s);
      const machineKeys = [
        'readingtime', 'reading_time', 'readtime', 'duration', 'elapsed',
        'timestamp', 'startedat', 'endedat', 'updatedat', 'lastread', 'last_read',
        'heartbeat', 'session', 'progress', 'percent', 'source', 'plugin', 'meta',
      ];
      const scan = (value, depth = 0) => {
        if (depth > 3 || value == null) return { keys: 0, machine: 0 };
        if (Array.isArray(value)) {
          return value.slice(0, 20).reduce((acc, it) => {
            const r = scan(it, depth + 1);
            acc.keys += r.keys;
            acc.machine += r.machine;
            return acc;
          }, { keys: 0, machine: 0 });
        }
        if (typeof value === 'object') {
          const keys = Object.keys(value);
          let machine = 0;
          for (const k of keys) {
            const key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (machineKeys.some(m => key.includes(m))) machine++;
          }
          const nested = keys.slice(0, 20).reduce((acc, k) => {
            const r = scan(value[k], depth + 1);
            acc.keys += r.keys;
            acc.machine += r.machine;
            return acc;
          }, { keys: 0, machine: 0 });
          return { keys: keys.length + nested.keys, machine: machine + nested.machine };
        }
        return { keys: 0, machine: 0 };
      };
      const stat = scan(obj, 0);
      return stat.keys > 0 && (stat.machine / stat.keys) >= 0.35;
    } catch (_) {
      return false;
    }
  },

  _shouldHideInAllNotes(note, title, text, html, tags = null) {
    if (note?.deleted) return true;

    const t = String(title || '').trim();
    const body = String(text || '').trim();
    const raw = (String(html || '') + '\n' + t + '\n' + body).toLowerCase();
    const tagList = Array.isArray(tags)
      ? tags
      : Array.from(note?.getTags?.() || []).map(x => String(x?.tag || '')).filter(Boolean);
    const tagsLower = tagList.map(v => v.toLowerCase());

    const readingTimePattern = /(reading\s*time|readingtime|read\s*time|readtime|zotero-reading-time)/i;
    const tagHasReadingTime = tagsLower.some(tag => readingTimePattern.test(tag));
    const titleHasReadingTime = readingTimePattern.test(t);
    const bodyHasReadingTime = readingTimePattern.test(body.slice(0, 500));
    if ((tagHasReadingTime || titleHasReadingTime || bodyHasReadingTime) && body.length < 4000) {
      return true;
    }

    if (this._looksLikeMachineJSON(body)) return true;

    if (/<div[^>]+data-schema-version=/i.test(html || '') && !/[\u4E00-\u9FFFA-Za-z]{8,}/.test(body)) {
      return true;
    }

    if (this._isMachineRecordNote(t, body)) return true;

    const machineTagPattern = /(timestamp|timelog|time-log|sync-log|heartbeat|machine|auto[-_ ]?record|cache|state)/i;
    const nonEmptyTags = tagsLower.filter(Boolean);
    if (nonEmptyTags.length > 0 && nonEmptyTags.every(tag => machineTagPattern.test(tag)) && body.length < 800) {
      return true;
    }

    if (!note?.parentID && body.length <= 40 && /^\d{10,13}$/.test(body)) return true;

    return false;
  },

  _extractNotePlainText(doc, html) {
    try {
      const container = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      container.innerHTML = String(html || '');
      return String(container.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (_) {
      return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  },

  _renderMainNotesSection(container, rows, opts = null) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    const doc = container.ownerDocument;
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);

    if (opts?.loading) {
      const loading = h('div');
      loading.style.cssText = 'padding:10px;color:#93a6bd;';
      loading.textContent = rows?.[0]?.title || 'Loading...';
      container.appendChild(loading);
      return;
    }

    if (!rows?.length) {
      const empty = h('div');
      empty.style.cssText = 'padding:10px;color:#93a6bd;';
      empty.textContent = opts?.emptyMessage || 'No notes.';
      container.appendChild(empty);
      return;
    }

    const frag = doc.createDocumentFragment();
    for (const row of rows) {
      const card = h('article');
      const isSelected = opts?.selectedID && row.id === opts.selectedID;
      const hint = opts?.hintByID?.get?.(row.id) || '';
      card.style.cssText =
        'border:1px solid ' + (isSelected ? '#5f93da' : '#293240') + ';' +
        'background:' + (isSelected ? '#152236' : '#0f151f') + ';border-radius:6px;' +
        'padding:6px 8px;margin:0 0 6px 0;';
      card.tabIndex = -1;
      card.dataset.noteId = String(row.id || '');

      const t = h('div');
      t.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:700;color:#d7e5f8;';
      if (hint) {
        const badge = h('span');
        badge.style.cssText =
          'display:inline-block;min-width:20px;padding:0 5px;border-radius:4px;' +
          'border:1px solid #43617f;color:#9ec5ff;font-size:11px;line-height:1.6;text-align:center;';
        badge.textContent = hint;
        t.appendChild(badge);
      }
      const titleText = h('span');
      titleText.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      titleText.textContent = row.title || 'Untitled note';
      t.appendChild(titleText);

      card.appendChild(t);
      card.addEventListener('click', () => {
        if (typeof opts?.onPick === 'function') opts.onPick(row.id);
      });
      card.addEventListener('dblclick', () => {
        if (typeof opts?.onOpen === 'function') void opts.onOpen(row.id);
      });
      frag.appendChild(card);
    }
    container.appendChild(frag);

    if (opts?.selectedID) {
      const selectedEl = container.querySelector('article[data-note-id="' + opts.selectedID + '"]');
      selectedEl?.scrollIntoView?.({ block: 'nearest' });
    }
  },

  _renderMainNotesPreview(container, selectedEntry, opts = null) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    const doc = container.ownerDocument;
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);

    if (opts?.loading) {
      const loading = h('div');
      loading.style.cssText = 'padding:12px;color:#93a6bd;';
      loading.textContent = opts.message || 'Loading preview...';
      container.appendChild(loading);
      return;
    }

    const row = selectedEntry?.row || null;
    if (!row) {
      const empty = h('div');
      empty.style.cssText = 'padding:12px;color:#93a6bd;';
      empty.textContent = opts?.message || 'No note selected.';
      container.appendChild(empty);
      return;
    }

    const section = h('div');
    section.style.cssText =
      'display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;' +
      'border:1px solid #314860;color:#9ec5ff;background:#121f2f;margin-bottom:10px;';
    section.textContent = selectedEntry.section === 'current' ? 'Current item note' : 'All notes';

    const title = h('h3');
    title.style.cssText = 'margin:0 0 8px 0;font-size:18px;line-height:1.35;color:#e8edf5;';
    title.textContent = row.title || 'Untitled note';

    const meta = h('div');
    meta.style.cssText = 'font-size:12px;color:#8ea4bf;margin-bottom:12px;';
    meta.textContent = row.meta || '';

    const body = h('div');
    body.style.cssText =
      'white-space:pre-wrap;color:#c8d6e8;line-height:1.6;background:#0f151f;' +
      'border:1px solid #293240;border-radius:8px;padding:12px 14px;min-height:120px;';
    body.textContent = row.text || '(empty)';

    container.appendChild(section);
    container.appendChild(title);
    if (meta.textContent) container.appendChild(meta);
    container.appendChild(body);
  },

  _closeMainNotesLayout(win, winState) {
    if (!winState?.notesLayoutOpen) return;
    winState.notesLayoutOpen = false;
    this._clearMainNotesHintBuffer(winState, false);
    this._clearMainNotesCmdBuffer(winState, false);
    try {
      const overlay = winState._notesOverlay;
      if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
    } catch (_) {}
    winState._notesOverlay = null;
    winState._notesStatusEl = null;
    winState._notesListPane = null;
    winState._notesPreviewPane = null;
    winState._notesFocusPane = 'list';
    winState._notesCurrentList = null;
    winState._notesAllList = null;
    winState._notesCurrentRows = [];
    winState._notesAllRows = [];
    winState._notesNavRows = [];
    winState._notesSelected = 0;
  },
});

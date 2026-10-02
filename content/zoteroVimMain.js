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
      _pickerPrevFocus: null,      // element focused before the picker opened
      _pickerPrevFocusWin: null,   // innermost focused window (e.g. PDF iframe)
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
      _contextNoteEditorInputHandler: null,
      _contextNoteConsumedInput: null,
      _contextNoteKeyHandling: false,
      _contextNoteLineNumbers: null,
      _contextNoteMode: 'normal',
      _contextNoteKeyBuffer: '',
      _contextNoteMainBuffer: '',
      _contextNoteCountBuffer: '',
      _contextNoteOperatorCountBuffer: '',
      _contextNoteKeyTimeout: null,
      _contextNoteLastYank: '',
      _contextNoteRegisterType: 'character',
      _contextNoteLastFind: null,
      _contextNoteSearch: null,
      _contextNoteSearchUI: null,
      _contextNotePendingUI: null,
      _contextNoteVisual: null,
      _contextNoteLastVisual: null,
      executeAction: null,  // set below
      cleanup: () => {},
    };
    mainWinState.executeAction = (action, count) =>
      this._executeMainAction(action, win, mainWinState, count);
    this._mainWindowState.set(win, mainWinState);
    this._initNoteDiagnostics?.(win, mainWinState);

    const readerScanHandler = () => {
      this._rescanSelectedReader(win);
      this._syncMainContextNoteListener(win, mainWinState);
    };
    readerScanHandler();
    const readerScanTimer = win.setInterval(readerScanHandler, 1000);
    // Startup burst: catch readers restored during Zotero initialization as
    // soon as their tabs exist, before the 1 s interval ticks.
    for (let i = 1; i <= 4; i++) {
      win.setTimeout(readerScanHandler, i * 250);
    }

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
      this._clearNoteDiagnostics?.(mainWinState);
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
    if (e._zvNoteEditorCommand) return;
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
    // The editor's original event handles tab switching in Normal mode;
    // forwarded copies must not execute it again (issue #6).
    const active = win?.document?.activeElement;
    const noteTabSelected = this._isStandaloneNoteTabSelected(win);
    const noteVimEnabled = this.isNoteEditorVimEnabled();
    if (noteTabSelected && !noteVimEnabled) {
      // Disabling note Vim must leave native note keys alone, including while
      // its iframe is loading. Explicit library/search focus still works.
      if (!active || /^(browser|iframe)$/i.test(active.localName || active.tagName || '')
          || this._isMainNoteTextEditing(win, e)) return;
    }
    if (noteVimEnabled && noteTabSelected) {
      const noteMode = String(winState?._contextNoteMode || 'normal');

      // Gecko can capture the ORIGINAL content event here before it reaches
      // the note iframe. Let that iframe handle it instead of stopping the
      // event in chrome. Forwarded chrome copies must never run a motion.
      this._syncMainContextNoteListener(win, winState);
      const noteWin = winState?._contextNoteEditorWin || null;
      const eventWin = e.view || e.target?.ownerDocument?.defaultView || null;
      const hasDirectNoteAPI = typeof Zotero.Notes?.getByTabID === 'function';
      if (noteWin && (eventWin === noteWin
          || (winState._contextNoteEditorDoc
            && e.target?.ownerDocument === winState._contextNoteEditorDoc))) return;
      if (!noteWin && !hasDirectNoteAPI) {
        this._onMainContextNoteKeyDown(e, win, winState);
      }
      if (!e.defaultPrevented && noteMode !== 'insert' && !winState._contextNoteSearchUI) {
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

    // A note iframe is not an editable element in the chrome document.
    // Protect every native note key, not just J/K, even with note Vim disabled.
    if (this._isMainNoteTextEditing(win, e)) return;

    const keyStr = this._keyString(e);
    if (!keyStr) return;

    // Keep tab cycling responsive even when a heavy reader tab is still loading.
    // In that phase focus is often on <browser> and normal reader listeners are not ready.
    const bindings = this.getBindings();
    const modePrefix = 'main:';
    const directAction = bindings[modePrefix + keyStr];
    if (directAction === 'mainPrevTab' || directAction === 'mainNextTab') {
      // Skip tab switching while the user is actually editing text — the
      // side-panel note editor, Zotero's annotation-comment popup, or this
      // plugin's own comment overlay all report <browser> as the main
      // window's activeElement, so the input check above does not catch them.
      if (this._isMainTextEditing(win, winState)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      this._executeMainAction(directAction, win, winState, 1);
      return;
    }

    // Focus is on an embedded browser element (PDF reader tab content).
    // Restored readers keep focus here after a restart, so route the key
    // into the reader instead of dropping it.
    if (active && active.localName === 'browser') {
      this._forwardReaderKey(e, win);
      return;
    }

    // Selected tab is a reader tab — forward the key to the reader rather
    // than dropping it (main-window bindings are for the library pane).
    try {
      const tabID = win.Zotero_Tabs?.selectedID;
      if (tabID && Zotero.Reader.getByTabID?.(tabID)) {
        this._forwardReaderKey(e, win);
        return;
      }
    } catch (_) {}

    // Count prefix digits — only when no chord prefix is pending, so that
    // bindings like `main:t1` can extend `t` with a digit (issue #3).
    if (
      !winState.keyBuffer &&
      /^\d$/.test(keyStr) &&
      (keyStr !== '0' || winState.countBuffer)
    ) {
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

  /**
   * Detect native note focus independently of the optional Vim listener.
   * Iframes retain their activeElement after focus returns to the library, so
   * require the original event, Gecko focus, or the main document's focus chain.
   */
  _isMainNoteTextEditing(win, event = null) {
    try {
      const isEditing = frameWin => {
        const doc = frameWin?.document;
        return !!doc && (this._isEditableElement(doc.activeElement)
          || String(doc.designMode || '').toLowerCase() === 'on');
      };
      const noteWin = this._getActiveMainNoteEditorWindow(win);
      const noteDoc = noteWin?.document;
      if (noteDoc && isEditing(noteWin)) {
        if (event?.target?.ownerDocument === noteDoc || event?.view === noteWin) return true;
        if (Services.focus?.focusedWindow === noteWin) return true;
      }
      // Older library note editors may not be exposed by ZoteroContextPane.
      const eventWin = event?.target?.ownerDocument?.defaultView || event?.view;
      if (this._isLikelyMainNoteEditorWindow(eventWin, win) && isEditing(eventWin)) return true;

      // The chrome activeElement may be a browser/iframe wrapper, with another
      // wrapper inside it. Do not confuse an unfocused side-panel editor with
      // the currently focused collection tree.
      let active = win?.document?.activeElement;
      for (let depth = 0; active && depth < 10; depth += 1) {
        if (active.shadowRoot?.activeElement) {
          active = active.shadowRoot.activeElement;
          continue;
        }
        const frameWin = active.contentWindow;
        if (!frameWin) break;
        if ((frameWin === noteWin || this._isLikelyMainNoteEditorWindow(frameWin, win))
            && isEditing(frameWin)) return true;
        active = frameWin.document?.activeElement;
      }
    } catch (_) {}
    return false;
  },

  /**
   * True when the user is actually editing text somewhere the keystroke should
   * reach the editor rather than trigger a main-mode binding.  Covers the
   * side-panel / standalone note editor and the PDF reader's annotation-
   * comment editor (native textarea or this plugin's overlay).
   *
   * Without this guard the unconditional main:J / main:K fallback at the top
   * of _onMainKeyDown swallows the keystroke and switches tabs even though
   * the activeElement is a <browser> wrapper — see issue #5.  The check is
   * driven by DOM focus (input / textarea / contenteditable) rather than by
   * `_contextNoteMode === 'insert'` alone, because clicking directly into a
   * native editor does not flip the plugin's tracked mode.
   */
  _isMainTextEditing(win, winState) {
    if (!win || !winState) return false;
    // (a) Plugin-tracked insert mode in the note editor.
    if (this.isNoteEditorVimEnabled() && winState._contextNoteMode === 'insert') return true;
    if (this._isMainNoteTextEditing(win)) return true;
    // (b) Native focus on an editable inside the context note editor
    //     (side panel) — even when mode is still 'normal' the user is typing.
    try {
      const noteDoc = winState._contextNoteEditorDoc;
      const active = noteDoc?.activeElement;
      if (active && this._isEditableElement(active)) return true;
    } catch (_) {}
    // (c) Native focus on an editable inside the PDF reader — annotation
    //     comment popup, this plugin's overlay, or the reader's find bar.
    //     Both the reader.html iframe (annotation popups) and the PDF.js
    //     iframe (plugin's overlay textarea lives there) are checked, since
    //     the user-facing `activeElement` lives in only one of them.
    try {
      const tabID = win.Zotero_Tabs?.selectedID;
      const reader = tabID && Zotero.Reader.getByTabID?.(tabID);
      if (!reader) return false;
      if (this._nativeEditableFocused(reader)) return true;
      const rState = this._readerState.get(reader._instanceID);
      const pdfWin = rState?.activePdfWin
        || reader?._internalReader?._primaryView?._iframeWindow
        || reader?._internalReader?._secondaryView?._iframeWindow
        || null;
      if (pdfWin) {
        const pdfActive = pdfWin.document?.activeElement;
        if (pdfActive && this._isEditableElement(pdfActive)) return true;
      }
    } catch (_) {}
    return false;
  },

  _isEditableElement(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
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

    // Colored-tag shortcuts (t1..t9 toggle position N, t0 clears all).
    // Routed before the switch so the ten actions share one implementation.
    const coloredTagMatch = /^mainColoredTag([1-9])$/.exec(action);
    if (coloredTagMatch) {
      this._mainToggleColoredTag(win, winState, Number(coloredTagMatch[1]));
      return;
    }
    if (action === 'mainColoredTagClear') {
      this._mainToggleColoredTag(win, winState, 0);
      return;
    }

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

  /**
   * Toggle a Zotero colored tag on the items currently selected in the
   * items pane, mirroring the native Digit1..Digit9 / Digit0 behaviour
   * (see Zotero's items pane shortcut handler).  `number` is 1..9 for
   * toggling a colored-tag position, or 0 to clear every colored tag.
   *
   * Only fires in the items pane; collections-tree selections are not
   * valid targets and the user is shown a status message instead.  Mixed-
   * library selections are also rejected because colored tags are
   * library-scoped and applying different keys would be ambiguous.
   */
  async _mainToggleColoredTag(win, winState, number) {
    try {
      this._mainSyncFocusedPanel(win, winState);
      if (winState.activePanelFocus !== 'items') {
        this._mainShowStatus(win, '✗ colored tags only work in items pane', 1500);
        return;
      }

      const itemsView = win.ZoteroPane?.itemsView;
      const items = itemsView?.getSelectedItems?.() || [];
      if (!items.length) {
        this._mainShowStatus(win, '✗ no items selected', 1500);
        return;
      }

      const libraryIDs = new Set(items.map(i => i.libraryID).filter(Boolean));
      if (libraryIDs.size > 1) {
        this._mainShowStatus(win, '✗ mixed-library selection not supported', 1800);
        return;
      }
      const libraryID = items[0].libraryID;

      if (number === 0) {
        await Zotero.Tags.removeColoredTagsFromItems(items);
        this._mainShowStatus(win, '✓ colored tags cleared', 1200);
        return;
      }

      const colorData = Zotero.Tags.getColorByPosition(libraryID, number - 1);
      if (!colorData) {
        this._mainShowStatus(win, `✗ no colored tag at position ${number}`, 1800);
        return;
      }

      // Match Zotero's native toggle: if any selected item already has the
      // tag, remove it from all; otherwise add it to all.
      const tagRemove = items.some(item => item.hasTag(colorData.name));
      await Zotero.DB.executeTransaction(async () => {
        Zotero.UndoHistory.stageAction(
          tagRemove ? 'undo-action-remove-tag' : 'undo-action-add-tag',
          { count: items.length }
        );
        for (const item of items) {
          if (tagRemove) item.removeTag(colorData.name);
          else item.addTag(colorData.name);
          await item.save();
        }
      });
      this._mainShowStatus(
        win,
        `✓ ${tagRemove ? 'removed' : 'added'} tag: ${colorData.name}`,
        1500
      );
    } catch (err) {
      Zotero.debug('[ZoteroVim] colored tag action failed: ' + err, 1);
      this._mainShowStatus(win, '✗ colored tag action failed', 1800);
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
      const selectedType = String(win?.Zotero_Tabs?.selectedType || '').toLowerCase();
      if (selectedType) return /^note(?:-|$)/.test(selectedType);

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
      if (!maybeNoteTab) return null;

      // Zotero 10 exposes the selected note tab's EditorInstance directly.
      // Its _iframeWindow is the window that owns the original keydown and
      // therefore the only place where preventDefault() can suppress text
      // insertion reliably. Keep the DOM scan below for older Zotero builds.
      const tabID = win?.Zotero_Tabs?.selectedID || tab?.id || tab?.tabID || null;
      const getEditorByTabID = Zotero.Notes?.getByTabID;
      if (typeof getEditorByTabID === 'function') {
        const editorInstance = tabID
          ? getEditorByTabID.call(Zotero.Notes, tabID)
          : null;
        const editorWin = editorInstance?._iframeWindow || null;
        if (this._isLikelyMainNoteEditorWindow(editorWin, win)) {
          return editorWin;
        }
        // The selected note may still be loading. Do not attach to another
        // visible note editor while Zotero's direct lookup is authoritative.
        return null;
      }

      const focusedWin = Services.focus?.focusedWindow || null;
      if (this._isLikelyMainNoteEditorWindow(focusedWin, win)) {
        return focusedWin;
      }

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
      // A selected note tab must win over the context-pane editor. Otherwise
      // the listener can be installed into a different note iframe while the
      // main-window bridge still executes motions in the selected tab.
      if (this._isStandaloneNoteTabSelected(win)) {
        return this._getActiveStandaloneNoteEditorWindow(win);
      }

      const libraryWin = this._getActiveLibraryNoteEditorWindow(win);
      if (libraryWin) return libraryWin;
      const contextEditor = this._getActiveContextNoteEditor(win);
      const contextWin = this._getContextNoteEditorWindow(contextEditor);
      if (this._isLikelyMainNoteEditorWindow(contextWin, win)) return contextWin;
      return null;
    } catch (_) {
      return null;
    }
  },

  /** The library's item-pane note editor is separate from ZoteroContextPane. */
  _getActiveLibraryNoteEditorWindow(win) {
    try {
      if (win?.Zotero_Tabs?.selectedType !== 'library') return null;
      const doc = win.document;
      const pane = win.ZoteroPane?.itemPane || doc?.getElementById?.('zotero-item-pane');
      const noteMode = pane?.mode === 'note';
      if (pane?.mode && !noteMode) return null;
      const editor = doc?.getElementById?.('zotero-note-editor');
      if (!editor || editor.hidden
          || editor.closest?.('[hidden]:not([hidden="false"]), [collapsed="true"]')) return null;
      const noteWin = this._getContextNoteEditorWindow(editor);
      if (!this._isLikelyMainNoteEditorWindow(noteWin, win)) return null;
      // Older builds may not expose itemPane.mode. Require real focus then,
      // rather than binding an editor left hidden behind the library deck.
      if (noteMode || Services.focus?.focusedWindow === noteWin
          || doc.activeElement?.contentWindow === noteWin) return noteWin;
    } catch (_) {}
    return null;
  },

  _getContextNoteEditorWindow(noteEditor) {
    try {
      return noteEditor?._iframe?.contentWindow || noteEditor?._editorInstance?._iframeWindow || null;
    } catch (_) {
      return null;
    }
  },

  _clearMainContextNoteListener(winState) {
    this._noteCloseSearch(winState);
    if (winState) {
      if (winState._contextNoteVisual) winState._contextNoteMode = 'normal';
      winState._contextNoteVisual = null;
      winState._contextNoteLastVisual = null;
      winState._contextNoteLastFind = null;
      winState._contextNoteSearch = null;
    }
    this._clearNoteLineNumbers(winState);
    this._clearMainContextNoteKeyState(winState);
    const noteWin = winState?._contextNoteEditorWin;
    const noteDoc = winState?._contextNoteEditorDoc;
    const handler = winState?._contextNoteEditorKeyHandler;
    const inputHandler = winState?._contextNoteEditorInputHandler;
    try { noteDoc?.documentElement?.classList.remove('zv-note-visual-mode'); } catch (_) {}
    if (noteWin && handler) {
      try { noteWin.removeEventListener('keydown', handler, true); } catch (_) {}
    }
    if (noteDoc && handler) {
      try { noteDoc.removeEventListener('keydown', handler, true); } catch (_) {}
    }
    for (const target of [noteWin, noteDoc]) {
      if (!target || !inputHandler) continue;
      for (const type of ['keypress', 'beforeinput', 'keyup', 'blur']) {
        try { target.removeEventListener(type, inputHandler, true); } catch (_) {}
      }
    }
    if (winState) {
      winState._contextNoteEditorWin = null;
      winState._contextNoteEditorDoc = null;
      winState._contextNoteEditorKeyHandler = null;
      winState._contextNoteEditorInputHandler = null;
      winState._contextNoteConsumedInput = null;
    }
  },

  _syncMainContextNoteListener(win, winState) {
    // Diagnostic observers must precede Vim's capture listener and also work
    // with note Vim disabled. They have their own independent cleanup.
    this._syncNoteDiagnosticsEditor?.(win, winState,
      this._getActiveMainNoteEditorWindow(win));
    if (!this.isNoteEditorVimEnabled()) {
      this._clearMainContextNoteListener(winState);
      return;
    }

    const noteWin = this._getActiveMainNoteEditorWindow(win);
    const noteDoc = noteWin?.document || null;
    if (noteWin === winState?._contextNoteEditorWin && noteDoc === winState?._contextNoteEditorDoc) {
      this._syncNoteLineNumbers(winState);
      return;
    }

    this._clearMainContextNoteListener(winState);

    if (!noteWin || !winState) return;
    const handler = (event) => this._onMainContextNoteKeyDown(event, win, winState);
    try { noteWin.addEventListener('keydown', handler, true); } catch (_) { return; }
    try { noteDoc?.addEventListener('keydown', handler, true); } catch (_) {}
    const inputHandler = event => this._onMainContextNoteInput(event, winState);
    for (const target of [noteWin, noteDoc]) {
      if (!target) continue;
      for (const type of ['keypress', 'beforeinput', 'keyup', 'blur']) {
        try { target.addEventListener(type, inputHandler, true); } catch (_) {}
      }
    }
    winState._contextNoteEditorWin = noteWin;
    winState._contextNoteEditorDoc = noteDoc;
    winState._contextNoteEditorKeyHandler = handler;
    winState._contextNoteEditorInputHandler = inputHandler;
    if (!winState._contextNoteMode) winState._contextNoteMode = 'normal';
    this._syncNoteCursorVisualState(noteDoc, winState._contextNoteMode || 'normal');
    this._syncNoteLineNumbers(winState);
    this._mainShowStatus(win, '-- NOTE ' + String(winState._contextNoteMode || 'normal').toUpperCase() + ' --', 1200);
  },

  _onMainContextNoteKeyDown(event, win, winState) {
    if (!winState) return;
    if (!this.isNoteEditorVimEnabled()) return;
    if (event._zvNoteEditorCommand) return;
    // The same handler is installed on both the note window and its document
    // as a capture listener. stopImmediatePropagation() covers handled keys,
    // but insert-mode passthrough returns without stopping propagation; this
    // guard keeps that second invocation from becoming observable if the
    // handler ever does work in that branch.
    if (event._zvContextNoteHandled) return;
    try { event._zvContextNoteHandled = true; } catch (_) {}
    // Keep consumption until keyup or the next real keydown, including when
    // i/a/o/c changes the mode before macOS dispatches its character events.
    winState._contextNoteConsumedInput = null;
    const wasHandling = winState._contextNoteKeyHandling;
    winState._contextNoteKeyHandling = true;
    try {
      this._handleMainContextNoteKeyDown(event, win, winState);
    } finally {
      winState._contextNoteKeyHandling = wasHandling;
      if (event.defaultPrevented) {
        winState._contextNoteConsumedInput = {
          key: event.key, code: event.code, doc: event.target?.ownerDocument,
        };
      }
    }
  },

  /** Block native character input, not Vim's own synchronous editing commands. */
  _onMainContextNoteInput(event, winState) {
    if (!winState || event._zvNoteEditorCommand) return;
    const consumed = winState._contextNoteConsumedInput;
    if (event.type === 'blur' || event.type === 'keyup') {
      if (event.type === 'blur' || (consumed && (consumed.code && event.code
          ? event.code === consumed.code : event.key === consumed.key))) {
        winState._contextNoteConsumedInput = null;
      }
      return;
    }
    if (!this.isNoteEditorVimEnabled() || winState._contextNoteKeyHandling
        || event.isTrusted === false || event.cancelable === false) return;
    const target = event.target;
    const doc = target?.ownerDocument;
    if (!doc || doc !== winState._contextNoteEditorDoc) return;
    let consumedInput = consumed?.doc === doc;
    if (consumedInput && event.type === 'keypress') {
      consumedInput = consumed.code && event.code
        ? consumed.code === event.code : consumed.key === event.key;
    }
    if (!consumedInput) {
      if (winState._contextNoteMode === 'insert' || winState._contextNoteSearchUI) return;
      // Toolbars and the search input live in the same iframe, but are not
      // managed note text. Do not intercept their native input.
      const editable = doc.querySelector?.('.ProseMirror');
      if (editable ? target !== editable && !editable.contains?.(target)
        : !this._isEditableElement(target)) return;
      if (/^(format|history)/.test(event.inputType || '')) return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  },

  _handleMainContextNoteKeyDown(event, win, winState) {
    if (winState._contextNoteSearchUI) {
      this._noteSearchKeyDown(event, win, winState);
      return;
    }
    const keyStr = this._keyString(event);
    if (!keyStr) return;
    const mode = winState._contextNoteMode || 'normal';
    if (event.isComposing && mode === 'insert') return;

    const isCtrlH = keyStr === 'ctrl+h'
      || (mode !== 'insert' && keyStr === 'ctrl+backspace')
      || ((event.ctrlKey || event.metaKey) && (event.key === 'h' || event.key === 'H' || event.code === 'KeyH'));

    if (isCtrlH) {
      this._clearMainContextNoteKeyState(winState);
      event.preventDefault();
      event.stopImmediatePropagation();
      void this._focusReaderContent(win);
      return;
    }

    if (keyStr === 'ctrl+l') {
      this._clearMainContextNoteKeyState(winState);
      event.preventDefault();
      event.stopImmediatePropagation();
      void this._focusContextNoteEditor(win);
      this._mainShowStatus(win, '▶ note', 700);
      return;
    }

    if (mode === 'insert') {
      if (keyStr === 'escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._clearMainContextNoteKeyState(winState);
        winState._contextNoteMode = 'normal';
        this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'normal', event.target);
        this._mainShowStatus(win, '-- NOTE NORMAL --', 900);
      }
      return;
    }

    // Normal mode consumes every key. Cancel the original editor event before
    // changing the selection so ProseMirror cannot turn a motion into text if
    // command execution or cursor synchronisation later fails.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (mode === 'visual' || mode === 'visual-line') {
      this._handleNoteVisualKey(event, keyStr, win, winState);
      return;
    }

    if (keyStr === 'i' && !winState._contextNoteKeyBuffer
        && !winState._contextNoteMainBuffer) {
      this._clearMainContextNoteKeyState(winState);
      winState._contextNoteMode = 'insert';
      this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'insert', event.target);
      this._mainShowStatus(win, '-- NOTE INSERT --', 900);
      return;
    }

    if (keyStr === 'escape') {
      this._clearMainContextNoteKeyState(winState);
      winState._contextNoteMode = 'normal';
      this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'normal', event.target);
      this._mainShowStatus(win, '-- NOTE NORMAL --', 700);
      return;
    }

    const tabAction = this.getBindings()['main:' + keyStr];
    if (!winState._contextNoteKeyBuffer && !winState._contextNoteMainBuffer
        && (tabAction === 'mainPrevTab' || tabAction === 'mainNextTab')) {
      this._clearMainContextNoteKeyState(winState);
      if (!event.repeat) this._executeMainAction(tabAction, win, winState, 1);
      return;
    }

    const handled = this._handleMainContextNoteNormalKey(event, keyStr, win, winState);
    if (handled) {
      if (String(winState._contextNoteMode || 'normal') === 'normal'
          && !winState._contextNoteSearchUI) {
        this._syncNoteCursorVisualState(event.target?.ownerDocument || null, 'normal', event.target);
      }
      return;
    }
  },

  _clearMainContextNoteKeyState(winState) {
    if (!winState) return;
    this._noteClearPendingCommand(winState);
    winState._contextNoteKeyBuffer = '';
    winState._contextNoteMainBuffer = '';
    winState._contextNoteCountBuffer = '';
    winState._contextNoteOperatorCountBuffer = '';
    clearTimeout(winState._contextNoteKeyTimeout);
    winState._contextNoteKeyTimeout = null;
  },

  // ── Note pending-command hint (outside managed note content) ─────────────

  /** Describe the buffered command without completing it or moving its caret. */
  _notePendingCommandHint(winState) {
    const mode = winState._contextNoteMode || 'normal';
    if (mode === 'insert' || winState._contextNoteSearchUI) return null;
    const buffer = winState._contextNoteKeyBuffer || '';
    const count = winState._contextNoteCountBuffer || '';
    const operatorCount = winState._contextNoteOperatorCountBuffer || '';
    if (!buffer && !count) return null;
    const lang = this.getPref('language', '') || Zotero.locale || '';
    const zh = /^zh/i.test(lang);
    const visual = mode === 'visual' || mode === 'visual-line';
    const operator = !visual && /^[dyc]/.test(buffer) ? buffer[0] : '';
    const motion = operator ? buffer.slice(1) : buffer;
    const operators = zh ? { d: '删除', y: '复制', c: '修改' }
      : { d: 'Delete', y: 'Yank', c: 'Change' };
    let description;
    if (/^[fFtT]$/.test(motion)) {
      const finds = zh ? {
        f: '向右查找：等待字符', F: '向左查找：等待字符',
        t: '向右停在目标前：等待字符', T: '向左停在目标后：等待字符',
      } : {
        f: 'Find → · type a character', F: 'Find ← · type a character',
        t: 'Till → · type a character', T: 'Till ← · type a character',
      };
      description = finds[motion];
      const total = this._noteCommandCount(winState);
      if (total > 1) description += zh ? '（第 ' + total + ' 个）' : ' · #' + total;
    } else if (motion === 'i' || motion === 'a') {
      description = zh ? (motion === 'i' ? '内部对象' : '包含边界的对象') + '：w / " / ( …'
        : (motion === 'i' ? 'Inner object' : 'Around object') + ': w / " / ( …';
    } else if (motion === 'g') {
      description = zh ? (visual ? '等待 g：跳到指定行' : '等待 g 或 v')
        : (visual ? 'Type g to go to a line' : 'Type g or v');
    } else description = zh ? '等待动作或文本对象' : 'Type a motion or text object';
    if (operator) description = operators[operator] + ' · ' + description;
    return {
      command: operator ? operatorCount + operator + count + motion : count + buffer,
      description, cancel: zh ? 'Esc 取消' : 'Esc cancel',
    };
  },

  /** Non-interactive status pill; never part of saved HTML, selection or undo. */
  _noteSyncPendingCommand(winState, editable) {
    const hint = this._notePendingCommandHint(winState);
    const doc = editable?.ownerDocument;
    if (!hint || !doc?.body) { this._noteClearPendingCommand(winState); return; }
    try {
      let ui = winState._contextNotePendingUI;
      if (ui && (ui.editable !== editable || ui.root.parentNode !== doc.body)) {
        this._noteClearPendingCommand(winState);
        ui = null;
      }
      if (!ui) {
        const root = doc.createElement('div');
        root.className = 'zv-note-command-hint';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.setAttribute('aria-atomic', 'true');
        root.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483646;'
          + 'display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;'
          + 'max-width:calc(100% - 16px);box-sizing:border-box;padding:5px 8px;'
          + 'background:var(--color-background,var(--material-background,#f4f4f4));'
          + 'color:var(--fill-primary,#222);border:1px solid rgba(128,128,128,.55);'
          + 'border-radius:5px;box-shadow:0 2px 8px #0002;font:12px/1.4 sans-serif;'
          + 'pointer-events:none;user-select:none;';
        const command = doc.createElement('kbd');
        command.style.cssText = 'font:bold 12px/1.4 monospace;padding:1px 5px;'
          + 'border-radius:3px;background:rgba(96,150,255,.18);overflow-wrap:anywhere;';
        const description = doc.createElement('span');
        description.style.cssText = 'min-width:0;overflow-wrap:anywhere;';
        const cancel = doc.createElement('span');
        cancel.style.cssText = 'opacity:.65;white-space:nowrap;font-size:11px;';
        const style = doc.createElement('style');
        style.textContent = '@media print { .zv-note-command-hint { display:none!important; } }';
        root.appendChild(command);
        root.appendChild(description);
        root.appendChild(cancel);
        root.appendChild(style);
        ui = { root, command, description, cancel, editable, win: doc.defaultView };
        // Losing editor focus cancels pending commands as well as their hint.
        ui.onFocusOut = event => {
          if (event.relatedTarget === editable || editable.contains?.(event.relatedTarget)) return;
          this._clearMainContextNoteKeyState(winState);
        };
        ui.onBlur = () => this._clearMainContextNoteKeyState(winState);
        winState._contextNotePendingUI = ui;
        editable.addEventListener?.('focusout', ui.onFocusOut);
        ui.win.addEventListener?.('blur', ui.onBlur);
        doc.body.appendChild(root);
      }
      // Bound only the display width, not the buffered command/count itself.
      ui.command.textContent = hint.command.length > 32
        ? hint.command.slice(0, 10) + '…' + hint.command.slice(-16) : hint.command;
      ui.command.title = hint.command;
      ui.description.textContent = hint.description;
      ui.cancel.textContent = hint.cancel;
    } catch (e) {
      this._noteClearPendingCommand(winState);
      Zotero.debug('[ZoteroVim] note command hint: ' + e);
    }
  },

  _noteClearPendingCommand(winState) {
    const ui = winState?._contextNotePendingUI;
    if (!ui) return;
    winState._contextNotePendingUI = null;
    try { ui.editable.removeEventListener('focusout', ui.onFocusOut); } catch (_) {}
    try { ui.win.removeEventListener('blur', ui.onBlur); } catch (_) {}
    try { ui.root.remove(); } catch (_) {}
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
    html.classList.toggle('zv-note-visual-mode', mode === 'visual' || mode === 'visual-line');
    html.classList.toggle(normalClass, isNormal);
    html.classList.toggle(insertClass, mode === 'insert');

    const editableEl = this._resolveEditableFromTarget(target)
      || this._resolveEditableFromTarget(doc.activeElement)
      || this._findEditableInDocument(doc);
    if (!editableEl) return;

    if (mode === 'visual' || mode === 'visual-line') return;
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
        'html.zv-note-visual-mode [contenteditable="true"],',
        'html.zv-note-visual-mode textarea { caret-color: rgb(170, 130, 240) !important; }',
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

  // ── Note line-number gutter ──────────────────────────────────────────────

  /** Remove UI-only numbering, observers and pending paint when an editor is detached. */
  _clearNoteLineNumbers(winState) {
    const state = winState?._contextNoteLineNumbers;
    if (!state) return;
    winState._contextNoteLineNumbers = null;
    state.disposed = true;
    try { state.win.cancelAnimationFrame(state.frame); } catch (_) {}
    try { state.mutations?.disconnect(); } catch (_) {}
    try { state.resize?.disconnect(); } catch (_) {}
    for (const [target, type, handler] of state.listeners) {
      try { target.removeEventListener(type, handler, true); } catch (_) {}
    }
    try { state.editable.classList.remove('zv-note-numbered-editor'); } catch (_) {}
    try { state.layer.remove(); } catch (_) {}
    try { state.style.remove(); } catch (_) {}
  },

  /**
   * Attach to the native view only. The gutter is outside ProseMirror's managed
   * DOM, so numbering never enters saved HTML, clipboard text or undo history.
   * The existing editor scan also detects preference changes and view replacement.
   */
  _syncNoteLineNumbers(winState) {
    const doc = winState?._contextNoteEditorDoc;
    if (!doc || !this.isNoteLineNumbersEnabled()) {
      this._clearNoteLineNumbers(winState);
      return;
    }
    try {
      const win = doc.defaultView;
      const nativeWin = win.wrappedJSObject || win;
      const editable = nativeWin._currentEditorInstance?._editorCore?.view?.dom;
      const ctx = this._noteEditorContext(editable);
      if (!ctx || !ctx.view.coordsAtPos || !editable.isConnected) {
        this._clearNoteLineNumbers(winState);
        return;
      }
      const existing = winState._contextNoteLineNumbers;
      if (existing?.editable === editable && existing.view === ctx.view) {
        // Native selection-only transactions need not change the DOM.
        if (existing.model?.doc !== ctx.view.state.doc
            || existing.selection !== ctx.view.state.selection) {
          this._queueNoteLineNumbers(existing);
        }
        return;
      }
      this._clearNoteLineNumbers(winState);

      const layer = doc.createElement('div');
      layer.className = 'zv-note-line-numbers';
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('contenteditable', 'false');
      const style = doc.createElement('style');
      style.id = 'zv-note-line-number-style';
      const state = {
        win, doc, editable, view: ctx.view, winState, layer, style, listeners: [],
        basePadding: parseFloat(win.getComputedStyle(editable).paddingLeft) || 0,
        headingMargins: new WeakMap(), headingGaps: new WeakMap(),
        width: 0, frame: null, model: null, selection: null, disposed: false,
      };
      winState._contextNoteLineNumbers = state;
      (doc.head || doc.documentElement).appendChild(style);
      (doc.body || doc.documentElement).appendChild(layer);
      editable.classList.add('zv-note-numbered-editor');
      const queue = () => this._queueNoteLineNumbers(state);
      const listen = (target, type) => {
        target.addEventListener(type, queue, true);
        state.listeners.push([target, type, queue]);
      };
      for (const type of ['selectionchange', 'input', 'scroll', 'load']) listen(doc, type);
      listen(win, 'resize');
      if (doc.fonts?.addEventListener) listen(doc.fonts, 'loadingdone');

      if (typeof win.MutationObserver === 'function') {
        state.mutations = new win.MutationObserver(queue);
        state.mutations.observe(editable, Components.utils.cloneInto({
          childList: true, characterData: true, subtree: true, attributes: true,
        }, win));
      }
      if (typeof win.ResizeObserver === 'function') {
        state.resize = new win.ResizeObserver(queue);
        state.resize.observe(editable);
        // Includes the scroller and centered editor container, not just content height.
        for (let el = editable.parentElement; el; el = el.parentElement) {
          state.resize.observe(el);
        }
      }
      queue();
    } catch (e) {
      this._clearNoteLineNumbers(winState);
      Zotero.debug('[ZoteroVim] note line-number setup: ' + e);
    }
  },

  _queueNoteLineNumbers(state) {
    if (state.disposed || state.frame !== null) return;
    state.frame = state.win.requestAnimationFrame(() => {
      state.frame = null;
      if (state.disposed) return;
      try { this._paintNoteLineNumbers(state); } catch (e) {
        state.layer.replaceChildren();
        Zotero.debug('[ZoteroVim] note line-number paint: ' + e);
      }
    });
  },

  /** Cache logical line starts per immutable document, not per scroll or selection. */
  _noteLineNumberModel(editable, previous = null) {
    const ctx = this._noteEditorContext(editable);
    if (!ctx) return null;
    if (previous?.doc === ctx.view.state.doc && previous.view === ctx.view) return previous;
    const snapshot = this._noteTextSnapshot(editable);
    if (!snapshot?.ctx) return null;
    const model = { doc: ctx.view.state.doc, view: ctx.view, snapshot, groups: [], starts: [] };
    for (const block of snapshot.blocks) {
      let cell = null;
      for (let i = block.ancestors.length - 1; i >= 0; i -= 1) {
        const ancestor = block.ancestors[i];
        if (/^(table_cell|table_header|tableCell|tableHeader)$/.test(ancestor.node.type.name)) {
          cell = ancestor;
          break;
        }
      }
      const group = {
        from: block.from, cellPos: cell?.pos,
        heading: block.node.type.name === 'heading', lines: [],
      };
      let offset = block.start;
      while (offset <= block.end) {
        model.starts.push(offset);
        group.lines.push({ number: model.starts.length, pos: snapshot.points[offset] });
        const next = snapshot.text.indexOf('\n', offset);
        if (next < 0 || next >= block.end) break;
        offset = next + 1;
      }
      model.groups.push(group);
    }
    return model;
  },

  _noteLineNumberCurrent(model, caret = null) {
    const offset = caret ?? this._noteNativeCaretOffset(model.snapshot);
    let low = 0;
    let high = model.starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (model.starts[mid] <= offset) low = mid + 1;
      else high = mid;
    }
    return Math.max(1, low);
  },

  /** Intersect with scroll/overflow ancestors so labels cannot cover the toolbar. */
  _noteLineNumberViewport(editable) {
    const win = editable.ownerDocument.defaultView;
    const rect = editable.getBoundingClientRect();
    const clip = {
      left: Math.max(0, rect.left), top: Math.max(0, rect.top),
      right: Math.min(win.innerWidth, rect.right),
      bottom: Math.min(win.innerHeight, rect.bottom),
    };
    for (let el = editable.parentElement; el; el = el.parentElement) {
      const css = win.getComputedStyle(el);
      const bounds = el.getBoundingClientRect();
      const left = bounds.left + el.clientLeft;
      const top = bounds.top + el.clientTop;
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
        clip.left = Math.max(clip.left, left);
        clip.right = Math.min(clip.right, left + el.clientWidth);
      }
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
        clip.top = Math.max(clip.top, top);
        clip.bottom = Math.min(clip.bottom, top + el.clientHeight);
      }
    }
    return clip;
  },

  _noteLineNumberElementSelector(editable, el) {
    const path = [];
    while (el && el !== editable) {
      let index = 1;
      for (let sibling = el.previousElementSibling; sibling;
        sibling = sibling.previousElementSibling) {
        index += 1;
      }
      path.unshift(el.tagName.toLowerCase() + ':nth-child(' + index + ')');
      el = el.parentElement;
    }
    return el === editable && path.length
      ? '.zv-note-numbered-editor > ' + path.join(' > ') : '';
  },

  /**
   * Read a visible H1–H6 pseudo-element badge without changing its native style.
   * Ignore Zotero's empty, wide click-target pseudo-elements. Transparent wide
   * labels and inline SVG icons are measured inside the click target's padding.
   */
  _noteHeadingMarkerBox(state, block, coords = null) {
    const bounds = block.getBoundingClientRect();
    const px = value => parseFloat(value) || 0;
    for (const pseudo of ['::before', '::after']) {
      const css = state.win.getComputedStyle(block, pseudo);
      const imageMarker = /url\(/i.test(css.content || '')
        || /url\(/i.test(css.backgroundImage || '');
      if ((!/\bH[1-6]\b/i.test(css.content || '') && !imageMarker)
          || css.display === 'none' || css.visibility === 'hidden') continue;
      const fontSize = px(css.fontSize) || 10;
      const textWidth = fontSize * 1.4;
      const width = px(css.width) || textWidth;
      // Better Notes puts an 18px SVG inside a padded 64px click target.
      // Its visible center is not the center of that pseudo-element's box.
      let imageWidth = 0;
      const svgURL = /url\(["']?(data:image\/svg\+xml[^"')]+)["']?\)/i
        .exec(css.content || '');
      if (svgURL) {
        try {
          const comma = svgURL[1].indexOf(',');
          const data = svgURL[1].slice(comma + 1);
          const svg = /;base64/i.test(svgURL[1].slice(0, comma))
            ? state.win.atob(data) : decodeURIComponent(data);
          const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] || '';
          imageWidth = px(/\bwidth\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i
            .exec(tag)?.[1]);
        } catch (_) {}
      }
      const borderX = px(css.borderLeftWidth) + px(css.borderRightWidth);
      const borderY = px(css.borderTopWidth) + px(css.borderBottomWidth);
      const boxWidth = width + (css.boxSizing === 'border-box' ? 0
        : borderX + px(css.paddingLeft) + px(css.paddingRight));
      const boxHeight = (px(css.height) || px(css.lineHeight) || fontSize * 1.2)
        + (css.boxSizing === 'border-box' ? 0
          : borderY + px(css.paddingTop) + px(css.paddingBottom));
      let left = bounds.left + px(css.marginLeft);
      if (css.left && css.left !== 'auto') left += px(css.left);
      else if (css.right && css.right !== 'auto') {
        left = bounds.right - px(css.right) - px(css.marginRight) - boxWidth;
      } else if (coords) left = coords.left + px(css.marginLeft);
      let top = (coords?.top ?? bounds.top) + px(css.marginTop);
      if (css.top && css.top !== 'auto') top = bounds.top + px(css.top) + px(css.marginTop);
      else if (css.bottom && css.bottom !== 'auto') {
        top = bounds.bottom - px(css.bottom) - px(css.marginBottom) - boxHeight;
      }
      const matrix = /^matrix\(([^)]+)\)$/.exec(css.transform || '');
      if (matrix) {
        const values = matrix[1].split(',').map(Number);
        left += values[4] || 0;
        top += values[5] || 0;
      }
      const hasBox = imageMarker || borderX || borderY
        || (css.backgroundColor && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(css.backgroundColor));
      const labelWidth = imageWidth || (hasBox ? boxWidth : Math.min(width, textWidth));
      const innerWidth = imageWidth ? boxWidth - borderX
        - px(css.paddingLeft) - px(css.paddingRight) : boxWidth;
      const alignedInset = css.textAlign === 'right' || css.textAlign === 'end'
        ? innerWidth - labelWidth : css.textAlign === 'center'
          ? (innerWidth - labelWidth) / 2 : 0;
      const inset = imageWidth ? px(css.borderLeftWidth) + px(css.paddingLeft) + alignedInset
        : hasBox ? 0 : alignedInset;
      return {
        center: left + inset + labelWidth / 2,
        bottom: top + (hasBox ? boxHeight : px(css.lineHeight) || fontSize * 1.2),
      };
    }
    return null;
  },

  /** Only badged headings need vertical clearance; preserve native em-based margins. */
  _noteLineNumberHeadingRules(state) {
    const rules = [];
    for (const group of state.model?.groups || []) {
      if (!group.heading) continue;
      const block = state.view.nodeDOM(group.from);
      if (!block?.getBoundingClientRect || !this._noteHeadingMarkerBox(state, block)) continue;
      const selector = this._noteLineNumberElementSelector(state.editable, block);
      if (!selector) continue;
      if (!state.headingMargins.has(block)) {
        const css = state.win.getComputedStyle(block);
        const fontSize = parseFloat(css.fontSize) || 16;
        state.headingMargins.set(block,
          Math.max(0, parseFloat(css.marginBottom) || 0) / fontSize);
      }
      const em = state.headingMargins.get(block).toFixed(4);
      const gap = state.headingGaps.get(block) || 0;
      rules.push('  ' + selector + ' { margin-bottom: max('
        + gap + 'px, ' + em + 'em) !important; }');
    }
    return rules.join('\n');
  },

  _noteLineNumberStyle(state, count) {
    const width = Math.max(24, String(count).length * 8 + 8);
    const headingRules = this._noteLineNumberHeadingRules(state);
    if (state.width === width && state.headingRules === headingRules) return false;
    state.width = width;
    state.headingRules = headingRules;
    // Reuse the original compact margin. Heading badges and numbers share it
    // vertically instead of making every paragraph surrender an extra column.
    state.padding = Math.max(state.basePadding, width + 8);
    state.style.textContent = [
      // Limit spacing changes to screen: printing keeps Zotero's original layout.
      '@media screen {',
      '  .zv-note-numbered-editor { padding-left: ' + state.padding + 'px !important; }',
      '  .zv-note-numbered-editor td, .zv-note-numbered-editor th {',
      '    padding-left: ' + (width + 10) + 'px !important;',
      '  }',
      headingRules,
      '}',
      '.zv-note-line-numbers {',
      '  position: fixed; overflow: hidden; z-index: 1; pointer-events: none;',
      '  user-select: none; -moz-user-select: none;',
      '}',
      '.zv-note-line-numbers > span {',
      '  position: absolute; box-sizing: border-box; text-align: right; padding-right: 4px;',
      '  font: 12px monospace; color: var(--fill-tertiary, #777); border-radius: 3px;',
      '}',
      '.zv-note-line-numbers > .zv-note-current-line {',
      '  color: var(--accent-blue, #3975d5); background: var(--accent-blue10, #e5efff);',
      '  font-weight: bold;',
      '}',
      '.zv-note-line-numbers > .zv-note-heading-line {',
      '  font-size: 9px; text-align: center; padding: 0 1px; border-radius: 2px;',
      '}',
      '@media (prefers-color-scheme: dark) {',
      '  .zv-note-line-numbers > span { color: var(--fill-tertiary, #aaa); }',
      '  .zv-note-line-numbers > .zv-note-current-line {',
      '    color: var(--accent-blue, #b4ceff); background: var(--accent-blue10, #263b57);',
      '  }',
      '}',
      '@media print { .zv-note-line-numbers { display: none !important; } }',
    ].join('\n');
    return true;
  },

  /**
   * Skip offscreen text blocks before measuring individual lines. Binary-search
   * very long code/hard-break blocks. Table cells get their own reserved gutter,
   * but keep global document-order numbers matching G and j/k.
   */
  _paintNoteLineNumbers(state) {
    if (!state.editable.isConnected) { state.layer.replaceChildren(); return; }
    const model = this._noteLineNumberModel(state.editable, state.model);
    if (!model) { state.layer.replaceChildren(); return; }
    state.model = model;
    state.selection = state.view.state.selection;
    this._noteLineNumberStyle(state, model.starts.length);
    const clip = this._noteLineNumberViewport(state.editable);
    const width = Math.max(0, clip.right - clip.left);
    const height = Math.max(0, clip.bottom - clip.top);
    const style = state.layer.style;
    style.left = clip.left + 'px';
    style.top = clip.top + 'px';
    style.width = width + 'px';
    style.height = height + 'px';
    if (!width || !height) { state.layer.replaceChildren(); return; }
    const current = this._noteLineNumberCurrent(model, state.winState?._contextNoteVisual?.head);
    const rootRect = state.editable.getBoundingClientRect();
    const left = rootRect.left + state.padding - state.width - 8;
    const fragment = state.doc.createDocumentFragment();
    for (const group of model.groups) {
      const block = state.view.nodeDOM(group.from);
      if (!block?.getBoundingClientRect) continue;
      const bounds = block.getBoundingClientRect();
      const headingGap = group.heading ? Math.max(14, state.headingGaps.get(block) || 0) : 0;
      if (bounds.bottom + headingGap < clip.top || bounds.top > clip.bottom) continue;
      const cell = group.cellPos === undefined ? null : state.view.nodeDOM(group.cellPos);
      const cellRect = cell?.getBoundingClientRect();
      const x = cellRect ? cellRect.left + 5 : left;
      const marker = group.heading ? this._noteHeadingMarkerBox(state, block) : null;
      let low = 0;
      let high = group.lines.length;
      // A compact heading number may still be visible after its text has scrolled out.
      while (!marker && low < high) {
        const mid = (low + high) >> 1;
        const coords = state.view.coordsAtPos(group.lines[mid].pos, 1);
        if (coords.bottom < clip.top) low = mid + 1;
        else high = mid;
      }
      let lastHeadingBottom = -Infinity;
      for (let i = low; i < group.lines.length; i += 1) {
        const line = group.lines[i];
        const coords = state.view.coordsAtPos(line.pos, 1);
        if (coords.top > clip.bottom) break;
        let rowX = x;
        let rowTop = coords.top;
        let rowWidth = state.width;
        let rowHeight = Math.max(14, coords.bottom - coords.top);
        if (marker) {
          rowWidth = Math.ceil(Math.max(18, String(line.number).length * 5.4 + 4));
          rowHeight = 10;
          rowX = Math.max(clip.left,
            Math.min(marker.center - rowWidth / 2, coords.left - rowWidth - 2));
          rowTop = Math.max(i === 0 ? marker.bottom + 1 : coords.bottom + 1,
            lastHeadingBottom + 1);
          lastHeadingBottom = rowTop + rowHeight;
        }
        if (rowTop > clip.bottom || rowTop + rowHeight < clip.top
            || rowX + rowWidth < clip.left || rowX > clip.right) continue;
        const row = state.doc.createElement('span');
        row.textContent = String(line.number);
        row.className = [line.number === current ? 'zv-note-current-line' : '',
          marker ? 'zv-note-heading-line' : ''].filter(Boolean).join(' ');
        row.style.cssText = 'left:' + (rowX - clip.left) + 'px;top:'
          + (rowTop - clip.top) + 'px;width:' + rowWidth + 'px;height:'
          + rowHeight + 'px;line-height:' + rowHeight + 'px;';
        fragment.appendChild(row);
      }
      if (marker && Number.isFinite(lastHeadingBottom)) {
        state.headingGaps.set(block, Math.max(0, Math.ceil(lastHeadingBottom - bounds.bottom + 2)));
      }
    }
    state.layer.replaceChildren(fragment);
    if (this._noteLineNumberStyle(state, model.starts.length)) this._queueNoteLineNumbers(state);
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

    // Bridge <space> leader bindings from main mode while focus is in note editor.
    if (mainBuffer || keyStr === ' ') {
      this._noteClearPendingCommand(winState);
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

    // f2 / f<space> are character arguments, never counts or leader bindings.
    const pending = winState._contextNoteKeyBuffer || '';
    if (/^[dyc]?[fFtT]$/.test(pending)) {
      const count = this._noteCommandCount(winState);
      this._clearMainContextNoteKeyState(winState);
      if (Array.from(keyStr).length !== 1) return true;
      return this._executeMainContextNoteCommand(
        editableEl, pending + keyStr, count, win, winState);
    }

    if (this._handleMainBindingsInNoteNormal(keyStr, win, winState)) {
      return true;
    }

    if (/^\d$/.test(keyStr) && (keyStr !== '0' || winState._contextNoteCountBuffer)) {
      winState._contextNoteCountBuffer = (winState._contextNoteCountBuffer || '') + keyStr;
      clearTimeout(winState._contextNoteKeyTimeout);
      winState._contextNoteKeyTimeout = null;
      this._noteSyncPendingCommand(winState, editableEl);
      return true;
    }

    const newBuffer = (winState._contextNoteKeyBuffer || '') + keyStr;
    const command = this._matchMainContextNoteCommand(newBuffer, keyStr);

    if (command === 'pending') {
      if (/^[dyc]$/.test(newBuffer)) {
        winState._contextNoteOperatorCountBuffer = winState._contextNoteCountBuffer || '';
        winState._contextNoteCountBuffer = '';
      }
      winState._contextNoteKeyBuffer = newBuffer;
      clearTimeout(winState._contextNoteKeyTimeout);
      // Counts, operators and character arguments wait for input or Escape.
      // Only configurable leader chords use a timeout; a paused df must not
      // turn the eventual x argument into an unrelated character deletion.
      winState._contextNoteKeyTimeout = null;
      this._noteSyncPendingCommand(winState, editableEl);
      return true;
    }

    if (!command) {
      this._clearMainContextNoteKeyState(winState);
      const fallback = this._matchMainContextNoteCommand(keyStr, keyStr);
      if (!fallback || fallback === 'pending') return false;
      return this._executeMainContextNoteCommand(editableEl, fallback, 1, win, winState);
    }

    const hasCount = !!(winState._contextNoteCountBuffer
      || winState._contextNoteOperatorCountBuffer);
    const count = this._noteCommandCount(winState);
    this._clearMainContextNoteKeyState(winState);
    return this._executeMainContextNoteCommand(editableEl, command, count, win, winState, hasCount);
  },

  _matchMainContextNoteCommand(buffer, keyStr) {
    if (/^[dyc]?[fFtT]$/.test(buffer) || /^[dyc][ia]$/.test(buffer)) return 'pending';
    if (/^[dyc][ia][wWsp()[\]{}<>bB"'`t]$/.test(buffer)) return buffer;
    if (/^[dyc]?[fFtT]/.test(buffer)
        && Array.from(buffer.replace(/^[dyc]?[fFtT]/, '')).length === 1) return buffer;
    if (/^[dyc][%;,nN/?]$/.test(buffer)) return buffer;
    if ([';', ',', '%', '/', '?', 'n', 'N', '*', '#', 'v', 'V', 'gv'].includes(buffer)) {
      return buffer;
    }
    if (buffer === 'g') return 'pending';
    if (buffer === 'd') return 'pending';
    if (buffer === 'y') return 'pending';
    if (buffer === 'c') return 'pending';

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

  _executeMainContextNoteCommand(editableEl, command, count, win, winState, hasCount = false) {
    if (!editableEl) return false;

    if (/^[dyc][ia]/.test(command)) {
      return this._noteOperateTextObject(
        editableEl, command[0], command.slice(1), count, win, winState);
    }
    if (/^[dyc]?[fFtT]/.test(command) || /^[dyc]?[%;,nN]$/.test(command)) {
      return this._notePreciseCommand(editableEl, command, count, win, winState, hasCount);
    }
    if (/^[dyc]?[/?]$/.test(command)) {
      const operator = command.length > 1 ? command[0] : null;
      return this._noteOpenSearch(editableEl, command.endsWith('/') ? 1 : -1,
        win, winState, operator, count);
    }
    if (command === '*' || command === '#') {
      return this._noteSearchWord(editableEl, command === '*' ? 1 : -1, count, win, winState);
    }
    if (command === 'v' || command === 'V' || command === 'gv') {
      return this._noteEnterVisual(editableEl, command, win, winState);
    }
    if (/^[dyc][hjklwebWEB0^$G]$/.test(command)) {
      return this._noteOperateByMotion(
        editableEl, command[0], command[1], count, win, winState, hasCount);
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
        return hasCount
          ? this._noteGoToLine(editableEl, count)
          : this._noteGoToLastLine(editableEl);
      case 'x':
        return this._noteDeleteChar(editableEl, count, winState);
      case 'u':
        return this._noteUndoRedo(editableEl, false);
      case 'ctrl+r':
        return this._noteUndoRedo(editableEl, true);
      case 'p':
        return this._notePasteRegister(editableEl, winState, false, count);
      case 'P':
        return this._notePasteRegister(editableEl, winState, true, count);
      case 'dd': {
        const deletedText = this._noteDeleteLines(editableEl, count);
        if (deletedText) {
          winState._contextNoteLastYank = deletedText;
          winState._contextNoteRegisterType = 'line';
          this._mainShowStatus(win, '▶ dd', 700);
          return true;
        }
        return false;
      }
      case 'yy': {
        const yankedText = this._noteYankLines(editableEl, count);
        if (yankedText) {
          winState._contextNoteLastYank = yankedText;
          winState._contextNoteRegisterType = 'line';
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

  // ── Note editing primitives ──────────────────────────────────────────────

  /**
   * Resolve Zotero's native ProseMirror view, not a descendant formatting node.
   * All edits use its transactions so saving and undo see the same document.
   */
  _noteEditorContext(editableEl) {
    try {
      const win = editableEl?.ownerDocument?.defaultView;
      const editorWin = win?.wrappedJSObject || win;
      const core = editorWin?._currentEditorInstance?._editorCore;
      const view = core?.view;
      if (!view?.state?.doc || !view.dispatch || !view.dom) return null;
      if (view.dom !== editableEl && !view.dom.contains(editableEl)) return null;
      return { win: editorWin, core, view };
    } catch (_) {
      return null;
    }
  },

  _noteNativeSelection(ctx, tr, from, to = from) {
    const doc = tr.doc;
    const anchor = Math.max(0, Math.min(from, doc.content.size));
    const head = Math.max(0, Math.min(to, doc.content.size));
    const data = Components.utils.cloneInto({ type: 'text', anchor, head }, ctx.win);
    const selection = ctx.view.state.selection.constructor.fromJSON(doc, data);
    return tr.setSelection(selection);
  },

  /** Map the live native/DOM caret into a cached snapshot without rescanning text. */
  _noteNativeCaretOffset(snapshot) {
    const { ctx, editableEl, points } = snapshot;
    let caret = ctx.view.state.selection.head ?? ctx.view.state.selection.from;
    try {
      const active = editableEl.ownerDocument.activeElement;
      const sel = editableEl.ownerDocument.getSelection();
      if ((!active || active === editableEl || ctx.view.dom.contains(active))
          && sel?.rangeCount && ctx.view.dom.contains(sel.anchorNode)) {
        caret = ctx.view.posAtDOM(sel.focusNode || sel.anchorNode,
          sel.focusOffset ?? sel.anchorOffset);
      }
    } catch (_) {}
    let low = 0;
    let high = points.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (points[mid] < caret) low = mid + 1;
      else high = mid;
    }
    if (!low) return 0;
    if (low === points.length) return Math.max(0, low - 1);
    return caret - points[low - 1] <= points[low] - caret ? low - 1 : low;
  },

  /**
   * Build a text/position map without losing the editor's rich-text structure.
   * Paragraph boundaries and hard breaks are logical newlines; soft wrapping
   * never changes the meaning of dd, O or a numbered line.
   */
  _noteTextSnapshot(editableEl) {
    if (!editableEl) return null;
    const tag = String(editableEl.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      return {
        editableEl, text: String(editableEl.value || ''),
        caret: Number(editableEl.selectionStart || 0), control: true,
      };
    }

    const ctx = this._noteEditorContext(editableEl);
    const doc = editableEl.ownerDocument;
    const sel = doc?.getSelection?.();
    const snapshot = { editableEl, ctx, text: '', points: [], blocks: [], caret: 0 };
    const append = (text, pointAt) => {
      const start = snapshot.text.length;
      for (let i = 0; i <= text.length; i += 1) snapshot.points[start + i] = pointAt(i);
      snapshot.text += text;
    };

    if (ctx) {
      const walk = (node, pos, ancestors) => {
        if (node.isTextblock) {
          if (snapshot.blocks.length) snapshot.text += '\n';
          const start = snapshot.text.length;
          const inline = (parent, base) => {
            let offset = 0;
            for (let i = 0; i < parent.childCount; i += 1) {
              const child = parent.child(i);
              const childPos = base + offset;
              if (child.isText) {
                append(child.text, n => childPos + n);
              } else if (child.isLeaf) {
                append(/^(hardBreak|hard_break)$/.test(child.type.name) ? '\n' : '\uFFFC',
                  n => childPos + n);
              } else {
                inline(child, childPos + 1);
              }
              offset += child.nodeSize;
            }
          };
          snapshot.points[start] = pos + 1;
          inline(node, pos + 1);
          snapshot.points[snapshot.text.length] = pos + node.nodeSize - 1;
          snapshot.blocks.push({
            start, end: snapshot.text.length, from: pos, to: pos + node.nodeSize,
            node, ancestors,
          });
          return;
        }
        let offset = 0;
        for (let i = 0; i < node.childCount; i += 1) {
          const child = node.child(i);
          walk(child, pos + offset + (node === ctx.view.state.doc ? 0 : 1),
            ancestors.concat([{ node, pos }]));
          offset += child.nodeSize;
        }
      };
      walk(ctx.view.state.doc, 0, []);
      snapshot.caret = this._noteNativeCaretOffset(snapshot);
      return snapshot;
    }

    const blocks = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const walkDOM = node => {
      if (node.nodeType === 3) {
        append(node.nodeValue || '', n => ({ node, offset: n }));
        return;
      }
      if (node.tagName === 'BR') {
        const parent = node.parentNode;
        const index = Array.prototype.indexOf.call(parent.childNodes, node);
        append('\n', n => ({ node: parent, offset: index + n }));
        return;
      }
      const isBlock = node !== editableEl && blocks.has(node.tagName);
      if (isBlock && snapshot.text && !snapshot.text.endsWith('\n')) snapshot.text += '\n';
      const start = snapshot.text.length;
      if (!node.childNodes.length) snapshot.points[start] = { node, offset: 0 };
      for (const child of node.childNodes) walkDOM(child);
      if (isBlock) snapshot.blocks.push({ start, end: snapshot.text.length, element: node });
    };
    walkDOM(editableEl);
    try {
      const range = doc.createRange();
      range.selectNodeContents(editableEl);
      range.setEnd(sel.anchorNode, sel.anchorOffset);
      // Points are authoritative even when Range.toString() omits paragraph breaks.
      for (let i = 0; i < snapshot.points.length; i += 1) {
        const p = snapshot.points[i];
        if (p?.node === sel.anchorNode && p.offset === sel.anchorOffset) {
          snapshot.caret = i;
          return snapshot;
        }
      }
      snapshot.caret = Math.min(snapshot.text.length, range.toString().length);
    } catch (_) {}
    return snapshot;
  },

  _noteLineBounds(text, caret) {
    const start = caret > 0 ? text.lastIndexOf('\n', caret - 1) + 1 : 0;
    const next = text.indexOf('\n', caret);
    return { start, end: next < 0 ? text.length : next };
  },

  _noteSelectOffsets(snapshot, from, to = from, focus = true) {
    if (!snapshot) return false;
    from = Math.max(0, Math.min(from, snapshot.text.length));
    to = Math.max(0, Math.min(to, snapshot.text.length));
    const el = snapshot.editableEl;
    try {
      if (snapshot.control) {
        el.setSelectionRange(Math.min(from, to), Math.max(from, to),
          from <= to ? 'forward' : 'backward');
        if (focus) el.focus();
      } else if (snapshot.ctx) {
        const ctx = snapshot.ctx;
        const tr = this._noteNativeSelection(
          ctx, ctx.view.state.tr, snapshot.points[from], snapshot.points[to]);
        ctx.view.dispatch(tr.scrollIntoView());
        if (focus) ctx.view.focus();
      } else {
        const a = snapshot.points[from];
        const b = snapshot.points[to];
        if (!a || !b) return false;
        const range = el.ownerDocument.createRange();
        const start = from <= to ? a : b;
        const end = from <= to ? b : a;
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const sel = el.ownerDocument.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        if (from > to && sel.extend) {
          sel.collapse(a.node, a.offset);
          sel.extend(b.node, b.offset);
        }
        if (focus) el.focus();
      }
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] note selection: ' + e);
      return false;
    }
  },

  _noteControlReplace(el, from, to, text) {
    if (el.readOnly || el.disabled) return false;
    try {
      el.setRangeText(text, from, to, 'end');
      const win = el.ownerDocument.defaultView;
      const options = Components.utils.cloneInto({ bubbles: true }, win);
      el.dispatchEvent(new win.Event('input', options));
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteReplaceOffsets(snapshot, from, to, text = '') {
    if (!snapshot) return false;
    const el = snapshot.editableEl;
    if (snapshot.control) return this._noteControlReplace(el, from, to, text);
    if (snapshot.ctx) {
      const ctx = snapshot.ctx;
      if (ctx.core.readOnly || ctx.view.editable === false) return false;
      try {
        let tr = ctx.view.state.tr;
        const a = snapshot.points[from];
        const b = snapshot.points[to];
        tr = this._noteNativeSelection(ctx, tr, a, b);
        tr = text ? tr.insertText(text, a, b) : tr.delete(a, b);
        tr = this._noteNativeSelection(ctx, tr, a + text.length);
        ctx.view.dispatch(tr.scrollIntoView());
        ctx.view.focus();
        return true;
      } catch (e) {
        Zotero.debug('[ZoteroVim] note edit: ' + e);
        return false;
      }
    }
    if (!this._noteSelectOffsets(snapshot, from, to)) return false;
    // Native editing commands retain the browser's undo history on older editors.
    try {
      return !!el.ownerDocument.execCommand(text ? 'insertText' : 'delete', false, text);
    } catch (_) {
      return false;
    }
  },

  _noteWordKind(char, big = false) {
    if (!char || /\s/u.test(char)) return 0;
    if (big) return 1;
    return /[\p{L}\p{M}\p{N}_]/u.test(char) ? 1 : 2;
  },

  _noteCharAt(text, pos) {
    const code = text.codePointAt(pos);
    return code === undefined ? '' : String.fromCodePoint(code);
  },

  _noteNextChar(text, pos) {
    return Math.min(text.length, pos + (text.codePointAt(pos) > 0xFFFF ? 2 : 1));
  },

  _notePrevChar(text, pos) {
    let previous = Math.max(0, pos - 1);
    const code = text.charCodeAt(previous);
    if (previous > 0 && code >= 0xDC00 && code <= 0xDFFF
        && text.charCodeAt(previous - 1) >= 0xD800
        && text.charCodeAt(previous - 1) <= 0xDBFF) previous -= 1;
    return previous;
  },

  _noteMotionOffset(snapshot, key, count = 1) {
    const text = snapshot.text;
    let pos = snapshot.caret;
    const n = Math.max(1, Math.min(count || 1, text.length + 1));
    const bounds = this._noteLineBounds(text, pos);
    if (key === '0') return bounds.start;
    if (key === '^') {
      const leading = text.slice(bounds.start, bounds.end).match(/^\s*/u)[0].length;
      return Math.min(bounds.end, bounds.start + leading);
    }
    if (key === '$') {
      let line = bounds;
      for (let i = 1; i < n && line.end < text.length; i += 1) {
        line = this._noteLineBounds(text, line.end + 1);
      }
      return line.end;
    }
    if (key === 'h' || key === 'l') {
      for (let i = 0; i < n; i += 1) {
        pos = key === 'h' ? Math.max(bounds.start, this._notePrevChar(text, pos))
          : Math.min(bounds.end, this._noteNextChar(text, pos));
      }
      return pos;
    }
    if (key === 'j' || key === 'k') {
      const column = pos - bounds.start;
      let line = bounds;
      for (let i = 0; i < n; i += 1) {
        if (key === 'j' && line.end < text.length) {
          line = this._noteLineBounds(text, line.end + 1);
        } else if (key === 'k' && line.start > 0) {
          line = this._noteLineBounds(text, line.start - 1);
        } else break;
      }
      const target = Math.min(line.end, line.start + column);
      const code = text.charCodeAt(target);
      return code >= 0xDC00 && code <= 0xDFFF ? target - 1 : target;
    }
    const big = key === key.toUpperCase();
    const kind = p => this._noteWordKind(this._noteCharAt(text, p), big);
    for (let i = 0; i < n; i += 1) {
      if (key === 'w' || key === 'W') {
        const current = kind(pos);
        while (pos < text.length && kind(pos) === current) pos = this._noteNextChar(text, pos);
        while (pos < text.length && !kind(pos)) pos = this._noteNextChar(text, pos);
      } else if (key === 'b' || key === 'B') {
        pos = this._notePrevChar(text, pos);
        while (pos > 0 && !kind(pos)) pos = this._notePrevChar(text, pos);
        const current = kind(pos);
        while (pos > 0 && kind(this._notePrevChar(text, pos)) === current) {
          pos = this._notePrevChar(text, pos);
        }
      } else if (key === 'e' || key === 'E') {
        pos = this._noteNextChar(text, pos);
        while (pos < text.length && !kind(pos)) pos = this._noteNextChar(text, pos);
        const current = kind(pos);
        while (this._noteNextChar(text, pos) < text.length
            && kind(this._noteNextChar(text, pos)) === current) {
          pos = this._noteNextChar(text, pos);
        }
      }
    }
    return pos;
  },

  _moveNoteCaretByKey(editableEl, keyStr, count = 1) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    return this._noteSelectOffsets(snapshot, this._noteMotionOffset(snapshot, keyStr, count));
  },

  _noteGoToLine(editableEl, lineNumber) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    let pos = 0;
    for (let i = 1; i < lineNumber && pos < snapshot.text.length; i += 1) {
      const end = snapshot.text.indexOf('\n', pos);
      if (end < 0) break;
      pos = end + 1;
    }
    return this._noteSelectOffsets(snapshot, pos);
  },

  _noteGoToLastLine(editableEl) {
    const snapshot = this._noteTextSnapshot(editableEl);
    return snapshot ? this._noteSelectOffsets(
      snapshot, this._noteLineBounds(snapshot.text, snapshot.text.length).start) : false;
  },

  _noteSetRegister(winState, text, type = 'character') {
    if (!winState) return;
    winState._contextNoteLastYank = text;
    winState._contextNoteRegisterType = type;
  },

  _noteCopyText(text) {
    try {
      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper).copyString(text);
      return true;
    } catch (_) {
      return false;
    }
  },

  _noteDeleteChar(editableEl, count = 1, winState = null) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    const end = this._noteMotionOffset(snapshot, 'l', count);
    if (end === snapshot.caret) return false;
    const text = snapshot.text.slice(snapshot.caret, end);
    if (!this._noteReplaceOffsets(snapshot, snapshot.caret, end)) return false;
    this._noteSetRegister(winState, text);
    return true;
  },

  _noteOperateByMotion(editableEl, operator, motion, count, win, winState, hasCount = false) {
    if (motion === 'j' || motion === 'k' || motion === 'G') {
      const snapshot = this._noteTextSnapshot(editableEl);
      if (!snapshot) return false;
      const here = this._noteLineBounds(snapshot.text, snapshot.caret);
      let target;
      if (motion === 'G') {
        const lines = snapshot.text.split('\n');
        const targetLine = hasCount ? Math.min(lines.length, count) : lines.length;
        target = lines.slice(0, targetLine - 1).reduce((n, s) => n + s.length + 1, 0);
      } else {
        target = this._noteMotionOffset(snapshot, motion, count);
      }
      const start = Math.min(here.start, this._noteLineBounds(snapshot.text, target).start);
      const end = Math.max(here.end, this._noteLineBounds(snapshot.text, target).end);
      return this._noteOperateRange(snapshot, operator, start, end, win, winState, true);
    }
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    let end = this._noteMotionOffset(snapshot, motion, count);
    // e is inclusive; cw on a nonblank word does not delete the following space.
    if (motion === 'e' || motion === 'E') end = this._noteNextChar(snapshot.text, end);
    if (operator === 'c' && (motion === 'w' || motion === 'W')
        && this._noteWordKind(this._noteCharAt(snapshot.text, snapshot.caret))) {
      const big = motion === 'W';
      const kind = this._noteWordKind(this._noteCharAt(snapshot.text, snapshot.caret), big);
      end = snapshot.caret;
      while (end < snapshot.text.length
          && this._noteWordKind(this._noteCharAt(snapshot.text, end), big) === kind) {
        end = this._noteNextChar(snapshot.text, end);
      }
      if (count > 1 && end < snapshot.text.length) {
        const caret = this._notePrevChar(snapshot.text, end);
        end = this._noteNextChar(snapshot.text, this._noteMotionOffset(
          Object.assign({}, snapshot, { caret }), big ? 'E' : 'e', count - 1));
      }
    }
    return this._noteOperateRange(snapshot, operator,
      Math.min(snapshot.caret, end), Math.max(snapshot.caret, end), win, winState);
  },

  _noteOperateRange(snapshot, operator, from, to, win, winState, linewise = false) {
    let text = snapshot.text.slice(from, to);
    if (linewise) text += '\n';
    if (!text && operator !== 'c') return false;
    if (operator === 'y') {
      if (!this._noteCopyText(text)) return false;
      this._noteSelectOffsets(snapshot, from);
    } else if (operator === 'd' || operator === 'c') {
      if (linewise && operator === 'd') {
        if (!this._noteDeleteLineRange(snapshot, from, to)) return false;
      } else if (!this._noteReplaceOffsets(snapshot, from, to)) return false;
      if (operator === 'c') {
        winState._contextNoteMode = 'insert';
        this._syncNoteCursorVisualState(snapshot.editableEl.ownerDocument, 'insert',
          snapshot.editableEl);
      }
    } else return false;
    this._noteSetRegister(winState, text, linewise ? 'line' : 'character');
    this._mainShowStatus(win, operator === 'c' ? '-- NOTE INSERT --' : '✓ ' + operator, 900);
    return true;
  },

  _noteOperateTextObject(editableEl, operator, textObject, count, win, winState) {
    const snapshot = this._noteTextSnapshot(editableEl);
    const range = snapshot && this._noteTextObjectRange(snapshot, textObject, count);
    if (!range) { this._mainShowStatus(win, '✗ text object not found', 900); return false; }
    return this._noteOperateRange(snapshot, operator,
      range.from, range.to, win, winState, range.linewise);
  },

  // ── Note precise motions and text objects ────────────────────────────────

  _noteCommandCount(winState) {
    const motion = Number(winState._contextNoteCountBuffer || 1);
    const operator = Number(winState._contextNoteOperatorCountBuffer || 1);
    return Math.max(1, Math.min(10000, motion * operator || 1));
  },

  /** Find one Unicode character on this logical line; till repeats skip the old target. */
  _noteFindOffset(snapshot, motion, char, count, repeat = false) {
    const { text, caret } = snapshot;
    const line = this._noteLineBounds(text, caret);
    const forward = motion === 'f' || motion === 't';
    const till = motion === 't' || motion === 'T';
    let pos = caret;
    let remaining = Math.max(1, count);
    while (forward ? pos < line.end : pos > line.start) {
      pos = forward ? this._noteNextChar(text, pos) : this._notePrevChar(text, pos);
      if (pos >= line.end || this._noteCharAt(text, pos) !== char) continue;
      const target = till ? (forward ? this._notePrevChar(text, pos)
        : this._noteNextChar(text, pos)) : pos;
      if (repeat && target === caret) continue;
      if (--remaining === 0) return target;
    }
    return null;
  },

  _noteIsEscaped(text, pos) {
    let slashes = 0;
    while (pos > 0 && text[--pos] === '\\') slashes++;
    return slashes % 2 === 1;
  },

  /** Balanced pairs in plain text, ignoring escaped delimiters and one-line strings. */
  _noteDelimiterPairs(text, angles = false) {
    const openers = angles ? '([{<' : '([{';
    const closers = angles ? ')]}>' : ')]}';
    const stack = [];
    const pairs = [];
    for (let pos = 0; pos < text.length; pos = this._noteNextChar(text, pos)) {
      const char = text[pos];
      if (!(openers + closers + '"\'`').includes(char)) continue;
      if (this._noteIsEscaped(text, pos)) continue;
      if ('"\'`'.includes(char)
          && !(char === "'" && /[\p{L}\p{N}]/u.test(text[pos - 1] || ''))) {
        const end = this._noteLineBounds(text, pos).end;
        let close = pos + 1;
        while (close < end && (text[close] !== char || this._noteIsEscaped(text, close))) {
          close++;
        }
        if (close < end) { pos = close; continue; }
      }
      const opening = openers.indexOf(char);
      const closing = closers.indexOf(char);
      if (opening >= 0) stack.push({ char, from: pos });
      else if (closing >= 0 && stack.length
          && stack[stack.length - 1].char === openers[closing]) {
        const start = stack.pop();
        pairs.push({ from: start.from, to: pos, char: start.char });
      }
    }
    return pairs;
  },

  _notePreciseMotion(snapshot, motion, count, winState, hasCount = false) {
    if (/^[fFtT]/.test(motion)) {
      const char = motion.slice(1);
      winState._contextNoteLastFind = { motion: motion[0], char };
      const offset = this._noteFindOffset(snapshot, motion[0], char, count);
      return offset === null ? null : { offset, inclusive: /[ft]/.test(motion[0]) };
    }
    if (motion === ';' || motion === ',') {
      const last = winState._contextNoteLastFind;
      if (!last) return null;
      const opposite = { f: 'F', F: 'f', t: 'T', T: 't' };
      const find = motion === ',' ? opposite[last.motion] : last.motion;
      const offset = this._noteFindOffset(snapshot, find, last.char, count, true);
      return offset === null ? null : { offset, inclusive: /[ft]/.test(find) };
    }
    if (motion === '%') {
      if (hasCount) {
        if (count > 100) return null;
        const lines = snapshot.text.split('\n');
        const index = Math.max(0, Math.ceil(lines.length * count / 100) - 1);
        const offset = lines.slice(0, index).reduce((n, s) => n + s.length + 1, 0);
        return { offset, linewise: true };
      }
      const end = this._noteLineBounds(snapshot.text, snapshot.caret).end;
      let pos = snapshot.caret;
      while (pos < end && !'()[]{}'.includes(snapshot.text[pos])) pos++;
      const pair = this._noteDelimiterPairs(snapshot.text)
        .find(p => p.from === pos || p.to === pos);
      return pair ? { offset: pair.from === pos ? pair.to : pair.from, inclusive: true } : null;
    }
    if (motion === 'n' || motion === 'N') {
      const search = winState._contextNoteSearch;
      if (!search) return null;
      const result = this._noteSearchResult(snapshot, search,
        search.direction * (motion === 'N' ? -1 : 1), count);
      return result ? { offset: result.offset, search: result } : null;
    }
    return null;
  },

  _notePreciseCommand(editableEl, command, count, win, winState, hasCount) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    const operator = /^[dyc]/.test(command) ? command[0] : null;
    const motion = operator ? command.slice(1) : command;
    const result = this._notePreciseMotion(snapshot, motion, count, winState, hasCount);
    if (!result) { this._mainShowStatus(win, '✗ no match', 900); return false; }
    if (!operator) {
      if (result.search) this._noteSearchStatus(win, result.search);
      return this._noteSelectOffsets(snapshot, result.offset);
    }
    let from = Math.min(snapshot.caret, result.offset);
    let to = Math.max(snapshot.caret, result.offset);
    if (result.linewise) {
      from = this._noteLineBounds(snapshot.text, from).start;
      to = this._noteLineBounds(snapshot.text, to).end;
    } else if (result.inclusive) to = this._noteNextChar(snapshot.text, to);
    return this._noteOperateRange(snapshot, operator, from, to, win, winState, result.linewise);
  },

  /** Return an exclusive range shared by d/y/c and Visual mode, never a DOM rewrite. */
  _noteTextObjectRange(snapshot, object, count = 1) {
    const around = object[0] === 'a';
    const type = object[1];
    const text = snapshot.text;
    const caret = snapshot.caret;
    count = Math.max(1, Math.min(10000, count || 1));
    if (type === 'w' || type === 'W') {
      if (!text.length) return null;
      const kind = p => this._noteWordKind(this._noteCharAt(text, p), type === 'W');
      let from = Math.min(caret, this._notePrevChar(text, text.length));
      const current = kind(from);
      let to = from;
      while (from > 0 && kind(this._notePrevChar(text, from)) === current) {
        from = this._notePrevChar(text, from);
      }
      if (around) {
        if (!current) while (to < text.length && !kind(to)) to = this._noteNextChar(text, to);
        for (let i = 0; i < count && to < text.length; i++) {
          const word = kind(to);
          while (to < text.length && kind(to) === word) to = this._noteNextChar(text, to);
          if (i + 1 < count) {
            while (to < text.length && !kind(to)) to = this._noteNextChar(text, to);
          }
        }
        const end = to;
        if (current) while (to < text.length && /[ \t]/.test(text[to])) to++;
        if (to === end && current) while (from > 0 && /[ \t]/.test(text[from - 1])) from--;
      } else {
        for (let i = 0; i < count && to < text.length; i++) {
          const run = kind(to);
          while (to < text.length && kind(to) === run) to = this._noteNextChar(text, to);
        }
      }
      return { from, to };
    }
    if ('"\'`'.includes(type)) {
      const line = this._noteLineBounds(text, caret);
      const quotes = [];
      for (let pos = line.start; pos < line.end; pos++) {
        if (text[pos] === type && !this._noteIsEscaped(text, pos)) quotes.push(pos);
      }
      let pair = null;
      for (let i = 0; i + 1 < quotes.length; i += 2) {
        if (quotes[i + 1] >= caret) { pair = [quotes[i], quotes[i + 1]]; break; }
      }
      if (!pair) return null;
      let from = pair[0] + 1;
      let to = pair[1];
      if (around || count > 1) { from--; to++; }
      if (around) {
        const end = to;
        while (to < line.end && /[ \t]/.test(text[to])) to++;
        if (to === end) while (from > line.start && /[ \t]/.test(text[from - 1])) from--;
      }
      return { from, to };
    }
    const aliases = { ')': '(', ']': '[', '}': '{', '>': '<', b: '(', B: '{' };
    const delimiter = aliases[type] || type;
    if ('([{<'.includes(delimiter)) {
      let pairs = this._noteDelimiterPairs(text, true).filter(p => p.char === delimiter
        && p.from <= caret && p.to >= caret);
      pairs.sort((a, b) => (a.to - a.from) - (b.to - b.from));
      if (!pairs.length) {
        const end = this._noteLineBounds(text, caret).end;
        const next = this._noteDelimiterPairs(text, true)
          .filter(p => p.char === delimiter && p.from >= caret && p.from < end)
          .sort((a, b) => a.from - b.from)[0];
        if (next) pairs = [next];
      }
      const pair = pairs[count - 1];
      return pair ? { from: pair.from + (around ? 0 : 1),
        to: pair.to + (around ? 1 : 0) } : null;
    }
    if (type === 't') {
      const stack = [];
      const pairs = [];
      const tags = /<\/?([\p{L}_][\p{L}\p{N}_.:-]*)(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?\s*>/gu;
      let match;
      while ((match = tags.exec(text))) {
        if (/\/\s*>$/.test(match[0])
            || /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i
              .test(match[1])) continue;
        if (match[0][1] !== '/') stack.push({ name: match[1], from: match.index,
          inner: tags.lastIndex });
        else if (stack.length && stack[stack.length - 1].name === match[1]) {
          const start = stack.pop();
          pairs.push({ from: start.from, to: tags.lastIndex, inner: start.inner,
            end: match.index });
        }
      }
      const pair = pairs.filter(p => p.from <= caret && p.to > caret)
        .sort((a, b) => (a.to - a.from) - (b.to - b.from))[count - 1];
      return pair ? { from: around ? pair.from : pair.inner,
        to: around ? pair.to : pair.end } : null;
    }
    if (type === 'p') {
      let paragraphs = snapshot.blocks;
      if (!paragraphs?.length) {
        paragraphs = [];
        const lines = text.split('\n');
        let pos = 0;
        for (const line of lines) {
          const end = pos + line.length;
          const last = paragraphs[paragraphs.length - 1];
          if (line.trim() && last && text.slice(last.start, last.end).trim()) last.end = end;
          else paragraphs.push({ start: pos, end });
          pos = end + 1;
        }
      }
      let index = paragraphs.findIndex(p => p.end >= caret);
      if (index < 0) index = paragraphs.length - 1;
      const empty = p => !text.slice(p.start, p.end).trim();
      let first = index;
      let last = index;
      if (empty(paragraphs[index])) {
        while (first > 0 && empty(paragraphs[first - 1])) first--;
        while (last + 1 < paragraphs.length && empty(paragraphs[last + 1])) last++;
      } else {
        for (let i = 1; i < count && last + 1 < paragraphs.length; i++) {
          do { last++; } while (last + 1 < paragraphs.length && empty(paragraphs[last]));
        }
      }
      if (around) {
        const end = last;
        while (last + 1 < paragraphs.length && empty(paragraphs[last + 1])) last++;
        if (last === end) while (first > 0 && empty(paragraphs[first - 1])) first--;
      }
      return { from: paragraphs[first].start, to: paragraphs[last].end, linewise: true };
    }
    if (type === 's') {
      const sentences = [];
      const endings = /[.!?][)\]"']*(?=\s|$)|[。！？][”’」』）]*/gu;
      const boundaries = new Set([text.length]);
      for (const block of snapshot.blocks || []) boundaries.add(block.end);
      const emptyLines = /\n[ \t]*\n/gu;
      let match;
      while ((match = emptyLines.exec(text))) boundaries.add(match.index);
      while ((match = endings.exec(text))) boundaries.add(endings.lastIndex);
      let start = 0;
      for (const end of Array.from(boundaries).sort((a, b) => a - b)) {
        if (end > start) sentences.push({ from: start, to: end });
        start = end;
      }
      for (const sentence of sentences) {
        while (sentence.from < sentence.to && /\s/u.test(text[sentence.from])) sentence.from++;
      }
      const index = sentences.findIndex(s => s.to > caret);
      if (index < 0) return null;
      let from = sentences[index].from;
      let to = sentences[Math.min(sentences.length - 1, index + count - 1)].to;
      while (to > from && /\s/u.test(text[to - 1])) to--;
      if (around) {
        const end = to;
        while (to < text.length && /\s/u.test(text[to])) to++;
        if (to === end) while (from > 0 && /\s/u.test(text[from - 1])) from--;
      }
      return { from, to };
    }
    return null;
  },

  // ── Note Visual mode ────────────────────────────────────────────────────

  _noteEnterVisual(editableEl, command, win, winState) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    const last = winState._contextNoteLastVisual;
    if (command === 'gv' && (!last || last.editable !== editableEl || last.text !== snapshot.text)) {
      this._mainShowStatus(win, '✗ no unchanged Visual selection', 1000);
      return false;
    }
    winState._contextNoteVisual = command === 'gv' ? Object.assign({}, last)
      : { editable: editableEl, text: snapshot.text, anchor: snapshot.caret,
        head: snapshot.caret, linewise: command === 'V' };
    return this._noteRenderVisual(snapshot, win, winState);
  },

  _noteVisualRange(snapshot, visual) {
    const from = Math.min(visual.anchor, visual.head);
    const to = Math.max(visual.anchor, visual.head);
    return visual.linewise ? {
      from: this._noteLineBounds(snapshot.text, from).start,
      to: this._noteLineBounds(snapshot.text, to).end, linewise: true,
    } : { from, to: visual.empty ? to : this._noteNextChar(snapshot.text, to) };
  },

  _noteVisualCaret(text, pos) {
    const line = this._noteLineBounds(text, pos);
    return pos === line.end && pos > line.start ? this._notePrevChar(text, pos) : pos;
  },

  _noteRenderVisual(snapshot, win, winState) {
    const visual = winState._contextNoteVisual;
    if (!visual) return false;
    const range = this._noteVisualRange(snapshot, visual);
    // The native selection head stays on the moving edge even when reversed.
    const end = range.linewise && range.to < snapshot.text.length ? range.to + 1 : range.to;
    const forward = visual.head >= visual.anchor;
    const selected = this._noteSelectOffsets(snapshot,
      forward ? range.from : end, forward ? end : range.from);
    winState._contextNoteMode = visual.linewise ? 'visual-line' : 'visual';
    this._syncNoteCursorVisualState(snapshot.editableEl.ownerDocument,
      winState._contextNoteMode, snapshot.editableEl);
    this._mainShowStatus(win, visual.linewise ? '-- NOTE VISUAL LINE --' : '-- NOTE VISUAL --', 900);
    return selected;
  },

  _noteLeaveVisual(snapshot, win, winState) {
    const visual = winState._contextNoteVisual;
    if (!visual) return false;
    winState._contextNoteLastVisual = Object.assign({}, visual);
    winState._contextNoteVisual = null;
    winState._contextNoteMode = 'normal';
    this._clearMainContextNoteKeyState(winState);
    this._noteSelectOffsets(snapshot, visual.head);
    this._syncNoteCursorVisualState(snapshot.editableEl.ownerDocument, 'normal', snapshot.editableEl);
    this._mainShowStatus(win, '-- NOTE NORMAL --', 700);
    return true;
  },

  /** Visual tracks its own inclusive anchor/head, rather than collapsing browser selections. */
  _handleNoteVisualKey(event, key, win, winState) {
    const visual = winState._contextNoteVisual;
    const snapshot = visual && this._noteTextSnapshot(visual.editable);
    if (!snapshot) return false;
    if (snapshot.text !== visual.text) {
      // Mouse edits or another editor instance may invalidate old offsets.
      this._noteLeaveVisual(snapshot, win, winState);
      return false;
    }
    snapshot.caret = visual.head;
    if (key === 'escape') return this._noteLeaveVisual(snapshot, win, winState);
    const pending = winState._contextNoteKeyBuffer || '';
    if (/^[fFtT]$/.test(pending) && Array.from(key).length !== 1) {
      this._clearMainContextNoteKeyState(winState);
      return true;
    }
    if (!/^[fFtT]$/.test(pending)
        && /^\d$/.test(key) && (key !== '0' || winState._contextNoteCountBuffer)) {
      winState._contextNoteCountBuffer = (winState._contextNoteCountBuffer || '') + key;
      this._noteSyncPendingCommand(winState, visual.editable);
      return true;
    }
    const hasCount = !!winState._contextNoteCountBuffer;
    const count = this._noteCommandCount(winState);
    const command = pending + key;
    if (/^[fFtTia]$/.test(command) || command === 'g') {
      winState._contextNoteKeyBuffer = command;
      this._noteSyncPendingCommand(winState, visual.editable);
      return true;
    }
    this._clearMainContextNoteKeyState(winState);
    if (command === 'v' || command === 'V') {
      const linewise = command === 'V';
      if (linewise === visual.linewise) return this._noteLeaveVisual(snapshot, win, winState);
      visual.linewise = linewise;
    } else if (command === 'o') {
      const anchor = visual.anchor;
      visual.anchor = visual.head;
      visual.head = anchor;
    } else if (['d', 'x', 'y', 'c'].includes(command)) {
      const range = this._noteVisualRange(snapshot, visual);
      const changed = this._noteOperateRange(snapshot, command === 'x' ? 'd' : command,
        range.from, range.to, win, winState, range.linewise);
      if (!changed) return false;
      winState._contextNoteLastVisual = Object.assign({}, visual);
      winState._contextNoteVisual = null;
      if (command !== 'c') winState._contextNoteMode = 'normal';
      this._syncNoteCursorVisualState(snapshot.editableEl.ownerDocument,
        winState._contextNoteMode, snapshot.editableEl);
      return true;
    } else if (/^[ia][wWsp()[\]{}<>bB"'`t]$/.test(command)) {
      const repeated = visual.object === command;
      const objectCount = repeated ? visual.objectCount + count : count;
      const objectSnapshot = Object.assign({}, snapshot,
        { caret: repeated ? visual.objectCaret : visual.head });
      const range = this._noteTextObjectRange(objectSnapshot, command, objectCount);
      if (!range) { this._mainShowStatus(win, '✗ text object not found', 900); return false; }
      visual.object = command;
      visual.objectCount = objectCount;
      visual.objectCaret = objectSnapshot.caret;
      visual.anchor = range.from;
      visual.head = range.to > range.from ? this._notePrevChar(snapshot.text, range.to) : range.from;
      visual.empty = range.from === range.to;
      visual.linewise = !!range.linewise;
      return this._noteRenderVisual(snapshot, win, winState);
    } else if (command === '/' || command === '?') {
      return this._noteOpenSearch(visual.editable, command === '/' ? 1 : -1, win, winState);
    } else if (command === '*' || command === '#') {
      return this._noteSearchWord(visual.editable, command === '*' ? 1 : -1, count, win, winState);
    } else {
      let offset;
      if (/^[hjklwWeEbB0^$]$/.test(command)) {
        offset = this._noteMotionOffset(snapshot, command, count);
      } else if (command === 'gg' || command === 'G') {
        const lines = snapshot.text.split('\n');
        const line = command === 'G' && !hasCount ? lines.length : Math.min(count, lines.length);
        offset = lines.slice(0, line - 1).reduce((n, s) => n + s.length + 1, 0);
      } else {
        const result = this._notePreciseMotion(snapshot, command, count, winState, hasCount);
        if (!result) { this._mainShowStatus(win, '✗ no match', 900); return false; }
        offset = result.offset;
        if (result.search) this._noteSearchStatus(win, result.search);
      }
      visual.head = this._noteVisualCaret(snapshot.text, offset);
      visual.empty = false;
    }
    visual.object = null;
    return this._noteRenderVisual(snapshot, win, winState);
  },

  // ── Note search (UI-only; literal, Unicode-safe and wrapping) ─────────────

  _noteSearchMatches(text, search) {
    const matches = [];
    const pattern = search?.pattern || '';
    if (!pattern) return matches;
    let pos = 0;
    while ((pos = text.indexOf(pattern, pos)) >= 0) {
      const end = pos + pattern.length;
      const word = p => this._noteWordKind(this._noteCharAt(text, p)) === 1;
      if (!search.wholeWord || ((!pos || !word(this._notePrevChar(text, pos)))
          && (end === text.length || !word(end)))) matches.push(pos);
      pos = this._noteNextChar(text, pos);
    }
    return matches;
  },

  _noteSearchResult(snapshot, search, direction, count = 1) {
    const matches = this._noteSearchMatches(snapshot.text, search);
    if (!matches.length) return null;
    let index = direction > 0 ? matches.findIndex(p => p > snapshot.caret)
      : matches.length - 1;
    if (direction < 0) while (index >= 0 && matches[index] >= snapshot.caret) index--;
    const wrapped = index < 0 || (direction > 0 ? count - 1 + index >= matches.length
      : index - count + 1 < 0);
    if (index < 0) index = direction > 0 ? 0 : matches.length - 1;
    index = ((index + direction * (count - 1)) % matches.length + matches.length) % matches.length;
    return { offset: matches[index], length: search.pattern.length,
      index: index + 1, total: matches.length, wrapped };
  },

  _noteSearchStatus(win, result) {
    this._mainShowStatus(win, '✓ ' + result.index + '/' + result.total
      + (result.wrapped ? ' ↻' : ''), 1100);
  },

  _noteApplySearchResult(snapshot, result, win, winState, focus = true) {
    const visual = winState._contextNoteVisual;
    if (visual) {
      visual.head = this._noteVisualCaret(snapshot.text, result.offset);
      visual.object = null;
      visual.empty = false;
      if (focus) this._noteRenderVisual(snapshot, win, winState);
      else {
        const range = this._noteVisualRange(snapshot, visual);
        this._noteSelectOffsets(snapshot, range.from, range.to, false);
      }
    } else this._noteSelectOffsets(snapshot, result.offset,
      focus ? result.offset : result.offset + result.length, focus);
    this._noteSearchStatus(win, result);
  },

  _noteSearchWord(editableEl, direction, count, win, winState) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    if (winState._contextNoteVisual) snapshot.caret = winState._contextNoteVisual.head;
    if (!this._noteWordKind(this._noteCharAt(snapshot.text, snapshot.caret))) return false;
    const range = this._noteTextObjectRange(snapshot, 'iw');
    const pattern = snapshot.text.slice(range.from, range.to);
    const search = { pattern, direction,
      wholeWord: this._noteWordKind(this._noteCharAt(pattern, 0)) === 1 };
    winState._contextNoteSearch = search;
    const result = this._noteSearchResult(snapshot, search, direction, count);
    if (!result) return false;
    this._noteApplySearchResult(snapshot, result, win, winState);
    return true;
  },

  /** The search input lives outside ProseMirror, so it cannot enter note HTML or undo. */
  _noteOpenSearch(editableEl, direction, win, winState, operator = null, count = 1) {
    this._noteClearPendingCommand(winState);
    this._noteCloseSearch(winState);
    const snapshot = this._noteTextSnapshot(editableEl);
    const doc = editableEl.ownerDocument;
    if (!snapshot || !doc.body) return false;
    const visual = winState._contextNoteVisual;
    if (visual) snapshot.caret = visual.head;
    try {
      const root = doc.createElement('div');
      root.id = 'zv-note-search';
      root.setAttribute('role', 'search');
      root.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;'
        + 'display:flex;align-items:center;gap:6px;padding:6px 8px;'
        + 'background:var(--material-background,var(--color-background,#f4f4f4));'
        + 'color:var(--fill-primary,#222);'
        + 'border:1px solid #888;border-radius:5px;font:12px sans-serif;box-shadow:0 2px 8px #0003;';
      const label = doc.createElement('span');
      label.textContent = direction > 0 ? '/' : '?';
      const input = doc.createElement('input');
      input.type = 'text';
      input.setAttribute('aria-label', direction > 0 ? 'Search note forward' : 'Search note backward');
      input.setAttribute('autocomplete', 'off');
      input.style.cssText = 'flex:1;min-width:0;background:transparent;color:inherit;'
        + 'border:0;outline:none;font:inherit;';
      input.placeholder = 'Enter ↵ · Esc';
      const status = doc.createElement('span');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.style.whiteSpace = 'nowrap';
      root.appendChild(label);
      root.appendChild(input);
      root.appendChild(status);
      const style = doc.createElement('style');
      style.textContent = '@media print { #zv-note-search { display:none!important; } }';
      root.appendChild(style);
      const highlight = doc.createElement('div');
      highlight.className = 'zv-note-search-match';
      highlight.setAttribute('aria-hidden', 'true');
      highlight.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
      root.appendChild(highlight);
      const ui = { root, input, status, highlight, snapshot, direction, win, operator, count,
        nativeDoc: snapshot.ctx?.view.state.doc,
        visual: visual ? Object.assign({}, visual) : null,
        previousSearch: winState._contextNoteSearch };
      winState._contextNoteSearchUI = ui;
      ui.onInput = () => this._notePreviewSearch(winState);
      ui.onBlur = () => this._noteCancelSearch(winState, false);
      ui.onViewport = () => this._noteQueueSearchHighlight(ui);
      input.addEventListener('input', ui.onInput);
      input.addEventListener('blur', ui.onBlur);
      doc.defaultView.addEventListener?.('scroll', ui.onViewport, true);
      doc.defaultView.addEventListener?.('resize', ui.onViewport);
      doc.body.appendChild(root);
      input.focus();
      return true;
    } catch (e) {
      this._noteCloseSearch(winState);
      Zotero.debug('[ZoteroVim] note search UI: ' + e);
      return false;
    }
  },

  _notePreviewSearch(winState) {
    const ui = winState._contextNoteSearchUI;
    if (!ui) return;
    const pattern = ui.input.value || '';
    ui.search = pattern ? { pattern, direction: ui.direction, wholeWord: false }
      : ui.previousSearch && Object.assign({}, ui.previousSearch, { direction: ui.direction });
    ui.result = ui.search && this._noteSearchResult(ui.snapshot, ui.search, ui.direction, ui.count);
    if (ui.visual) winState._contextNoteVisual = Object.assign({}, ui.visual);
    if (ui.result) {
      this._noteApplySearchResult(ui.snapshot, ui.result, ui.win, winState, false);
      ui.status.textContent = ui.result.index + '/' + ui.result.total + (ui.result.wrapped ? ' ↻' : '');
    } else {
      if (ui.visual) {
        const range = this._noteVisualRange(ui.snapshot, ui.visual);
        this._noteSelectOffsets(ui.snapshot, range.from, range.to, false);
      } else this._noteSelectOffsets(ui.snapshot, ui.snapshot.caret, ui.snapshot.caret, false);
      ui.status.textContent = pattern ? '0/0' : '';
    }
    this._noteQueueSearchHighlight(ui);
  },

  _noteQueueSearchHighlight(ui) {
    const win = ui.snapshot.editableEl.ownerDocument.defaultView;
    if (ui.frame || ui.disposed) return;
    // Controls already paint their own selected text; older DOM editors can
    // use the same range overlay without requiring CSS Highlights support.
    if (!win.requestAnimationFrame) return;
    ui.frame = win.requestAnimationFrame(() => {
      ui.frame = null;
      this._notePaintSearchHighlight(ui);
    });
  },

  /** Paint a preview above the note without inserting spans into managed rich text. */
  _notePaintSearchHighlight(ui) {
    if (ui.disposed) return;
    const snapshot = ui.snapshot;
    ui.highlight.textContent = '';
    if (!ui.result || snapshot.control
        || (snapshot.ctx && snapshot.ctx.view.state.doc !== ui.nativeDoc)) return;
    try {
      const doc = snapshot.editableEl.ownerDocument;
      const start = snapshot.points[ui.result.offset];
      const end = snapshot.points[ui.result.offset + ui.result.length];
      const a = snapshot.ctx ? snapshot.ctx.view.domAtPos(start) : start;
      const b = snapshot.ctx ? snapshot.ctx.view.domAtPos(end) : end;
      const range = doc.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const clip = this._noteLineNumberViewport(snapshot.editableEl);
      for (const rect of range.getClientRects()) {
        const left = Math.max(clip.left, rect.left);
        const top = Math.max(clip.top, rect.top);
        const right = Math.min(clip.right, rect.right);
        const bottom = Math.min(clip.bottom, rect.bottom);
        if (right <= left || bottom <= top) continue;
        const marker = doc.createElement('span');
        marker.style.cssText = 'position:fixed;pointer-events:none;'
          + 'background:rgba(255,190,40,.32);border-radius:2px;'
          + 'box-shadow:inset 0 0 0 1px rgba(210,140,0,.55);'
          + 'left:' + left + 'px;top:' + top + 'px;'
          + 'width:' + (right - left) + 'px;height:' + (bottom - top) + 'px;';
        ui.highlight.appendChild(marker);
      }
    } catch (_) {}
  },

  _noteSearchKeyDown(event, win, winState) {
    const ui = winState._contextNoteSearchUI;
    if (!ui || event.isComposing) return;
    if (event.key !== 'Escape' && event.key !== 'Enter') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { this._noteCancelSearch(winState); return; }
    this._notePreviewSearch(winState);
    const accept = event.key === 'Enter' && ui.search && ui.result;
    const current = this._noteTextSnapshot(ui.snapshot.editableEl);
    // An asynchronous external edit invalidates all preview offsets.
    const unchanged = current?.text === ui.snapshot.text;
    this._noteCloseSearch(winState);
    if (accept && unchanged) {
      winState._contextNoteSearch = ui.search;
      if (ui.operator) {
        const changed = this._noteOperateRange(current, ui.operator,
          Math.min(ui.snapshot.caret, ui.result.offset),
          Math.max(ui.snapshot.caret, ui.result.offset), win, winState);
        if (!changed) {
          this._noteSelectOffsets(current, ui.snapshot.caret);
          this._mainShowStatus(win, '✗ operation unavailable', 900);
        }
      } else this._noteApplySearchResult(current, ui.result, win, winState);
    } else {
      winState._contextNoteSearch = ui.previousSearch;
      if (ui.visual && unchanged) {
        winState._contextNoteVisual = ui.visual;
        this._noteRenderVisual(current, win, winState);
      } else if (current) {
        if (ui.visual) { winState._contextNoteVisual = null; winState._contextNoteMode = 'normal'; }
        this._noteSelectOffsets(current, ui.snapshot.caret);
      }
      if (event.key === 'Enter') this._mainShowStatus(win, '✗ no match', 900);
    }
    this._clearMainContextNoteKeyState(winState);
  },

  _noteCancelSearch(winState, focus = true) {
    const ui = winState?._contextNoteSearchUI;
    if (!ui) return;
    this._noteCloseSearch(winState);
    winState._contextNoteSearch = ui.previousSearch;
    const current = this._noteTextSnapshot(ui.snapshot.editableEl);
    if (ui.visual && current?.text === ui.snapshot.text) {
      winState._contextNoteVisual = ui.visual;
      if (focus) this._noteRenderVisual(current, ui.win, winState);
      else {
        const range = this._noteVisualRange(current, ui.visual);
        const end = range.linewise && range.to < current.text.length ? range.to + 1 : range.to;
        const forward = ui.visual.head >= ui.visual.anchor;
        this._noteSelectOffsets(current, forward ? range.from : end,
          forward ? end : range.from, false);
      }
    } else if (current) {
      if (ui.visual) { winState._contextNoteVisual = null; winState._contextNoteMode = 'normal'; }
      this._noteSelectOffsets(current, ui.snapshot.caret, ui.snapshot.caret, focus);
    }
    this._clearMainContextNoteKeyState(winState);
  },

  _noteCloseSearch(winState) {
    const ui = winState?._contextNoteSearchUI;
    if (!ui) return;
    winState._contextNoteSearchUI = null;
    ui.disposed = true;
    const win = ui.snapshot.editableEl.ownerDocument.defaultView;
    try { win.cancelAnimationFrame(ui.frame); } catch (_) {}
    try { win.removeEventListener('scroll', ui.onViewport, true); } catch (_) {}
    try { win.removeEventListener('resize', ui.onViewport); } catch (_) {}
    try { ui.input.removeEventListener('input', ui.onInput); } catch (_) {}
    try { ui.input.removeEventListener('blur', ui.onBlur); } catch (_) {}
    try { ui.root.remove(); } catch (_) {}
  },

  _noteNormalizeCaretForNormalOps(editableEl) {
    if (editableEl.tagName === 'TEXTAREA' || editableEl.tagName === 'INPUT') {
      editableEl.setSelectionRange(editableEl.selectionStart, editableEl.selectionStart);
      return;
    }
    const sel = editableEl.ownerDocument?.getSelection?.();
    if (!sel) return;
    try {
      if (!sel.rangeCount) {
        sel.selectAllChildren(editableEl);
        sel.collapseToStart();
      } else if (!sel.isCollapsed) sel.collapseToStart();
    } catch (_) {}
  },

  _noteUndoRedo(editableEl, redo = false) {
    const doc = editableEl.ownerDocument;
    try {
      const win = doc.defaultView?.wrappedJSObject || doc.defaultView;
      const method = redo ? 'doRedo' : 'doUndo';
      if (typeof win?.[method] === 'function') return !!win[method]();
      const command = redo ? 'cmd_redo' : 'cmd_undo';
      const controller = doc.defaultView?.controllers?.getControllerForCommand(command);
      if (controller?.isCommandEnabled(command)) {
        controller.doCommand(command);
        return true;
      }
      editableEl.focus();
      if (doc.execCommand(redo ? 'redo' : 'undo')) return true;
      // Older Zotero editors expose history through ProseMirror's keymap only.
      // Bypass our own capture handlers, and report success only if the editor
      // actually consumed the command (not merely because dispatch succeeded).
      if (!win?.KeyboardEvent) return false;
      const mac = /Mac/i.test(win.navigator?.platform || '');
      const options = Components.utils.cloneInto({
        key: 'z', code: 'KeyZ', ctrlKey: !mac, metaKey: mac, shiftKey: !!redo,
        bubbles: true, cancelable: true,
      }, win);
      const event = new win.KeyboardEvent('keydown', options);
      event._zvNoteEditorCommand = true;
      editableEl.dispatchEvent(event);
      return event.defaultPrevented;
    } catch (e) {
      Zotero.debug('[ZoteroVim] note undo/redo: ' + e);
      return false;
    }
  },

  _noteLineSpan(snapshot, count = 1) {
    const first = this._noteLineBounds(snapshot.text, snapshot.caret);
    let last = first;
    for (let i = 1; i < count && last.end < snapshot.text.length; i += 1) {
      last = this._noteLineBounds(snapshot.text, last.end + 1);
    }
    return { from: first.start, to: last.end };
  },

  _noteLineUnit(block) {
    if (!block) return null;
    const ancestors = block.ancestors || [];
    const parent = ancestors[ancestors.length - 1];
    // A list item's only paragraph represents the entire list line.
    if (/^(listItem|list_item)$/.test(parent?.node.type.name || '')
        && parent.node.childCount === 1) {
      return { node: parent.node, from: parent.pos, to: parent.pos + parent.node.nodeSize };
    }
    return { node: block.node, from: block.from, to: block.to };
  },

  _noteDeleteLineRange(snapshot, from, to) {
    if (snapshot.ctx) {
      const first = snapshot.blocks.find(b => b.start === from);
      const last = snapshot.blocks.find(b => b.end === to);
      if (first && last) {
        const a = this._noteLineUnit(first);
        const b = this._noteLineUnit(last);
        const ctx = snapshot.ctx;
        if (ctx.core.readOnly || ctx.view.editable === false) return false;
        try {
          const tr = ctx.view.state.tr.delete(a.from, b.to);
          const pos = Math.min(a.from, tr.doc.content.size);
          const selection = ctx.view.state.selection.constructor.near(tr.doc.resolve(pos), 1);
          ctx.view.dispatch(tr.setSelection(selection).scrollIntoView());
          ctx.view.focus();
          return true;
        } catch (e) {
          Zotero.debug('[ZoteroVim] note delete line: ' + e);
          return false;
        }
      }
    }
    if (to < snapshot.text.length) to += 1;
    else if (from > 0) from -= 1;
    return this._noteReplaceOffsets(snapshot, from, to);
  },

  _noteDeleteLines(editableEl, count = 1) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    const { from, to } = this._noteLineSpan(snapshot, count);
    const text = snapshot.text.slice(from, to) + '\n';
    return this._noteDeleteLineRange(snapshot, from, to) ? text : false;
  },

  _noteYankLines(editableEl, count = 1) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return '';
    const { from, to } = this._noteLineSpan(snapshot, count);
    const text = snapshot.text.slice(from, to) + '\n';
    if (!this._noteCopyText(text)) return '';
    this._noteSelectOffsets(snapshot, from);
    return text;
  },

  _noteEnterInsertAt(editableEl, placement) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    const motion = placement === 'append-char' ? 'l'
      : placement === 'append-line' ? '$' : '^';
    return this._noteSelectOffsets(snapshot, this._noteMotionOffset(snapshot, motion));
  },

  _noteSwitchToInsert(editableEl, placement) {
    if (placement === 'open-below') return this._noteOpenLine(editableEl, false);
    if (placement === 'open-above') return this._noteOpenLine(editableEl, true);
    return this._noteEnterInsertAt(editableEl, placement);
  },

  /**
   * Insert whole empty blocks at explicit model positions. No simulated Enter
   * and no splitting at the old caret: O and o differ solely by insertion side.
   */
  _noteInsertNativeLines(snapshot, lines, above) {
    const ctx = snapshot.ctx;
    if (!ctx || ctx.core.readOnly || ctx.view.editable === false) return false;
    const block = snapshot.blocks.find(b => snapshot.caret >= b.start
      && snapshot.caret <= b.end);
    if (!block) return false;
    const line = this._noteLineBounds(snapshot.text, snapshot.caret);
    const isCode = /^(codeBlock|code_block)$/.test(block.node.type.name);
    if (isCode || line.start > block.start || line.end < block.end) {
      const pos = snapshot.points[above ? line.start : line.end];
      try {
        let tr = ctx.view.state.tr;
        if (isCode) {
          const text = lines.join('\n');
          tr = tr.insertText(above ? text + '\n' : '\n' + text, pos);
        } else {
          const type = ctx.view.state.schema.nodes.hardBreak
            || ctx.view.state.schema.nodes.hard_break;
          let cursor = pos;
          if (!above) { tr = tr.insert(cursor, type.create()); cursor += 1; }
          for (let i = 0; i < lines.length; i += 1) {
            if (lines[i]) {
              tr = tr.insertText(lines[i], cursor);
              cursor += lines[i].length;
            }
            if (above || i < lines.length - 1) {
              tr = tr.insert(cursor, type.create());
              cursor += 1;
            }
          }
        }
        tr = this._noteNativeSelection(ctx, tr, pos + (above ? 0 : 1));
        ctx.view.dispatch(tr.scrollIntoView());
        ctx.view.focus();
        return true;
      } catch (e) {
        Zotero.debug('[ZoteroVim] note insert logical line: ' + e);
        return false;
      }
    }
    const unit = this._noteLineUnit(block);
    try {
      let pos = above ? unit.from : unit.to;
      let tr = ctx.view.state.tr;
      const firstPos = pos;
      let firstCaret = pos + 1;
      for (let i = 0; i < lines.length; i += 1) {
        const paragraph = ctx.view.state.schema.nodes.paragraph;
        let node = lines[i]
          ? paragraph.create(null, ctx.view.state.schema.text(lines[i]))
          : paragraph.createAndFill();
        if (/^(listItem|list_item)$/.test(unit.node.type.name)) {
          node = unit.node.type.createAndFill(null, node);
          if (i === 0) firstCaret = firstPos + 2;
        }
        tr = tr.insert(pos, node);
        pos += node.nodeSize;
      }
      tr = this._noteNativeSelection(ctx, tr, firstCaret);
      ctx.view.dispatch(tr.scrollIntoView());
      ctx.view.focus();
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] note insert line: ' + e);
      return false;
    }
  },

  _noteOpenLine(editableEl, above = false) {
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    const line = this._noteLineBounds(snapshot.text, snapshot.caret);
    if (snapshot.ctx) {
      return this._noteInsertNativeLines(snapshot, [''], above);
    }
    if (snapshot.control) {
      const pos = above ? line.start : line.end;
      if (!this._noteControlReplace(editableEl, pos, pos, '\n')) return false;
      return this._noteSelectOffsets(
        this._noteTextSnapshot(editableEl), pos + (above ? 0 : 1));
    }
    // Non-ProseMirror contenteditable fallback: resolve the nearest real block,
    // not the inherited isContentEditable descendant under the caret.
    try {
      const doc = editableEl.ownerDocument;
      const sel = doc.getSelection();
      let block = sel.anchorNode;
      if (block?.nodeType === 3) block = block.parentElement;
      while (block && block !== editableEl
          && !/^(P|DIV|LI|PRE|H[1-6])$/.test(block.tagName)) block = block.parentElement;
      if (!block || block === editableEl) return false;
      const node = doc.createElement(block.tagName === 'LI' ? 'li' : 'p');
      node.appendChild(doc.createElement('br'));
      block.parentNode.insertBefore(node, above ? block : block.nextSibling);
      const range = doc.createRange();
      range.selectNodeContents(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      const options = Components.utils.cloneInto({ bubbles: true }, doc.defaultView);
      editableEl.dispatchEvent(new doc.defaultView.Event('input', options));
      return true;
    } catch (_) {
      return false;
    }
  },

  _notePasteRegister(editableEl, winState, before = false, count = 1) {
    const text = String(winState?._contextNoteLastYank || '');
    if (!text) return false;
    const snapshot = this._noteTextSnapshot(editableEl);
    if (!snapshot) return false;
    const n = Math.max(1, Math.min(count || 1, 10000));
    if (winState._contextNoteRegisterType === 'line') {
      const lines = text.replace(/\n$/, '').split('\n');
      const repeated = [];
      for (let i = 0; i < n; i += 1) repeated.push(...lines);
      if (snapshot.ctx) return this._noteInsertNativeLines(snapshot, repeated, before);
      const line = this._noteLineBounds(snapshot.text, snapshot.caret);
      const pos = before ? line.start : line.end;
      const inserted = before ? repeated.join('\n') + '\n' : '\n' + repeated.join('\n');
      return this._noteReplaceOffsets(snapshot, pos, pos, inserted);
    }
    const pos = before ? snapshot.caret : this._noteMotionOffset(snapshot, 'l');
    return this._noteReplaceOffsets(snapshot, pos, pos, text.repeat(n));
  },

  _resolveEditableFromTarget(target) {
    if (!target) return null;
    let el = target.nodeType === 1 ? target : target.parentElement;
    while (el) {
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return el;
      if (el.isContentEditable) {
        while (el.parentElement?.isContentEditable) el = el.parentElement;
        return el;
      }
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

  async _mainOpenPDF(win, winState) {
    // Mirrors Zotero's native Enter/double-click behaviour (zoteroPane.js
    // viewItems): attachments open via viewAttachment, regular items open
    // their best attachment (Zotero's getBestAttachment order — PDF matching
    // the item URL first, then other PDFs, then snapshots/EPUB/…), and items
    // without any attachment fall back to the URL field / DOI in an external
    // browser.  Notes open as notes.
    try {
      let items = win.ZoteroPane.getSelectedItems();
      if (!items.length) {
        this._mainEnsureItemsSelection(win.ZoteroPane?.itemsView);
        items = win.ZoteroPane.getSelectedItems();
      }
      if (!items.length) { this._mainShowStatus(win, '✗ No item selected'); return; }
      const item = items[0];

      if (item.isAttachment()) {
        win.ZoteroPane.viewAttachment(item.id);
        return;
      }
      if (item.isNote()) {
        win.ZoteroPane.openNote(item.id);
        return;
      }

      let att = null;
      if (typeof item.getBestAttachment === 'function') {
        try { att = await item.getBestAttachment(); } catch (_) {}
      }
      if (!att) {
        const atts = item.getAttachments()
          .map(id => Zotero.Items.get(id))
          .filter(a => a && a.isAttachment());
        att = atts.find(a => a.attachmentContentType === 'application/pdf') || atts[0] || null;
      }
      if (att) {
        win.ZoteroPane.viewAttachment(att.id);
        Zotero.debug('[ZoteroVim] _mainOpenPDF: attID=' + att.id);
        return;
      }

      let uri = item.getField('url');
      if (!uri) {
        const doi = item.getField('DOI');
        if (doi) uri = 'https://doi.org/' + (Zotero.Utilities.cleanDOI?.(doi) || doi);
      }
      if (uri) {
        win.ZoteroPane.loadURI(uri);
        return;
      }
      this._mainShowStatus(win, '✗ No attachment');
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

    // Remember where focus was before the picker steals it, so closing can
    // restore it.  Zotero only refocuses the reader on Escape when it actually
    // sees the key (our picker handler stops propagation), so without this
    // the reader stays unfocused and all vim bindings are dead until a second
    // Escape triggers Zotero's own fallback.
    try {
      winState._pickerPrevFocus = win.document.activeElement || null;
      winState._pickerPrevFocusWin = Services.focus?.focusedWindow || null;
    } catch (_) {
      winState._pickerPrevFocus = null;
      winState._pickerPrevFocusWin = null;
    }

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

    // Restore focus to wherever it was before the picker opened.  The overlay
    // removal leaves focus on <body>: if the selected tab is a reader, the
    // main-window bindings are skipped (reader-tab guard) and the reader's own
    // listeners are inactive until something refocuses the PDF iframe.
    const prevEl  = winState._pickerPrevFocus;
    const prevWin = winState._pickerPrevFocusWin;
    winState._pickerPrevFocus = null;
    winState._pickerPrevFocusWin = null;
    try {
      if (prevEl && prevEl.isConnected) prevEl.focus();
      else if (prevWin) prevWin.focus();
    } catch (_) {}
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

/* global Zotero, Services, Components */
/* eslint-disable no-unused-vars */

/**
 * Reader focus appearance. PDF/outline frames draw in their own document;
 * sidebar notes draw outside the editor in chrome. Only one frame is visible.
 * Focus ownership keeps the keyboard pane target aligned with focus intent.
 * Rendering never changes DOM focus, editor contents, selection or scroll.
 */
Object.assign(ZoteroVim, {
  _sameReaderFocusWindow(first, second) {
    if (first === second) return true;
    try { return !!first && !!second && first.document === second.document; } catch (_) {}
    return false;
  },

  _readerFocusViewport(win) {
    const root = win.document.documentElement;
    return { width: win.innerWidth || root.clientWidth,
      height: win.innerHeight || root.clientHeight };
  },

  _readerFocusCueSelected(cue, reader) {
    const tabs = cue.win.Zotero_Tabs;
    if (!tabs) return true; // Standalone reader window.
    const selected = Zotero.Reader.getByTabID?.(tabs.selectedID);
    return selected === reader || (selected?._instanceID != null
      && selected._instanceID === reader._instanceID);
  },

  /** Create/reconcile observers as native PDF views and note editors change. */
  _syncReaderFocusCue(reader, state) {
    const win = reader._window || reader._iframe?.ownerDocument?.defaultView;
    if (!win?.document?.createElementNS) return;
    let cue = state._focusCue;
    if (cue && cue.win !== win) {
      this._clearReaderFocusCue(state);
      cue = null;
    }
    if (!cue) {
      cue = { win, owner: null, bindings: new Map(), layers: new Map(), note: null,
        frame: null, active: true, cleanup: null,
        animation: null, paintedOwner: null, pendingRecovery: null };
      state._focusCue = cue;
      const layer = this._readerFocusCueLayer(cue, win);
      cue.element = layer.element;
      const refresh = () => this._queueReaderFocusCue(state);
      const activate = () => { cue.active = true; refresh(); };
      const deactivate = () => {
        cue.active = false;
        this._hideReaderFocusCueLayers(cue);
      };
      win.addEventListener('activate', activate);
      win.addEventListener('deactivate', deactivate);
      win.addEventListener('resize', refresh);
      win.addEventListener('scroll', refresh, true);
      cue.cleanup = () => {
        win.removeEventListener('activate', activate);
        win.removeEventListener('deactivate', deactivate);
        win.removeEventListener('resize', refresh);
        win.removeEventListener('scroll', refresh, true);
      };
    }

    // hasFocus() on a chrome document can be false while its embedded PDF is
    // active. Use the top-level active window, including during early startup.
    const activeWindow = Services.focus?.activeWindow;
    if (activeWindow) cue.active = this._sameReaderFocusWindow(activeWindow, cue.win);
    const selected = this._readerFocusCueSelected(cue, reader);
    const editor = selected ? this._getActiveContextNoteEditor(cue.win) : null;
    const noteWin = this._getContextNoteEditorWindow(editor);
    const noteHost = editor?.getBoundingClientRect ? editor
      : editor?._iframe || noteWin?.frameElement;
    cue.note = noteWin && noteHost ? { win: noteWin, host: noteHost } : null;
    const wanted = new Map();
    wanted.set(cue.win.document, { kind: 'chrome', win: cue.win });
    if (reader._iframeWindow?.document) {
      wanted.set(reader._iframeWindow.document, { kind: 'reader', win: reader._iframeWindow });
    }
    for (const view of [reader._internalReader?._primaryView, reader._internalReader?._secondaryView]) {
      const pdfWin = view?._iframeWindow;
      if (pdfWin?.document) wanted.set(pdfWin.document, { kind: 'pdf', win: pdfWin });
    }
    if (cue.note) wanted.set(noteWin.document, { kind: 'note', win: noteWin });
    const owner = cue.owner;
    if (owner && ['pdf', 'outline'].includes(owner.kind)
        && (wanted.get(owner.doc)?.kind !== 'pdf'
          || (owner.kind === 'outline' && !state._outlineExplorerOverlay?.isConnected))) {
      // A disappearing view is different from an intentional toolbar focus.
      // Wait for evidence of focus in a surviving region; do not call focus().
      cue.pendingRecovery = { doc: owner.doc, role: owner.role };
      cue.owner = null;
    }
    for (const [doc, layer] of cue.layers) {
      if (doc === cue.win.document || wanted.has(doc)) continue;
      this._removeReaderFocusCueLayer(layer);
      cue.layers.delete(doc);
    }
    for (const [doc, binding] of cue.bindings) {
      if (wanted.has(doc)) continue;
      this._removeReaderFocusCueBinding(doc, binding);
      cue.bindings.delete(doc);
      if (cue.owner?.doc === doc) cue.owner = null;
    }
    for (const [doc, region] of wanted) {
      if (cue.bindings.has(doc)) continue;
      const input = event => this._onReaderFocusCueEvent(state, region, event);
      const refresh = () => this._queueReaderFocusCue(state);
      // Gecko iframe activation can emit window focus without document focusin.
      // Keep this on the content window so chrome/reader body focus stays incidental.
      const focus = ['pdf', 'note'].includes(region.kind) ? () => input({
        type: 'focus', target: region.win.document.activeElement,
      }) : null;
      for (const type of ['pointerdown', 'focusin', 'keydown']) {
        doc.addEventListener(type, input, true);
      }
      doc.addEventListener('scroll', refresh, true);
      region.win.addEventListener('resize', refresh);
      if (focus) region.win.addEventListener('focus', focus);
      cue.bindings.set(doc, { input, refresh, focus, win: region.win });
      // A new split may already be focused before this observer is installed.
      // Seed only newly observed documents from real focus, never activePdfWin
      // or a retained activeElement in another frame.
      if (focus && (Services.focus?.focusedWindow?.document === doc
          || (region.kind === 'note' && doc.hasFocus?.() === true))) {
        focus();
      }
    }
    this._syncReaderFocusCueNativeFocus(state, wanted);
    this._recoverReaderFocusCueOwner(state, wanted);
    this._queueReaderFocusCue(state);
  },

  /** Resolve a native PDF iframe element without trusting arbitrary child frames. */
  _readerFocusCuePdfFrameWindow(state, frame) {
    if (!frame) return null;
    const ir = state.reader?._internalReader;
    for (const view of [ir?._primaryView, ir?._secondaryView]) {
      const win = view?._iframeWindow;
      if (!win) continue;
      try {
        if (view._iframe === frame || this._sameReaderFocusWindow(frame.contentWindow, win)) {
          return win;
        }
      } catch (_) {} // A frame may disappear while its document is being replaced.
    }
    return null;
  },

  /**
   * Native PDFView.focus() focuses the outer iframe element. Its child can
   * receive keys without an inner focus event. Observe changes in this native
   * focus chain even while both views remain alive. Remember the last sample
   * so retained native focus cannot overwrite later logical tree/toolbar input.
   * This reads focus only; it never calls focus() or consumes input.
   */
  _syncReaderFocusCueNativeFocus(state, regions) {
    const cue = state._focusCue;
    if (!cue.active || !this._readerFocusCueSelected(cue, state.reader)) return;
    let doc = null;
    try { doc = Services.focus?.focusedWindow?.document; } catch (_) {}
    const outerDoc = state.reader._iframeWindow?.document;
    const active = outerDoc?.activeElement;
    const frameWin = this._readerFocusCuePdfFrameWindow(state, active);
    const frame = frameWin ? active : null;
    const frameDoc = frameWin?.document;
    const chromeDoc = cue.win.document;
    const chromeActive = chromeDoc.activeElement;
    const previous = cue.nativeFocus;
    cue.nativeFocus = { doc, frame, frameDoc, chromeActive };
    const docChanged = doc !== previous?.doc;
    const frameChanged = frame !== previous?.frame || frameDoc !== previous?.frameDoc;
    if (!docChanged && !frameChanged && chromeActive === previous?.chromeActive) return;

    const region = regions.get(doc);
    // Parent documents retain their iframe activeElement while notes or native
    // toolbar controls have focus. Such retained elements are not evidence of
    // focus returning to the PDF.
    if (region?.kind === 'note'
        || (chromeActive && chromeActive !== chromeDoc.body
          && chromeActive !== chromeDoc.documentElement && chromeActive !== state.reader._iframe)
        || (active && active !== outerDoc.body && active !== outerDoc.documentElement && !frameWin)) {
      return;
    }
    let target = null;
    if (region?.kind === 'pdf' && docChanged) {
      target = region.win;
    } else if (frameWin && (['pdf', 'reader'].includes(region?.kind)
        || (region?.kind === 'chrome' && chromeActive === state.reader._iframe))) {
      target = frameWin;
    }
    if (target) {
      const tree = this._readerOutlineExplorerFocused(state, target);
      this._setReaderFocusCueOwner(state, tree ? 'outline' : 'pdf', target);
    }
  },

  /**
   * Reconcile a destroyed PDF view when native focus has returned to the
   * reader. Keep a pending recovery across delayed view creation, but never
   * infer focus from activePdfWin alone: notes and toolbars can own input.
   */
  _recoverReaderFocusCueOwner(state, regions) {
    const cue = state._focusCue;
    const pending = cue.pendingRecovery;
    if (!pending || cue.owner || !cue.active
        || !this._readerFocusCueSelected(cue, state.reader)) return;
    let focusedDoc = null;
    try { focusedDoc = Services.focus?.focusedWindow?.document; } catch (_) {}
    const region = regions.get(focusedDoc);
    if (region?.kind === 'note') {
      this._setReaderFocusCueOwner(state, 'note', region.win);
      return;
    }
    if (region?.kind === 'pdf') {
      const tree = this._readerOutlineExplorerFocused(state, region.win);
      this._setReaderFocusCueOwner(state, tree ? 'outline' : 'pdf', region.win);
      return;
    }
    const reader = state.reader;
    let inReader = false;
    if (region?.kind === 'reader') {
      const doc = region.win.document;
      const active = doc.activeElement;
      if (active?.contentWindow) {
        const child = regions.get(active.contentWindow.document);
        if (child?.kind === 'pdf') {
          this._setReaderFocusCueOwner(state, 'pdf', child.win);
          return;
        }
      }
      inReader = active === doc.body || active === doc.documentElement;
      if (!inReader) return; // Native find inputs, buttons and annotation editors.
    } else {
      const active = cue.win.document.activeElement;
      // Chrome may still report the removed child window during teardown.
      // The reader browser must also have focus before falling back to a pane.
      inReader = active === reader._iframe
        && (!focusedDoc || focusedDoc === cue.win.document || focusedDoc === pending.doc);
    }
    if (!inReader) return;
    const ir = reader._internalReader;
    const preferred = pending.role === 'secondary' ? ir?._secondaryView : ir?._primaryView;
    const target = preferred?._iframeWindow || ir?._primaryView?._iframeWindow;
    if (target && regions.get(target.document)?.kind === 'pdf') {
      this._setReaderFocusCueOwner(state, 'pdf', target);
    }
  },

  /**
   * Gecko embeds PDF content inside a XUL browser. A chrome sibling overlay
   * is not a reliable paint surface above that browser's content/compositor.
   * Draw locally for PDFs/outline; keep note frames in chrome, outside the
   * editor's managed DOM. All layers are fixed and pointer-transparent.
   */
  _readerFocusCueLayer(cue, win) {
    const doc = win.document;
    let layer = cue.layers.get(doc);
    try {
      if (layer?.element.isConnected && layer.style.isConnected && layer.marker.isConnected) {
        return layer;
      }
    } catch (_) {} // A replaced content document can expose dead DOM wrappers.
    if (layer) {
      if (cue.element === layer.element) cue.paintedOwner = null;
      this._removeReaderFocusCueLayer(layer);
      cue.layers.delete(doc);
    }
    const h = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    const style = h('style');
    style.style.cssText = 'display:none!important;';
    style.textContent =
      '@media(prefers-reduced-motion:reduce){.zv-focus-frame{transition:none!important;}}' +
      '@media(forced-colors:active){.zv-focus-frame{box-shadow:none!important;' +
      'border:1px solid CanvasText!important;}}';
    const element = h('div');
    element.className = 'zv-focus-frame';
    element.setAttribute('aria-hidden', 'true');
    element.style.cssText =
      'position:fixed!important;display:block!important;z-index:100001;' +
      'left:0;top:0;width:0;height:0;min-width:0;min-height:0;' +
      'margin:0!important;padding:0!important;border:0;outline:none!important;' +
      'pointer-events:none!important;user-select:none;box-sizing:border-box;' +
      'border-radius:5px;opacity:0;transition:opacity 140ms ease;';
    const marker = h('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.style.cssText =
      'position:absolute!important;display:none;width:6px;height:6px;' +
      'min-width:0;min-height:0;margin:0!important;padding:0!important;border:0!important;' +
      'border-radius:50%;background:CanvasText;box-shadow:0 0 0 1px Canvas;' +
      'opacity:0.72;pointer-events:none!important;user-select:none;';
    element.appendChild(marker);
    (doc.body || doc.documentElement).appendChild(style);
    (doc.body || doc.documentElement).appendChild(element);
    layer = { win, element, marker, style, animation: null };
    cue.layers.set(doc, layer);
    return layer;
  },

  /**
   * PDF-only focus dot at the marked upper-right viewport location. It uses
   * fixed CSS pixels, avoids native scrollbars, and follows pane resizing.
   * Directory and note focus retain their existing frame-only appearance.
   */
  _positionReaderFocusMarker(layer, owner, box, inset) {
    const style = layer.marker.style;
    style.display = 'none';
    if (owner.kind !== 'pdf') return;
    const win = owner.win;
    const container = win.PDFViewerApplication?.pdfViewer?.container
      || win.document.getElementById?.('viewerContainer');
    let rightGap = 0;
    let topGap = 0;
    if (container?.clientWidth > 0 && container.getBoundingClientRect) {
      const rect = container.getBoundingClientRect();
      const contentRight = rect.left + (container.clientLeft || 0) + container.clientWidth;
      rightGap = Math.max(0, box.right - contentRight);
      topGap = Math.max(0, rect.top + (container.clientTop || 0) - box.top);
    }
    const right = 10 + rightGap;
    const top = 6 + topGap;
    const width = box.right - box.left - inset * 2;
    const height = box.bottom - box.top - inset * 2;
    if (width < right + 10 || height < top + 10) return;
    style.right = right + 'px';
    style.top = top + 'px';
    style.display = 'block';
  },

  _hideReaderFocusCueLayers(cue, except = null) {
    for (const layer of cue.layers.values()) {
      if (layer === except) continue;
      this._hideReaderFocusCueLayer(layer);
    }
    if (!except) {
      cue.animation = null;
      cue.paintedOwner = null;
    }
  },

  _hideReaderFocusCueLayer(layer) {
    try { layer.animation?.cancel(); } catch (_) {}
    layer.animation = null;
    try { layer.element.style.opacity = '0'; } catch (_) {}
  },

  _removeReaderFocusCueLayer(layer) {
    this._hideReaderFocusCueLayer(layer);
    try { layer.element.remove(); } catch (_) {}
    try { layer.style.remove(); } catch (_) {}
  },

  /** A keyboard request can focus a newly created note before its next scan. */
  _focusCueContextNote(win) {
    try {
      const reader = Zotero.Reader.getByTabID?.(win.Zotero_Tabs?.selectedID) || win.reader;
      const state = reader && this._readerState.get(reader._instanceID);
      if (!state) return;
      this._syncReaderFocusCue(reader, state);
      if (state._focusCue?.note) {
        this._setReaderFocusCueOwner(state, 'note', state._focusCue.note.win);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] note focus cue: ' + e);
    }
  },

  _removeReaderFocusCueBinding(doc, binding) {
    for (const type of ['pointerdown', 'focusin', 'keydown']) {
      try { doc.removeEventListener(type, binding.input, true); } catch (_) {}
    }
    try { doc.removeEventListener('scroll', binding.refresh, true); } catch (_) {}
    try { binding.win.removeEventListener('resize', binding.refresh); } catch (_) {}
    if (binding.focus) {
      try { binding.win.removeEventListener('focus', binding.focus); } catch (_) {}
    }
  },

  /** Read-only input observation, also used by explicit Vim focus commands. */
  _onReaderFocusCueEvent(state, region, event) {
    const cue = state._focusCue;
    if (!cue) return;
    if (event.type === 'pointerdown' || event.type === 'keydown') {
      state._readerSplitFocus = null;
    }
    const target = event.target;
    if (region.kind === 'chrome') {
      // Gecko can capture the original content event in chrome. Its content
      // document's observer (or _onKeyDown) supplies the precise region.
      if (target?.ownerDocument && target.ownerDocument !== cue.win.document) return;
      if (event.type === 'focusin' && (target === cue.win.document.body
          || target === cue.win.document.documentElement)) return;
      if (cue.note?.host.contains?.(target)) {
        this._setReaderFocusCueOwner(state, 'note', cue.note.win);
      } else if (target === state.reader?._iframe) {
        this._queueReaderFocusCue(state);
      } else {
        this._setReaderFocusCueOwner(state, null);
      }
      return;
    }
    if (region.kind === 'reader') {
      if (target?.ownerDocument && target.ownerDocument !== region.win.document) return;
      if (target?.contentWindow) {
        const pdfWin = this._readerFocusCuePdfFrameWindow(state, target);
        if (pdfWin) {
          const tree = this._readerOutlineExplorerFocused(state, pdfWin);
          this._setReaderFocusCueOwner(state, tree ? 'outline' : 'pdf', pdfWin);
        }
        return;
      }
      if (event.type === 'focusin'
          && (target === region.win.document.body || target === region.win.document.documentElement)) {
        return; // Incidental frame-body focus does not replace a content owner.
      }
      this._setReaderFocusCueOwner(state, null);
      return;
    }
    if (region.kind === 'note') {
      this._setReaderFocusCueOwner(state, 'note', region.win);
      return;
    }
    const outline = state._outlineExplorerOverlay;
    const inTree = outline?.ownerDocument === region.win.document && outline.contains(target);
    const logicalTree = this._readerOutlineExplorerFocused(state, region.win);
    const tree = event.type === 'pointerdown' ? inTree : inTree || logicalTree;
    this._setReaderFocusCueOwner(state, tree ? 'outline' : 'pdf', region.win);
  },

  _setReaderFocusCueOwner(state, kind, win = null) {
    const cue = state?._focusCue;
    if (!cue) return;
    if (kind === 'pdf' || kind === 'outline') state.activePdfWin = win;
    else state._readerSplitFocus = null;
    const ir = state.reader?._internalReader;
    const role = ['pdf', 'outline'].includes(kind)
      ? (ir?._secondaryView?._iframeWindow
        && this._sameReaderFocusWindow(win, ir._secondaryView._iframeWindow)
        ? 'secondary' : 'primary') : null;
    cue.owner = kind ? { kind, win, doc: win?.document, role } : null;
    cue.pendingRecovery = null;
    this._queueReaderFocusCue(state);
  },

  _queueReaderFocusCue(state) {
    const cue = state._focusCue;
    if (!cue || cue.frame !== null) return;
    try {
      cue.frame = cue.win.requestAnimationFrame(() => {
        cue.frame = null;
        if (state._focusCue === cue) {
          try { this._paintReaderFocusCue(state); } catch (e) {
            this._hideReaderFocusCueLayers(cue);
            Zotero.debug('[ZoteroVim] focus cue paint: ' + e);
          }
        }
      });
    } catch (_) {} // A reader window can close before its next view-sync tick.
  },

  /**
   * Project into the requested drawing document, clipping at each viewport.
   * PDF/outline use their own window and return before reading frameElement;
   * notes can still project an outer editor host into chrome coordinates.
   * Frame transforms and borders are included without changing containers.
   */
  _projectReaderFocusRect(rect, sourceWin, cue, reader, targetWin = cue.win) {
    let box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    let win = sourceWin;
    for (let depth = 0; depth < 8; depth++) {
      const viewport = this._readerFocusViewport(win);
      box.left = Math.max(0, box.left);
      box.top = Math.max(0, box.top);
      box.right = Math.min(viewport.width, box.right);
      box.bottom = Math.min(viewport.height, box.bottom);
      if (box.right <= box.left || box.bottom <= box.top) return null;
      if (this._sameReaderFocusWindow(win, targetWin)) return box;
      const view = [reader._internalReader?._primaryView, reader._internalReader?._secondaryView]
        .find(candidate => this._sameReaderFocusWindow(candidate?._iframeWindow, win));
      const frame = view?._iframe || win.frameElement
        || (this._sameReaderFocusWindow(win, reader._iframeWindow) ? reader._iframe : null);
      if (!frame?.isConnected) return null;
      const bounds = frame.getBoundingClientRect();
      const sx = frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
      const sy = frame.offsetHeight ? bounds.height / frame.offsetHeight : 1;
      const left = bounds.left + (frame.clientLeft || 0) * sx;
      const top = bounds.top + (frame.clientTop || 0) * sy;
      box = { left: left + box.left * sx, top: top + box.top * sy,
        right: left + box.right * sx, bottom: top + box.bottom * sy };
      win = frame.ownerDocument.defaultView;
    }
    return null;
  },

  /** Appearance is centralized here so later cue styles can share ownership. */
  _paintReaderFocusCue(state) {
    const cue = state._focusCue;
    const reader = state.reader;
    const owner = cue?.owner;
    if (!cue) return;
    const hide = () => this._hideReaderFocusCueLayers(cue);
    if (!owner || !cue.active || (reader._iframe && !reader._iframe.isConnected)
        || !this._readerFocusCueSelected(cue, reader)
        || state._outlinePicker || state._translationPopup || state.marksExplorerOpen
        || state._commentOverlay || this._mainWindowState.get(cue.win)?.pickerOpen
        || this._mainWindowState.get(cue.win)?.notesLayoutOpen) {
      hide();
      return;
    }
    let rect;
    let win = owner.win;
    let surface;
    if (owner.kind === 'outline') {
      surface = state._outlineExplorerOverlay;
      if (!this._readerOutlineExplorerFocused(state, win)) { hide(); return; }
      rect = surface.getBoundingClientRect();
    } else if (owner.kind === 'pdf') {
      const ir = reader._internalReader;
      if (![ir?._primaryView, ir?._secondaryView].some(view => view?._iframeWindow === win)) {
        hide(); return;
      }
      const viewport = this._readerFocusViewport(win);
      rect = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
      const tree = state._outlineExplorerOverlay;
      if (state.outlineExplorerOpen && state._outlineExplorerPdfWin === win
          && tree?.isConnected && tree.style.visibility !== 'hidden') {
        rect.left = Math.max(0, tree.getBoundingClientRect().right);
      }
    } else if (owner.kind === 'note') {
      surface = cue.note?.win === win ? cue.note.host : null;
      if (!surface?.isConnected) { hide(); return; }
      rect = surface.getBoundingClientRect();
      win = surface.ownerDocument.defaultView;
    }
    if (!rect) { hide(); return; }
    const paintWin = owner.kind === 'note' ? cue.win : owner.win;
    const box = this._projectReaderFocusRect(rect, win, cue, reader, paintWin);
    const inset = 1;
    if (!box || box.right - box.left <= inset * 2
        || box.bottom - box.top <= inset * 2) { hide(); return; }
    const layer = this._readerFocusCueLayer(cue, paintWin);
    this._hideReaderFocusCueLayers(cue, layer);
    cue.element = layer.element;
    const style = layer.element.style;
    // Directory overlays can use a dark surface in a light Zotero theme;
    // derive the neutral ink from that surface's actual foreground color.
    const inkSurface = surface || cue.win.document.documentElement;
    const ink = inkSurface.ownerDocument.defaultView.getComputedStyle(inkSurface).color;
    if (ink) style.setProperty('--zv-focus-ink', ink);
    else style.removeProperty('--zv-focus-ink');
    style.boxShadow = 'inset 0 0 0 1px color-mix(in srgb,' + (ink || 'CanvasText')
      + ' 24%,transparent)';
    style.left = (box.left + inset) + 'px';
    style.top = (box.top + inset) + 'px';
    style.width = (box.right - box.left - inset * 2) + 'px';
    style.height = (box.bottom - box.top - inset * 2) + 'px';
    this._positionReaderFocusMarker(layer, owner, box, inset);
    layer.element.setAttribute('data-region', owner.kind);
    style.opacity = '1';
    const changed = cue.paintedOwner?.kind !== owner.kind || cue.paintedOwner?.win !== owner.win;
    cue.paintedOwner = owner;
    if (changed && layer.element.animate
        && !paintWin.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      layer.animation?.cancel();
      layer.animation = layer.element.animate(
        Components.utils.cloneInto([{ opacity: 0 }, { opacity: 1 }], paintWin),
        Components.utils.cloneInto({ duration: 140, easing: 'ease-out' }, paintWin));
    }
    cue.animation = layer.animation;
  },

  _clearReaderFocusCue(state) {
    const cue = state._focusCue;
    if (!cue) return;
    state._focusCue = null;
    if (cue.frame !== null) cue.win.cancelAnimationFrame(cue.frame);
    cue.cleanup();
    for (const [doc, binding] of cue.bindings) this._removeReaderFocusCueBinding(doc, binding);
    cue.bindings.clear();
    for (const layer of cue.layers.values()) this._removeReaderFocusCueLayer(layer);
    cue.layers.clear();
  },
});

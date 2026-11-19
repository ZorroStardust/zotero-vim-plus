/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */

/**
 * Zotero Vim Plus — reader-side methods: outline explorer, visual /
 * cursor mode, annotations. Loaded by bootstrap.js after zoteroVim.js;
 * every method here is merged onto the ZoteroVim object.
 */

Object.assign(ZoteroVim, {
  /** Open Zotero's own appearance popup so theme changes use its normal preferences path. */
  _openReaderThemePicker(state, reader, pdfWin) {
    const doc = reader._iframeWindow?.document;
    const toolbar = doc?.querySelector('button#appearance');
    const zh = this._isZhLocale();
    if (!pdfWin?.PDFViewerApplication || !toolbar) {
      this._showStatus(state, zh ? '无法打开 PDF 主题浮窗' : 'PDF themes are unavailable');
      return;
    }

    this._clearReaderThemePicker(state);
    this._stopSmoothHoldScroll(state, pdfWin);
    const win = reader._window || reader._iframe?.ownerDocument?.defaultView;
    const popup = doc.querySelector('.appearance-popup');
    state._readerThemePicker = {
      doc, toolbar, win, popup, tabID: win?.Zotero_Tabs?.selectedID, hints: [], prefix: '',
    };
    if (!popup) toolbar.click();
    this._showStatus(state, zh ? '按 f 显示主题提示 · Esc 关闭'
      : 'f shows theme hints · Esc closes', 3000);
  },

  _syncReaderThemePicker(state) {
    const ui = state._readerThemePicker;
    if (!ui) return;
    const popup = ui.doc.querySelector('.appearance-popup');
    if (!popup || !ui.toolbar.isConnected || ui.tabID !== ui.win?.Zotero_Tabs?.selectedID
        || state.mode !== 'normal' || (ui.popup && ui.popup !== popup)) {
      this._clearReaderThemePicker(state);
    } else {
      ui.popup = popup;
    }
  },

  _clearReaderThemePicker(state) {
    const ui = state._readerThemePicker;
    if (!ui) return;
    state._readerThemePicker = null;
    for (const { badge } of ui.hints) badge.remove();
  },

  _readerThemePickerOwnsKey(state, key) {
    const ui = state._readerThemePicker;
    return !!ui && (key === 'escape' || key === 'f'
      || (ui.hints.length > 0 && /^[a-z]$/i.test(key)));
  },

  /** Label native theme buttons in place and invoke their original click handlers. */
  _onReaderThemePickerKeyDown(event, state) {
    const ui = state._readerThemePicker;
    if (!ui || event.isComposing || event.keyCode === 229) return false;
    const key = this._keyString(event);
    if (!this._readerThemePickerOwnsKey(state, key)) return false;
    const popup = ui.doc.querySelector('.appearance-popup');
    if (key !== 'escape' && !popup) return false;
    if (ui.tabID !== ui.win?.Zotero_Tabs?.selectedID) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return true;

    if (key === 'escape') {
      this._clearReaderThemePicker(state);
      // Zotero may already have handled Escape in its outer window listener.
      if (popup && ui.toolbar.classList.contains('active')) ui.toolbar.click();
    } else if (key === 'f') {
      ui.popup = popup;
      for (const { badge } of ui.hints) badge.remove();
      ui.prefix = '';
      const buttons = Array.from(popup.querySelectorAll('button.theme:not(.add)'));
      // The outer reader receives keys before our document listener. Keep
      // native tool and Read Aloud shortcuts out of every hint position.
      const alphabet = this._hintAlphabet().replace(/[FHLRSU]/g, '');
      const labels = this._flashLabels(buttons.length, new Set(), alphabet);
      ui.hints = buttons.map((button, index) => {
        const badge = ui.doc.createElement('span');
        badge.setAttribute('aria-hidden', 'true');
        badge.style.cssText = 'position:absolute;inset-block-start:1px;inset-inline-start:1px;'
          + 'pointer-events:none;padding:0 3px;'
          + 'border-radius:3px;background:var(--zv-theme-hint, #ffd400);'
          + 'color:var(--zv-theme-on-hint, #000);font:bold 11px/1.2 monospace;';
        badge.textContent = labels[index];
        button.prepend(badge);
        return { button, badge, label: labels[index] };
      });
    } else {
      const prefix = ui.prefix + key.toUpperCase();
      const matches = ui.hints.filter(hint => hint.label.startsWith(prefix));
      const selected = matches.find(hint => hint.label === prefix && popup.contains(hint.button));
      if (selected) {
        this._clearReaderThemePicker(state);
        selected.button.click();
        if (ui.toolbar.classList.contains('active')) ui.toolbar.click();
      } else {
        ui.prefix = matches.length ? prefix : '';
        for (const { badge, label } of ui.hints) {
          badge.hidden = !label.startsWith(ui.prefix);
        }
      }
    }
    return true;
  },

  /**
   * Set native PDF page pairing in the key event's pane. Entering from single
   * page saves that pane's zoom/scroll mode; leaving restores them at the
   * current reading page. Parity and restore state belong to this reader's
   * individual PDF windows, and expire when a window is replaced.
   * @param {number|string} mode 0/1/2, 'toggle', or 'parity'.
   */
  _setReaderSpreadMode(state, reader, pdfWin, mode) {
    const ir = reader?._internalReader;
    const view = [ir?._primaryView, ir?._secondaryView]
      .find(candidate => candidate && candidate._iframeWindow === pdfWin);
    const viewer = pdfWin?.PDFViewerApplication?.pdfViewer;
    if (!view || !viewer || ![0, 1, 2].includes(viewer.spreadMode)) {
      this._showStatus(state, '✗ Page layout is only available in PDF readers', 1500);
      return false;
    }
    if (!viewer.pagesCount) {
      this._showStatus(state, 'PDF is still loading', 1200);
      return false;
    }

    const layouts = state._readerPageLayouts || (state._readerPageLayouts = new WeakMap());
    const saved = layouts.get(pdfWin) || { lastSpreadMode: 1, restore: null };
    const before = {
      spreadMode: viewer.spreadMode,
      scrollMode: viewer.scrollMode,
      scale: viewer.currentScaleValue,
    };
    if (mode === 'toggle') mode = before.spreadMode ? 0 : saved.lastSpreadMode;
    else if (mode === 'parity') mode = before.spreadMode === 2 ? 1 : 2;
    if (![0, 1, 2].includes(mode)) return false;

    const label = ['Single page', 'Two pages · odd starts (1–2, 3–4)',
      'Two pages · even starts (1, 2–3, 4–5)'][mode];
    if (mode === before.spreadMode) {
      if (mode) saved.lastSpreadMode = mode;
      layouts.set(pdfWin, saved);
      this._showStatus(state, label, 1400);
      return true;
    }

    // Only primitives cross into the content compartment. Prefer Zotero's
    // layout methods so its menus, statistics and document state stay in sync.
    const setSpread = value => {
      if (typeof view.setSpreadMode === 'function') view.setSpreadMode(value);
      else viewer.spreadMode = value;
    };
    const setScroll = value => {
      if (typeof view.setScrollMode === 'function') view.setScrollMode(value);
      else viewer.scrollMode = value;
    };
    const restore = before.spreadMode === 0 ? before : saved.restore;
    this._stopSmoothHoldScroll(state, pdfWin);
    try {
      if (mode) {
        if (!before.spreadMode) setScroll(0);
        setSpread(mode);
        if (!before.spreadMode) {
          if (typeof view.zoomPageHeight === 'function') view.zoomPageHeight();
          else viewer.currentScaleValue = 'page-fit';
        }
      } else {
        setSpread(0);
        if (restore) {
          setScroll(restore.scrollMode);
          if (restore.scale) viewer.currentScaleValue = restore.scale;
        }
      }
      if (viewer.spreadMode !== mode
          || (mode && !before.spreadMode && viewer.scrollMode !== 0)) {
        throw new Error('Reader did not apply the requested page layout');
      }
    } catch (e) {
      // A failed transition must not discard the single-page restore point.
      try {
        setSpread(before.spreadMode);
        setScroll(before.scrollMode);
        if (before.scale) viewer.currentScaleValue = before.scale;
      } catch (rollbackError) {
        Zotero.debug('[ZoteroVim] restore page layout: ' + rollbackError);
      }
      Zotero.debug('[ZoteroVim] set page layout: ' + e);
      this._showStatus(state, '✗ Could not change PDF page layout', 1500);
      return false;
    }

    layouts.set(pdfWin, {
      lastSpreadMode: mode || before.spreadMode,
      restore: mode ? restore : null,
    });
    this._showStatus(state, label, 1400);
    return true;
  },

  /** Record dot-repeat only when the requested mutation has a real target. */
  _readerChangeTargetAvailable(action, reader, state, pdfWin) {
    if (/^(highlight|underline|addNote)/.test(action)) {
      if (!state?._orderedVisual && state?.selectionParams?.annotation) return true;
      if (!state?._orderedVisual && Date.now() - (this._lastSelectionTS || 0) < 10000
          && this._lastSelectionParams?.annotation) return true;
      try {
        return !!this._readerSelectedText(state, pdfWin);
      } catch (_) {
        return false;
      }
    }
    return !!this._selectedAnnotationKey?.(state, reader);
  },

  _readerHistoryView(reader, pdfWin) {
    const ir = reader?._internalReader;
    for (const [view, primary] of [[ir?._primaryView, true], [ir?._secondaryView, false]]) {
      if (!view || view._iframeWindow !== pdfWin) continue;
      return typeof ir._getActiveView === 'function' ? ir._getActiveView(primary) : view;
    }
    return ir?._lastView || ir || null;
  },

  /** Commit a major plugin jump to Zotero's native per-view history. */
  _recordReaderHistoryPoint(reader, state, pdfWin, afterNavigation = null) {
    const target = this._readerHistoryView(reader, pdfWin);
    if (typeof target?._pushHistoryPoint !== 'function') return Promise.resolve(false);
    const previous = state._readerHistoryPending || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      try {
        if (afterNavigation) await afterNavigation;
        await target._pushHistoryPoint();
        return true;
      } catch (e) {
        Zotero.debug('[ZoteroVim] record reader history: ' + e);
        return false;
      }
    });
    state._readerHistoryPending = pending;
    pending.finally(() => {
      if (state._readerHistoryPending === pending) state._readerHistoryPending = null;
    });
    return pending;
  },

  /**
   * Traverse Zotero's session history, independently of user marks. Select the
   * focused split pane rather than relying on Zotero's last-view focus cache.
   * Native navigation owns locations, forward-stack invalidation and scrolling.
   */
  _navigateReaderHistory(reader, state, pdfWin, forward, count = 1) {
    if (state._readerHistoryPending) {
      state._readerHistoryPending
        .then(() => this._navigateReaderHistory(reader, state, pdfWin, forward, count))
        .catch(e => Zotero.debug('[ZoteroVim] wait for reader history: ' + e));
      return;
    }
    const ir = reader?._internalReader;
    const method = forward ? 'navigateForward' : 'navigateBack';
    const capability = forward ? 'canNavigateForward' : 'canNavigateBack';
    let target = this._readerHistoryView(reader, pdfWin);
    let statsKey = null;
    for (const [view, primary] of [[ir?._primaryView, true], [ir?._secondaryView, false]]) {
      if (!view || view._iframeWindow !== pdfWin) continue;
      statsKey = primary ? 'primaryViewStats' : 'secondaryViewStats';
      break;
    }
    if (typeof target?.[method] !== 'function') {
      this._showStatus(state, '✗ Reading history unavailable', 1500);
      return;
    }
    let moved = 0;
    for (let i = 0; i < Math.max(1, count); i++) {
      // The history getters update synchronously; view stats are the fallback
      // for older readers. Unknown capability is left to the native method.
      const available = target._history?.[capability] ?? ir?._state?.[statsKey]?.[capability];
      if (available === false) break;
      target[method]();
      moved++;
    }
    if (moved) state.lastAnnotationKey = null;
    else this._showStatus(state, forward ? 'No later reading position' : 'No earlier reading position', 1200);
  },

  // ── Heading picker and outline explorer ────────────────────────────────────

  /**
   * Track the reader's chosen region instead of comparing Gecko window wrappers.
   * DOM focus can temporarily be on the iframe body during chrome forwarding,
   * or .focus() can leave activeElement unchanged in restored reader frames.
   */
  _readerOutlineExplorerFocused(state, pdfWin = null) {
    const overlay = state._outlineExplorerOverlay;
    return !!(state.outlineExplorerOpen && overlay?.isConnected
      && overlay.style.visibility !== 'hidden' && state._outlineExplorerFocused
      && (!pdfWin || state._outlineExplorerPdfWin === pdfWin));
  },

  /** Report command ownership to the separate, read-only focus appearance layer. */
  _setReaderOutlineExplorerFocus(state, focused) {
    state._outlineExplorerFocused = focused;
    if (state._outlineExplorerHeader) {
      state._outlineExplorerHeader.textContent = this._isZhLocale() ? '目录' : 'Outline';
    }
    if (focused) {
      this._setReaderFocusCueOwner?.(state, 'outline', state._outlineExplorerPdfWin);
    } else if (state._focusCue?.owner?.kind === 'outline') {
      this._setReaderFocusCueOwner?.(state, 'pdf', state._outlineExplorerPdfWin);
    }
  },

  /** Explicit focus intent survives a failed DOM focus and preserves tree scroll. */
  _focusReaderOutlineElement(state) {
    const overlay = state._outlineExplorerOverlay;
    if (!overlay?.isConnected) return;
    const viewWin = state._outlineExplorerPdfWin;
    state.activePdfWin = viewWin;
    try { viewWin?.focus(); } catch (_) {}
    try { overlay.focus(); } catch (_) {}
    this._setReaderOutlineExplorerFocus(state, true);
  },

  _focusReaderOutlineBody(state, pdfWin) {
    this._setReaderOutlineExplorerFocus(state, false);
    this._clearReaderOutlineExplorerHintBuffer(state);
    this._clearReaderOutlineExplorerCmdBuffer(state);
    try { state._outlineExplorerOverlay?.blur(); } catch (_) {}
    this._focusReaderPdfWindow(pdfWin, state);
  },

  /** Snapshot this pane before the picker takes focus; coordinates are PDF units. */
  _readerOutlineReadingPosition(pdfWin) {
    const viewer = pdfWin.PDFViewerApplication?.pdfViewer;
    const location = viewer?._location;
    const pageNumber = Number.isInteger(viewer?.currentPageNumber) && viewer.currentPageNumber > 0
      ? viewer.currentPageNumber : Math.max(1, location?.pageNumber || 1);
    const position = { pageIndex: pageNumber - 1, left: null, top: null, viewport: null };
    if (location?.pageNumber === pageNumber) {
      if (Number.isFinite(location.left)) position.left = location.left;
      if (Number.isFinite(location.top)) position.top = location.top;
    }
    try {
      const page = viewer?.getPageView?.(position.pageIndex) || viewer?._pages?.[position.pageIndex];
      position.viewport = page?.viewport || null;
      if (position.top === null) {
        const container = this._getScrollContainer(pdfWin);
        const bounds = container?.getBoundingClientRect?.();
        const rect = page?.div?.getBoundingClientRect?.();
        if (bounds && rect) {
          const x = Math.max(0, bounds.left + (container.clientLeft || 0)
            - rect.left - (page.div.clientLeft || 0));
          const y = Math.max(0, bounds.top + (container.clientTop || 0)
            - rect.top - (page.div.clientTop || 0));
          const point = page.getPagePoint?.(x, y) || position.viewport?.convertToPdfPoint?.(x, y);
          if (Number.isFinite(point?.[0])) position.left = point[0];
          if (Number.isFinite(point?.[1])) position.top = point[1];
        }
      }
    } catch (_) {} // Older/unrendered viewers can still be located by page number.
    return position;
  },

  /** Resolve destination metadata without navigating or modifying the saved tree. */
  async _readerOutlineHeadingPosition(entry, pdfDoc) {
    const position = { pageIndex: Number.isInteger(entry.pageIndex) && entry.pageIndex >= 0
      ? entry.pageIndex : null, left: null, top: null };
    try {
      let dest = entry.dest;
      if (!dest && entry.url) {
        const info = await this._resolveReaderOutlineUrlInfo(entry.url, pdfDoc);
        if (position.pageIndex === null) position.pageIndex = info.pageIndex;
        dest = info.dest;
      }
      if (typeof dest === 'string' && typeof pdfDoc?.getDestination === 'function') {
        dest = await pdfDoc.getDestination(dest);
      }
      if (position.pageIndex === null) {
        position.pageIndex = await this._resolveReaderOutlinePageIndex(entry, dest, pdfDoc);
      }
      if (!Array.isArray(dest)) return position;
      const mode = dest[1]?.name;
      const left = mode === 'XYZ' || mode === 'FitR' ? dest[2] : null;
      const top = mode === 'XYZ' ? dest[3]
        : mode === 'FitH' || mode === 'FitBH' ? dest[2] : mode === 'FitR' ? dest[5] : null;
      if (Number.isFinite(left)) position.left = left;
      if (Number.isFinite(top)) position.top = top;
    } catch (_) {} // Broken destinations retain any usable page metadata.
    return position;
  },

  /** Use the authored destination and let the page's text identify the visual cue. */
  async _goToReaderHeading(state, reader, pdfWin, entry, isCurrent, position = null) {
    const ok = await this._goToReaderOutlineEntry(reader, pdfWin, entry);
    if (ok && isCurrent()) void this._cueReaderHeading(state, pdfWin, entry, position);
    return ok;
  },

  async _cueReaderHeading(state, pdfWin, entry, position) {
    const app = pdfWin.PDFViewerApplication;
    const pdfDoc = app?.pdfDocument;
    const viewer = app?.pdfViewer;
    if (!pdfDoc || typeof viewer?.getPageView !== 'function') return;
    this._clearReaderJumpCue(state, pdfWin);
    const cues = state._readerJumpCues || (state._readerJumpCues = new Map());
    const pending = {};
    cues.set(pdfWin, pending);
    try {
      position ||= await this._readerOutlineHeadingPosition(entry, pdfDoc);
      if (!Number.isInteger(position.pageIndex) || !viewer.getPageView(position.pageIndex)) return;
      let region = null;
      if (typeof pdfDoc.getPage === 'function') {
        try {
          const page = await this._readerPdfPage(pdfDoc, position.pageIndex);
          if (cues.get(pdfWin) !== pending) return;
          const { items } = await page.getTextContent();
          region = this._readerHeadingTextRect(entry.title, this._readerPdfTextLines(items), position);
        } catch (e) {
          Zotero.debug('[ZoteroVim] locate heading text: ' + e);
        }
      }
      if (cues.get(pdfWin) !== pending || pdfWin.closed
          || pdfWin.PDFViewerApplication?.pdfDocument !== pdfDoc) return;
      const page = viewer.getPageView(position.pageIndex);
      region ||= this._readerJumpAnchorRect(page, position);
      if (region) this._showReaderJumpCue(state, pdfWin, page, region);
    } catch (e) {
      Zotero.debug('[ZoteroVim] cue outline heading: ' + e);
    } finally {
      if (cues.get(pdfWin) === pending) cues.delete(pdfWin);
    }
  },

  /** Match the literal heading, allowing the printed section number and wrapped lines. */
  _readerHeadingTextRect(title, lines, position) {
    const key = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const unnumber = text => text.replace(/^(?:\d+(?:\.\d+)*[.)]?|[IVXLCDM]+[.)]?)\s+/u, '');
    const query = key(unnumber(title));
    if (!query) return null;
    const lineRect = line => [line.x, line.y - line.height * 0.22, line.right, line.y + line.height];
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      const first = lines[i];
      let current = first;
      let text = key(unnumber(first.text));
      if (!text || !query.startsWith(text)) continue;
      let rect = lineRect(first);
      for (let j = i + 1; text !== query && j < lines.length; j++) {
        const next = lines[j];
        const step = current.y - next.y;
        if (step > current.height * 1.65) break;
        if (step < current.height * 0.6 || Math.abs(next.x - first.x) > first.height) continue;
        text += key(next.text);
        if (!query.startsWith(text)) break;
        rect = this._readerUnionRects(rect, lineRect(next));
        current = next;
      }
      if (text === query) matches.push(rect);
    }
    if (matches.length < 2) return matches[0] || null;
    if (!Number.isFinite(position.top)) return null;
    const distance = rect => Math.abs(rect[3] - position.top)
      + (Number.isFinite(position.left) ? Math.abs(rect[0] - position.left) * 0.3 : 0);
    return matches.sort((a, b) => distance(a) - distance(b))[0];
  },

  /**
   * Locate the last heading reached in the originating pane, across every depth.
   * Compare page-local destinations in viewport order (including rotation).
   * Page-only outlines degrade to page/order matching; an unknown outline starts at zero.
   */
  async _readerOutlineCurrentIndex(entries, pdfWin, reading) {
    const toViewY = point => {
      if (!Number.isFinite(point.top)) return null;
      try {
        const left = Number.isFinite(point.left) ? point.left : reading.left || 0;
        const result = reading.viewport?.convertToViewportPoint?.(left, point.top);
        if (Number.isFinite(result?.[1])) return result[1];
      } catch (_) {}
      return -point.top;
    };
    const currentY = toViewY(reading);
    const pdfDoc = pdfWin.PDFViewerApplication?.pdfDocument;
    const positions = await Promise.all(entries.map(entry =>
      this._readerOutlineHeadingPosition(entry, pdfDoc)));
    let selected = -1;
    let bestPage = -1;
    let bestY = -Infinity;
    let first = 0;
    let firstPage = Infinity;
    positions.forEach((position, index) => {
      const page = position.pageIndex;
      if (!Number.isInteger(page) || page < 0) return;
      if (page < firstPage) { first = index; firstPage = page; }
      if (page > reading.pageIndex) return;
      let y = -Infinity;
      if (page === reading.pageIndex && currentY !== null) {
        y = toViewY(position) ?? -Infinity;
        if (y > currentY + 1) return;
      }
      if (page > bestPage || (page === bestPage && y >= bestY)) {
        selected = index;
        bestPage = page;
        bestY = y;
      }
    });
    return selected >= 0 ? selected : first;
  },

  /**
   * Both <space>fh and tree-local / open this picker in the originating PDF
   * pane. Hiding the existing tree preserves its nodes, selection and scroll.
   * Async results belong to this popup instance and are ignored after closing.
   */
  async _openReaderOutlinePicker(state, reader, pdfWin, fromOutline = false, captions = false) {
    if (state._outlinePicker) {
      state._outlinePicker.input.focus();
      return;
    }
    const app = pdfWin?.PDFViewerApplication;
    if (!app?.pdfDocument) {
      this._showStatus(state, app ? 'PDF is still loading'
        : 'Search is only available in PDF readers', 1500);
      return;
    }
    const doc = pdfWin.document;
    const h = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    const zh = this._isZhLocale();
    const overlay = h('div');
    overlay.id = 'zv-outline-picker';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);' +
      'display:flex;align-items:flex-start;justify-content:center;padding-top:10vh;';
    const modal = h('div');
    modal.style.cssText =
      'width:min(680px,90%);max-height:75vh;display:flex;flex-direction:column;' +
      'background:var(--zv-theme-surface, #1e1e2e);color:var(--zv-theme-text, #cdd6f4);border-radius:8px;overflow:hidden;' +
      'box-shadow:0 16px 48px rgba(0,0,0,0.6);font:13px/1.4 sans-serif;';
    const input = h('input');
    input.type = 'text';
    input.placeholder = captions ? (zh ? '搜索 PDF 图表题注…' : 'Search PDF captions…')
      : (zh ? '搜索 PDF 目录标题…' : 'Search PDF headings…');
    input.setAttribute('aria-label', input.placeholder);
    input.style.cssText =
      'box-sizing:border-box;width:100%;padding:12px;background:var(--zv-theme-control, #313244);' +
      'color:var(--zv-theme-text, #cdd6f4);border:0;outline:none;font:inherit;flex-shrink:0;';
    const list = h('div');
    list.style.cssText = 'overflow:auto;min-height:0;max-height:55vh;';
    const status = h('div');
    status.style.cssText =
      'padding:8px 12px;border-top:1px solid var(--zv-theme-control, #313244);color:var(--zv-theme-muted, #a6adc8);font-size:11px;';
    status.textContent = zh
      ? '输入筛选 · Ctrl+j/k 或 ↑/↓ 选择 · Enter 跳转 · Esc 返回'
      : 'Type to filter · Ctrl+j/k or ↑/↓ select · Enter jump · Esc back';
    for (const node of [input, list, status]) modal.appendChild(node);
    overlay.appendChild(modal);
    const popup = {
      overlay, input, list, status, pdfWin, reader, state, zh, captions,
      pdfDoc: app.pdfDocument,
      readingPosition: this._readerOutlineReadingPosition(pdfWin), selectionTouched: false,
      outlineOverlay: fromOutline ? state._outlineExplorerOverlay : null,
      outlineScrollTop: state._outlineExplorerList?.scrollTop || 0,
      items: [], filtered: [], selected: 0, rows: [], loading: true,
      error: '', composing: false, activating: false,
    };
    state._outlinePicker = popup;
    if (popup.outlineOverlay) popup.outlineOverlay.style.visibility = 'hidden';
    this._stopSmoothHoldScroll(state, pdfWin);
    this._clearMarkKey(state);
    input.addEventListener('input', () => {
      if (state._outlinePicker !== popup) return;
      popup.selectionTouched = true;
      popup.selected = 0;
      this._filterReaderOutlinePicker(popup);
    });
    input.addEventListener('compositionstart', () => { popup.composing = true; });
    input.addEventListener('compositionend', () => { popup.composing = false; });
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) this._closeReaderOutlinePicker(state);
    });
    (doc.body || doc.documentElement).appendChild(overlay);
    this._renderReaderOutlinePicker(popup);
    input.focus();
    try {
      if (captions) {
        const entries = await this._readerCaptionTargets(state, reader, pdfWin);
        if (state._outlinePicker !== popup) return;
        popup.items = entries.map(entry => {
          const alias = (entry.kind === 'figure' ? 'Figure Fig 图 ' : 'Table 表 ') + entry.label;
          return { entry, breadcrumb: '', titleFields: [entry.title, alias]
            .map(value => this._pickerSearchField(value)), pathFields: [
            this._pickerSearchField('p. ' + (entry.pageIndex + 1) + ' 第 ' + (entry.pageIndex + 1) + ' 页'),
          ] };
        });
      } else {
        const tree = popup.outlineOverlay && state.outlineExplorerTree
          ? state.outlineExplorerTree : await this._fetchReaderOutlineTree(reader, pdfWin);
        if (state._outlinePicker !== popup) return;
        const paths = new Map();
        popup.items = this._flattenReaderOutlineTree(tree).map(entry => {
          const parents = paths.get(entry.parentID) || [];
          const path = parents.concat(entry.title);
          paths.set(entry.id, path);
          return { entry, breadcrumb: parents.join(' › '),
            titleFields: [this._pickerSearchField(entry.title)],
            pathFields: parents.length ? [this._pickerSearchField(path.join(' '))] : [],
          };
        });
        const initial = await this._readerOutlineCurrentIndex(
          popup.items.map(item => item.entry), pdfWin, popup.readingPosition);
        if (state._outlinePicker !== popup) return;
        if (!popup.selectionTouched && !popup.input.value.trim()) popup.selected = initial;
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _openReaderOutlinePicker error: ' + e);
      popup.error = captions ? (zh ? '题注加载失败' : 'Error loading captions')
        : (zh ? '目录加载失败' : 'Error loading outline');
    }
    if (state._outlinePicker !== popup) return;
    if (pdfWin.PDFViewerApplication?.pdfDocument !== popup.pdfDoc) {
      this._closeReaderOutlinePicker(state, false);
      return;
    }
    popup.loading = false;
    this._filterReaderOutlinePicker(popup);
  },

  _filterReaderOutlinePicker(popup) {
    const query = this._normalizePickerSearchText(popup.input.value);
    if (!query) {
      popup.filtered = popup.items.slice();
    } else {
      const terms = query.split(' ');
      // Rank direct title matches before matches that need the parent path.
      const matches = popup.items.map(item => {
        const titleRank = this._rankPickerMatch(item.titleFields, query, terms);
        const pathRank = titleRank ? 0 : this._rankPickerMatch(item.pathFields, query, terms);
        return { item, titleRank, pathRank };
      });
      popup.filtered = matches.filter(match => match.titleRank || match.pathRank)
        .sort((a, b) => b.titleRank - a.titleRank || b.pathRank - a.pathRank)
        .map(match => match.item);
    }
    popup.selected = Math.min(popup.selected, Math.max(0, popup.filtered.length - 1));
    this._renderReaderOutlinePicker(popup);
  },

  _renderReaderOutlinePicker(popup) {
    const doc = popup.pdfWin.document;
    const h = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    const list = popup.list;
    while (list.firstChild) list.removeChild(list.firstChild);
    popup.rows = [];
    if (popup.loading || popup.error || !popup.filtered.length) {
      const message = h('div');
      message.style.cssText = 'padding:14px;color:var(--zv-theme-muted, #a6adc8);';
      const messages = popup.captions
        ? (popup.zh ? ['正在索引题注…', '无匹配题注', '未找到图表题注']
          : ['Indexing captions…', 'No matching captions', 'No figure or table captions found'])
        : (popup.zh ? ['正在加载目录…', '无匹配标题', '此 PDF 没有目录']
          : ['Loading outline…', 'No matching headings', 'No outline available for this PDF']);
      message.textContent = popup.loading ? messages[0] : popup.error || messages[popup.items.length ? 1 : 2];
      list.appendChild(message);
      return;
    }
    // Render all matches so keyboard navigation can reach every heading.
    const fragment = doc.createDocumentFragment();
    popup.filtered.forEach((item, index) => {
      const row = h('div');
      row.style.cssText = 'padding:8px 12px;border-left:3px solid transparent;cursor:pointer;';
      const title = h('div');
      title.textContent = item.entry.title;
      const context = h('div');
      context.style.cssText = 'font-size:11px;color:var(--zv-theme-muted, #a6adc8);overflow-wrap:anywhere;';
      const page = typeof item.entry.pageIndex === 'number'
        ? (popup.zh ? '第 ' + (item.entry.pageIndex + 1) + ' 页' : 'p. ' + (item.entry.pageIndex + 1))
        : '';
      context.textContent = [item.breadcrumb, page].filter(Boolean).join(' · ');
      row.appendChild(title);
      row.appendChild(context);
      row.addEventListener('click', () => {
        popup.selected = index;
        this._activateReaderOutlinePicker(popup.state);
      });
      popup.rows.push(row);
      fragment.appendChild(row);
    });
    list.appendChild(fragment);
    this._updateReaderOutlinePickerSelection(popup);
  },

  /** Moving selection changes styles only; a stationary mouse cannot reset it. */
  _updateReaderOutlinePickerSelection(popup) {
    popup.rows.forEach((row, index) => {
      row.style.backgroundColor = index === popup.selected ? 'var(--zv-theme-control, #313244)' : 'transparent';
      row.style.borderLeftColor = index === popup.selected ? 'var(--zv-theme-accent, #89b4fa)' : 'transparent';
    });
    const selected = popup.rows[popup.selected];
    if (selected) {
      selected.scrollIntoView(Components.utils.cloneInto({ block: 'nearest' }, popup.pdfWin));
    }
  },

  _onReaderOutlinePickerKeyDown(event, state) {
    const popup = state._outlinePicker;
    if (!popup) return;
    event.stopImmediatePropagation();
    if (event.isComposing || popup.composing || event.keyCode === 229) return;
    const key = this._keyString(event);
    if (key === 'escape') {
      event.preventDefault();
      this._closeReaderOutlinePicker(state);
    } else if (key === 'enter' || key === 'return') {
      event.preventDefault();
      this._activateReaderOutlinePicker(state);
    } else if (['arrowdown', 'ctrl+j', 'ctrl+n', 'arrowup', 'ctrl+k', 'ctrl+p'].includes(key)) {
      event.preventDefault();
      popup.selectionTouched = true;
      const down = ['arrowdown', 'ctrl+j', 'ctrl+n'].includes(key);
      popup.selected = Math.max(0, Math.min(popup.filtered.length - 1,
        popup.selected + (down ? 1 : -1)));
      this._updateReaderOutlinePickerSelection(popup);
    } else if (key === 'tab') {
      event.preventDefault();
      popup.input.focus();
    }
    // Text, Backspace, clipboard shortcuts and IME retain native input behavior.
  },

  async _activateReaderOutlinePicker(state) {
    const popup = state._outlinePicker;
    const item = popup?.filtered[popup.selected];
    if (!item || popup.activating) return;
    const ir = popup.reader?._internalReader;
    if (![ir?._primaryView, ir?._secondaryView]
      .some(view => view?._iframeWindow === popup.pdfWin)
        || popup.pdfWin.PDFViewerApplication?.pdfDocument !== popup.pdfDoc) {
      this._closeReaderOutlinePicker(state, false);
      return;
    }
    popup.activating = true;
    const isCurrent = () => state._outlinePicker === popup && !popup.pdfWin.closed
      && popup.pdfWin.PDFViewerApplication?.pdfDocument === popup.pdfDoc
      && [ir?._primaryView, ir?._secondaryView].some(view => view?._iframeWindow === popup.pdfWin);
    const ok = popup.captions
      ? await this._goToReaderCaption(state, popup.reader, popup.pdfWin, item.entry, isCurrent)
      : await this._goToReaderHeading(state, popup.reader, popup.pdfWin, item.entry, isCurrent);
    if (state._outlinePicker !== popup) return;
    if (![ir?._primaryView, ir?._secondaryView]
      .some(view => view?._iframeWindow === popup.pdfWin)
        || popup.pdfWin.PDFViewerApplication?.pdfDocument !== popup.pdfDoc) {
      this._closeReaderOutlinePicker(state, false);
      return;
    }
    popup.activating = false;
    if (!ok) {
      popup.status.textContent = popup.zh ? '跳转失败 · Esc 返回' : 'Jump failed · Esc back';
      return;
    }
    this._closeReaderOutlinePicker(state, false);
    this._closeReaderOutlineExplorer(state);
    state.lastAnnotationKey = null;
    this._setMode(state, 'normal');
    state.activePdfWin = popup.pdfWin;
    popup.pdfWin.focus();
    if (popup.captions) this._rememberReaderTargetJump(state, popup.pdfWin, item.entry.kind, item.entry);
    this._recordReaderHistoryPoint(popup.reader, state, popup.pdfWin);
  },

  /** Dismiss without re-rendering the saved tree or refocusing a removed pane. */
  _closeReaderOutlinePicker(state, restoreFocus = true) {
    const popup = state._outlinePicker;
    if (!popup) return;
    state._outlinePicker = null;
    popup.overlay.remove();
    const tree = popup.outlineOverlay;
    if (tree && tree === state._outlineExplorerOverlay && tree.isConnected) {
      tree.style.visibility = '';
      if (restoreFocus) this._focusReaderOutlineElement(state);
      if (state._outlineExplorerList) {
        state._outlineExplorerList.scrollTop = popup.outlineScrollTop;
      }
    } else if (restoreFocus) {
      popup.pdfWin.focus();
    }
  },

  // ── Reader jump targets ────────────────────────────────────────────────────
  // Caption sources and bracket categories follow Zotero Neo v0.3.0.

  /** Keep heading and caption data attached to the PDF document that produced it. */
  _readerTargetCache(state, pdfWin) {
    const docs = state._readerTargetDocs || (state._readerTargetDocs = new WeakMap());
    const doc = pdfWin.PDFViewerApplication.pdfDocument;
    if (!docs.has(doc)) docs.set(doc, {});
    return docs.get(doc);
  },

  _readerHeadingTargets(state, reader, pdfWin) {
    const cache = this._readerTargetCache(state, pdfWin);
    if (!cache.headings) {
      const pdfDoc = pdfWin.PDFViewerApplication.pdfDocument;
      cache.headings = this._fetchReaderOutlineTree(reader, pdfWin).then(tree =>
        Promise.all(this._flattenReaderOutlineTree(tree).map(async outline => ({
          ...await this._readerOutlineHeadingPosition(outline, pdfDoc),
          title: outline.title, outline,
        })))).then(entries => entries.filter(entry =>
        Number.isInteger(entry.pageIndex) && entry.pageIndex >= 0
          && entry.pageIndex < pdfDoc.numPages));
      cache.headings.catch(() => { delete cache.headings; });
    }
    return cache.headings;
  },

  /** Numbered labels can be recognized in the native outline, SDT or PDF text. */
  _readerCaptionLabel(text) {
    const title = text.normalize('NFKC').trim();
    const match = /^(fig(?:ure)?\.?|图|table|表)\s*((?:[A-Z]\.?)?\d+(?:[.-]\d+)*|[零〇一二三四五六七八九十百千万两]+)(\s*\([a-z]\)|[a-z])?(?=$|[\s.:、,()–—-]|[\u3400-\u9fff])/iu.exec(title);
    if (match) return {
      kind: /^(table|表)$/iu.test(match[1]) ? 'table' : 'figure',
      label: match[2] + (match[3]?.trim() || ''), end: match[0].length,
    };
    const roman = /^(?:table|表)\s*([IVXLCDM]+)(?=$|[\s.:、,()–—-])/u.exec(
      title.replace(/^table/iu, 'table'));
    if (roman && /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/u.test(roman[1])) {
      return { kind: 'table', label: roman[1], end: roman[0].length };
    }
    return null;
  },

  /** Zotero's optional structured document API exposes typed local caption blocks. */
  async _readerStructuredCaptions(itemID, isCurrent, cache) {
    if (!itemID || typeof Zotero.SDT?.getReader !== 'function') return [];
    const source = await Zotero.SDT.getReader(itemID);
    if (!isCurrent() || !source || typeof source.getBlocks !== 'function') return [];
    const count = await source.getTopLevelBlockCount?.();
    if (!isCurrent() || !Number.isInteger(count) || count < 1) return [];
    const blocks = await source.getBlocks(0, count - 1);
    if (!isCurrent() || !Array.isArray(blocks)) return [];
    const textOf = part => typeof part?.text === 'string' ? part.text
      : Array.isArray(part?.content) ? part.content.map(textOf).join(
        part.content.every(child => typeof child?.text === 'string') ? '' : ' ') : '';
    const captions = [];
    const bodies = new Map();
    for (const block of blocks) {
      if (!['caption', 'image', 'table'].includes(block?.type) || block.reference) continue;
      const anchors = block.anchor?.pageRects;
      if (!Array.isArray(anchors)) continue;
      const valid = anchors.filter(rect => Array.isArray(rect) && rect.length === 5
        && rect.every(Number.isFinite) && Number.isInteger(rect[0]) && rect[0] >= 0
        && rect[3] > rect[1] && rect[4] > rect[2]);
      if (!valid.length) continue;
      const pageIndex = Math.min(...valid.map(anchor => anchor[0]));
      const samePage = valid.filter(anchor => anchor[0] === pageIndex);
      const rect = samePage.map(anchor => anchor.slice(1)).reduce(this._readerUnionRects);
      if (block.type === 'caption') {
        const title = textOf(block).replace(/\s+/gu, ' ').trim();
        const label = this._readerCaptionLabel(title);
        if (label) captions.push({ ...label, title, pageIndex, left: rect[0], top: rect[3], rect });
      } else if (samePage.length === valid.length) {
        if (!bodies.has(pageIndex)) bodies.set(pageIndex, []);
        bodies.get(pageIndex).push({ kind: block.type === 'image' ? 'figure' : 'table', rect });
      }
    }
    cache.nativeBodies = bodies;
    return captions;
  },

  /** Rebuild lines from PDF.js text runs in page coordinates, keeping columns apart. */
  _readerPdfTextLines(items) {
    const chunks = [];
    for (const item of items) {
      const [a, b, , , x, y] = item.transform || [];
      if (!item.str?.trim() || item.dir === 'ttb' || !(a > 0)
          || Math.abs(b) > a * 0.1 || !Number.isFinite(x) || !Number.isFinite(y)
          || !(item.width > 0)) continue;
      chunks.push({ text: item.str, x, y, right: x + item.width,
        height: item.height || a });
    }
    chunks.sort((a, b) => b.y - a.y);
    const lines = [];
    for (let i = 0; i < chunks.length;) {
      const first = chunks[i];
      let end = i + 1;
      while (end < chunks.length && first.y - chunks[end].y <= first.height * 0.28) end++;
      const row = chunks.slice(i, end).sort((a, b) => a.x - b.x);
      let line = null;
      for (const part of row) {
        const gap = part.x - (line?.right ?? part.x);
        if (!line || gap > Math.min(13, Math.max(6, part.height * 1.1))) {
          line = { ...part };
          lines.push(line);
        } else {
          line.text += (gap > part.height * 0.14 && !/\s$/u.test(line.text)
            && !/^\s/u.test(part.text) ? ' ' : '') + part.text;
          line.right = Math.max(line.right, part.right);
          line.height = Math.max(line.height, part.height);
        }
      }
      i = end;
    }
    for (const line of lines) {
      line.text = line.text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
      line.label = this._readerCaptionLabel(line.text);
    }
    return lines;
  },

  _readerPdfPageCaptions(items, pageIndex, lines = this._readerPdfTextLines(items)) {
    return lines.flatMap((line, index) => {
      const label = line.label;
      if (!label) return [];
      const suffix = line.text.slice(label.end);
      // An unpunctuated label followed by a sentence predicate can be a reference.
      if (/^\s+(?:(?:also|clearly)\s+)?(?:shows?|illustrates?|presents?|summari[sz]es?|compares?|depicts?|reports?|lists?|demonstrates?|displays?|contains?|is|are)\b/iu.test(suffix)
          || /^(?:所示|显示|展示|给出|说明|中[的可])/u.test(suffix.trimStart())) return [];
      // IEEE tables often put a short centered number above a wider title.
      const centered = /^[\s.:：、–—-]*$/u.test(suffix);
      const mid = line => (line.x + line.right) / 2;
      const size = line.height;
      let previous = line;
      let title = line.text;
      let left = line.x;
      let right = line.right;
      let parts = 1;
      for (let j = index + 1; j < lines.length && parts < 8; j++) {
        const next = lines[j];
        const drop = previous.y - next.y;
        if (drop > size * 1.55) break;
        if (drop < size * 0.7 || Math.abs(next.height - size) > size * 0.09) continue;
        const aligned = Math.abs(next.x - line.x) <= size * 1.25;
        if (!aligned && !(centered && Math.abs(mid(next) - mid(line)) <= size * 1.25)) continue;
        if (next.label || !next.text
            || (!centered && /[.!?。！？]$/u.test(previous.text))) break;
        const joinWord = /-$/u.test(title) && /^\p{Ll}/u.test(next.text);
        title += (joinWord ? '' : ' ') + next.text;
        left = Math.min(left, next.x);
        right = Math.max(right, next.right);
        previous = next;
        parts++;
        if (/[.!?。！？]$/u.test(next.text)) break;
      }
      const top = line.y + size;
      return [{ ...label, title, pageIndex, left, top,
        rect: [left, previous.y - size * 0.22, right, top] }];
    });
  },

  /** Gecko can hide a PDFPageProxy's prototype when a content promise resolves in chrome. */
  async _readerPdfPage(pdfDoc, pageIndex) {
    const page = await pdfDoc.getPage(pageIndex + 1);
    return typeof page?.getTextContent === 'function' ? page
      : Components.utils.waiveXrays?.(page) || page;
  },

  /** Build once on demand. Older Zotero versions use the same PDF.js layer as search. */
  _readerCaptionTargets(state, reader, pdfWin) {
    const pdfDoc = pdfWin.PDFViewerApplication.pdfDocument;
    const cache = this._readerTargetCache(state, pdfWin);
    if (cache.captions) return cache.captions;
    const isCurrent = () => [reader._internalReader?._primaryView, reader._internalReader?._secondaryView]
      .some(view => view?._iframeWindow?.PDFViewerApplication?.pdfDocument === pdfDoc);
    cache.captions = (async () => {
      const entries = [];
      const add = target => {
        if (entries.some(entry => entry.pageIndex === target.pageIndex && entry.kind === target.kind
            && entry.label.toLowerCase() === target.label.toLowerCase())) return;
        entries.push(target);
      };
      try {
        const native = await this._readerStructuredCaptions(reader.itemID, isCurrent, cache);
        native.filter(entry => entry.pageIndex < pdfDoc.numPages).forEach(add);
      } catch (e) {
        Zotero.debug('[ZoteroVim] SDT captions: ' + e);
      }
      if (!isCurrent()) return [];
      const nativeKinds = new Set(entries.map(entry => entry.kind));
      const headings = await this._readerHeadingTargets(state, reader, pdfWin).catch(() => []);
      if (nativeKinds.size < 2 && typeof pdfDoc.getPage === 'function') {
        let pagesRead = 0;
        let lastError = null;
        for (let index = 0; index < pdfDoc.numPages && isCurrent(); index++) {
          try {
            const page = await this._readerPdfPage(pdfDoc, index);
            if (!isCurrent()) break;
            const data = await page.getTextContent();
            this._readerPdfPageCaptions(data.items, index).forEach(entry => {
              if (!nativeKinds.has(entry.kind)) add(entry);
            });
            pagesRead++;
          } catch (e) { lastError = e; }
        }
        if (lastError && !pagesRead && !entries.length && !headings.length) throw lastError;
      }
      for (const heading of headings) {
        const label = this._readerCaptionLabel(heading.title);
        if (label) add({ ...heading, ...label });
      }
      return isCurrent() ? entries.sort(this._compareReaderTargetPositions) : [];
    })();
    cache.captions.then(() => {
      if (!isCurrent()) delete cache.captions;
    }, () => { delete cache.captions; });
    return cache.captions;
  },

  _compareReaderTargetPositions(a, b) {
    return a.pageIndex - b.pageIndex || (b.top ?? Infinity) - (a.top ?? Infinity)
      || (a.left ?? 0) - (b.left ?? 0);
  },

  _readerUnionRects(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  },

  /** Follow PDF transforms to expose image, vector group and painted path bounds. */
  _readerPaintedRects(list, ops) {
    const result = [];
    if (!ops || !list?.fnArray || !list.argsArray) return result;
    const paint = new Set(['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke',
      'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'].map(name => ops[name]).filter(Number.isFinite));
    const images = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject']
      .map(name => ops[name]).filter(Number.isFinite));
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const multiply = ([a, b, c, d, e, f], [g, h, i, j, k, l]) =>
      [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
    const bounds = (box, [a, b, c, d, e, f] = matrix) => {
      if (box?.length !== 4 || !Array.from(box).every(Number.isFinite)) return null;
      const [l, btm, r, t] = box;
      const xs = [a * l + c * btm, a * l + c * t, a * r + c * btm, a * r + c * t];
      const ys = [b * l + d * btm, b * l + d * t, b * r + d * btm, b * r + d * t];
      return [Math.min(...xs) + e, Math.min(...ys) + f, Math.max(...xs) + e, Math.max(...ys) + f];
    };
    const add = (rect, type) => {
      if (!rect || rect[2] - rect[0] < 20) return;
      result.push({ rect, type });
    };
    let path = null;
    for (let i = 0; i < list.fnArray.length; i++) {
      const op = list.fnArray[i];
      const args = list.argsArray[i] || [];
      if (op === ops.save) stack.push({ matrix });
      else if (op === ops.beginGroup || op === ops.paintFormXObjectBegin) {
        const group = op === ops.beginGroup;
        const transform = group ? args[0]?.matrix : args[0];
        const transformed = transform?.length === 6 ? multiply(matrix, transform) : matrix;
        const rect = bounds(group ? args[0]?.bbox : args[1], transformed);
        stack.push({ matrix, rect, start: result.length });
        if (!group) matrix = transformed;
      } else if (op === ops.restore || op === ops.endGroup || op === ops.paintFormXObjectEnd) {
        const frame = stack.pop();
        if (frame) {
          if (result.length > frame.start) add(frame.rect, 'group');
          matrix = frame.matrix;
        }
      } else if (op === ops.transform && args.length === 6) matrix = multiply(matrix, args);
      else if (images.has(op)) add(bounds([0, 0, 1, 1]), 'image');
      else if (op === ops.constructPath) {
        const rect = bounds(args[2]);
        if (typeof args[0] !== 'number') path = path && rect ? this._readerUnionRects(path, rect) : rect;
        else if (paint.has(args[0])) add(rect, 'path');
      } else if (paint.has(op) || op === ops.endPath) {
        if (paint.has(op)) add(path, 'path');
        path = null;
      }
    }
    return result;
  },

  /** Read graphics only on pages the user jumps to. Keep the caption index lightweight. */
  _readerCaptionGeometry(cache, pdfWin, pageIndex) {
    const pages = cache.graphicPages || (cache.graphicPages = new Map());
    if (pages.has(pageIndex)) return pages.get(pageIndex);
    const pdfDoc = pdfWin.PDFViewerApplication.pdfDocument;
    const ops = pdfWin.pdfjsLib?.OPS;
    const geometry = (async () => {
      const page = await this._readerPdfPage(pdfDoc, pageIndex);
      const [text, list] = await Promise.allSettled([
        page.getTextContent?.(), ops && page.getOperatorList?.(Components.utils.cloneInto({
          annotationMode: 0,
        }, pdfWin)),
      ]);
      const lines = this._readerPdfTextLines(text.value?.items || []);
      // Drawing arguments include typed buffers. Read the PDF.js objects directly
      // so Gecko's wrappers do not reject their indexed elements.
      const operators = list.value && (Components.utils.waiveXrays?.(list.value) || list.value);
      return { lines, captions: this._readerPdfPageCaptions([], pageIndex, lines),
        painted: this._readerPaintedRects(operators, ops), pageRect: page.view };
    })();
    pages.set(pageIndex, geometry);
    geometry.catch(() => pages.delete(pageIndex));
    return geometry;
  },

  /** Ruled tables without structured tags can be bounded by aligned rules and cells. */
  _readerRuledTableRects(painted, lines) {
    const rules = painted.filter(({ rect: r, type }) => type === 'path'
      && r[2] - r[0] >= 65 && r[3] - r[1] <= 2).map(({ rect }) => rect)
      .sort((a, b) => b[3] - a[3]);
    return rules.flatMap((top, index) => {
      let bottom = null;
      let last = top;
      for (let i = index + 1; i < rules.length; i++) {
        const rule = rules[i];
        if (last[3] - rule[3] > 75 || top[3] - rule[3] > 360) break;
        if (Math.abs(top[0] - rule[0]) > 5 || Math.abs(top[2] - rule[2]) > 5) continue;
        if (top[3] - rule[3] >= 12) bottom = rule;
        last = rule;
      }
      if (!bottom) return [];
      const cells = lines.filter(line => line.y < top[3] && line.y > bottom[1]
        && line.x >= top[0] - 3 && line.right <= top[2] + 3);
      return cells.some((cell, i) => cells.slice(i + 1).some(other =>
        Math.abs(other.y - cell.y) < 2 && other.x > cell.right + 7))
        ? [this._readerUnionRects(top, bottom)] : [];
    });
  },

  /** Pair on the same page and in the same column, with no text or rival caption in the gap. */
  _readerCaptionRegion(entry, entries, geometry, native) {
    const caption = entry.rect;
    const { painted = [], lines = [], pageRect = null } = geometry || {};
    const width = rect => rect[2] - rect[0];
    const overlap = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const gap = (a, b) => Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
    const aligned = (a, b) => overlap(a, b) >= Math.min(width(a), width(b)) * 0.62;
    const siblings = entries.filter(other => other !== entry && other.rect);
    const scoreBody = body => {
      const distance = gap(body, caption);
      if (distance < -5 || distance > 50 || !aligned(body, caption)) return null;
      const above = body[3] > caption[3];
      const bottom = above ? caption[3] : body[3];
      const top = above ? body[1] : caption[1];
      if (lines.some(line => line.y + line.height * 0.45 > bottom + 1
          && line.y + line.height * 0.45 < top - 1 && line.text.length >= 8
          && !/^\([a-z]\)\s/iu.test(line.text)
          && line.x < Math.min(body[2], caption[2]) && line.right > Math.max(body[0], caption[0]))) return null;
      if (siblings.some(other => aligned(body, other.rect)
          && gap(body, other.rect) < distance - 1)) return null;
      return Math.max(0, distance) + (above === (entry.kind === 'figure') ? 0 : 13);
    };
    const match = candidates => candidates.map(body => ({ body, score: scoreBody(body) }))
      .filter(item => item.score !== null)
      .sort((a, b) => a.score - b.score || width(b.body) - width(a.body))[0]?.body;
    const nativeRects = native.filter(item => item.kind === entry.kind).map(item => item.rect);
    const joinPanels = (body, panels) => {
      if (!body) return body;
      let combined = body;
      for (const other of panels) {
        const vertical = Math.min(body[3], other[3]) - Math.max(body[1], other[1]);
        if (vertical < Math.min(body[3] - body[1], other[3] - other[1]) * 0.65
            || overlap(body, other) > 2 || overlap(body, other) < -24) continue;
        const union = this._readerUnionRects(combined, other);
        if (aligned(other, caption) && scoreBody(union) !== null) combined = union;
      }
      return combined;
    };
    let body = match(nativeRects);
    if (entry.kind === 'figure') body = joinPanels(body, nativeRects);
    if (!body && entry.kind === 'table') body = match(this._readerRuledTableRects(painted, lines));
    if (!body && entry.kind === 'figure') {
      const candidates = painted.filter(({ rect, type }) => width(rect) >= 36
        && rect[3] - rect[1] >= 18 && (!pageRect || (width(rect) <= width(pageRect) * 0.94
          && rect[3] - rect[1] < (pageRect[3] - pageRect[1]) * 0.83))
        && (type !== 'path' || (width(rect) >= width(caption) * 0.5 && gap(rect, caption) <= 18)))
        .map(({ rect }) => rect);
      // Prefer the outer drawing bounds when smaller panels are part of the same object.
      const colocated = candidates.filter(rect => scoreBody(rect) !== null);
      body = match(colocated.filter(rect => !colocated.some(outer => outer !== rect
        && outer[0] <= rect[0] + 1 && outer[1] <= rect[1] + 1
        && outer[2] >= rect[2] - 1 && outer[3] >= rect[3] - 1
        && (width(outer) > width(rect) + 2 || outer[3] - outer[1] > rect[3] - rect[1] + 2))));
      body = joinPanels(body, colocated);
    }
    return body ? this._readerUnionRects(caption, body) : caption;
  },

  /** Frame the region in the originating pane, shrinking only when it would be clipped. */
  async _goToReaderCaption(state, reader, pdfWin, entry, isCurrent = () => true) {
    const app = pdfWin.PDFViewerApplication;
    const viewer = app?.pdfViewer;
    const cache = this._readerTargetCache(state, pdfWin);
    const native = cache.nativeBodies?.get(entry.pageIndex) || [];
    let geometry;
    if (typeof app.pdfDocument.getPage === 'function' && (pdfWin.pdfjsLib?.OPS || native.length || !entry.rect)) {
      geometry = await this._readerCaptionGeometry(cache, pdfWin, entry.pageIndex).catch(e => {
        Zotero.debug('[ZoteroVim] read graphic bounds: ' + e);
      });
    }
    if (!isCurrent()) return false;
    if (!entry.rect) {
      entry = geometry?.captions.find(caption =>
        caption.kind === entry.kind && caption.label.toLowerCase() === entry.label.toLowerCase()) || entry;
      if (!entry.rect && entry.outline) {
        this._clearReaderJumpCue(state, pdfWin);
        return this._goToReaderOutlineEntry(reader, pdfWin, entry.outline);
      }
    }
    if (typeof viewer?.scrollPageIntoView !== 'function') return false;
    const page = viewer.getPageView?.(entry.pageIndex);
    let region = entry.rect;
    let left = entry.left, top = entry.top, scale = null;
    try {
      if (region) {
        const siblings = geometry?.captions.filter(other => other.kind !== entry.kind
          || other.label.toLowerCase() !== entry.label.toLowerCase()) || [];
        region = this._readerCaptionRegion(entry, siblings, geometry, native);
      }
      if (region && page?.viewport && viewer.container?.clientHeight > 0
          && viewer.container.clientWidth > 0) {
        const rect = this._readerJumpViewportRect(page.viewport, region);
        const { clientWidth: w, clientHeight: h } = viewer.container;
        const padding = Math.max(8, Math.min(24, w * 0.06, h * 0.06));
        const ratio = Math.min(1, (w - padding * 2) / (rect[2] - rect[0]),
          (h - padding * 2) / (rect[3] - rect[1]));
        const zoom = ratio > 0 && ratio < 1 && viewer.currentScale > 0
          ? viewer.currentScale * ratio : null;
        const applied = zoom ? ratio : 1;
        const offsetX = (w / applied - (rect[2] - rect[0])) / 2;
        const offsetY = (h / applied - (rect[3] - rect[1])) / 2;
        const clamp = (position, pageSize, viewSize) =>
          Math.max(0, Math.min(position, pageSize - viewSize / applied));
        const [x, y] = page.viewport.convertToPdfPoint(
          clamp(rect[0] - offsetX, page.viewport.width, w),
          clamp(rect[1] - offsetY, page.viewport.height, h));
        if (Number.isFinite(x) && Number.isFinite(y)) [left, top, scale] = [x, y, zoom];
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] frame graphic region, using caption destination: ' + e);
    }
    try {
      viewer.scrollPageIntoView(Components.utils.cloneInto({
        pageNumber: entry.pageIndex + 1,
        destArray: [null, { name: 'XYZ' }, left, top, scale],
      }, pdfWin));
    } catch (e) {
      Zotero.debug('[ZoteroVim] jump to graphic region: ' + e);
      return false;
    }
    if (region) this._showReaderJumpCue(state, pdfWin, page, region);
    return true;
  },

  _readerJumpViewportRect(viewport, rect) {
    // PDF.js runs in the reader iframe and cannot read a privileged array.
    const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  },

  _readerJumpAnchorRect(page, position) {
    const box = page?.viewport?.viewBox;
    if (box?.length !== 4) return null;
    const left = Number.isFinite(position.left) ? position.left : box[0] + 20;
    const top = Number.isFinite(position.top) ? position.top - 8 : box[3] - 18;
    const x = Math.max(box[0] + 8, Math.min(left, box[2] - 30));
    const y = Math.max(box[1] + 23, Math.min(top, box[3] - 8));
    return [x, y - 13, Math.min(x + 120, box[2] - 8), y];
  },

  /** A brief, non-interactive outline follows the PDF page in its own pane. */
  _showReaderJumpCue(state, pdfWin, page, region) {
    const repeated = state._readerJumpCues?.get(pdfWin)?.node === page?.div;
    this._clearReaderJumpCue(state, pdfWin);
    const viewport = page?.viewport;
    const node = page?.div;
    if (!node || !viewport || !(viewport.width > 0) || !(viewport.height > 0)) return;
    try {
      const [left, top, right, bottom] = this._readerJumpViewportRect(viewport, region);
      if (![left, top, right, bottom].every(Number.isFinite)) return;
      // A pseudo-element survives PDF.js replacing the page's rendered layers.
      if (repeated) void node.offsetWidth;
      const inset = [
        top / viewport.height, 1 - right / viewport.width,
        1 - bottom / viewport.height, left / viewport.width,
      ].map(ratio => (ratio * 100) + '%').join(' ');
      node.style.setProperty('--zv-jump-cue-inset', inset);
      node.setAttribute('data-zv-jump-cue', '');
      const hints = state._readerJumpCues || (state._readerJumpCues = new Map());
      const timer = setTimeout(() => this._clearReaderJumpCue(state, pdfWin), 1450);
      hints.set(pdfWin, { node, timer });
    } catch (e) {
      Zotero.debug('[ZoteroVim] show reader jump cue: ' + e);
    }
  },

  _clearReaderJumpCue(state, pdfWin) {
    const hint = state._readerJumpCues?.get(pdfWin);
    if (!hint) return;
    state._readerJumpCues.delete(pdfWin);
    clearTimeout(hint.timer);
    try {
      hint.node?.removeAttribute('data-zv-jump-cue');
      hint.node?.style.removeProperty('--zv-jump-cue-inset');
    } catch (_) {} // The pane may already have torn down its PDF document.
  },

  _rememberReaderTargetJump(state, pdfWin, kind, entry) {
    const app = pdfWin.PDFViewerApplication;
    const container = this._getScrollContainer(pdfWin);
    const marks = state._readerLastJumps || (state._readerLastJumps = new WeakMap());
    marks.set(pdfWin, {
      pdfDoc: app?.pdfDocument, kind, entry, page: app?.pdfViewer?.currentPageNumber,
      scale: app?.pdfViewer?.currentScale, scrollTop: container?.scrollTop || 0,
      scrollLeft: container?.scrollLeft || 0,
    });
  },

  /** Step relative to the active pane, wrapping at either end like Neo. */
  async _traverseReaderTargets(state, reader, pdfWin, kind, direction) {
    const bookmark = kind === 'bookmark';
    const pdfDoc = pdfWin?.PDFViewerApplication?.pdfDocument;
    const viewer = pdfWin?.PDFViewerApplication?.pdfViewer;
    const zh = this._isZhLocale();
    const names = {
      bookmark: ['bookmarks', '书签'], heading: ['PDF headings', 'PDF 目录标题'],
      figure: ['figure captions', '图题注'], table: ['table captions', '表题注'],
    };
    const name = names[kind][zh ? 1 : 0];
    if (!pdfDoc && (!bookmark || viewer)) {
      this._showStatus(state, viewer ? (zh ? 'PDF 正在加载' : 'PDF is still loading')
        : (zh ? '此跳转仅支持 PDF' : 'This jump is only available in PDFs'), 1500);
      return;
    }
    const request = {};
    state._readerJumpRequest = request;
    const ir = reader._internalReader;
    const current = () => state._readerJumpRequest === request && !pdfWin?.closed
      && (!state.activePdfWin || state.activePdfWin === pdfWin)
      && pdfWin?.PDFViewerApplication?.pdfDocument === pdfDoc
      && [ir?._primaryView, ir?._secondaryView].some(view => view?._iframeWindow === pdfWin);
    try {
      const cache = pdfDoc && this._readerTargetCache(state, pdfWin);
      if ((kind === 'figure' || kind === 'table') && !cache.captions) {
        this._showStatus(state, zh ? '▶ 正在索引题注…' : '▶ Indexing captions…', 1400);
      }
      const entries = bookmark ? await this._readerBookmarkTargets(state, reader, pdfWin)
        : kind === 'heading' ? (await this._readerHeadingTargets(state, reader, pdfWin))
          .filter(entry => !this._readerCaptionLabel(entry.title))
        : (await this._readerCaptionTargets(state, reader, pdfWin))
          .filter(entry => entry.kind === kind);
      if (!current()) return;
      if (!entries.length) {
        this._showStatus(state, zh ? '未找到' + name : 'No ' + name + ' found', 1500);
        return;
      }

      const container = this._getScrollContainer(pdfWin);
      const previous = state._readerLastJumps?.get(pdfWin);
      const index = previous?.kind === kind && previous.pdfDoc === pdfDoc
          && previous.page === viewer?.currentPageNumber && previous.scale === viewer?.currentScale
          && Math.abs(previous.scrollTop - (container?.scrollTop || 0)) <= 2
          && Math.abs(previous.scrollLeft - (container?.scrollLeft || 0)) <= 2
        ? entries.findIndex(entry => bookmark ? entry.key === previous.entry.key
          && entry.position === previous.entry.position : entry === previous.entry) : -1;
      let target;
      if (index >= 0) {
        target = entries[(index + direction + entries.length) % entries.length];
      } else {
        let relative;
        let tolerance;
        if (bookmark) {
          const position = this._markPosition(pdfWin);
          const page = position.pageIndex ?? 0;
          const pageHeight = viewer?.getPageView?.(page)?.viewport?.height
            || container?.scrollHeight || 600;
          const value = this._readerBookmarkOrder(position, pdfDoc?.numPages || 1);
          relative = entry => entry.position - value;
          tolerance = 2 / pageHeight;
        } else {
          const reading = this._readerOutlineReadingPosition(pdfWin);
          relative = entry => {
            if (entry.pageIndex !== reading.pageIndex) {
              return entry.pageIndex > reading.pageIndex ? Infinity : -Infinity;
            }
            if (reading.top === null) return direction * Infinity;
            if (entry.top === null) return -Infinity;
            const toY = point => reading.viewport?.convertToViewportPoint?.(
              point.left ?? reading.left ?? 0, point.top)?.[1] ?? -point.top;
            return toY(entry) - toY(reading);
          };
          tolerance = 1;
        }
        const ordered = bookmark ? entries : entries.slice().sort(this._compareReaderTargetPositions);
        if (direction < 0) ordered.reverse();
        target = ordered.find(entry => direction * relative(entry) > tolerance) || ordered[0];
      }

      this._stopSmoothHoldScroll(state, pdfWin);
      if (bookmark) {
        if (state.marks[target.key] !== target.mark) return;
        if (!await this._jumpMark(state, reader, pdfWin, target.key, target.location)) return;
      } else {
        const ok = kind === 'heading'
          ? await this._goToReaderHeading(state, reader, pdfWin, target.outline, current, target)
          : await this._goToReaderCaption(state, reader, pdfWin, target, current);
        if (!current()) return;
        if (!ok) {
          this._showStatus(state, zh ? '跳转失败' : 'Jump failed', 1500);
          return;
        }
        state.lastAnnotationKey = null;
        this._recordReaderHistoryPoint(reader, state, pdfWin);
        this._showStatus(state, '→ ' + target.title.slice(0, 85), 1500);
      }
      if (current()) this._rememberReaderTargetJump(state, pdfWin, kind, target);
    } catch (e) {
      Zotero.debug('[ZoteroVim] reader jump: ' + e);
      if (current()) this._showStatus(state, zh ? '无法加载' + name : 'Could not load ' + name, 1500);
    }
  },

  _readerBookmarkOrder(mark, pages) {
    return mark.pageIndex === null ? mark.ratio * pages : mark.pageIndex + mark.ratio;
  },

  /** Existing Vim marks serve as bookmarks, including the legacy annotation-only format. */
  async _readerBookmarkTargets(state, reader, pdfWin) {
    const marks = Object.entries(state.marks || {});
    const pages = pdfWin?.PDFViewerApplication?.pdfDocument?.numPages || 1;
    const legacy = marks.some(([, mark]) => mark.key && mark.pageIndex === null)
      ? Zotero.Items.get(reader.itemID)?.getAnnotations() || [] : [];
    const targets = await Promise.all(marks.map(async ([key, mark]) => {
      const annotation = mark.pageIndex === null && legacy.find(item => item.key === mark.key);
      const location = annotation ? await this._annotationPageRatio(pdfWin, annotation) : mark;
      return { key, mark, location, position: this._readerBookmarkOrder(location, pages) };
    }));
    return targets.sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  },

  _onReaderOutlineExplorerKeyDown(event, reader, state, pdfWin) {
    const keyStr = this._keyString(event);
    if (!keyStr) return false;

    if (keyStr === '/') {
      event.preventDefault(); event.stopImmediatePropagation();
      this._openReaderOutlinePicker(state, reader, pdfWin, true);
      return true;
    }

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
    this._focusReaderOutlineElement(state);
    if (!state.outlineExplorerVisible?.length && !state.outlineExplorerLoading) {
      await this._loadReaderOutlineExplorer(state, reader, pdfWin);
    }
  },

  async _openReaderOutlineExplorer(state, reader, pdfWin) {
    if (state.outlineExplorerOpen) return;
    const reading = this._readerOutlineReadingPosition(pdfWin);
    state.outlineExplorerOpen = true;
    this._createReaderOutlineExplorer(state, pdfWin);
    this._renderReaderOutlineExplorer(state);
    this._focusReaderOutlineElement(state);
    await this._loadReaderOutlineExplorer(state, reader, pdfWin, reading);
  },

  _closeReaderOutlineExplorer(state, pdfWin = null) {
    state._outlineExplorerLoad = null;
    if (state._outlinePicker?.outlineOverlay
        && state._outlinePicker.outlineOverlay === state._outlineExplorerOverlay) {
      this._closeReaderOutlinePicker(state, false);
    }
    state.outlineExplorerOpen = false;
    state.outlineExplorerLoading = false;
    state._outlineExplorerCleanup?.();
    state._outlineExplorerCleanup = null;
    this._setReaderOutlineExplorerFocus(state, false);
    this._clearReaderOutlineExplorerHintBuffer(state);
    this._clearReaderOutlineExplorerCmdBuffer(state);
    try {
      const overlay = state._outlineExplorerOverlay;
      if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
    } catch (_) {}
    state._outlineExplorerOverlay = null;
    state._outlineExplorerPdfWin = null;
    state._outlineExplorerHeader = null;
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
    const width = 'min(320px, 40vw)';

    const overlay = h('div');
    overlay.id = 'zv-outline-explorer';
    overlay.tabIndex = -1;
    overlay.style.cssText =
      'position:fixed;top:0;left:0;bottom:0;box-sizing:border-box;width:' + width + ';' +
      'z-index:99998;background:var(--zv-theme-recessed, #181825);color:var(--zv-theme-text, #cdd6f4);border-right:1px solid var(--zv-theme-control, #313244);' +
      'outline:none!important;display:flex;flex-direction:column;' +
      'font:13px/1.35 monospace;';

    const header = h('div');
    header.style.cssText = 'padding:12px 14px;border-bottom:1px solid var(--zv-theme-control, #313244);font-weight:bold;letter-spacing:0.04em;';
    header.textContent = 'Outline Explorer';

    const list = h('div');
    list.style.cssText = 'flex:1;overflow:auto;padding:8px 0;';

    const status = h('div');
    status.style.cssText = 'padding:6px 12px;border-top:1px solid var(--zv-theme-control, #313244);' +
      'color:var(--zv-theme-muted, #6c7086);font-size:11px;overflow-wrap:anywhere;';
    status.textContent =
      'j/k move  ·  Ctrl+d/u fast  ·  gg/G top/bottom  ·  R/M expand/collapse all  ·  ' +
      '/ search headings  ·  Ctrl+h/l focus  ·  Enter jump';

    overlay.appendChild(header);
    overlay.appendChild(list);
    overlay.appendChild(status);
    root.appendChild(overlay);
    state._outlineExplorerOverlay = overlay;
    state._outlineExplorerPdfWin = pdfWin;
    state._outlineExplorerHeader = header;
    state._outlineExplorerList = list;
    state._outlineExplorerStatus = status;
    // Keep ownership in sync with real clicks/focus changes. Prevent the
    // default mousedown focus reset on non-focusable tree rows. Listening on
    // the document also observes a click back into the PDF while the tree stays open.
    const pointer = event => {
      if (state._outlinePicker) return;
      const inside = overlay.contains(event.target);
      this._setReaderOutlineExplorerFocus(state, inside);
      if (inside) {
        this._focusReaderOutlineElement(state);
        if (event.type === 'mousedown' && event.button === 0) event.preventDefault();
      }
    };
    const focus = event => {
      // Gecko may asynchronously focus the frame body during key forwarding.
      // Body/root focus alone is ambiguous; clicks and explicit PDF-focus
      // commands already hand ownership back. Real controls still take focus.
      if (event.target === doc.body || event.target === doc.documentElement) return;
      this._setReaderOutlineExplorerFocus(state, overlay.contains(event.target));
    };
    doc.addEventListener('pointerdown', pointer, true);
    doc.addEventListener('mousedown', pointer, true);
    doc.addEventListener('focusin', focus, true);
    const releaseWidth = this._reserveReaderOutlineWidth(pdfWin, width);
    state._outlineExplorerCleanup = () => {
      doc.removeEventListener('pointerdown', pointer, true);
      doc.removeEventListener('mousedown', pointer, true);
      doc.removeEventListener('focusin', focus, true);
      releaseWidth?.();
    };
    this._setReaderOutlineExplorerFocus(state, false);
  },

  /**
   * Inset this pane's PDF scroll container for the life of the tree. The
   * iframe itself keeps its size, so notify its usual resize handlers to
   * update fit zoom and page geometry when the inset is added or removed.
   */
  _reserveReaderOutlineWidth(pdfWin, width) {
    const container = pdfWin.PDFViewerApplication?.pdfViewer?.container
      || pdfWin.document.getElementById('viewerContainer');
    if (!container?.isConnected) return null;
    const style = container.style;
    const previousLeft = style.getPropertyValue('left');
    const priority = style.getPropertyPriority('left');
    style.setProperty('left', width, priority);
    const appliedLeft = style.getPropertyValue('left');
    const resize = () => pdfWin.dispatchEvent(new pdfWin.Event('resize'));
    resize();
    return () => {
      try {
        if (style.getPropertyValue('left') !== appliedLeft
            || style.getPropertyPriority('left') !== priority) return;
        if (previousLeft) style.setProperty('left', previousLeft, priority);
        else style.removeProperty('left');
        if (!pdfWin.closed && container.isConnected) resize();
      } catch (_) {} // The PDF window may have been destroyed.
    };
  },

  /** Locate once per opening, expanding only the current chapter's parent path. */
  async _loadReaderOutlineExplorer(state, reader, pdfWin,
    reading = this._readerOutlineReadingPosition(pdfWin)) {
    const load = { overlay: state._outlineExplorerOverlay, interacted: false };
    state._outlineExplorerLoad = load;
    const current = () => {
      if (state._outlineExplorerLoad !== load || !state.outlineExplorerOpen
          || state._outlineExplorerOverlay !== load.overlay
          || state._outlineExplorerPdfWin !== pdfWin) return false;
      try { return !!load.overlay?.isConnected; } catch (_) { return false; }
    };
    state.outlineExplorerLoading = true;
    this._renderReaderOutlineExplorer(state);
    try {
      const tree = state.outlineExplorerTree || await this._fetchReaderOutlineTree(reader, pdfWin);
      if (!current()) return;
      state.outlineExplorerTree = tree;
      const entries = this._flattenReaderOutlineTree(tree);
      const initial = await this._readerOutlineCurrentIndex(entries, pdfWin, reading);
      if (!current()) return;
      const selected = entries[initial];
      if (selected && !load.interacted) {
        const byID = new Map(entries.map(entry => [entry.id, entry]));
        let parent = byID.get(selected.parentID);
        while (parent) {
          parent.expanded = true;
          parent = byID.get(parent.parentID);
        }
      }
      this._refreshReaderOutlineExplorer(state);
      if (selected && !load.interacted) {
        state.outlineExplorerSelected = Math.max(0, state.outlineExplorerVisible.indexOf(selected));
      }
      if (!state.outlineExplorerVisible.length) {
        this._setReaderOutlineExplorerStatus(state, 'No outline available');
      }
    } catch (e) {
      if (!current()) return;
      Zotero.debug('[ZoteroVim] _loadReaderOutlineExplorer error: ' + e);
      state.outlineExplorerTree = [];
      this._refreshReaderOutlineExplorer(state);
      this._setReaderOutlineExplorerStatus(state, 'Error loading outline');
    }
    if (!current()) return;
    state._outlineExplorerLoad = null;
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
      loading.style.cssText = 'padding:12px 14px;color:var(--zv-theme-muted, #6c7086);';
      loading.textContent = 'Loading outline...';
      list.appendChild(loading);
      return;
    }

    const items = state.outlineExplorerVisible || [];
    if (!items.length) {
      const empty = h('div');
      empty.style.cssText = 'padding:12px 14px;color:var(--zv-theme-muted, #6c7086);';
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
        'cursor:pointer;border-left:3px solid ' + (isSel ? 'var(--zv-theme-accent, #89b4fa)' : 'transparent') + ';' +
        'background:' + (isSel ? 'var(--zv-theme-control, #313244)' : 'transparent') + ';';

      const twisty = h('span');
      twisty.style.cssText = 'display:inline-block;width:10px;color:var(--zv-theme-accent, #89b4fa);flex:0 0 10px;';
      twisty.textContent = hasChildren ? (item.expanded ? '▾' : '▸') : '·';

      const hint = h('span');
      hint.style.cssText = 'display:inline-block;min-width:22px;color:var(--zv-theme-hint-text, #f9e2af);flex:0 0 auto;font-weight:bold;';
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
    if (selRow) {
      selRow.scrollIntoView(Components.utils.cloneInto({ block: 'nearest' }, doc.defaultView));
    }
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
    const overlay = state._outlineExplorerOverlay;
    const isCurrent = () => state._outlineExplorerOverlay === overlay && !pdfWin.closed;
    const ok = await this._goToReaderHeading(state, reader, pdfWin, entry, isCurrent);
    if (!isCurrent()) return;
    if (!ok) {
      this._setReaderOutlineExplorerStatus(state, 'Jump failed');
      return;
    }
    this._closeReaderOutlineExplorer(state, pdfWin);
    this._setMode(state, 'normal');
    this._recordReaderHistoryPoint(reader, state, pdfWin);
  },

  async _goToReaderOutlineEntry(reader, pdfWin, entry) {
    try {
      const app = pdfWin?.PDFViewerApplication;
      const pdfDoc = app?.pdfDocument;
      const linkService = app?.pdfLinkService;
      const originalDest = entry.dest;
      const contentDest = dest => dest && typeof dest === 'object'
        ? Components.utils.cloneInto(dest, pdfWin) : dest;

      if (originalDest && typeof linkService?.getDestinationHash === 'function' && typeof linkService?.setHash === 'function') {
        try {
          const hash = linkService.getDestinationHash(contentDest(originalDest));
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
          await linkService.goToDestination(contentDest(originalDest));
          return true;
        } catch (_) {}
      }
      if (originalDest && typeof linkService?.navigateTo === 'function') {
        try {
          await linkService.navigateTo(contentDest(originalDest));
          return true;
        } catch (_) {}
      }

      let dest = originalDest;
      if (typeof dest === 'string' && typeof pdfDoc?.getDestination === 'function') {
        dest = await pdfDoc.getDestination(dest);
      }
      if (dest && typeof linkService?.getDestinationHash === 'function' && typeof linkService?.setHash === 'function') {
        try {
          const hash = linkService.getDestinationHash(contentDest(dest));
          if (hash) {
            linkService.setHash(String(hash).replace(/^#/, ''));
            return true;
          }
        } catch (_) {}
      }
      if (dest && typeof linkService?.goToDestination === 'function') {
        try {
          await linkService.goToDestination(contentDest(dest));
          return true;
        } catch (_) {}
      }
      if (dest && typeof linkService?.navigateTo === 'function') {
        try {
          await linkService.navigateTo(contentDest(dest));
          return true;
        } catch (_) {}
      }

      const resolvedPageIndex = await this._resolveReaderOutlinePageIndex(entry, dest, pdfDoc);
      if (typeof resolvedPageIndex === 'number') {
        // A hash addresses this exact pane, even if Zotero's last-view state
        // still points at its sibling. Avoid reader-level navigation here.
        if (typeof linkService?.setHash === 'function') {
          linkService.setHash('page=' + (resolvedPageIndex + 1));
          return true;
        }
        const view = [reader?._internalReader?._primaryView, reader?._internalReader?._secondaryView]
          .find(candidate => candidate?._iframeWindow === pdfWin);
        if (typeof view?.navigate === 'function') {
          const targetWin = reader._iframeWindow || pdfWin;
          await view.navigate(Components.utils.cloneInto({ pageIndex: resolvedPageIndex }, targetWin));
          return true;
        }
      }
      // Native sidebar links are shared between panes and can target the
      // primary one. Only use that legacy fallback in a single-pane reader.
      if (!reader?._internalReader?._secondaryView
          && this._clickNativeReaderOutlineEntry(reader, pdfWin, entry)) return true;
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
      this._setReaderOutlineExplorerStatus(state,
        'Selected ' + exact.item.hint + '  ·  / search headings  ·  Ctrl+l PDF  ·  Enter jump');
      return;
    }

    this._setReaderOutlineExplorerStatus(state, 'Hint: ' + nextBuffer);
  },

  _clearReaderOutlineExplorerHintBuffer(state, resetStatus = true) {
    state.outlineExplorerHintBuffer = '';
    clearTimeout(state._outlineExplorerHintTimer);
    state._outlineExplorerHintTimer = null;
    if (resetStatus && state._outlineExplorerStatus) {
      state._outlineExplorerStatus.textContent =
        'j/k move  ·  l expand  ·  h collapse  ·  / search headings  ·  Ctrl+l PDF  ·  Esc close';
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
        'j/k move  ·  Ctrl+d/u fast  ·  gg/G top/bottom  ·  R/M expand/collapse all  ·  ' +
        '/ search headings  ·  Ctrl+h/l focus  ·  Enter jump';
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
    if (state._outlineExplorerLoad && state.outlineExplorerTree?.length) {
      state._outlineExplorerLoad.interacted = true;
    }
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
    target.style.outline = '1px solid var(--zv-theme-accent, rgba(137,180,250,0.9))';
    target.style.background = 'var(--zv-theme-accent-faint, rgba(137,180,250,0.15))';
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
        // Keep the existing mouse selection, but remember its anchor so
        // subsequent j/k/w/b and `o` work exactly like a keyboard selection.
        state.visualCursor = { textNode: sel.anchorNode, offset: sel.anchorOffset };
        state.visualPreferredX = this._cursorCurrentX(pdfWin.document, sel, null);
        this._updateVisualCursor(state, pdfWin);
        return;
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
      const body = state._readerBodyText ? this._readingOrderKeys(pdfWin.document, state) : null;
      if (sel.rangeCount > 0 && sel.isCollapsed && sel.focusNode?.nodeType === 3
          && (!body || body.byNode.has(sel.focusNode))) {
        state.visualCursor = {
          textNode: sel.focusNode,
          offset: sel.focusOffset,
        };
        return true;
      }

      if (state.visualCursor?.textNode?.isConnected
          && (!body || body.byNode.has(state.visualCursor.textNode))) {
        const r = pdfWin.document.createRange();
        r.setStart(state.visualCursor.textNode, state.visualCursor.offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }

      const tn = body ? body.items[0]?.node
        : pdfWin.document.querySelector('.textLayer span')?.firstChild;
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
      } else if (granularity === 'character') {
        // Deterministic char movement over reading-ordered text nodes
        // (column-aware), same as visual _extendByChar.
        const doc = pdfWin.document;
        const sel = pdfWin.getSelection();
        if (!sel) return;
        const nodes = this._cursorOrderedTextNodes(doc, state);
        if (!nodes.length) return;
        let idx = this._cursorNodeIndex(nodes, sel.focusNode);
        if (idx < 0) idx = 0;
        let pos = { idx, off: Math.max(0, Math.min(sel.focusOffset || 0, nodes[idx].length)) };
        for (let i = 0; i < times; i++) {
          pos = direction === 'forward'
            ? this._cursorAdvancePos(nodes, pos)
            : this._cursorRetreatPos(nodes, pos);
        }
        const targetNode = nodes[Math.max(0, Math.min(pos.idx, nodes.length - 1))];
        const targetOff = Math.max(0, Math.min(pos.off, targetNode.length));
        const r = doc.createRange();
        r.setStart(targetNode, targetOff);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        state.visualCursor = { textNode: targetNode, offset: targetOff };
        state.cursorPreferredX = this._cursorCurrentX(doc, sel, state.cursorPreferredX);
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
      const keys = this._readingOrderKeys(doc, state);
      const target = this._lineMoveTarget(doc, sel.focusNode, sel.focusOffset, direction,
        state.cursorPreferredX, keys);
      if (!target) return false;
      if (Number.isFinite(target.preferredX)) state.cursorPreferredX = target.preferredX;
      if (target.stopped) {
        this._showStatus(state, direction > 0 ? '→ document end' : '→ document top', 900);
        return false;
      }
      if (!target.node) return false;

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

  /** Read each mounted page independently. Scrolling translates cached page geometry. */
  _readingOrderKeys(doc, state = null) {
    const layers = Array.from(doc.querySelectorAll('.textLayer'));
    const byNode = new Map();
    const lines = [];
    const items = [];
    const mounted = (layers.length ? layers : [doc]).map((layer, index) => {
      const page = layer.closest?.('.page[data-page-number]');
      const pageNumber = Number(page?.dataset.pageNumber);
      const pageIdx = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber - 1 : index;
      const rect = layer.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
      return { page, pageIdx, rect, layout: this._readerPageTextLayout(layer, rect) };
    });
    let repeated;
    if (state?._readerBodyText) {
      // Keep evidence from pages that scrolled out of PDF.js's rendered range.
      const documents = state._readerBodyDocuments ||= new WeakMap();
      const pdf = doc.defaultView?.PDFViewerApplication?.pdfDocument;
      let evidence = documents.get(doc);
      if (!evidence || evidence.pdf !== pdf) {
        evidence = { pdf, repeated: new Map() };
        documents.set(doc, evidence);
      }
      repeated = evidence.repeated;
      for (const entry of mounted) {
        const { layout, rect, pageIdx } = entry;
        entry.body = layout.body ||= this._readerBodyPageLines(layout.lines, rect);
        for (const name of entry.body.running.values()) {
          if (!repeated.has(name)) repeated.set(name, new Set());
          repeated.get(name).add(pageIdx);
        }
      }
    }
    for (const { page, pageIdx, rect, layout, body } of mounted) {
      for (const line of layout.lines) {
        if (body && (body.excluded.has(line.geometry)
            || repeated.get(body.running.get(line.geometry))?.size >= 2)) continue;
        const spans = line.spans.map(item => {
          const r = item.rect;
          const current = { ...item, page, pageIdx, line, colIdx: line.colIdx, order: items.length,
            rect: { left: r.left + rect.left, right: r.right + rect.left,
              top: r.top + rect.top, bottom: r.bottom + rect.top, width: r.width,
              height: r.height } };
          items.push(current);
          byNode.set(item.node, current);
          return current;
        });
        lines.push({ pageIdx, colIdx: line.colIdx, block: line.block, source: line,
          midY: line.midY + rect.top, top: line.top + rect.top, bottom: line.bottom + rect.top,
          colLeft: Math.min(...spans.map(it => it.rect.left)),
          colRight: Math.max(...spans.map(it => it.rect.right)),
          spans });
      }
    }
    return { items, lines, byNode };
  },

  /** Classify familiar publisher furniture and well-supported notes on one text layer. */
  _readerBodyPageLines(lines, { height }) {
    const excluded = new Set();
    const running = new Map();
    if (!(height > 0)) return { excluded, running };

    const physical = [...new Set(lines.map(line => line.geometry))];
    const entries = physical.map(line => {
      let text = '';
      let previous = null;
      for (const item of line.spans) {
        if (previous && (item.wordBreakBefore === previous.domIndex
            || this._pdfTextHasGap(previous.rect, item.rect))) text += ' ';
        text += item.node.data;
        previous = item;
      }
      text = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
      return { line, text, font: Math.max(...line.spans.map(item => item.rect.height)) };
    });
    const fonts = entries.filter(it => !it.line.vertical && it.text.length >= 12
      && it.line.midY >= height * 0.13 && it.line.midY <= height * 0.88)
      .map(it => it.font).sort((a, b) => a - b);
    const unit = fonts[Math.floor(fonts.length / 2)] || 0;
    const columns = new Map();
    const caption = /^(?:fig(?:ure)?\.?|table|movie|video|图|表|视频)\s*[A-Z]?\d+[A-Z]?[.:：．]\s*/iu;

    for (const it of entries) {
      const { line, text } = it;
      const atTop = line.midY < height * 0.11;
      const atBottom = line.midY > height * 0.92;
      const compact = text.replace(/\s+/gu, '');
      const pageLabel = /^(?:page\s*)?\d+\s*(?:of|\/)\s*\d+$/iu;
      const masthead = /^[\p{L}&.-]+\|(?:researcharticle|researchreport|reviewarticle)$/iu;
      const uppercaseMasthead = /^[A-Z&.-]{5,40}(?:RESEARCHARTICLE|RESEARCHREPORT|REVIEWARTICLE)$/u;
      if ((line.vertical && /downloadedfrom|^arxiv:/iu.test(compact))
          || (atTop && (masthead.test(compact) || uppercaseMasthead.test(compact))) || (atBottom && pageLabel.test(text))
          || (atBottom && /\bet\s+al\..{0,90}\be[a-z]{2,}\d{3,}\s*\(\d{4}\)/iu.test(text))) {
        excluded.add(line);
        continue;
      }
      if (!line.vertical && (atTop || atBottom) && text.length >= 10 && text.length <= 160) {
        const region = atTop ? 'top:' : 'bottom:';
        running.set(line, region + text.toLowerCase());
      }
      if (!line.vertical && line.colIdx >= 0) {
        const column = line.block + ':' + line.colIdx;
        if (!columns.has(column)) columns.set(column, []);
        columns.get(column).push(it);
      }
    }

    if (!unit) return { excluded, running };
    const nearby = (a, b) => b.line.top - a.line.bottom <= unit * 0.8;
    for (const column of columns.values()) {
      column.sort((a, b) => a.line.midY - b.line.midY);
      for (let i = 0; i < column.length; i++) {
        const current = column[i];
        if (excluded.has(current.line)) continue;
        const previous = column[i - 1];
        if (caption.test(current.text) && current.font <= unit * 0.92 && previous
            && current.line.top - previous.line.bottom > unit * 2) {
          excluded.add(current.line);
          while (i + 1 < column.length) {
            const next = column[i + 1];
            if (excluded.has(next.line) || caption.test(next.text) || !nearby(column[i], next)
                || Math.abs(next.font - current.font) > unit * 0.1) break;
            excluded.add(next.line);
            i++;
          }
        }
        if (current.line.midY <= height * 0.68 || current.font > unit * 0.9
            || !/corresponding author|present address|equal contribution/iu.test(current.text)) {
          continue;
        }
        let start = i, end = i;
        const note = it => it.font <= unit * 0.9 && it.line.midY > height * 0.68
          && !excluded.has(it.line);
        while (start > 0 && note(column[start - 1]) && nearby(column[start - 1], column[start])) {
          start--;
        }
        while (end + 1 < column.length && note(column[end + 1]) && nearby(column[end], column[end + 1])) {
          end++;
        }
        if (end > start) {
          for (const it of column.slice(start, end + 1)) excluded.add(it.line);
          i = end;
        }
      }
    }
    return { excluded, running };
  },

  _toggleReaderBodyText(state, pdfWin) {
    if (!pdfWin?.PDFViewerApplication?.pdfViewer) return;
    this._closeReaderFlash?.(state, false);
    this._clearOrderedReaderVisual(state);
    state._readerBodyText = !state._readerBodyText;
    const zh = this._isZhLocale();
    const message = state._readerBodyText ? (zh ? '只选正文' : 'Body text only')
      : (zh ? '选择全部文字' : 'All text selectable');
    this._showStatus(state, message, 1800);
  },

  _readerPageTextLayout(layer, bounds) {
    const win = layer.ownerDocument?.defaultView;
    const Observer = win?.MutationObserver;
    const rotation = layer.getAttribute?.('data-main-rotation');
    let layout = this._readerPageTextLayouts.get(layer);
    const size = [bounds.width, bounds.height, rotation].join(':');
    if (layout && layout.size === size && !layout.dirty && !layout.observer.takeRecords().length) {
      return layout;
    }
    layout?.observer.disconnect();

    const selector = layer.nodeType === 1 ? 'span' : '.textLayer span';
    const items = [];
    let precedingSpace = null;
    for (const [domIndex, span] of Array.from(layer.querySelectorAll(selector)).entries()) {
      const node = span.firstChild;
      if (node?.nodeType !== 3 || !node.data) continue;
      if (/^[\p{White_Space}\u200B\uFEFF]+$/u.test(node.data)) {
        precedingSpace = items.at(-1)?.domIndex ?? null;
        continue;
      }
      const wordBreakBefore = precedingSpace;
      precedingSpace = null;
      const r = span.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      items.push({ span, node, domIndex, wordBreakBefore, rect: { left: r.left - bounds.left,
        right: r.right - bounds.left, top: r.top - bounds.top, bottom: r.bottom - bounds.top,
        width: r.width, height: r.height } });
    }
    layout = { size, lines: this._readerPageTextLines(items, bounds.width) };
    if (Observer) {
      const observer = new Observer(() => { layout.dirty = true; });
      observer.observe(layer, Components.utils.cloneInto({
        subtree: true, childList: true, characterData: true,
      }, win));
      layout.observer = observer;
      this._readerPageTextLayouts.set(layer, layout);
    }
    return layout;
  },

  _readerPageTextLayouts: new WeakMap(),

  /** Group by baseline first, then detect recurring gaps between chunks on this page. */
  _readerPageTextLines(items, pageWidth) {
    if (!items.length) return [];
    const heights = items.map(it => it.rect.height).sort((a, b) => a - b);
    const unit = heights[Math.floor(heights.length / 2)] || items[0].rect.height;
    const tolerance = unit * 0.45;
    const center = it => (it.rect.top + it.rect.bottom) / 2;
    const rows = [];
    const sideText = [];
    const sorted = [...items].sort((a, b) => center(a) - center(b)
      || a.rect.left - b.rect.left || a.domIndex - b.domIndex);
    for (const item of sorted) {
      const { width, height } = item.rect;
      // Rotated margin text can overlap dozens of baselines. Keep it available
      // after the page's horizontal text without joining it to a body line.
      if (height >= unit * 3 && height >= width * 2) {
        sideText.push(item);
        continue;
      }
      const row = rows.at(-1);
      if (row && center(item) - row.midY <= tolerance) row.spans.push(item);
      else rows.push({ midY: center(item), spans: [item] });
    }
    for (const row of rows) {
      row.spans.sort((a, b) => a.rect.left - b.rect.left || a.domIndex - b.domIndex);
      row.chunks = [];
      for (const it of row.spans) {
        const last = row.chunks.at(-1);
        if (last && it.rect.left - last.right <= unit * 1.25) {
          last.right = Math.max(last.right, it.rect.right);
        } else row.chunks.push({ left: it.rect.left, right: it.rect.right, y: row.midY });
      }
    }

    const chunks = rows.flatMap(row => row.chunks);
    const width = pageWidth || (Math.max(...chunks.map(r => r.right))
      - Math.min(...chunks.map(r => r.left)));
    const columns = this._readerPageColumns(chunks, width, unit);
    const lines = [];
    let block = 0;
    for (const row of rows) {
      const byColumn = new Map();
      const spanning = columns.some(edge => row.chunks.some(chunk =>
        chunk.left <= edge - unit * 2 && chunk.right >= edge + unit * 2));
      for (const it of row.spans) {
        const x = (it.rect.left + it.rect.right) / 2;
        const colIdx = spanning ? -1 : columns.filter(edge => x >= edge).length;
        if (!byColumn.has(colIdx)) byColumn.set(colIdx, []);
        byColumn.get(colIdx).push(it);
      }
      if (spanning) block++;
      for (const [colIdx, spans] of byColumn) {
        lines.push({ colIdx, block, midY: row.midY, spans,
          top: Math.min(...spans.map(it => it.rect.top)),
          bottom: Math.max(...spans.map(it => it.rect.bottom)) });
      }
      if (spanning) block++;
    }
    for (const it of sideText) {
      lines.push({ colIdx: -1, block: ++block, midY: center(it), spans: [it],
        top: it.rect.top, bottom: it.rect.bottom, vertical: true });
    }

    // Preserve the source sequence, including publisher-chosen figure and footnote
    // placement. A geometric line can occur in more than one native fragment.
    const lineByItem = new Map();
    for (const line of lines) {
      for (const item of line.spans) lineByItem.set(item, line);
    }
    const native = [];
    for (const item of items) {
      const line = lineByItem.get(item);
      const previous = native.at(-1);
      if (previous?.geometry === line) previous.spans.push(item);
      else native.push({ ...line, geometry: line, spans: [item] });
    }
    return this._repairReaderColumnInterleaving(native, unit);
  },

  /** Reorder local column runs only when repeated returns prove row-major source order. */
  _repairReaderColumnInterleaving(lines, unit) {
    const runs = [];
    for (const [index, line] of lines.entries()) {
      const last = runs.at(-1);
      if (last?.block === line.block && last.col === line.colIdx && line.colIdx >= 0) {
        last.end = index + 1;
      } else runs.push({ start: index, end: index + 1, block: line.block, col: line.colIdx });
    }

    const broad = line => {
      const spans = line.geometry.spans;
      return Math.max(...spans.map(it => it.rect.right)) - Math.min(...spans.map(it => it.rect.left))
        >= unit * 4;
    };
    const repairs = [];
    for (let i = 1; i + 1 < runs.length; i++) {
      const [left, across, right] = [runs[i - 1], runs[i], runs[i + 1]];
      if (left.col < 0 || across.col < 0 || left.col !== right.col
          || left.block !== across.block || left.block !== right.block) continue;
      const a = lines[left.end - 1], b = lines[right.start];
      const before = a.midY, after = b.midY;
      if (after - before < unit * 0.45 || after - before > unit * 4 || !broad(a) || !broad(b)) continue;
      const crossing = lines.slice(across.start, across.end);
      if (!crossing.some(broad)) continue;
      const other = crossing.map(line => line.midY);
      const tolerance = unit * 3;
      if (Math.min(...other) < before - tolerance || Math.max(...other) > after + tolerance) {
        continue;
      }
      const previous = repairs.at(-1);
      if (previous && across.start < previous.end) {
        previous.end = right.start + 1;
        previous.returns++;
      } else {
        repairs.push({ start: left.end - 1, end: right.start + 1, returns: 1 });
      }
    }
    const ordered = lines.slice();
    for (const { start, end, returns } of repairs) {
      if (returns < 2) continue;
      const local = lines.slice(start, end).sort((a, b) => a.colIdx - b.colIdx);
      ordered.splice(start, end - start, ...local);
    }
    return ordered;
  },

  /** A gutter must separate real text on several rows, not just short indents or a sparse figure. */
  _readerPageColumns(chunks, width, unit) {
    const eligible = chunks.filter(chunk => chunk.right - chunk.left <= width * 0.6);
    const split = (parts, depth = 0) => {
      if (parts.length < 6) return [];
      const changes = new Map();
      for (const { left, right } of parts) {
        changes.set(left, (changes.get(left) || 0) + 1);
        changes.set(right, (changes.get(right) || 0) - 1);
      }
      const edges = [...changes].filter(([, delta]) => delta).sort(([a], [b]) => a - b);
      const lo = edges[0][0], hi = edges.at(-1)[0];
      if (hi - lo < unit * 9) return [];

      // Sweep the actual text edges. Binning them can reject the same gutter
      // at a different zoom when one narrow valley straddles a bucket boundary.
      const bands = [];
      let count = 0, max = 0;
      for (let i = 0; i < edges.length - 1; i++) {
        const [left, delta] = edges[i];
        count += delta;
        max = Math.max(max, count);
        bands.push({ left, right: edges[i + 1][0], count });
      }

      let best = null;
      for (const [i, band] of bands.entries()) {
        const { count } = band;
        const gap = band.right - band.left;
        const x = (band.left + band.right) / 2;
        if (x < lo + (hi - lo) * 0.15 || x > lo + (hi - lo) * 0.85
            || gap < unit * 0.75 || count > max * 0.25
            || bands[i - 1]?.count < count || bands[i + 1]?.count < count) continue;
        const leftRows = new Set(parts.filter(p => p.right <= x).map(p => p.y));
        const rightRows = new Set(parts.filter(p => p.left >= x).map(p => p.y));
        if (leftRows.size < 3 || rightRows.size < 3) continue;
        const upper = Math.max(Math.min(...leftRows), Math.min(...rightRows));
        const lower = Math.min(Math.max(...leftRows), Math.max(...rightRows));
        const support = [...leftRows].filter(y => rightRows.has(y)).length;
        // Columns with different line spacing can still share a gutter. A few
        // crossing title or caption lines are compatible with two sustained tracks.
        if (support < 3 && (lower - upper < unit * 2
            || count > Math.min(leftRows.size, rightRows.size) * 0.15)) continue;
        if (!best || count < best.count || (count === best.count
            && (support > best.support || (support === best.support && gap > best.gap)))) {
          best = { x, count, support, gap };
        }
      }
      if (!best) return [];
      const { x } = best;
      if (depth) return [x];
      return [...split(parts.filter(p => p.right <= x), depth + 1), x,
        ...split(parts.filter(p => p.left >= x), depth + 1)];
    };
    return split(eligible);
  },

  _cursorVisibleLines(doc, state = null) {
    const { lines } = this._readingOrderKeys(doc, state);
    return { lines };
  },

  _currentLineIndex(lines, focusY, focusX) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (focusY >= l.top - 1 && focusY <= l.bottom + 1 &&
          focusX >= l.colLeft - 8 && focusX <= l.colRight + 8) {
        return i;
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (focusY >= l.top - 1 && focusY <= l.bottom + 1) return i;
    }
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const d = Math.abs(lines[i].midY - focusY);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  },

  /** Resolve the adjacent reading-order line, keeping a horizontal reference within its column. */
  _lineMoveTarget(doc, focusNode, focusOffset, direction, preferredX = null, keys = null) {
    const focusEl = focusNode?.nodeType === 3 ? focusNode.parentElement : focusNode;
    const focusRect = focusEl?.getBoundingClientRect?.();
    if (!focusRect) return null;

    // Column containment uses the focus character's OWN x — a stale
    // preferredX from another column must not mis-route j/k.  preferredX is
    // only used to pick the closest span inside the target line.
    let charX = (focusRect.left + focusRect.right) / 2;
    try {
      if (focusNode?.nodeType === 3 && focusNode.length > 0) {
        const off = Math.max(0, Math.min(focusOffset || 0, focusNode.length - 1));
        const r = doc.createRange();
        r.setStart(focusNode, off);
        r.setEnd(focusNode, Math.min(focusNode.length, off + 1));
        const rects = r.getClientRects();
        if (rects.length) charX = (rects[0].left + rects[0].right) / 2;
      }
    } catch (_) {}

    const focusY = (focusRect.top + focusRect.bottom) / 2;
    const { lines } = keys || this._cursorVisibleLines(doc);
    if (!lines.length) return null;

    const exact = lines.findIndex(line => line.spans.some(it => it.node === focusNode));
    const curLineIdx = exact < 0 ? this._currentLineIndex(lines, focusY, charX) : exact;
    if (curLineIdx < 0) return null;
    const curLine = lines[curLineIdx];

    let selX = Number.isFinite(preferredX) ? preferredX : charX;
    const targetIdx = curLineIdx + (direction > 0 ? 1 : -1);
    if (targetIdx < 0 || targetIdx >= lines.length) {
      return { node: null, offset: 0, stopped: direction > 0 ? 'end' : 'top' };
    }

    const targetLine = lines[targetIdx];
    if (targetLine.pageIdx !== curLine.pageIdx || targetLine.block !== curLine.block
        || targetLine.colIdx !== curLine.colIdx) {
      selX += targetLine.colLeft - curLine.colLeft;
    }

    // Choose the span whose centre x is closest to the desired x.
    let bestSpan = null;
    let bestDist = Infinity;
    for (const s of targetLine.spans) {
      const distX = Math.abs(((s.rect.left + s.rect.right) / 2) - selX);
      if (distX < bestDist) {
        bestDist = distX;
        bestSpan = s;
      }
    }
    const node = bestSpan?.span?.firstChild || null;
    if (!node) return { node: null, offset: 0, stopped: null, preferredX: selX, line: targetLine };

    // Resolve the exact offset inside the line, most precise first:
    //   1. caretPositionFromPoint with the x clamped into the column
    //   2. caretPositionFromPoint on the chosen span's own centre x
    //   3. binary search of character rects inside the span's text node
    // A caretPositionFromPoint result is accepted from ANY span of the
    // target line — it is the most precise geometric answer even when it
    // lands on a neighbouring span.
    let targetNode = node;
    let targetOffset = 0;
    let placed = false;

    const acceptProbe = (cp) => {
      if (!cp?.offsetNode || cp.offsetNode.nodeType !== 3) return false;
      const owner = cp.offsetNode.parentElement;
      if (!owner) return false;
      for (const s of targetLine.spans) {
        if (s.span === owner || s.span.contains(owner)) {
          targetNode = cp.offsetNode;
          targetOffset = cp.offset;
          return true;
        }
      }
      return false;
    };

    try {
      const probeX = Math.max(targetLine.colLeft, Math.min(selX, targetLine.colRight));
      if (acceptProbe(doc.caretPositionFromPoint?.(probeX, targetLine.midY))) placed = true;
    } catch (_) {}
    if (!placed && bestSpan.rect) {
      try {
        const cx = (bestSpan.rect.left + bestSpan.rect.right) / 2;
        if (acceptProbe(doc.caretPositionFromPoint?.(cx, targetLine.midY))) placed = true;
      } catch (_) {}
    }
    if (!placed) {
      const off = this._offsetAtX(doc, node, selX);
      if (off !== null) {
        targetOffset = off;
      } else {
        targetOffset = selX < (targetLine.colLeft + targetLine.colRight) / 2 ? 0 : node.length;
      }
    }

    return { node: targetNode, offset: targetOffset, stopped: null, preferredX: selX, line: targetLine };
  },

  _cursorCurrentX(doc, sel, fallback = null) {
    try {
      if (!sel?.focusNode) return fallback;
      const focusNode = sel.focusNode;
      if (focusNode.nodeType === 3 && focusNode.length > 0) {
        const offset = Math.max(0, Math.min(sel.focusOffset || 0, focusNode.length));
        const r = doc.createRange();
        r.setStart(focusNode, offset);
        r.collapse(true);
        const caret = r.getBoundingClientRect?.();
        if (caret?.height > 0) return caret.left;
        const start = Math.min(offset, focusNode.length - 1);
        r.setStart(focusNode, start);
        r.setEnd(focusNode, start + 1);
        const rect = r.getClientRects()[0];
        if (rect) return offset === focusNode.length ? rect.right : rect.left;
      }
      const el = focusNode.nodeType === 3 ? focusNode.parentElement : focusNode;
      const rect = el?.getBoundingClientRect?.();
      if (rect) return (rect.left + rect.right) / 2;
    } catch (_) {}
    return fallback;
  },

  /**
   * Character offset inside a text node whose rendered x is closest to the
   * given viewport x.  Binary search over the node's character rects —
   * text within a single span is laid out left-to-right, so x is monotonic.
   * Returns null when the node has no measurable rects.
   */
  _offsetAtX(doc, node, x) {
    try {
      const len = node.length;
      if (!len) return 0;
      const xAt = (off) => {
        const o = Math.max(0, Math.min(off, len - 1));
        const r = doc.createRange();
        r.setStart(node, o);
        r.setEnd(node, o + 1);
        const rects = r.getClientRects();
        if (!rects.length) return null;
        return (rects[0].left + rects[0].right) / 2;
      };
      const x0 = xAt(0);
      const xN = xAt(len - 1);
      if (x0 === null || xN === null) return null;
      if (x <= x0) return 0;
      if (x >= xN) return len;
      let lo = 0, hi = len - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const xm = xAt(mid);
        if (xm === null) return null;
        if (xm < x) lo = mid; else hi = mid;
      }
      return Math.abs(x - xAt(lo)) <= Math.abs(xAt(hi) - x) ? lo : hi;
    } catch (_) {
      return null;
    }
  },

  _compareReaderPoints(a, b, keys) {
    if (a.node === b.node) return a.offset - b.offset;
    const first = keys?.byNode.get(a.node);
    const second = keys?.byNode.get(b.node);
    if (first && second) return first.order - second.order;
    const relation = a.node.compareDocumentPosition?.(b.node);
    return (relation & 1) ? NaN : (relation & 4) ? -1 : (relation & 2) ? 1 : NaN;
  },

  _orderedReaderVisual(state, pdfWin) {
    const ordered = state._orderedVisual;
    if (!ordered || ordered.pdfWin !== pdfWin) return null;
    if (ordered.doc !== pdfWin.document || !ordered.anchor.node.isConnected
        || !ordered.focus.node.isConnected || ordered.anchor.offset > ordered.anchor.node.length
        || ordered.focus.offset > ordered.focus.node.length
        || ordered.runs.some(({ range }) => range.startContainer.nodeType !== 3
          || range.endContainer.nodeType !== 3 || !range.startContainer.isConnected
          || !range.endContainer.isConnected)) {
      this._clearOrderedReaderVisual(state, pdfWin);
      return null;
    }
    return ordered;
  },

  _clearOrderedReaderVisual(state, pdfWin = state._orderedVisual?.pdfWin) {
    if (!state._orderedVisual || state._orderedVisual.pdfWin !== pdfWin) return;
    state._orderedVisual = null;
    state.visualCursor = null;
    state.visualPreferredX = null;
    try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
  },

  _readerVisualEndpoints(state, pdfWin) {
    const ordered = this._orderedReaderVisual(state, pdfWin);
    if (ordered) return ordered;
    const sel = pdfWin.getSelection();
    const saved = state.visualCursor;
    const anchorNode = saved?.textNode?.isConnected
      && (!saved.textNode.ownerDocument || saved.textNode.ownerDocument === pdfWin.document)
      ? saved.textNode : sel?.anchorNode;
    const anchorOffset = anchorNode === saved?.textNode ? saved.offset : sel?.anchorOffset;
    if (!anchorNode) return null;
    const focusNode = sel?.focusNode || anchorNode;
    const focusOffset = sel?.focusNode ? sel.focusOffset : anchorOffset;
    const doc = pdfWin.document;
    const anchor = this._readerTextPoint(doc, anchorNode, anchorOffset);
    const focus = this._readerTextPoint(doc, focusNode, focusOffset);
    return anchor && focus ? { anchor, focus, wordAnchor: null } : null;
  },

  _readerTextPoint(doc, node, offset) {
    if (node.nodeType === 3) return { node, offset };
    const layer = node.closest?.('.textLayer');
    if (!layer) return null;
    const point = doc.createRange();
    point.setStart(node, offset);
    point.collapse(true);
    let preceding = null;
    for (const span of layer.querySelectorAll('span')) {
      const text = span.firstChild;
      if (text?.nodeType !== 3 || !text.data) continue;
      if (point.comparePoint(text, 0) >= 0) return { node: text, offset: 0 };
      preceding = text;
    }
    return preceding && { node: preceding, offset: preceding.length };
  },

  /** Project the logical interval into exact page-local DOM runs, in reading order. */
  _readerVisualRuns(doc, anchor, focus, keys) {
    const order = this._compareReaderPoints(anchor, focus, keys);
    if (!Number.isFinite(order)) return null;
    const [start, end] = order <= 0 ? [anchor, focus] : [focus, anchor];
    const first = keys.byNode.get(start.node);
    const last = keys.byNode.get(end.node);
    if (!first || !last) {
      if (start.node !== end.node) return null;
      const range = doc.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return { runs: [{ range, page: start.node.parentElement?.closest?.('.page[data-page-number]') }],
        text: start.node.data?.slice(start.offset, end.offset) || '' };
    }

    const runs = [];
    let text = '';
    let previous = null;
    let current = null;
    for (let i = first.order; i <= last.order; i++) {
      const item = keys.items[i];
      const { node, line } = item;
      const from = i === first.order ? start.offset : 0;
      const to = i === last.order ? end.offset : node.length;
      if (to <= from) continue;
      if (previous) {
        if (previous.line !== line) text += '\n';
        else if (item.wordBreakBefore === previous.domIndex
            || this._pdfTextHasGap(previous.rect, item.rect)) text += ' ';
      }
      text += node.data.slice(from, to);
      if (!previous || previous.pageIdx !== item.pageIdx
          || previous.domIndex + 1 !== item.domIndex) {
        const range = doc.createRange();
        range.setStart(node, from);
        current = { range, page: item.page };
        runs.push(current);
      }
      current.range.setEnd(node, to);
      previous = item;
    }
    return { runs, text };
  },

  /** Two separate logical ranges can share one native Selection in Gecko. */
  _paintOrderedReaderVisual(pdfWin, ordered) {
    const { anchor, focus, runs } = ordered;
    const sel = pdfWin.getSelection();
    if (!sel) return false;
    const range = runs.length === 1 ? runs[0].range : null;
    const matches = (point, node, offset) => point.node === node && point.offset === offset;
    const contiguous = range
      && (matches(anchor, range.startContainer, range.startOffset)
        && matches(focus, range.endContainer, range.endOffset)
        || matches(focus, range.startContainer, range.startOffset)
        && matches(anchor, range.endContainer, range.endOffset));
    if (anchor.node === focus.node || contiguous) {
      if (typeof sel.setBaseAndExtent === 'function') {
        sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      } else {
        sel.collapse(anchor.node, anchor.offset);
        sel.extend(focus.node, focus.offset);
      }
    } else {
      sel.removeAllRanges();
      for (const { range } of runs) sel.addRange(range);
      if (!runs.length) sel.collapse(focus.node, focus.offset);
    }
    return true;
  },

  _applyReaderVisualSelection(state, pdfWin, anchor, focus, options = {}) {
    const doc = pdfWin.document;
    if (!anchor?.node?.isConnected || !focus?.node?.isConnected
        || (anchor.node.ownerDocument && anchor.node.ownerDocument !== doc)
        || (focus.node.ownerDocument && focus.node.ownerDocument !== doc)) return false;
    const result = this._readerVisualRuns(doc, anchor, focus,
      options.keys || this._readingOrderKeys(doc, state));
    if (!result) return false;
    const ordered = { ...result, pdfWin, doc, anchor, focus,
      wordAnchor: options.wordAnchor || null };
    const previous = state._orderedVisual;
    if (previous && previous.pdfWin !== pdfWin) this._clearOrderedReaderVisual(state);
    if (!this._paintOrderedReaderVisual(pdfWin, ordered)) return false;
    state._orderedVisual = ordered;
    state.visualCursor = { textNode: anchor.node, offset: anchor.offset };
    state.selectionParams = null;
    if (options.updatePreferredX !== false) {
      state.visualPreferredX = this._cursorCurrentX(doc,
        { focusNode: focus.node, focusOffset: focus.offset }, state.visualPreferredX);
    }
    this._updateVisualCursor(state, pdfWin);
    if (state.mode === 'visual') this._updateIndicator(state);
    return true;
  },

  _setVisualSelectionFromAnchor(state, pdfWin, targetNode, targetOffset, options = {}) {
    try {
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return false;
      return this._applyReaderVisualSelection(state, pdfWin, endpoints.anchor,
        { node: targetNode, offset: targetOffset }, { wordAnchor: endpoints.wordAnchor, ...options });
    } catch (e) {
      Zotero.debug('[ZoteroVim] _setVisualSelectionFromAnchor error: ' + e);
      return false;
    }
  },

  _normalizeReaderSelectionText(text) {
    return text.normalize('NFKC').replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim();
  },

  _readerSelectedText(state, pdfWin) {
    const ordered = this._orderedReaderVisual(state, pdfWin);
    if (ordered) return ordered.text;
    const sel = pdfWin?.getSelection?.();
    return sel && !sel.isCollapsed ? sel.toString() : '';
  },

  _cursorOrderedTextNodes(doc, state = null) {
    return this._readingOrderKeys(doc, state).items.map(it => it.node);
  },

  _cursorNodeIndex(nodes, node) {
    if (!node) return -1;
    if (node.nodeType === 3) return nodes.indexOf(node);
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].parentElement === node || node.contains?.(nodes[i])) return i;
    }
    return -1;
  },

  /** Distinguish a visible gap or line wrap from a font change inside a word. */
  _pdfTextHasGap(prev, next) {
    if (!prev || !next) return false;
    const height = Math.min(prev.height, next.height);
    if (!(height > 0)) return false;
    const overlap = Math.min(prev.bottom, next.bottom) - Math.max(prev.top, next.top);
    return overlap < height * 0.35 || next.left - prev.right > Math.max(2, height * 0.25)
      || next.left < prev.left - Math.max(2, height * 0.3);
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

  _cursorMoveWord(state, pdfWin, direction, bigWord, count) {
    const doc = pdfWin.document;
    const sel = pdfWin.getSelection();
    if (!sel) return;
    const keys = this._readingOrderKeys(doc, state);
    const nodes = keys.items.map(it => it.node);
    const idx = this._cursorNodeIndex(nodes, sel.focusNode);
    if (idx < 0) return;
    const off = Math.min(sel.focusOffset || 0, nodes[idx].length);
    let target;
    if (bigWord) {
      const pos = this._cursorComputeWordPosition(nodes, { idx, off }, direction, true, count);
      target = { node: nodes[pos.idx], offset: pos.off };
    } else {
      target = { node: nodes[idx], offset: off };
      const forward = direction === 'forward';
      for (let i = 0; i < count; i++) {
        const word = this._readerNearbyToken(keys, target, forward ? 1 : -1,
          forward ? 'start' : 'end', forward);
        if (!word) break;
        target = word.start;
      }
    }
    const { node: targetNode, offset: targetOff } = target;
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
      const target = this._lineBoundaryTarget(pdfWin.document, sel.focusNode, sel.focusOffset, toEnd, state);
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

  _beginCursorFind(state, motion, count = 0) {
    state.cursorFindPending = {
      motion,
      count: Math.max(1, count || 1),
      startedAt: Date.now(),
    };
    this._updateIndicator(state, (count > 0 ? String(count) : '') + motion);
  },

  _readerTextSnapshot(nodes) {
    const starts = new Map();
    const points = [];
    let text = '';
    for (const node of nodes || []) {
      if (!node || node.nodeType !== 3) continue;
      starts.set(node, text.length);
      const value = node.data || '';
      for (let i = 0; i < value.length; i++) points.push({ node, offset: i });
      text += value;
    }
    return { nodes: Array.from(starts.keys()), starts, points, text };
  },

  _readerSnapshotOffset(snapshot, node, offset) {
    const start = snapshot?.starts?.get(node);
    if (!Number.isFinite(start)) return -1;
    return start + Math.max(0, Math.min(Number(offset) || 0, node.length));
  },

  _readerSnapshotPoint(snapshot, offset) {
    if (!snapshot?.nodes?.length) return null;
    const pos = Math.max(0, Math.min(Number(offset) || 0, snapshot.text.length));
    if (pos < snapshot.points.length) return snapshot.points[pos];
    const node = snapshot.nodes[snapshot.nodes.length - 1];
    return { node, offset: node.length };
  },

  _cursorLineTextNodes(doc, focusNode, state = null) {
    const focusEl = focusNode?.nodeType === 3 ? focusNode.parentElement : focusNode;
    const { lines } = this._cursorVisibleLines(doc, state);
    for (const line of lines) {
      if (!line.spans?.some(item => item.span === focusEl || item.span.contains?.(focusEl))) {
        continue;
      }
      return line.spans
        .map(item => item.span?.firstChild)
        .filter(node => node?.nodeType === 3);
    }

    return !state?._readerBodyText && focusNode?.nodeType === 3 ? [focusNode] : [];
  },

  /** Resolve one f/F/t/T target on the current visual line. */
  _cursorFindTarget(nodes, focusNode, focusOffset, motion, char, count = 1) {
    const snapshot = this._readerTextSnapshot(nodes);
    const current = this._readerSnapshotOffset(snapshot, focusNode, focusOffset);
    if (current < 0 || !char) return null;
    const forward = motion === 'f' || motion === 't';
    let match = -1;
    let from = forward
      ? current + (Array.from(snapshot.text.slice(current))[0]?.length || 1)
      : current - 1;
    for (let i = 0; i < Math.max(1, count || 1); i++) {
      match = forward
        ? snapshot.text.indexOf(char, Math.max(0, from))
        : snapshot.text.lastIndexOf(char, from);
      if (match < 0) return null;
      from = forward ? match + char.length : match - 1;
    }
    let target = match;
    if (motion === 't') {
      const before = Array.from(snapshot.text.slice(0, match)).pop() || '';
      target = Math.max(0, match - before.length);
    } else if (motion === 'T') {
      target = Math.min(snapshot.text.length, match + char.length);
    }
    return this._readerSnapshotPoint(snapshot, target);
  },

  _cursorFindChar(state, pdfWin, motion, char, count = 1) {
    try {
      if (!this._ensureCursorCaret(state, pdfWin)) return false;
      const sel = pdfWin.getSelection();
      if (!sel?.focusNode) return false;
      const nodes = this._cursorLineTextNodes(pdfWin.document, sel.focusNode, state);
      const target = this._cursorFindTarget(
        nodes,
        sel.focusNode,
        sel.focusOffset,
        motion,
        char,
        count
      );
      if (!target) {
        this._showStatus(state, '✗ not found: ' + char, 900);
        return false;
      }
      const range = pdfWin.document.createRange();
      range.setStart(target.node, target.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      state.visualCursor = { textNode: target.node, offset: target.offset };
      state.cursorPreferredX = this._cursorCurrentX(
        pdfWin.document,
        sel,
        state.cursorPreferredX
      );
      this._updateVisualCursor(state, pdfWin);
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _cursorFindChar error: ' + e);
      return false;
    }
  },

  _lineBoundaryTarget(doc, focusNode, focusOffset, toEnd, state = null) {
    const focusEl = focusNode?.nodeType === 3 ? focusNode.parentElement : focusNode;
    const focusRect = focusEl?.getBoundingClientRect?.();
    if (!focusRect) return null;

    const focusY = (focusRect.top + focusRect.bottom) / 2;
    const focusX = (focusRect.left + focusRect.right) / 2;
    const { lines } = this._cursorVisibleLines(doc, state);
    if (!lines.length) return null;

    // Line lookup is column-aware: 0/$ stay inside the current column.
    const exact = lines.findIndex(line => line.spans.some(it => it.node === focusNode));
    const curLineIdx = exact < 0 ? this._currentLineIndex(lines, focusY, focusX) : exact;
    if (curLineIdx < 0) return null;

    const spans = lines[curLineIdx].spans;
    if (!spans?.length) return null;
    const targetSpan = toEnd ? spans[spans.length - 1] : spans[0];
    const node = targetSpan?.span?.firstChild || null;
    if (!node) return null;
    const offset = toEnd ? node.length : 0;
    return { node, offset };
  },

  _extendToLineBoundary(state, pdfWin, toEnd) {
    try {
      pdfWin.focus();
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return;
      const target = this._lineBoundaryTarget(pdfWin.document,
        endpoints.focus.node, endpoints.focus.offset, toEnd, state);
      if (target?.node) this._setVisualSelectionFromAnchor(state, pdfWin, target.node, target.offset);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendToLineBoundary error: ' + e);
    }
  },

  /** Derive word starts from source offsets, ignoring invisible PDF formatting characters. */
  _pdfWordStops(text, bigWord) {
    const starts = [];
    let kind = null, offset = 0, lastEnd = 0, mayJoin = true;
    for (const char of text) {
      const start = offset;
      offset += char.length;
      if (/[\p{White_Space}\u200B\uFEFF]/u.test(char)) {
        kind = null;
        mayJoin = false;
      } else if (!/[\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}]/u.test(char)) {
        const word = bigWord || /[\p{L}\p{M}\p{N}_]/u.test(char);
        if (word !== kind) starts.push({ off: start, kind: word, joins: mayJoin });
        kind = word;
        mayJoin = false;
        lastEnd = offset;
      }
    }
    return { starts, tail: kind, lastEnd, transparent: mayJoin };
  },

  _cursorComputeWordPosition(nodes, startPos, direction, bigWord, count, extend = false) {
    const forward = direction === 'forward';
    const step = forward ? 1 : -1;
    let target = startPos;
    let lastGlyph = null;
    const stopsByNode = new Map();
    const stops = idx => {
      if (!stopsByNode.has(idx)) {
        stopsByNode.set(idx, this._pdfWordStops(nodes[idx].data, bigWord));
      }
      return stopsByNode.get(idx);
    };
    for (let idx = startPos.idx; idx >= 0 && idx < nodes.length; idx += step) {
      const node = nodes[idx];
      const words = stops(idx);
      if (words.lastEnd) lastGlyph = { idx, off: words.lastEnd };
      const matches = forward ? words.starts : [...words.starts].reverse();
      for (const { off, kind, joins } of matches) {
        if (idx === startPos.idx && (off - startPos.off) * step <= 0) continue;
        if (joins && idx > 0) {
          let previous = idx - 1;
          while (previous >= 0 && stops(previous).transparent) previous--;
          if (previous >= 0 && stops(previous).tail === kind
              && !this._pdfTextHasGap(nodes[previous].parentElement?.getBoundingClientRect?.(),
                node.parentElement?.getBoundingClientRect?.())) continue;
        }
        target = { idx, off };
        if (--count <= 0) return target;
      }
    }

    if (extend && forward && lastGlyph
        && (lastGlyph.idx > target.idx
          || (lastGlyph.idx === target.idx && lastGlyph.off > target.off))) return lastGlyph;
    return target;
  },

  _readerWordRange(nodes, focusNode, focusOffset) {
    const snapshot = this._readerTextSnapshot(nodes);
    let pos = this._readerSnapshotOffset(snapshot, focusNode, focusOffset);
    if (pos < 0) return null;
    if (pos >= snapshot.text.length && pos > 0) pos--;
    const re = /[\p{L}\p{N}\p{M}_]+/gu;
    let firstAfter = null;
    let match;
    while ((match = re.exec(snapshot.text)) !== null) {
      const end = match.index + match[0].length;
      if (pos >= match.index && pos < end) {
        return { snapshot, start: match.index, end, text: match[0] };
      }
      if (!firstAfter && match.index >= pos) {
        firstAfter = { snapshot, start: match.index, end, text: match[0] };
      }
    }
    return firstAfter;
  },

  _readerTextObjectRange(nodes, focusNode, focusOffset, object) {
    if (object === 'word') return this._readerWordRange(nodes, focusNode, focusOffset);
    const snapshot = this._readerTextSnapshot(nodes);
    let pos = this._readerSnapshotOffset(snapshot, focusNode, focusOffset);
    if (pos < 0 || !snapshot.text) return null;
    pos = Math.min(pos, snapshot.text.length - 1);

    if (object === '"') {
      const quotes = [];
      for (let i = 0; i < snapshot.text.length; i++) {
        if (snapshot.text.charAt(i) !== '"') continue;
        let slashes = 0;
        for (let j = i - 1; j >= 0 && snapshot.text.charAt(j) === '\\'; j--) slashes++;
        if (slashes % 2 === 0) quotes.push(i);
      }
      for (let i = 0; i + 1 < quotes.length; i += 2) {
        if (pos >= quotes[i] && pos <= quotes[i + 1]) {
          return { snapshot, start: quotes[i] + 1, end: quotes[i + 1] };
        }
      }
      return null;
    }

    const pairs = { '(': ')', '[': ']', '{': '}' };
    const close = pairs[object];
    if (!close) return null;
    let depth = 0;
    let start = -1;
    for (let i = pos; i >= 0; i--) {
      const ch = snapshot.text.charAt(i);
      if (ch === close) depth++;
      else if (ch === object) {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    if (start < 0) return null;
    depth = 0;
    for (let i = start; i < snapshot.text.length; i++) {
      const ch = snapshot.text.charAt(i);
      if (ch === object) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return { snapshot, start: start + 1, end: i };
        }
      }
    }
    return null;
  },

  _selectVisualTextObject(state, pdfWin, object) {
    try {
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return false;
      const { node, offset } = endpoints.focus;
      let nodes = this._cursorOrderedTextNodes(pdfWin.document, state);
      if (object === '"') {
        nodes = this._cursorLineTextNodes(pdfWin.document, node, state);
      }
      const objectRange = this._readerTextObjectRange(
        nodes,
        node,
        offset,
        object
      );
      if (!objectRange || objectRange.end <= objectRange.start) return false;
      const start = this._readerSnapshotPoint(objectRange.snapshot, objectRange.start);
      const end = this._readerSnapshotPoint(objectRange.snapshot, objectRange.end);
      if (!start || !end) return false;
      return this._applyReaderVisualSelection(state, pdfWin, start, end);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _selectVisualTextObject error: ' + e);
      return false;
    }
  },

  _readerLineTokens(line) {
    if (!line.tokens) {
      const index = this._buildFlashIndex(line.spans);
      line.tokens = [...new Set(index.tokens.filter(Boolean))]
        .map(token => ({ start: index.starts[token.start], end: index.ends[token.end - 1] }))
        .filter(token => token.start && token.end);
    }
    return line.tokens;
  },

  _readerNearbyToken(keys, focus, step, edge, skipActive) {
    const item = keys.byNode.get(focus.node);
    if (!item) return null;
    const lines = keys.lines;
    const current = lines.findIndex(line => line.source === item.line);
    const compare = (a, b) => this._compareReaderPoints(a, b, keys);
    const tokens = this._readerLineTokens(item.line);
    const active = tokens.findIndex(token => edge === 'end'
      ? compare(token.start, focus) < 0 && compare(focus, token.end) <= 0
      : compare(token.start, focus) <= 0 && compare(focus, token.end) < 0);
    if (active >= 0) {
      const target = tokens[active + (skipActive ? step : 0)];
      if (target) return target;
    } else {
      const target = step > 0
        ? tokens.find(token => compare(token.start, focus) >= 0)
        : tokens.findLast(token => compare(token.end, focus) <= 0);
      if (target) return target;
    }
    for (let i = current + step; i >= 0 && i < lines.length; i += step) {
      const candidates = this._readerLineTokens(lines[i].source);
      if (candidates.length) return candidates.at(step > 0 ? 0 : -1);
    }
    return null;
  },

  /** Keep the original anchor word or phrase whole when the active end crosses it. */
  _readerAnchoredTokenEndpoints(anchor, target, keys) {
    if (!anchor) return { anchor: target.start, focus: target.end };
    if (this._compareReaderPoints(target.start, anchor.start, keys) < 0) {
      return { anchor: anchor.end, focus: target.start };
    }
    const focus = this._compareReaderPoints(target.end, anchor.end, keys) < 0
      ? anchor.end : target.end;
    return { anchor: anchor.start, focus };
  },

  _readerAnchorToken(keys, anchor, focus) {
    const item = keys.byNode.get(anchor.node);
    if (!item) return null;
    const order = this._compareReaderPoints(anchor, focus, keys);
    if (!order) return null;
    const edge = order < 0 ? 'start' : 'end';
    return this._readerLineTokens(item.line).find(token =>
      token[edge].node === anchor.node && token[edge].offset === anchor.offset) || null;
  },

  _readerTokenEndpoints(endpoints, target, keys) {
    const { anchor, focus, wordAnchor } = endpoints;
    if (wordAnchor) return this._readerAnchoredTokenEndpoints(wordAnchor, target, keys);
    const before = this._compareReaderPoints(target.end, anchor, keys) <= 0;
    const after = this._compareReaderPoints(target.start, anchor, keys) >= 0;
    const backward = this._compareReaderPoints(focus, anchor, keys) < 0;
    return { anchor, focus: before || (!after && backward) ? target.start : target.end };
  },

  _extendByWord(state, pdfWin, direction, count = 1) {
    try {
      pdfWin.focus();
      const keys = this._readingOrderKeys(pdfWin.document, state);
      let endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return;
      if (!endpoints.wordAnchor) {
        endpoints = { ...endpoints,
          wordAnchor: this._readerAnchorToken(keys, endpoints.anchor, endpoints.focus) };
      }
      let moved = false;
      const step = direction === 'forward' ? 1 : -1;
      for (let i = 0; i < count; i++) {
        const order = this._compareReaderPoints(endpoints.anchor, endpoints.focus, keys);
        const edge = (order < 0 || (order === 0 && step < 0)) ? 'end' : 'start';
        const target = this._readerNearbyToken(keys, endpoints.focus, step, edge, order !== 0);
        if (!target) break;
        if (order === 0) {
          const { start, end } = target;
          endpoints = { anchor: step > 0 ? start : end, focus: step > 0 ? end : start,
            wordAnchor: target };
        } else {
          const result = this._readerTokenEndpoints(endpoints, target, keys);
          endpoints = { ...result, wordAnchor: endpoints.wordAnchor };
        }
        moved = true;
      }
      if (moved) this._applyReaderVisualSelection(state, pdfWin, endpoints.anchor, endpoints.focus,
        { keys, wordAnchor: endpoints.wordAnchor });
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByWord error: ' + e);
    }
  },

  /**
   * Hint label generator: uppercase, prefix-free labels in home-row-first
   * order.  count ≤ 26 → single letters; more → uniform two-letter labels
   * (26² = 676).  With `reserved` set (fine stage), the first label is the
   * reserved one and all following labels avoid its first character, so
   * typing the reserved label is always an exact, unambiguous match.  The
   * optional excluded string removes keys owned by the surrounding mode.
   */
  _hintAlphabet() {
    return 'ASDFJKLGHQWERTYUIOPZXCVBNM';
  },

  _hintLabelList(count, reserved = null, excluded = '') {
    const alphabet = this._hintAlphabet()
      .split('')
      .filter(c => !excluded.includes(c))
      .join('');
    const labels = [];
    if (reserved !== null) {
      labels.push(reserved);
      const rest = alphabet.split('').filter(c => c !== reserved.charAt(0));
      const n = count - 1;
      if (n <= rest.length) {
        for (let i = 0; i < n; i++) labels.push(rest[i]);
      } else {
        for (let i = 0; i < n; i++) {
          labels.push(rest[Math.floor(i / alphabet.length)] + alphabet[i % alphabet.length]);
        }
      }
      return labels;
    }
    if (count <= alphabet.length) return alphabet.slice(0, count).split('');
    for (let i = 0; i < count; i++) {
      labels.push(alphabet[Math.floor(i / alphabet.length)] + alphabet[i % alphabet.length]);
    }
    return labels;
  },

  /**
   * Show Tridactyl/Vimium-style hint badges in two stages.
   *
   * Coarse stage: one badge per visible sentence start.  Picking a label
   * enters the fine stage, which shows one badge per word start inside that
   * sentence — the sentence's own start keeps its label, so pressing the
   * same label again jumps straight back to the sentence start.
   *
   * While typing, the consumed prefix dims and non-matching badges hide;
   * a full label or a uniquely matching prefix activates immediately.
   */
  _showVisualHints(state, pdfWin, targetMode = 'visual') {
    this._clearVisualHints(state, pdfWin);
    const starts = this._findSentenceStarts(pdfWin, state);
    if (!starts.length) {
      this._placeCursorAtFirstText(state, pdfWin);
      return;
    }
    // Reserve g for Visual text objects (giw, gi", gi(, ...) in coarse hints.
    const excluded = targetMode === 'visual' ? 'G'
      : targetMode === 'cursor' ? 'FT' : '';
    const labels = this._hintLabelList(starts.length, null, excluded);
    const badges = [];
    for (let i = 0; i < starts.length; i++) {
      const b = this._createHintBadge(
        pdfWin.document, labels[i], starts[i].textNode, starts[i].offset
      );
      if (b) badges.push(b);
    }
    if (!badges.length) {
      this._placeCursorAtFirstText(state, pdfWin);
      return;
    }
    this._layoutHintBadges(pdfWin.document, badges);
    state.hintMode = true;
    state.hintStage = 'coarse';
    state.hintBuffer = '';
    state.hintBadges = badges;
    state.hintStarts = starts;
    state.hintSelected = null;
    state.hintTargetMode = targetMode;
  },

  /**
   * Create one badge element for a target.  The label is split into a dim
   * prefix span (typed part) and a bold rest span (still to be typed).
   */
  _createHintBadge(doc, label, textNode, offset, targetRect = null) {
    const rect = (textNode && this._hintTextRect(doc, textNode, offset)) || targetRect;
    if (!rect) return null;

    const badge = doc.createElement('div');
    badge.setAttribute('data-zv-hint', label);
    const prefix = doc.createElement('span');
    prefix.setAttribute('data-zv-hint-part', 'prefix');
    prefix.textContent = '';
    prefix.style.color = 'var(--zv-theme-hint-border, #8f7d1c)';
    const rest = doc.createElement('span');
    rest.setAttribute('data-zv-hint-part', 'rest');
    rest.textContent = label;
    badge.appendChild(prefix);
    badge.appendChild(rest);
    badge.style.cssText =
      'position:fixed;left:0;top:0;' +
      'background:var(--zv-theme-hint, #FFD400);color:var(--zv-theme-on-hint, #000);' +
      'font:bold 10px/1.2 monospace;white-space:nowrap;' +
      'padding:1px 3px;border-radius:2px;' +
      'z-index:99999;pointer-events:none;' +
      'border:1px solid var(--zv-theme-hint-border, #b8960c);';
    doc.body.appendChild(badge);
    return {
      label,
      textNode,
      offset,
      el: badge,
      prefixEl: prefix,
      restEl: rest,
      left: rect.left,
      top: rect.top,
      height: rect.height || 12,
      width: rect.width || 1,
    };
  },

  _hintTextRect(doc, textNode, offset) {
    try {
      const range = doc.createRange();
      const start = Math.min(offset, textNode.length);
      range.setStart(textNode, start);
      range.setEnd(textNode, Math.min(start + 1, textNode.length));
      const rect = range.getBoundingClientRect?.() || range.getClientRects()[0];
      if (rect?.height > 0) return rect;
    } catch (_) {}
    return textNode?.parentElement?.getBoundingClientRect?.();
  },

  /** Anchor links above the source and text hints at the first glyph's top edge. */
  _layoutHintBadges(doc, badges, measure = true) {
    const width = doc.defaultView?.innerWidth || doc.documentElement?.clientWidth;
    const height = doc.defaultView?.innerHeight || doc.documentElement?.clientHeight;
    if (!width || !height) return;
    const targets = badges.map(badge => ({ badge,
      rect: (measure && this._hintTextRect(doc, badge.textNode, badge.offset)) || badge,
      size: badge.el.getBoundingClientRect?.(),
    }));
    const placed = [];
    for (const { badge, rect, size } of targets) {
      if (rect.left >= width || rect.left + rect.width <= 0
          || rect.top >= height || rect.top + rect.height <= 0) {
        badge.el.style.visibility = 'hidden';
        continue;
      }
      badge.badgeWidth = size?.width || badge.badgeWidth || badge.label.length * 6 + 8;
      badge.badgeHeight = size?.height || badge.badgeHeight || 16;
      const above = !badge.textNode;
      const top = above ? rect.top - badge.badgeHeight - 2 : rect.top;
      const slot = this._findHintBadgeSlot(rect.left, top, badge.badgeWidth, badge.badgeHeight,
        width, height, above ? [...placed, rect] : placed);
      badge.el.style.visibility = slot ? '' : 'hidden';
      if (!slot) continue;
      badge.el.style.left = slot.left + 'px';
      badge.el.style.top = slot.top + 'px';
      placed.push(slot);
    }
  },

  // Placement adapted from Zotero Neo. Prefer a nearby slot on the same line.
  _findHintBadgeSlot(leftAnchor, topAnchor, width, height, viewWidth, viewHeight, placed) {
    if (width > viewWidth || height > viewHeight) return null;
    const gap = 2;
    const preferredLeft = Math.max(0, Math.min(leftAnchor, viewWidth - width));
    const preferredTop = Math.max(0, Math.min(topAnchor, viewHeight - height));
    const clear = placed.every(rect => preferredLeft >= rect.left + rect.width + gap
      || preferredLeft + width + gap <= rect.left || preferredTop >= rect.top + rect.height + gap
      || preferredTop + height + gap <= rect.top);
    if (clear) return { left: preferredLeft, top: preferredTop, width, height };

    const columns = new Set([preferredLeft, 0, viewWidth - width]);
    for (const rect of placed) {
      columns.add(rect.left + rect.width + gap);
      columns.add(rect.left - width - gap);
    }
    const candidates = [...columns].filter(left => left >= 0 && left + width <= viewWidth)
      .sort((a, b) => Math.abs(a - preferredLeft) - Math.abs(b - preferredLeft));
    const obstacles = [...placed].sort((a, b) => a.top - b.top);
    let best = null, bestDistance = Infinity;
    for (const left of candidates) {
      const horizontalDistance = Math.abs(left - preferredLeft);
      if (horizontalDistance >= bestDistance) break;
      let start = 0;
      const consider = end => {
        if (end - start < height) return;
        const top = Math.max(start, Math.min(preferredTop, end - height));
        const distance = horizontalDistance + 2 * Math.abs(top - preferredTop);
        if (distance >= bestDistance) return;
        best = { left, top, width, height };
        bestDistance = distance;
      };
      for (const rect of obstacles) {
        if (left >= rect.left + rect.width + gap || left + width + gap <= rect.left) continue;
        consider(Math.min(viewHeight, rect.top - gap));
        start = Math.max(start, rect.top + rect.height + gap);
      }
      consider(viewHeight);
    }
    return best;
  },

  /**
   * Re-filter visible badges after each keystroke (Vimium-style).  Only
   * visibility and label parts change — positions are NOT recomputed, so
   * remaining badges never drift.
   */
  _refreshHintBadges(state, pdfWin) {
    const buffer = state.hintBuffer || '';
    for (const b of state.hintBadges) {
      if (!b.label.startsWith(buffer)) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = '';
      b.prefixEl.textContent = buffer;
      b.restEl.textContent = b.label.slice(buffer.length);
    }
  },

  /** Keep badges glued to the text while the user scrolls (rAF-throttled). */
  _repositionHintBadges(state, pdfWin) {
    if (!state.hintMode || !state.hintBadges?.length) return;
    if (state._hintRepositionRAF) return;
    state._hintRepositionRAF = pdfWin.requestAnimationFrame(() => {
      state._hintRepositionRAF = null;
      if (!state.hintMode || !state.hintBadges?.length) return;
      this._layoutHintBadges(pdfWin.document, state.hintBadges);
    });
  },

  /**
   * Return { textNode, offset } pairs for every sentence start visible in the
   * PDF.js text layer.  Rules:
   *   1. First non-space character after a paragraph break (y-gap > 0.5 × lineH).
   *   2. First non-space character of a span when the previous span ended with
   *      sentence-ending punctuation (.!?) optionally followed by closing quotes.
   *   3. Positions within a span after the same punctuation + whitespace.
   */
  _findSentenceStarts(pdfWin, state = null) {
    const doc = pdfWin.document;
    const container =
      doc.getElementById('viewerContainer') ||
      doc.querySelector('.pdfViewer') || doc.body;
    const viewH = container.clientHeight;

    const { items } = this._readingOrderKeys(doc, state);
    const spans = items.filter(it =>
      it.rect.top < viewH - 4 && it.rect.bottom > 4 &&
      it.rect.width > 4 && it.rect.height > 3);

    const results = [];
    let prevRect = null;
    let prevText = '';

    for (const it of spans) {
      const textNode = it.span.firstChild;
      const text     = textNode.data;
      if (!text || !text.trim()) continue;
      const rect  = it.rect;
      const lineH = Math.max(rect.height, 8);

      // Rule 1: large y-gap → paragraph break → sentence start
      const isNewBlock = !prevRect || rect.top > prevRect.bottom + lineH * 0.5;
      if (isNewBlock) {
        const off = text.search(/\S/);
        if (off >= 0) results.push({ textNode, offset: off });
      } else {
        // Rule 2: previous span ended a sentence
        if (/[.!?]['")\]]*\s*$/.test(prevText)) {
          const off = text.search(/\S/);
          if (off >= 0) results.push({ textNode, offset: off });
        }

        // Rule 3: sentence starts inside this span (any non-space after
        // sentence-ending punctuation + whitespace)
        const pat = /[.!?]['")\]]*\s+(\S)/g;
        let m;
        while ((m = pat.exec(text)) !== null) {
          const off = m.index + m[0].length - m[1].length;
          results.push({ textNode, offset: off });
        }
      }

      if (results.length >= 400) break;

      prevRect = rect;
      prevText = text;
    }

    return results;
  },

  _clearVisualHints(state, pdfWin) {
    state.hintMode = false;
    state.hintStage = null;
    state.hintBuffer = '';
    state.hintBadges = [];
    state.hintStarts = [];
    state.hintSelected = null;
    state.hintTargetMode = null;
    if (state._hintRepositionRAF && pdfWin) {
      try { pdfWin.cancelAnimationFrame(state._hintRepositionRAF); } catch (_) {}
    }
    state._hintRepositionRAF = null;
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

    const ordered = this._orderedReaderVisual(state, pdfWin);
    let focusNode = ordered?.focus.node, focusOffset = ordered?.focus.offset ?? 0;
    try {
      const sel = pdfWin.getSelection();
      if (ordered && sel?.isCollapsed && ordered.text && !state._readerFlash
          && !state._translationPopup && !state._shortcutHelp) {
        this._paintOrderedReaderVisual(pdfWin, ordered);
      } else if (!ordered && sel?.focusNode) {
        focusNode = sel.focusNode;
        focusOffset = sel.focusOffset;
      }
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
        r.setStart(focusNode, focusOffset);
        r.collapse(true);
        const caret = r.getBoundingClientRect?.();
        if (caret?.height > 0) rect = caret;
        r.setStart(focusNode, off);
        r.setEnd(focusNode, off + 1);
        const rects = r.getClientRects();
        if (!rect && rects.length) {
          rect = rects[0];
          if (focusOffset === focusNode.length) {
            rect = { left: rect.right, right: rect.right, top: rect.top,
              bottom: rect.bottom, height: rect.height };
          }
        }
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
      'background:var(--zv-theme-danger, #ff4500);' +
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
        this._scrollContainerBy(container, dx, dy);
      }
    } catch (_) {}
  },

  /**
   * Activate a fully-resolved hint badge.  In the coarse stage this opens
   * the fine (word-level) stage for the picked sentence; in the fine stage
   * it places the selection anchor (visual) or caret (cursor) at the word.
   */
  _activateHint(state, pdfWin, badge) {
    if (!badge) return;
    if (state.hintStage === 'coarse') {
      this._showFineHints(state, pdfWin, badge);
      return;
    }
    const targetMode = state.hintTargetMode;
    this._clearVisualHints(state, pdfWin);
    try {
      const sel   = pdfWin.getSelection();
      const range = pdfWin.document.createRange();
      range.setStart(badge.textNode, badge.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      state.visualCursor = { textNode: badge.textNode, offset: badge.offset };
      if (targetMode === 'visual') {
        state.visualPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.visualPreferredX);
      } else if (targetMode === 'cursor') {
        state.cursorPreferredX = this._cursorCurrentX(pdfWin.document, sel, state.cursorPreferredX);
      }
      pdfWin.focus();
      this._updateVisualCursor(state, pdfWin);
      Zotero.debug('[ZoteroVim] Hint selected: ' + badge.label);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _activateHint error: ' + e);
    }
  },

  /**
   * Fine stage: show one badge per word start inside the sentence selected
   * in the coarse stage.  The sentence's own start keeps the coarse label,
   * so pressing the same label again jumps straight back to the sentence
   * start; the remaining words get fresh labels.
   */
  _showFineHints(state, pdfWin, coarseBadge) {
    const doc = pdfWin.document;
    for (const el of doc.querySelectorAll('[data-zv-hint]')) el.remove();
    state.hintBadges = [];
    state.hintStage = 'fine';
    state.hintBuffer = '';
    state.hintSelected = coarseBadge;

    const starts = state.hintStarts || [];
    let next = null;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i].textNode === coarseBadge.textNode &&
          starts[i].offset === coarseBadge.offset) {
        next = starts[i + 1] || null;
        break;
      }
    }

    const words = this._findWordStartsInSentence(pdfWin, coarseBadge, next, state);
    if (!words.length) {
      this._clearVisualHints(state, pdfWin);
      return;
    }
    const labels = this._hintLabelList(
      words.length,
      coarseBadge.label,
      state.hintTargetMode === 'cursor' ? 'FT' : ''
    );
    const badges = [];
    for (let i = 0; i < words.length; i++) {
      const b = this._createHintBadge(doc, labels[i], words[i].textNode, words[i].offset);
      if (b) badges.push(b);
    }
    if (!badges.length) {
      this._clearVisualHints(state, pdfWin);
      return;
    }
    this._layoutHintBadges(doc, badges);
    state.hintBadges = badges;
  },

  /**
   * Word-start offsets between a sentence start and the next sentence start
   * (or the bottom of the viewport when there is none).  A word starts at
   * any non-space character that follows whitespace — the sentence start
   * itself always counts as the first word start.
   */
  _findWordStartsInSentence(pdfWin, coarseBadge, nextStart, state = null) {
    const doc = pdfWin.document;
    const keys = this._readingOrderKeys(doc, state);
    const nodes = keys.items.map(it => it.node);
    const startIdx = this._cursorNodeIndex(nodes, coarseBadge.textNode);
    if (startIdx < 0) {
      return [{ textNode: coarseBadge.textNode, offset: coarseBadge.offset }];
    }

    // Column of the sentence start, for stopping open-ended ranges at the
    // column boundary.
    const coarse = keys.byNode.get(coarseBadge.textNode);

    // Visible viewport bottom in viewport coordinates — innerHeight is the
    // only reliable measure regardless of which container scrolls.
    const container =
      doc.getElementById('viewerContainer') ||
      doc.querySelector('.pdfViewer') ||
      doc.body;
    const viewRect = container.getBoundingClientRect?.() || { top: 0 };
    const viewBottom = (viewRect.top >= 0 ? viewRect.top : 0)
      + (pdfWin.innerHeight || container.clientHeight || 800);

    let endIdx = nodes.length - 1;
    let endOffset = nodes[endIdx].length;
    if (nextStart) {
      const idx = this._cursorNodeIndex(nodes, nextStart.textNode);
      if (idx > startIdx) {
        endIdx = idx;
        endOffset = nextStart.offset;
      } else if (idx === startIdx && nextStart.offset > coarseBadge.offset) {
        endIdx = idx;
        endOffset = nextStart.offset;
      }
      // Otherwise (ordering mismatch or next before coarse) keep the open
      // end — the viewport clamp below bounds the range.
    }

    const results = [];
    let prevWasSpace = true;
    let lastSpanText = null;
    for (let i = startIdx; i <= endIdx; i++) {
      const node = nodes[i];
      const elRect = node.parentElement?.getBoundingClientRect?.();
      if (elRect && elRect.top > viewBottom + 40) break;

      // Open-ended range (no next sentence start in the viewport): stop
      // when leaving the sentence's column — unless the text genuinely
      // flows across the column break (previous span did not end with
      // sentence-ending punctuation).
      if (!nextStart && elRect) {
        const item = keys.byNode.get(node);
        if (item && coarse && (item.pageIdx !== coarse.pageIdx || item.colIdx !== coarse.colIdx
            || item.line.block !== coarse.line.block)) {
          if (!lastSpanText || /[.!?]['")\]]*\s*$/.test(lastSpanText)) break;
        }
      }

      let from = 0;
      let to = node.length;
      if (i === startIdx) from = Math.max(0, Math.min(coarseBadge.offset, node.length));
      if (i === endIdx) to = Math.max(from, Math.min(endOffset, node.length));
      for (let off = from; off < to; off++) {
        const ch = node.data.charAt(off);
        if (/\s/.test(ch)) {
          prevWasSpace = true;
          continue;
        }
        if (prevWasSpace || (i === startIdx && off === from)) {
          results.push({ textNode: node, offset: off });
          if (results.length >= 650) return results;
        }
        prevWasSpace = false;
      }
      if (to > from) lastSpanText = node.data;
    }
    return results;
  },

  _placeCursorAtFirstText(state, pdfWin) {
    try {
      const [textNode] = this._cursorOrderedTextNodes(pdfWin.document, state);
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

  /** Place a collapsed caret at the text nearest the viewport centre. */
  _placeCursorNearViewportCenter(state, pdfWin) {
    try {
      const doc = pdfWin.document;
      const container = this._getScrollContainer(pdfWin);
      const rect = container?.getBoundingClientRect?.()
        || { left: 0, right: pdfWin.innerWidth || 800, top: 0, bottom: pdfWin.innerHeight || 800 };
      const x = (rect.left + rect.right) / 2;
      const y = (rect.top + rect.bottom) / 2;
      const keys = this._readingOrderKeys(doc, state);
      let node = null;
      let offset = 0;
      try {
        const caret = doc.caretPositionFromPoint?.(x, y);
        const candidate = caret?.offsetNode;
        const owner = candidate?.nodeType === 3 ? candidate.parentElement : candidate;
        if (candidate?.nodeType === 3 && owner?.closest?.('.textLayer')
            && (!state._readerBodyText || keys.byNode.has(candidate))) {
          node = candidate;
          offset = caret.offset;
        }
      } catch (_) {}

      if (!node) {
        let best = null;
        let bestDistance = Infinity;
        for (const { node: candidate, rect: r } of keys.items) {
          const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
          const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
        node = best;
        if (node) offset = this._offsetAtX(doc, node, x) ?? 0;
      }
      if (!node) return false;
      const sel = pdfWin.getSelection();
      const range = doc.createRange();
      range.setStart(node, Math.max(0, Math.min(offset, node.length)));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      state.visualCursor = { textNode: node, offset };
      if (state.mode === 'visual') {
        state.visualPreferredX = this._cursorCurrentX(doc, sel, state.visualPreferredX);
      } else {
        state.cursorPreferredX = this._cursorCurrentX(doc, sel, state.cursorPreferredX);
      }
      this._updateVisualCursor(state, pdfWin);
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _placeCursorNearViewportCenter error: ' + e);
      return false;
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
      let endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return;
      const { node, offset } = endpoints.focus;
      const keys = this._readingOrderKeys(doc, state);
      if (!endpoints.wordAnchor) {
        endpoints = { ...endpoints,
          wordAnchor: this._readerAnchorToken(keys, endpoints.anchor, endpoints.focus) };
      }
      const target = this._lineMoveTarget(doc, node, offset, direction, state.visualPreferredX, keys);
      if (!target?.node || target.stopped) return;
      let result = { anchor: endpoints.anchor, focus: { node: target.node, offset: target.offset } };
      let distance = Infinity;
      for (const token of this._readerLineTokens(target.line.source)) {
        const choice = this._readerTokenEndpoints(endpoints, token, keys);
        const x = this._cursorCurrentX(doc, { focusNode: choice.focus.node,
          focusOffset: choice.focus.offset });
        if (!Number.isFinite(x)) continue;
        const gap = Math.abs(x - target.preferredX);
        if (gap < distance) {
          distance = gap;
          result = choice;
        }
      }
      state.visualPreferredX = target.preferredX;
      this._applyReaderVisualSelection(state, pdfWin, result.anchor, result.focus,
        { keys, wordAnchor: endpoints.wordAnchor, updatePreferredX: false });
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByLine error: ' + e);
    }
  },

  /** Extend selection left/right by one character (h/l). */
  _extendByChar(state, pdfWin, direction) {
    try {
      pdfWin.focus();
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return;
      const keys = this._readingOrderKeys(pdfWin.document, state);
      const nodes = keys.items.map(it => it.node);
      const idx = this._cursorNodeIndex(nodes, endpoints.focus.node);
      if (idx < 0) return;
      const off = Math.min(endpoints.focus.offset, nodes[idx].length);
      const pos = direction > 0 ? this._cursorAdvancePos(nodes, { idx, off })
        : this._cursorRetreatPos(nodes, { idx, off });
      this._applyReaderVisualSelection(state, pdfWin, endpoints.anchor,
        { node: nodes[pos.idx], offset: pos.off }, { keys, wordAnchor: endpoints.wordAnchor });
    } catch (e) {
      Zotero.debug('[ZoteroVim] _extendByChar error: ' + e);
    }
  },

  /** Read a paragraph around a point, stopping at page, column or full-width block boundaries. */
  _readerParagraphAt(keys, focus) {
    const items = keys.items.filter(item => item.rect.width > 4 && item.rect.height > 3);
    const index = items.findIndex(item => item.node === focus.node);
    if (index < 0) return null;
    const gap = Math.max(items[index].rect.height, 8) * 0.5;
    const boundary = (a, b) => a.pageIdx !== b.pageIdx || a.colIdx !== b.colIdx
      || a.line.block !== b.line.block || b.rect.top - a.rect.bottom > gap;
    let start = index, end = index;
    while (start > 0 && !boundary(items[start - 1], items[start])) start--;
    while (end + 1 < items.length && !boundary(items[end], items[end + 1])) end++;
    return { items, start, end };
  },

  _extendByParagraph(state, pdfWin, direction) {
    try {
      pdfWin.focus();
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return;
      const keys = this._readingOrderKeys(pdfWin.document, state);
      let paragraph = this._readerParagraphAt(keys, endpoints.focus);
      if (!paragraph) return;
      if (direction < 0 && paragraph.start > 0) {
        const node = paragraph.items[paragraph.start].node;
        if (node === endpoints.focus.node && endpoints.focus.offset <= Math.max(0, node.data.search(/\S/))) {
          paragraph = this._readerParagraphAt(keys, paragraph.items[paragraph.start - 1]);
        }
      }
      const node = paragraph.items[direction > 0 ? paragraph.end : paragraph.start].node;
      const offset = direction > 0 ? node.length : Math.max(0, node.data.search(/\S/));
      this._setVisualSelectionFromAnchor(state, pdfWin, node, offset, { keys });
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
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) return;

      // Build ordered list of non-empty text nodes from ALL .textLayer spans
      // (one .textLayer per PDF page — querySelectorAll returns them all),
      // in reading order: page, column, line, left.
      const { items } = this._readingOrderKeys(doc, state);
      const textNodes = [];
      for (const it of items) {
        const tn = it.span.firstChild;
        if (tn && tn.nodeType === 3 && tn.data?.trim()) textNodes.push(tn);
      }
      if (textNodes.length === 0) {
        Zotero.debug('[ZoteroVim] _extendBySentence: no text nodes found');
        return;
      }

      const focusNode   = endpoints.focus.node;
      const focusOffset = endpoints.focus.offset;

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

      this._setVisualSelectionFromAnchor(state, pdfWin, targetNode, targetOffset);
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
      if (!container) {
        // Non-PDF views (snapshot/EPUB): no page elements — scroll the
        // document itself to top / centre / bottom.
        const c = this._getScrollContainer(pdfWin);
        if (!c) return;
        const h  = c.scrollHeight || 0;
        const vh = c.clientHeight || 0;
        let top = 0;
        if (position === 'bottom')  top = Math.max(0, h - vh);
        else if (position === 'center') top = Math.max(0, (h - vh) / 2);
        this._scrollContainerTo(c, top, { smooth: true });
        return;
      }

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

      this._scrollContainerTo(container, Math.max(0, newTop), { smooth: true });
    } catch (e) {
      Zotero.debug('[ZoteroVim] _scrollToPagePosition error: ' + e);
    }
  },

  _getScrollContainer(pdfWin) {
    // PDF views scroll a dedicated #viewerContainer div; snapshot and EPUB
    // views scroll their iframe document itself (document.scrollingElement).
    return pdfWin.PDFViewerApplication?.pdfViewer?.container ||
           pdfWin.document.getElementById('viewerContainer') ||
           pdfWin.document.scrollingElement ||
           pdfWin.document.documentElement;
  },

  _scrollContainerBy(container, dx, dy, opts = null) {
    if (!container) return;
    if (opts?.smooth && this.isSmoothScrollEnabled()) {
      try {
        // The options dictionary is created in the chrome compartment, but the
        // container lives in the reader's content iframe: pass it cloned into
        // that window, or Xray shielding makes the content side read every
        // member as undefined and the scroll silently does nothing.
        const win = container.ownerDocument?.defaultView || container.ownerGlobal;
        if (win) {
          container.scrollBy(Components.utils.cloneInto({ left: dx, top: dy, behavior: 'smooth' }, win));
          return;
        }
      } catch (_) {}
    }
    try { container.scrollBy(dx, dy); } catch (_) {}
  },

  _scrollContainerTo(container, top, opts = null) {
    if (!container) return;
    if (opts?.smooth && this.isSmoothScrollEnabled()) {
      try {
        const win = container.ownerDocument?.defaultView || container.ownerGlobal;
        if (win && typeof container.scrollTo === 'function') {
          container.scrollTo(Components.utils.cloneInto({ top, behavior: 'smooth' }, win));
          return;
        }
      } catch (_) {}
    }
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
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (endpoints) {
        const { focus, anchor } = endpoints;
        const keys = this._readingOrderKeys(pdfWin.document, state);
        this._applyReaderVisualSelection(state, pdfWin, focus, anchor,
          { keys, wordAnchor: this._readerAnchorToken(keys, focus, anchor) });
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
  _getRangeTextRects(range, doc, onRect = null) {
    const rects = [];
    const start = range.startContainer;
    const end = range.endContainer;
    const append = (part, node) => {
      for (const rect of part.getClientRects()) {
        if (!(rect.width > 0 && rect.height > 0)) continue;
        rects.push(rect);
        onRect?.(rect, node);
      }
    };
    if (start === end && start.nodeType === 3) {
      append(range, start);
      return rects;
    }

    const walker = doc.createTreeWalker(range.commonAncestorContainer, 0x4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const from = node === start ? range.startOffset : 0;
      const to = node === end ? range.endOffset : node.length;
      if (to > from) {
        const part = doc.createRange();
        part.setStart(node, from);
        part.setEnd(node, to);
        append(part, node);
      }
      if (node === end) break;
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
   * Create a highlight or underline on the current selection.
   *
   * When Zotero's renderTextSelectionPopup has fired we have pre-computed
   * position data (params.annotation).  We use that data but create the
   * Zotero.Item directly so we can specify any color — onAddAnnotation
   * may silently ignore the color override we pass it.
   *
   * When no params are available (keyboard-built selection) we compute the
   * PDF-coordinate rects ourselves via _createAnnotationFromSelection.
   */
  _annotateSelection(state, reader, pdfWin, type, color, opts = null) {
    // Brief flash confirms the action fired (disappears when ✓/✗ arrives).
    const colorName = Object.entries(this.COLORS).find(([, v]) => v === color)?.[0] || color;
    this._showStatus(state, '▶ ' + (opts?.focusComment ? 'note' : colorName), 800);

    const params = state._orderedVisual ? null : (state.selectionParams ||
      (Date.now() - this._lastSelectionTS < 10000 ? this._lastSelectionParams : null));
    if (params?.annotation) {
      state.selectionParams     = null;
      this._lastSelectionParams = null;
      return this._createAnnotationFromParams(state, reader, pdfWin, params.annotation,
        type, color, opts);
    }
    return this._createAnnotationFromSelection(reader, state, pdfWin, type, color, opts);
  },

  /**
   * Create a Zotero annotation item using position data already computed by
   * Zotero's reader (from renderTextSelectionPopup).  We bypass onAddAnnotation
   * so we can set any color without it being overridden.
   *
   * ann — the params.annotation object: { type, color, text, sortIndex, position }
   */
  async _createAnnotationFromParams(state, reader, pdfWin, ann, type, color, opts = null) {
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
        this._enterInsertForAnnotation(state, reader, item, pdfWin);
        return;
      }
      setTimeout(() => {
        if (state._orderedVisual || (state.activePdfWin && state.activePdfWin !== pdfWin)) return;
        this._setMode(state, 'normal');
        try { pdfWin.focus(); } catch (_) {}
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
    const ordered = this._orderedReaderVisual(state, pdfWin);
    const doc = pdfWin.document;
    const text = this._normalizeReaderSelectionText(this._readerSelectedText(state, pdfWin));
    if (!text) {
      this._showStatus(state, '✗ no selection');
      return;
    }
    try {
      const pdfViewer = pdfWin.PDFViewerApplication?.pdfViewer;
      if (!pdfViewer) { this._showStatus(state, '✗ no pdfViewer'); return; }
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) { this._showStatus(state, '✗ no attachment'); return; }

      const runs = ordered?.runs || Array.from({ length: sel.rangeCount },
        (_, i) => ({ range: sel.getRangeAt(i) }));
      const groups = new Map();
      let complete = true;
      for (const { range, page } of runs) {
        const rects = this._getRangeTextRects(range, doc, (rect, node) => {
          const el = page || node.parentElement?.closest('.page[data-page-number]');
          const pageIndex = Number(el?.dataset.pageNumber) - 1;
          if (!Number.isInteger(pageIndex) || pageIndex < 0) {
            complete = false;
            return;
          }
          if (!groups.has(pageIndex)) groups.set(pageIndex, { pageIndex, el, rects: [] });
          groups.get(pageIndex).rects.push(rect);
        });
        if (!rects.length && range.toString().trim()) complete = false;
      }
      const pageGroups = [...groups.values()].sort((a, b) => a.pageIndex - b.pageIndex);
      if (!complete || !pageGroups.length) {
        this._showStatus(state, this._isZhLocale()
          ? '✗ 无法定位完整选区，仍可复制' : '✗ Cannot locate the whole selection. You can still copy it.', 2200);
        return;
      }
      if (pageGroups.length > 2 || (pageGroups.length === 2
          && pageGroups[1].pageIndex !== pageGroups[0].pageIndex + 1)) {
        this._showStatus(state, this._isZhLocale()
          ? '✗ 批注限相邻两页，仍可复制选区' : '✗ Annotations fit two adjacent pages. You can still copy.', 2200);
        return;
      }

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
            const vp = pdfPage.getViewport(Components.utils.cloneInto({ scale: 1 }, pdfWin));
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
        const canvas = pageEl.querySelector('.canvasWrapper canvas');
        const pageRect = canvas?.getBoundingClientRect() || pageEl.getBoundingClientRect();
        const originX = pageRect.left + (canvas ? 0 : (pageEl.clientLeft || 0));
        const originY = pageRect.top + (canvas ? 0 : (pageEl.clientTop || 0));
        const vp = pageView?.viewport;
        return pageRects.map(r => {
          let x1, y1, x2, y2;
          if (vp?.convertToPdfPoint) {
            [x1, y2] = vp.convertToPdfPoint(r.left - originX, r.top - originY);
            [x2, y1] = vp.convertToPdfPoint(r.right - originX, r.bottom - originY);
          } else {
            x1 = (r.left - originX) / scale;
            y1 = pdfPageH - (r.bottom - originY) / scale;
            x2 = (r.right - originX) / scale;
            y2 = pdfPageH - (r.top - originY) / scale;
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
      if (firstPdfRects.length !== firstGroup.rects.length) {
        this._showStatus(state, '✗ bad rects');
        return;
      }

      const position = { pageIndex: firstGroup.pageIndex, rects: firstPdfRects };

      if (pageGroups.length === 2) {
        const nextPdfRects = await toPdfRects(pageGroups[1]);
        if (nextPdfRects.length !== pageGroups[1].rects.length) {
          this._showStatus(state, '✗ bad rects');
          return;
        }
        position.nextPageRects = nextPdfRects;
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

      if (ordered && this._orderedReaderVisual(state, pdfWin) !== ordered) return;
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
      if (ordered && this._orderedReaderVisual(state, pdfWin) !== ordered) return;
      this._clearOrderedReaderVisual(state, pdfWin);
      this._showStatus(state, '✓ annotated', 1200);
      try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
      if (opts?.focusComment) {
        this._enterInsertForAnnotation(state, reader, annotItem, pdfWin);
        return;
      }
      setTimeout(() => {
        if (state._orderedVisual || (state.activePdfWin && state.activePdfWin !== pdfWin)) return;
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

  // ── Translate for Zotero integration ──────────────────────────────────────

  /** Count word-like segments the same way Translate for Zotero routes selections. */
  _isSingleTranslationWord(text) {
    if (typeof Intl.Segmenter === 'function') {
      let count = 0;
      for (const segment of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
        if (segment.isWordLike && ++count > 1) return false;
      }
      return count === 1;
    }
    return /^[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*$/u.test(text);
  },

  /**
   * Read the other add-on's dictionary preferences without changing them. The
   * public API accepts ordered services, so its normal translator can be a fallback.
   */
  _translationDictionaryServices(addon, text) {
    if (!this._isSingleTranslationWord(text) || !Zotero.Prefs?.get) return null;
    try {
      const prefix = addon.data?.config?.prefsPrefix || 'extensions.zotero.ZoteroPDFTranslate';
      if (Zotero.Prefs.get(prefix + '.enableDict', true) !== true) return null;
      const dictionary = Zotero.Prefs.get(prefix + '.dictSource', true);
      const translator = Zotero.Prefs.get(prefix + '.translateSource', true);
      if (typeof dictionary !== 'string' || !dictionary) return null;
      return typeof translator === 'string' && translator && translator !== dictionary
        ? [dictionary, translator] : [dictionary];
    } catch (e) {
      Zotero.debug('[ZoteroVim] _translationDictionaryServices error: ' + e);
      return null;
    }
  },

  /**
   * Translate the focused pane's DOM selection with the other plugin's public
   * API. Each popup owns its request so closing/replacing it ignores late results.
   * The service and languages remain under Translate for Zotero's control.
   */
  async _translateSelection(state, reader, pdfWin) {
    if (state._translationPopup) {
      this._closeTranslationPopup(state);
      return;
    }
    const zh = this._isZhLocale();
    let popup = null;
    try {
      const selection = pdfWin.getSelection?.();
      const text = this._readerSelectedText(state, pdfWin)
        .normalize('NFKC').replace(/\s+/g, ' ').trim();
      if (!text) {
        this._showStatus(state, zh ? '请先选中要翻译的文本' : 'Select text to translate first');
        return;
      }
      const addon = Zotero.PDFTranslate;
      const api = addon?.api;
      if (addon?.data?.alive === false || typeof api?.translate !== 'function') {
        this._showStatus(state, zh
          ? '请安装并启用支持翻译接口的 Translate for Zotero'
          : 'Install and enable Translate for Zotero with translation API support', 4000);
        return;
      }
      const dictionaryServices = this._translationDictionaryServices(addon, text);
      popup = this._createTranslationPopup(state, pdfWin, text, selection);
      if (!popup) return;
      this._setTranslationPopupDictionary(popup, !!dictionaryServices);
      // The API belongs to another add-on's sandbox, not the PDF content window.
      const target = Components.utils.getGlobalForObject(api.translate);
      const apiOptions = {
        pluginID: this.id,
        itemID: reader.itemID,
      };
      if (dictionaryServices) apiOptions.service = dictionaryServices;
      const options = Components.utils.cloneInto(apiOptions, target);
      let task = await api.translate(text, options);
      if (state._translationPopup !== popup || !popup.overlay.isConnected) return;
      // A dictionary can return an empty successful result, or a removed service
      // can fail before the API tries candidates. Avoid repeating a fallback it ran.
      if (dictionaryServices?.length > 1 && task?.service !== dictionaryServices[1]
          && (task?.status !== 'success' || !String(task.result || '').trim())) {
        this._setTranslationPopupDictionary(popup, false);
        apiOptions.service = dictionaryServices[1];
        task = await api.translate(text, Components.utils.cloneInto(apiOptions, target));
        if (state._translationPopup !== popup || !popup.overlay.isConnected) return;
      }
      const result = typeof task?.result === 'string' ? task.result : '';
      if (task?.status !== 'success' || !result.trim()) {
        popup.resultLabel.textContent = zh ? '翻译失败' : 'Translation failed';
        popup.result.textContent = result.trim() ? result : (zh
          ? '未收到译文，请检查 Translate for Zotero 的服务设置。'
          : 'No translation returned. Check the service settings in Translate for Zotero.');
        return;
      }
      const dictionary = !!dictionaryServices
        && (!task.service || task.service === dictionaryServices[0]);
      this._setTranslationPopupDictionary(popup, dictionary);
      // Some dictionaries (Bing/Haici/Collins) return pronunciation only in audio.text.
      // Keep those phonetics visible and copyable without duplicating ones in result.
      const phonetics = [];
      if (dictionary && Array.isArray(task.audio)) {
        const normalize = value => value.replace(/\s+/g, ' ').trim();
        const normalizedResult = normalize(result);
        for (const audio of task.audio) {
          const text = typeof audio?.text === 'string' ? normalize(audio.text) : '';
          if (text && !normalizedResult.includes(text) && !phonetics.includes(text)) {
            phonetics.push(text);
          }
        }
      }
      popup.phonetics.textContent = phonetics.join(' · ');
      popup.phonetics.style.display = phonetics.length ? 'block' : 'none';
      popup.translation = phonetics.length ? phonetics.join('\n') + '\n\n' + result : result;
      popup.result.textContent = result;
      popup.copyButton.disabled = false;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _translateSelection error: ' + e);
      if (popup && state._translationPopup === popup && popup.overlay.isConnected) {
        popup.resultLabel.textContent = zh ? '翻译失败' : 'Translation failed';
        popup.result.textContent = String(e?.message || e);
      } else if (!popup) {
        this._showStatus(state, zh ? '无法打开翻译浮窗' : 'Could not open translation popup');
      }
    }
  },

  /** Create a pane-local popup without clearing the selection or changing mode. */
  _createTranslationPopup(state, pdfWin, text, selection) {
    const doc = pdfWin.document;
    if (!doc.body) return null;
    const zh = this._isZhLocale();
    const h = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    const overlay = h('div');
    overlay.id = 'zv-translation-popup';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-labelledby', 'zv-translation-title');
    overlay.style.cssText =
      'position:fixed;right:20px;bottom:48px;width:min(540px,calc(100% - 40px));' +
      'max-height:calc(100vh - 64px);z-index:99998;display:flex;flex-direction:column;' +
      'color-scheme:var(--zv-theme-scheme, light dark);' +
      'background:var(--zv-theme-surface, Canvas);color:var(--zv-theme-text, CanvasText);' +
      'border:1px solid var(--zv-theme-border, GrayText);' +
      'border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.35);' +
      'font:14px/1.6 sans-serif;overflow:hidden;';

    const header = h('div');
    header.style.cssText =
      'display:flex;flex-shrink:0;align-items:center;gap:12px;padding:10px 14px;';
    const title = h('h2');
    title.id = 'zv-translation-title';
    title.style.cssText = 'flex:1;margin:0;font-size:14px;';
    title.textContent = 'Translate for Zotero';
    const closeButton = h('button');
    closeButton.type = 'button';
    closeButton.textContent = zh ? '关闭' : 'Close';
    const body = h('div');
    body.style.cssText = 'min-height:0;overflow:auto;padding:0 14px 14px;';
    const sourceLabel = h('h3');
    sourceLabel.style.cssText = 'margin:4px 0;font-size:12px;color:var(--zv-theme-muted, GrayText);';
    sourceLabel.textContent = zh ? '原文' : 'Original';
    const source = h('div');
    source.style.cssText =
      'max-height:96px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;';
    source.textContent = text;
    const phonetics = h('div');
    phonetics.style.cssText =
      'display:none;margin-top:4px;color:var(--zv-theme-muted, GrayText);overflow-wrap:anywhere;';
    const resultLabel = h('h3');
    resultLabel.style.cssText = 'margin:14px 0 4px;font-size:12px;color:var(--zv-theme-muted, GrayText);';
    resultLabel.textContent = zh ? '译文' : 'Translation';
    const result = h('div');
    result.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;';
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    result.textContent = zh ? '正在翻译…' : 'Translating…';
    const footer = h('div');
    footer.style.cssText =
      'display:flex;flex-shrink:0;align-items:center;gap:12px;padding:8px 14px;' +
      'border-top:1px solid var(--zv-theme-border, GrayText);';
    const hint = h('div');
    hint.style.cssText = 'flex:1;font-size:12px;color:var(--zv-theme-muted, GrayText);';
    hint.textContent = zh ? 'j/k 滚动 · y 复制译文 · Esc 关闭'
      : 'j/k scroll · y copy translation · Esc close';
    const copyButton = h('button');
    copyButton.type = 'button';
    copyButton.textContent = zh ? '复制译文' : 'Copy translation';
    copyButton.disabled = true;
    for (const button of [closeButton, copyButton]) {
      button.style.cssText =
        'padding:3px 9px;border:1px solid var(--zv-theme-border, GrayText);border-radius:4px;' +
        'background:var(--zv-theme-control, ButtonFace);' +
        'color:var(--zv-theme-text, ButtonText);font:inherit;cursor:pointer;';
      // Clicking a control must not collapse the PDF selection.
      button.addEventListener('mousedown', event => event.preventDefault());
    }
    header.appendChild(title);
    header.appendChild(closeButton);
    for (const element of [sourceLabel, source, phonetics, resultLabel, result]) {
      body.appendChild(element);
    }
    footer.appendChild(hint);
    footer.appendChild(copyButton);
    for (const element of [header, body, footer]) overlay.appendChild(element);

    const popup = {
      overlay, body, sourceLabel, source, phonetics, resultLabel, result,
      closeButton, copyButton, hint, pdfWin,
      translation: '',
      selection: {
        anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode, focusOffset: selection.focusOffset,
      },
      selectionParams: state.selectionParams,
      ordered: this._orderedReaderVisual(state, pdfWin),
    };
    closeButton.addEventListener('click', () => this._closeTranslationPopup(state));
    copyButton.addEventListener('click', () => this._copyTranslationResult(state));
    doc.body.appendChild(overlay);
    state._translationPopup = popup;
    state.keyBuffer = '';
    state.countBuffer = '';
    clearTimeout(state.keyTimeout);
    state.keyTimeout = null;
    this._updateIndicator(state);
    return popup;
  },

  /** Keep dictionary labels accurate when the API falls back to sentence translation. */
  _setTranslationPopupDictionary(popup, dictionary) {
    const zh = this._isZhLocale();
    popup.sourceLabel.textContent = dictionary ? (zh ? '单词' : 'Word') : (zh ? '原文' : 'Original');
    popup.source.style.fontSize = dictionary ? '22px' : '';
    popup.source.style.fontWeight = dictionary ? 'bold' : '';
    popup.resultLabel.textContent = dictionary
      ? (zh ? '词典释义' : 'Dictionary entry') : (zh ? '译文' : 'Translation');
    popup.copyButton.textContent = dictionary
      ? (zh ? '复制释义' : 'Copy entry') : (zh ? '复制译文' : 'Copy translation');
    popup.hint.textContent = dictionary
      ? (zh ? 'j/k 滚动 · y 复制释义 · Esc 关闭' : 'j/k scroll · y copy entry · Esc close')
      : (zh ? 'j/k 滚动 · y 复制译文 · Esc 关闭' : 'j/k scroll · y copy translation · Esc close');
  },

  /** Dismiss the popup; restoring anchor/focus preserves backward selections too. */
  _closeTranslationPopup(state, restoreSelection = true) {
    const popup = state._translationPopup;
    if (!popup) return;
    state._translationPopup = null;
    try { popup.overlay.remove(); } catch (_) {}
    if (!restoreSelection) return;
    try {
      const saved = popup.selection;
      if (popup.ordered && this._orderedReaderVisual(state, popup.pdfWin) === popup.ordered) {
        this._paintOrderedReaderVisual(popup.pdfWin, popup.ordered);
      } else if (!popup.ordered && saved.anchorNode?.isConnected && saved.focusNode?.isConnected) {
        popup.pdfWin.getSelection().setBaseAndExtent(
          saved.anchorNode, saved.anchorOffset, saved.focusNode, saved.focusOffset);
        state.selectionParams = popup.selectionParams;
      }
      state.activePdfWin = popup.pdfWin;
      popup.pdfWin.focus();
      this._updateVisualCursor(state, popup.pdfWin, { autoPan: false });
    } catch (_) {}
  },

  _copyTranslationResult(state) {
    const popup = state._translationPopup;
    if (!popup?.translation) return;
    try {
      const clipboard = Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper);
      clipboard.copyString(popup.translation);
      popup.copyButton.textContent = this._isZhLocale() ? '已复制' : 'Copied';
    } catch (e) {
      Zotero.debug('[ZoteroVim] _copyTranslationResult error: ' + e);
      this._showStatus(state, this._isZhLocale() ? '复制失败' : 'Copy failed');
    }
  },

  /** Own popup keys so PDF motions and Zotero shortcuts cannot alter the selection. */
  _onTranslationPopupKeyDown(event, state) {
    const popup = state._translationPopup;
    if (!popup) return;
    const key = this._keyString(event);
    event.stopImmediatePropagation();
    // Allow native activation of a focused button, and copying selected popup text.
    if ((event.target === popup.closeButton || event.target === popup.copyButton)
        && (key === 'enter' || key === ' ')) return;
    if (key === 'ctrl+c') return;
    event.preventDefault();
    if (key === 'escape') {
      this._closeTranslationPopup(state);
    } else if (key === 'y') {
      this._copyTranslationResult(state);
    } else if (key === 'tab') {
      const next = !popup.copyButton.disabled
        && (event.target === popup.closeButton
          || (event.shiftKey && event.target !== popup.copyButton))
        ? popup.copyButton : popup.closeButton;
      next.focus();
    } else if (['j', 'arrowdown', 'k', 'arrowup'].includes(key)) {
      popup.body.scrollTop += ['j', 'arrowdown'].includes(key) ? 60 : -60;
    } else if (['pagedown', 'ctrl+d', 'pageup', 'ctrl+u'].includes(key)) {
      const direction = ['pagedown', 'ctrl+d'].includes(key) ? 1 : -1;
      popup.body.scrollTop += direction * popup.body.clientHeight * 0.8;
    }
  },

  _copyOrderedReaderSelection(event, state, pdfWin) {
    if (!event.clipboardData || state._readerFlash || state._translationPopup
        || event.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const ordered = this._orderedReaderVisual(state, pdfWin);
    if (!ordered) return;
    const text = this._normalizeReaderSelectionText(ordered.text);
    if (!text) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  },

  _copySelection(state, pdfWin) {
    try {
      const text = this._normalizeReaderSelectionText(this._readerSelectedText(state, pdfWin));
      if (text) {
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

  _searchReaderText(state, reader, pdfWin, rawText, backward = false) {
    try {
      const text = String(rawText || '')
        .normalize('NFKC')
        .replace(/\n/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();
      if (!text) return false;
      const readerWin = reader._iframeWindow;
      const ir = reader._internalReader;

      // Open the find popup. Internally it focuses the input after 100 ms.
      if (typeof ir?.toggleFindPopup === 'function') {
        ir.toggleFindPopup(Components.utils.cloneInto({ open: true }, readerWin));
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
          if (backward) {
            setTimeout(() => {
              try { ir?.findPrevious?.(); } catch (_) {}
            }, 80);
          }
          Zotero.debug('[ZoteroVim] find input set: "' + text + '"');
        } catch (e2) {
          Zotero.debug('[ZoteroVim] fill find input error: ' + e2);
        }
      }, 200);

      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _searchReaderText error: ' + e);
      return false;
    }
  },

  _searchSelection(state, reader, pdfWin) {
    try {
      const text = this._readerSelectedText(state, pdfWin);
      if (!text) return;
      this._searchReaderText(state, reader, pdfWin, text);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _searchSelection error: ' + e);
    }
    this._setMode(state, 'normal');
    try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
  },

  _searchWordUnderCursor(state, reader, pdfWin, backward = false) {
    try {
      let sel = pdfWin.getSelection?.();
      if (state.mode !== 'cursor' || !sel?.focusNode) {
        if (!this._placeCursorNearViewportCenter(state, pdfWin)) return;
        sel = pdfWin.getSelection?.();
      }
      const nodes = this._cursorOrderedTextNodes(pdfWin.document, state);
      const word = this._readerWordRange(nodes, sel?.focusNode, sel?.focusOffset);
      if (!word?.text) {
        this._showStatus(state, '✗ no word under cursor', 1200);
        return;
      }
      this._searchReaderText(state, reader, pdfWin, word.text, backward);
      this._setMode(state, 'normal');
      try { pdfWin.getSelection()?.removeAllRanges(); } catch (_) {}
    } catch (e) {
      Zotero.debug('[ZoteroVim] _searchWordUnderCursor error: ' + e);
    }
  },

  // ── Search helpers ────────────────────────────────────────────────────────

  /** Attach find shortcuts and inline help to this reader's native popups. */
  _attachReaderFindShortcuts(state, fallbackWin) {
    const reader = state.reader;
    const doc = reader._iframeWindow?.document;
    if (!doc) return;

    const optionIDs = new Map([
      ['j', 'highlight-all'], ['k', 'case-sensitive'], ['l', 'entire-word'],
    ]);
    const optionsSelector = '.row.options input[type="checkbox"]';
    const hintClass = 'zv-find-option-key';
    const style = doc.createElement('style');
    style.textContent = `
      .find-popup .row.options { height: auto; }
      .find-popup .row.options .option {
        display: grid;
        grid-template-columns: auto auto;
        gap: 2px 6px;
      }
      .find-popup .${hintClass} {
        grid-column: 1 / -1;
        justify-self: center;
        font: 11px/1.4 monospace;
        opacity: .8;
        user-select: none;
      }
      .find-popup ${optionsSelector}:focus {
        outline: 2px solid var(--zv-theme-accent, var(--color-focus-search, Highlight));
        outline-offset: 2px;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);

    const showHints = (target) => {
      const popup = target?.closest?.('.find-popup');
      if (!popup) return;
      for (const [letter, id] of optionIDs) {
        const option = popup.querySelector(optionsSelector + '#' + id)?.closest('.option');
        if (!option || option.querySelector('.' + hintClass)) continue;
        const hint = doc.createElement('kbd');
        hint.className = hintClass;
        hint.textContent = 'Ctrl+' + letter;
        option.appendChild(hint);
      }
    };

    let returnTimer;
    const onFocusIn = (e) => {
      clearTimeout(returnTimer);
      showHints(e.target);
    };
    const onKeyDown = (e) => {
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      const active = doc.activeElement;
      const popup = active?.closest?.('.find-popup');
      if (!popup) return;
      const key = e.key.toLowerCase();
      if (['alt', 'control', 'meta', 'shift'].includes(key)) return;
      clearTimeout(returnTimer);
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        // Gecko can report a control character instead of the letter for Ctrl shortcuts.
        const letter = /^[a-z]$/.test(key) ? key : /^Key([JKL])$/.exec(e.code)?.[1].toLowerCase();
        const id = optionIDs.get(letter);
        const option = id && popup.querySelector(optionsSelector + '#' + id);
        if (!option) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) option.click();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey || (key !== 'enter' && key !== 'escape')) return;

      const input = popup.querySelector('input[type="text"]');
      const ir = reader._internalReader;
      const view = popup.closest('.secondary-view') ? ir?._secondaryView : ir?._primaryView;
      const pdfWin = view?._iframeWindow || this._activeReaderPdfWin(reader, fallbackWin);
      if (active === input && key === 'enter') {
        // Let Zotero finish its search before returning to document shortcuts.
        returnTimer = setTimeout(() => {
          if (doc.hasFocus() && doc.activeElement === input) pdfWin?.focus();
        }, 150);
      } else if (active.matches(optionsSelector) && !e.shiftKey) {
        const close = popup.querySelector('button.close');
        if (key === 'enter' ? !input : !close) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (key === 'enter') {
          input.focus();
        } else {
          close.click();
          pdfWin?.focus();
        }
      }
    };

    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('keydown', onKeyDown, true);
    showHints(doc.activeElement);
    return () => {
      clearTimeout(returnTimer);
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      for (const hint of doc.querySelectorAll('.find-popup .' + hintClass)) hint.remove();
      style.remove();
    };
  },

  _openSearch(reader) {
    // Primary: toggleFindPopup({open:true}) on _internalReader.
    // The {open:true} object crosses the chrome→reader.html compartment boundary
    // so it must be cloned.
    try {
      const ir = reader._internalReader;
      if (typeof ir?.toggleFindPopup === 'function') {
        ir.toggleFindPopup(Components.utils.cloneInto(
          { open: true },
          reader._iframeWindow
        ));
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

  /**
   * Whether a search is currently active in any reader view.  Mirrors the
   * guard PdfView.findNext()/findPrevious() use internally (_findState.active);
   * for non-PDF views (snapshot/EPUB) falls back to the reader app's
   * view-agnostic find state.
   */
  _isSearchActive(reader) {
    try {
      const ir = reader?._internalReader;
      const pv = ir?._primaryView?._findState?.active;
      const sv = ir?._secondaryView?._findState?.active;
      if (pv || sv) return true;
      const st = ir?._state;
      return !!(st?.primaryViewFindState?.active || st?.secondaryViewFindState?.active);
    } catch (_) { return false; }
  },

  /**
   * Whether the current reader view supports page navigation.  PDF and EPUB
   * views expose navigateToNextPage()/… on the view; snapshot views are a
   * single scrolling document and do not.
   */
  _viewHasPageNav(reader) {
    try {
      const ir = reader?._internalReader;
      const view = ir?._lastView || ir?._primaryView;
      return typeof view?.navigateToNextPage === 'function';
    } catch (_) { return true; }
  },

  _clearSearch(reader, pdfWin, state = null) {
    // Normal-mode Escape also dismisses annotation selection. Keys forwarded
    // from chrome do not reach PdfView's own Escape handler.
    if (state?.mode === 'normal') {
      state.lastAnnotationKey = null;
      state._readerAnnotationJumpWin = null;
      try {
        reader?._internalReader?.setSelectedAnnotations?.(
          Components.utils.cloneInto([], reader._iframeWindow));
      } catch (e) {
        Zotero.debug('[ZoteroVim] clear annotation selection: ' + e);
      }
    }
    // Close the find popup via the reader app (deactivates the search and
    // clears highlights, matching Zotero's own Escape semantics).  Do NOT
    // re-dispatch an Escape keydown into the PDF.js document — the plugin's
    // own capture listener would process it again (normal:escape →
    // clearSearch), causing unbounded recursion.
    try {
      const ir = reader?._internalReader;
      if (typeof ir?.toggleFindPopup === 'function') {
        ir.toggleFindPopup(Components.utils.cloneInto(
          { open: false },
          reader._iframeWindow
        ));
        Zotero.debug('[ZoteroVim] clearSearch: toggleFindPopup(false) OK');
        return;
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _clearSearch toggleFindPopup error: ' + e);
    }

    // Fallback: if the popup is not reachable, blur any focused find input.
    try {
      const outerDoc = reader?._iframeWindow?.document;
      const inp = outerDoc?.querySelector('.find-popup input');
      if (inp && outerDoc.activeElement === inp) inp.blur();
    } catch (_) {}
  },

  // ── Annotation navigation ─────────────────────────────────────────────────

  _navigateAnnotation(state, reader, direction, pdfWin) {
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
      if (state.lastAnnotationKey && (!state._readerAnnotationJumpWin
          || !pdfWin || state._readerAnnotationJumpWin === pdfWin)) {
        const lastIdx = annotations.findIndex(a => a.key === state.lastAnnotationKey);
        if (lastIdx >= 0) {
          targetIdx = (lastIdx + direction + annotations.length) % annotations.length;
        }
      }

      // First press (or unknown last annotation): find nearest from current page.
      if (targetIdx < 0) {
        const active = pdfWin || internalReader._primaryView?._iframeWindow;
        const currentPage = (active?.PDFViewerApplication?.pdfViewer?.currentPageNumber - 1) || 0;

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
      state._readerAnnotationJumpWin = pdfWin;

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

      this._navigateToAnnotationKey(state, reader, target, pdfWin);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _navigateAnnotation error: ' + e);
      this._showStatus(state, '✗ nav: ' + String(e).slice(0, 30), 4000);
    }
  },

  /**
   * Navigate to an annotation by key: smooth-scroll the PDF and select it.
   * Keep Zotero's annotation selection and navigation in the originating pane.
   *
   * _internalReader lives in a different JS compartment (reader.html iframe);
   * arrays/objects passed as arguments must be cloned into that compartment
   * with Cu.cloneInto() — otherwise the security wrapper blocks property
   * access and the calls silently fail or throw "Permission denied".
   */
  _navigateToAnnotationKey(state, reader, target, pdfWin = null) {
    try {
      const internalReader = reader._internalReader;
      if (!internalReader) return false;

      // Page/position resolution (used by the page-jump last resort).
      let posPage = parseInt((target.annotationSortIndex || '00000').split('|')[0], 10) || 0;
      try {
        const parsed = JSON.parse(target.annotationPosition || '{}');
        if (typeof parsed.pageIndex === 'number') posPage = parsed.pageIndex;
      } catch (_) {}

      const readerWin = reader._iframeWindow;
      const Cu = Components.utils;
      const pane = [internalReader._primaryView, internalReader._secondaryView]
        .find(view => view && view._iframeWindow === pdfWin);
      if (pane && internalReader._lastView !== pane) {
        internalReader.focusView?.(pane === internalReader._primaryView);
      }

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
            const active = pdfWin || internalReader._primaryView?._iframeWindow;
            const pdfApp = active?.PDFViewerApplication;
            if (pdfApp?.pdfViewer) pdfApp.pdfViewer.currentPageNumber = posPage + 1;
          } catch (_) {}
        }
      }
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _navigateToAnnotationKey error: ' + e);
      return false;
    }
  },

  // ── Marks (m / ` / dm) ──────────────────────────────────────────────────

  /**
   * Compute the current mark position: page index plus the vertical position
   * within that page (0–1).  Non-PDF views (EPUB/snapshot) fall back to a
   * whole-document scroll ratio with pageIndex null.
   */
  _markPosition(pdfWin) {
    try {
      const pdfApp = pdfWin.PDFViewerApplication;
      const container =
        pdfApp?.pdfViewer?.container || pdfWin.document.getElementById('viewerContainer');
      if (pdfApp?.pdfViewer && container) {
        const pageNum = pdfApp.pdfViewer.currentPageNumber || 1;
        const pageEl = pdfWin.document.querySelector(`.page[data-page-number="${pageNum}"]`);
        if (pageEl && pageEl.offsetHeight > 0) {
          const pageTop = pageEl.offsetTop;
          const viewH = container.clientHeight || 600;
          // Viewport-centre semantics: the marked point is whatever sits in
          // the middle of the screen, so jumping back reproduces the exact
          // view (jump centres the ratio point, _scrollToPageRatio).
          const ratio = Math.min(1, Math.max(0,
            (container.scrollTop - pageTop + viewH / 2) / pageEl.offsetHeight));
          return { pageIndex: pageNum - 1, ratio };
        }
        return { pageIndex: pageNum - 1, ratio: 0 };
      }
      const c = this._getScrollContainer(pdfWin);
      if (c && (c.scrollHeight - c.clientHeight) > 0) {
        return { pageIndex: null, ratio: c.scrollTop / (c.scrollHeight - c.clientHeight) };
      }
      return { pageIndex: null, ratio: 0 };
    } catch (e) {
      Zotero.debug('[ZoteroVim] _markPosition error: ' + e);
      return { pageIndex: null, ratio: 0 };
    }
  },

  /**
   * Set a mark at the current viewport position ("m<x>").
   * Binds to the currently selected annotation (via lastAnnotationKey) when
   * available; with persistence enabled the whole mark set is saved through
   * the storage cascade (child note → extra field → local pref).
   */
  async _setMark(state, reader, pdfWin, char) {
    try {
      const pos = this._markPosition(pdfWin);
      state.marks[char] = {
        pageIndex: pos.pageIndex,
        ratio:     pos.ratio,
        key:       state.lastAnnotationKey || null,
        ts:        Date.now(),
      };
      const persist = this.getPref('marks.persist', false);
      let persistLabel = ' (session)';
      if (persist) {
        const store = await this._saveMarks(state, reader, state.marks);
        if (store) persistLabel = ' · saved (' + store + ')';
      }
      const pageLabel = pos.pageIndex === null ? '' : '  p.' + (pos.pageIndex + 1);
      this._showStatus(state, '✓ mark ' + char + ' set' + pageLabel + persistLabel, 1200);
      Zotero.debug('[ZoteroVim] setMark ' + char + ' page=' + pos.pageIndex +
                   ' ratio=' + pos.ratio.toFixed(3) + ' key=' + (state.marks[char].key || ''));
    } catch (e) {
      Zotero.debug('[ZoteroVim] _setMark error: ' + e);
      this._showStatus(state, '✗ mark: ' + String(e).slice(0, 35), 3000);
    }
  },

  /**
   * Jump to a mark ("`<x>") — instant page flip (no animated scroll), then
   * the saved viewport-centre position is scrolled to the centre again with
   * forced instant scrolling.  The stored page/ratio is always used so the
   * jump reproduces the exact view that was marked; the annotation key (when
   * present) only feeds state.lastAnnotationKey for follow-up commands.
   */
  async _jumpMark(state, reader, pdfWin, char, location = null) {
    try {
      const mark = state.marks[char];
      if (!mark) {
        this._showStatus(state, '✗ mark ' + char + ' not set', 2000);
        return false;
      }
      let { pageIndex, ratio } = location || mark;
      let annotationOK = true;
      if (mark.key) {
        const attachment = Zotero.Items.get(reader.itemID);
        const target = attachment?.getAnnotations()?.find(a => a.key === mark.key);
        if (target) {
          state.lastAnnotationKey = mark.key;
        } else {
          annotationOK = false;
          state.lastAnnotationKey = null;
        }
        // Legacy marks migrated from the old annotation-tag scheme carry no
        // stored position — derive it from the annotation as a fallback.
        if (pageIndex === null && target && !location) {
          const pos = await this._annotationPageRatio(pdfWin, target);
          pageIndex = pos.pageIndex;
          ratio = pos.ratio;
        }
      } else state.lastAnnotationKey = null;
      if (pageIndex !== null && this._viewHasPageNav(reader)) {
        this._instantPageFlip(pdfWin, pageIndex);
        this._scrollToPageRatio(pdfWin, pageIndex, ratio, 0);
      } else {
        const c = this._getScrollContainer(pdfWin);
        if (c) {
          this._scrollContainerTo(c,
            ratio * Math.max(0, (c.scrollHeight || 0) - (c.clientHeight || 0)));
        }
      }
      this._showStatus(state,
        '→ mark ' + char + (annotationOK ? '' : ' · annotation gone'), 1200);
      this._recordReaderHistoryPoint(reader, state, pdfWin);
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _jumpMark error: ' + e);
      this._showStatus(state, '✗ mark: ' + String(e).slice(0, 35), 3000);
      return false;
    }
  },

  /** Flip to a page instantly via PDF.js (no animated navigation). */
  _instantPageFlip(pdfWin, pageIndex) {
    try {
      const pdfApp = pdfWin.PDFViewerApplication;
      if (pdfApp?.pdfViewer) pdfApp.pdfViewer.currentPageNumber = pageIndex + 1;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _instantPageFlip error: ' + e);
    }
  },

  /**
   * Resolve an annotation's page index and within-page ratio (0–1) from its
   * stored position.  The ratio falls back to 0.5 (page centre) when the
   * page height cannot be resolved.
   */
  async _annotationPageRatio(pdfWin, annotation) {
    try {
      const parsed = JSON.parse(annotation.annotationPosition || '{}');
      const pageIndex = typeof parsed.pageIndex === 'number' ? parsed.pageIndex : 0;
      let ratio = 0.5;
      const rects = Array.isArray(parsed.rects) ? parsed.rects : null;
      if (rects?.length && Array.isArray(rects[0]) && rects[0].length >= 2) {
        const pdfApp = pdfWin.PDFViewerApplication;
        if (typeof pdfApp?.pdfDocument?.getPage === 'function') {
          try {
            const page = await pdfApp.pdfDocument.getPage(pageIndex + 1);
            const viewport = page.getViewport({ scale: 1 });
            if (viewport?.height > 0) {
              // PDF coordinates are bottom-up; y2 is the rect's top edge.
              const y2 = rects[0][3] ?? rects[0][1];
              ratio = Math.min(1, Math.max(0, (viewport.height - y2) / viewport.height));
            }
          } catch (_) {}
        }
      }
      return { pageIndex, ratio };
    } catch (e) {
      Zotero.debug('[ZoteroVim] _annotationPageRatio error: ' + e);
      return { pageIndex: 0, ratio: 0.5 };
    }
  },

  /**
   * Scroll the given page's ratio point to the viewport centre.
   * Retries briefly until the page element exists (PDF.js renders pages lazily).
   */
  _scrollToPageRatio(pdfWin, pageIndex, ratio, attempt = 0, opts = null) {
    try {
      const container =
        pdfWin.PDFViewerApplication?.pdfViewer?.container ||
        pdfWin.document.getElementById('viewerContainer');
      const pageEl = pdfWin.document.querySelector(`.page[data-page-number="${pageIndex + 1}"]`);
      if (!pageEl) {
        if (attempt < 10) {
          setTimeout(() => this._scrollToPageRatio(pdfWin, pageIndex, ratio, attempt + 1, opts), 80);
        }
        return;
      }
      if (!container) return;
      const viewH = container.clientHeight || 600;
      const top = Math.max(0, pageEl.offsetTop + pageEl.offsetHeight * ratio - viewH / 2);
      this._scrollContainerTo(container, top, opts);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _scrollToPageRatio error: ' + e);
    }
  },

  /** Delete a mark ("dm<x>"). */
  async _delMark(state, reader, char) {
    try {
      const mark = state.marks[char];
      if (!mark) {
        this._showStatus(state, '✗ mark ' + char + ' not set', 2000);
        return;
      }
      delete state.marks[char];
      if (this.getPref('marks.persist', false)) {
        await this._saveMarks(state, reader, state.marks);
      }
      this._showStatus(state, '✓ mark ' + char + ' deleted', 1200);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _delMark error: ' + e);
    }
  },

  /** Delete every mark ("dM", or "x" inside the marks explorer). */
  async _clearAllMarks(state, reader) {
    try {
      state.marks = {};
      if (this.getPref('marks.persist', false)) {
        await this._saveMarks(state, reader, state.marks);
      }
      this._showStatus(state, '✓ all marks deleted', 1200);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _clearAllMarks error: ' + e);
    }
  },

  /**
   * Persist all marks, cascading through storage backends:
   *   1) a "zv-marks-<attachmentKey>: {json}" line in the parent item's
   *      Extra field (syncs via Zotero sync).  Zotero 9 attachments have no
   *      Extra field and forbid child notes under attachments, so the
   *      storage item is the attachment's parent (a regular item).
   *   2) local pref marks.data.<itemID> (device-local only)
   * Returns the backend name that succeeded, or '' if all failed (a status
   * bar message with the first backend's error is shown in that case).
   * An empty mark set removes marks from all backends.
   */
  async _saveMarks(state, reader, marks) {
    const attachment = Zotero.Items.get(reader.itemID);
    if (!attachment) return '';
    const payload = { v: 1, marks: {} };
    for (const c of Object.keys(marks)) {
      payload.marks[c] = {
        pageIndex: marks[c].pageIndex,
        ratio:     marks[c].ratio,
        key:       marks[c].key || null,
      };
    }
    const hasMarks = Object.keys(payload.marks).length > 0;
    const errors = [];

    // 1) Extra field of the parent item (synced).
    try {
      const storeItem = this._marksStoreItem(reader);
      if (!storeItem) throw new Error('no storage item');
      const attKey = attachment.key;
      if (hasMarks) {
        await this._writeMarksExtra(storeItem, attKey, payload);
        Zotero.debug('[ZoteroVim] extra after saveTx: '
          + String(this._getItemExtra(storeItem)).slice(0, 120));
      } else {
        await this._clearMarksExtra(storeItem, attKey);
      }
      this._clearMarksPref(reader);
      return 'extra';
    } catch (e) {
      errors.push(String(e.message || e).slice(0, 80));
      Zotero.debug('[ZoteroVim] _saveMarks extra backend failed: ' + e);
    }

    // 2) Local pref fallback (no sync).
    try {
      if (hasMarks) this._saveMarksPref(reader, payload);
      else this._clearMarksPref(reader);
      return 'local';
    } catch (e) {
      errors.push(String(e.message || e).slice(0, 80));
      Zotero.debug('[ZoteroVim] _saveMarks pref backend failed: ' + e);
    }

    if (state) {
      this._showStatus(state, '✗ persist failed: ' + (errors[0] || 'unknown'), 4000);
    }
    return '';
  },

  /**
   * Resolve the item whose Extra field stores the marks: the attachment's
   * parent when it exists (Zotero 9 attachments have no Extra field), else
   * the attachment itself (older Zotero builds).
   */
  _marksStoreItem(reader) {
    try {
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) return null;
      if (attachment.parentItemID) return Zotero.Items.get(attachment.parentItemID);
      return attachment;
    } catch (_) {
      return null;
    }
  },

  /**
   * Read the item's Extra field via the Item API.  Zotero 9 has no
   * `.extra` property on Zotero.Item (fields go through getField/setField),
   * so a plain `.extra = …` assignment would never reach the database —
   * use getField/setField with a `.extra` property fallback for older
   * Zotero builds.
   */
  _getItemExtra(attachment) {
    try {
      if (typeof attachment.getField === 'function') {
        return attachment.getField('extra') || '';
      }
    } catch (_) {}
    return attachment.extra || '';
  },

  _setItemExtra(attachment, value) {
    try {
      if (typeof attachment.setField === 'function') {
        attachment.setField('extra', value);
        return;
      }
    } catch (_) {}
    attachment.extra = value;
  },

  /** The Extra-field line prefix for a given attachment key. */
  _marksExtraPrefix(attKey) {
    return 'zv-marks-' + attKey + ': ';
  },

  /** Read a payload from the "zv-marks-<key>: " extra line. */
  _readMarksExtra(item, attKey) {
    try {
      const prefix = this._marksExtraPrefix(attKey);
      const line = this._getItemExtra(item).split('\n')
        .find(l => l.startsWith(prefix));
      if (!line) return null;
      return JSON.parse(line.slice(prefix.length));
    } catch (_) {
      return null;
    }
  },

  /** Replace the "zv-marks-<key>: " extra line with the payload. */
  async _writeMarksExtra(item, attKey, payload) {
    const prefix = this._marksExtraPrefix(attKey);
    const line = prefix + JSON.stringify(payload);
    const lines = this._getItemExtra(item).split('\n')
      .filter(l => l.trim() && !l.startsWith(prefix));
    lines.push(line);
    this._setItemExtra(item, lines.join('\n'));
    await item.saveTx();
  },

  /** Remove the "zv-marks-<key>: " line from the item's extra field. */
  async _clearMarksExtra(item, attKey) {
    try {
      const prefix = this._marksExtraPrefix(attKey);
      const current = this._getItemExtra(item);
      const joined = current.split('\n')
        .filter(l => l.trim() && !l.startsWith(prefix)).join('\n');
      if (joined !== current) {
        this._setItemExtra(item, joined);
        await item.saveTx();
      }
    } catch (_) {}
  },

  /** Device-local pref fallback storage. */
  _saveMarksPref(reader, payload) {
    this.setPref('marks.data.' + reader.itemID, JSON.stringify(payload));
  },

  _readMarksPref(reader) {
    try {
      const raw = this.getPref('marks.data.' + reader.itemID, '');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  },

  _clearMarksPref(reader) {
    try { this.setPref('marks.data.' + reader.itemID, ''); } catch (_) {}
  },

  /**
   * Rebuild persisted marks from the storage cascade: parent item's Extra
   * field → local pref.  Also performs a one-time migration from the old
   * annotation-tag scheme ("zv-mark:<char>"), merging any found tags in.
   * Called when a reader opens so marks survive restarts and sync.
   * Retries briefly when the reader's item is not available yet (restored
   * readers can be injected before itemID resolves).
   */
  async _loadPersistedMarks(state, reader, retry = 0) {
    try {
      if (!this.getPref('marks.persist', false)) return;
      let attachment = null;
      try { attachment = reader.itemID ? Zotero.Items.get(reader.itemID) : null; } catch (_) {}
      if (!attachment) {
        // Restored readers can be injected before the item database is ready
        // (two-phase startup) — retry instead of giving up.
        if (retry < 20) {
          setTimeout(() => this._loadPersistedMarks(state, reader, retry + 1), 500);
        }
        return;
      }
      let payload = null;
      let source = '';

      // 1) Parent item's Extra field.
      const storeItem = this._marksStoreItem(reader);
      if (storeItem) {
        payload = this._readMarksExtra(storeItem, attachment.key);
        if (payload?.marks) source = 'extra';
      }
      // 2) Local pref fallback.
      if (!payload || !payload.marks) {
        payload = this._readMarksPref(reader);
        if (payload?.marks) source = 'pref';
      }

      if (payload && payload.v === 1 && payload.marks) {
        for (const [c, mm] of Object.entries(payload.marks)) {
          state.marks[c] = {
            pageIndex: mm.pageIndex ?? null,
            ratio:     mm.ratio ?? 0,
            key:       mm.key || null,
            ts:        0,
          };
        }
      }
      // One-time migration from the old annotation-tag scheme.
      const tagRe = /^zv-mark:([a-z0-9])$/;
      let migrated = false;
      for (const a of (attachment.getAnnotations() || [])) {
        for (const t of (a.tags || [])) {
          const tm = tagRe.exec(t.tag);
          if (tm && !state.marks[tm[1]]) {
            state.marks[tm[1]] = { key: a.key, pageIndex: null, ratio: 0, ts: 0 };
            migrated = true;
          }
        }
      }
      if (migrated) await this._saveMarks(state, reader, state.marks);
      const chars = Object.keys(state.marks);
      if (chars.length) {
        Zotero.debug('[ZoteroVim] loaded persisted marks from ' + (source || '?') +
                     ': ' + chars.join(','));
      } else {
        Zotero.debug('[ZoteroVim] no persisted marks found (reader ' + reader.itemID + ')');
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] _loadPersistedMarks error: ' + e);
    }
  },

  // ── Marks explorer overlay (<space>m) ──────────────────────────────────

  /**
   * Key handling while the marks explorer overlay is open.  Every key is
   * consumed so the PDF cannot scroll underneath the overlay.  Typing a
   * mark character jumps to it directly; the command keys j/k/g/G/d/x take
   * precedence so a mark named "d" can never be deleted by accident.
   */
  _onReaderMarksExplorerKeyDown(event, reader, state, pdfWin) {
    const keyStr = this._keyString(event);
    if (!keyStr) return true;
    event.preventDefault();
    event.stopPropagation();
    if (/^[a-z0-9]$/.test(keyStr) && state.marks[keyStr]
        && !['j', 'k', 'g', 'G', 'd', 'x'].includes(keyStr)) {
      this._activateReaderMarksExplorer(state, reader, pdfWin, keyStr);
      return true;
    }
    const chars = Object.keys(state.marks).sort();
    switch (keyStr) {
      case 'j':
        if (chars.length) {
          state.marksExplorerSelected =
            Math.min(chars.length - 1, state.marksExplorerSelected + 1);
        }
        this._renderReaderMarksExplorer(state);
        return true;
      case 'k':
        state.marksExplorerSelected = Math.max(0, state.marksExplorerSelected - 1);
        this._renderReaderMarksExplorer(state);
        return true;
      case 'gg':
        state.marksExplorerSelected = 0;
        this._renderReaderMarksExplorer(state);
        return true;
      case 'G':
        state.marksExplorerSelected = Math.max(0, chars.length - 1);
        this._renderReaderMarksExplorer(state);
        return true;
      case 'enter':
      case 'return':
        this._activateReaderMarksExplorer(state, reader, pdfWin);
        return true;
      case 'd':
        this._deleteReaderMarksExplorerSelected(state, reader);
        return true;
      case 'x':
        this._clearAllMarks(state, reader);
        state.marksExplorerSelected = 0;
        this._renderReaderMarksExplorer(state);
        return true;
      case 'escape':
        this._closeReaderMarksExplorer(state, pdfWin);
        return true;
      default:
        return true;
    }
  },

  async _activateReaderMarksExplorer(state, reader, pdfWin, char = null) {
    if (!char) {
      const chars = Object.keys(state.marks).sort();
      char = chars[state.marksExplorerSelected];
    }
    if (!char) return;
    this._closeReaderMarksExplorer(state, pdfWin);
    await this._jumpMark(state, reader, pdfWin, char);
  },

  _deleteReaderMarksExplorerSelected(state, reader) {
    const chars = Object.keys(state.marks).sort();
    const char = chars[state.marksExplorerSelected];
    if (!char) return;
    delete state.marks[char];
    if (this.getPref('marks.persist', false)) this._saveMarks(state, reader, state.marks);
    state.marksExplorerSelected =
      Math.min(state.marksExplorerSelected, Math.max(0, Object.keys(state.marks).length - 1));
    this._showStatus(state, '✓ mark ' + char + ' deleted', 1200);
    this._renderReaderMarksExplorer(state);
  },

  async _toggleReaderMarksExplorer(state, reader, pdfWin) {
    if (state.marksExplorerOpen) {
      this._closeReaderMarksExplorer(state, pdfWin);
      return;
    }
    if (state.outlineExplorerOpen) this._closeReaderOutlineExplorer(state, pdfWin);
    state.marksExplorerOpen = true;
    state.marksExplorerSelected = 0;
    this._createReaderMarksExplorer(state, pdfWin);
    this._renderReaderMarksExplorer(state);
    try { state._marksExplorerOverlay?.focus?.(); } catch (_) {}
  },

  _closeReaderMarksExplorer(state, pdfWin = null) {
    state.marksExplorerOpen = false;
    try {
      const overlay = state._marksExplorerOverlay;
      if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
    } catch (_) {}
    state._marksExplorerOverlay = null;
    state._marksExplorerList = null;
    state._marksExplorerStatus = null;
    if (pdfWin) {
      setTimeout(() => { try { pdfWin.focus(); } catch (_) {} }, 30);
    }
  },

  _createReaderMarksExplorer(state, pdfWin) {
    const doc = pdfWin.document;
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);
    const root = doc.body || doc.documentElement;

    const overlay = h('div');
    overlay.id = 'zv-marks-explorer';
    overlay.tabIndex = -1;
    overlay.style.cssText =
      'position:fixed;top:0;left:0;bottom:0;width:320px;z-index:99998;' +
      'background:var(--zv-theme-recessed, rgba(24,24,37,0.96));color:var(--zv-theme-text, #cdd6f4);border-right:1px solid var(--zv-theme-control, #313244);' +
      'display:flex;flex-direction:column;box-shadow:12px 0 40px rgba(0,0,0,0.35);' +
      'font:13px/1.35 monospace;';

    const header = h('div');
    header.style.cssText =
      'padding:12px 14px;border-bottom:1px solid var(--zv-theme-control, #313244);font-weight:bold;letter-spacing:0.04em;';
    header.textContent = 'Marks';

    const list = h('div');
    list.style.cssText = 'flex:1;overflow:auto;padding:8px 0;';

    const status = h('div');
    status.style.cssText =
      'padding:6px 12px;border-top:1px solid var(--zv-theme-control, #313244);color:var(--zv-theme-muted, #6c7086);font-size:11px;';
    status.textContent =
      'type a mark char to jump  ·  j/k move  ·  Enter jump  ·  d delete  ·  x delete all  ·  Esc close';

    overlay.appendChild(header);
    overlay.appendChild(list);
    overlay.appendChild(status);
    root.appendChild(overlay);

    state._marksExplorerOverlay = overlay;
    state._marksExplorerList = list;
    state._marksExplorerStatus = status;
  },

  /** Re-render the marks list.  Returns the number of rows. */
  _renderReaderMarksExplorer(state) {
    const list = state._marksExplorerList;
    if (!list) return 0;
    list.textContent = '';
    const H = 'http://www.w3.org/1999/xhtml';
    const doc = list.ownerDocument;
    const chars = Object.keys(state.marks).sort();
    if (chars.length === 0) {
      const empty = doc.createElementNS(H, 'div');
      empty.style.cssText = 'padding:10px 14px;color:var(--zv-theme-muted, #6c7086);';
      empty.textContent = 'No marks — press m<x> in Normal mode to set one';
      list.appendChild(empty);
      return 0;
    }
    chars.forEach((char, idx) => {
      const mark = state.marks[char];
      const row = doc.createElementNS(H, 'div');
      row.style.cssText = 'padding:6px 14px;cursor:pointer;white-space:nowrap;';
      if (idx === state.marksExplorerSelected) {
        row.style.background = 'var(--zv-theme-accent-tint, rgba(138,173,244,0.22))';
        row.style.color = 'var(--zv-theme-success, #a6d189)';
      }
      const pageLabel = mark.pageIndex !== null ? 'p.' + (mark.pageIndex + 1) : '—';
      const pct = mark.pageIndex !== null ? '  ' + Math.round((mark.ratio || 0) * 100) + '%' : '';
      const ann = mark.key ? '  ⚑ ann' : '';
      row.textContent = char + '   ' + pageLabel + pct + ann;
      list.appendChild(row);
    });
    return chars.length;
  },

  /**
   * Focus the comment field of the currently-selected annotation.
   * Called when `i` is pressed in normal mode with an annotation selected.
   * Opens the plugin's own comment overlay (see _enterAnnotationInsertMode).
   */
  _focusAnnotationComment(state, reader, opts = null) {
    if (state.mode !== 'insert') this._setMode(state, 'insert');
    return this._enterAnnotationInsertMode(state, reader, opts);
  },

  /**
   * Resolve the annotation key to edit: plugin bookkeeping first, then
   * Zotero's own selection.  The plugin's lastAnnotationKey is cleared by
   * scroll actions; Zotero's selection is not.
   */
  _selectedAnnotationKey(state, reader) {
    if (state.lastAnnotationKey) return state.lastAnnotationKey;
    try {
      const ids = reader?._internalReader?._state?.selectedAnnotationIDs;
      return (ids && ids.length) ? ids[0] : null;
    } catch (_) {}
    return null;
  },

  // ?? Annotation comment overlay (keyboard-only editing) ????????????????????

  /**
   * Create the plugin's own annotation-comment input overlay inside the PDF
   * iframe document ? the only document that receives the OS keyboard focus,
   * so a visible textarea there takes keystrokes and IME composition natively
   * (no focus wars, no forwarding).  Zotero's popup is not used at all.
   */
  _createAnnotationCommentOverlay(state, pdfWin, key, commentText, quotedText) {
    const doc = pdfWin?.document;
    if (!doc?.body) return null;
    const H = 'http://www.w3.org/1999/xhtml';
    const h = (tag) => doc.createElementNS(H, tag);

    const overlay = h('div');
    overlay.id = 'zv-annotation-comment';
    overlay.style.cssText =
      'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);' +
      'width:min(560px,92%);z-index:99998;background:var(--zv-theme-recessed, rgba(24,24,37,0.97));' +
      'color:var(--zv-theme-text, #cdd6f4);border:1px solid var(--zv-theme-control, #313244);border-radius:8px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.45);display:flex;flex-direction:column;' +
      'font:13px/1.4 sans-serif;';

    if (quotedText) {
      const quote = h('div');
      quote.style.cssText =
        'padding:8px 12px;color:var(--zv-theme-muted, #6c7086);font-size:12px;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis;';
      quote.textContent = quotedText;
      overlay.appendChild(quote);
    }

    const ta = h('textarea');
    ta.id = 'zv-annotation-comment-input';
    ta.value = commentText || '';
    ta.style.cssText =
      'width:100%;box-sizing:border-box;min-height:72px;max-height:220px;' +
      'padding:10px 12px;background:transparent;color:var(--zv-theme-text, #cdd6f4);border:0;' +
      'outline:none;resize:none;font:13px/1.5 sans-serif;';
    ta.setAttribute('spellcheck', 'false');
    overlay.appendChild(ta);

    const hint = h('div');
    hint.style.cssText =
      'padding:5px 12px;border-top:1px solid var(--zv-theme-control, #313244);color:var(--zv-theme-muted, #6c7086);font-size:11px;';
    const zh = this._isZhLocale();
    hint.textContent = zh ? 'Enter 换行 · Esc 保存并关闭' : 'Enter newline · Esc save & close';
    overlay.appendChild(hint);

    doc.body.appendChild(overlay);

    // Track IME composition state so the watchdog never interrupts it.
    ta.addEventListener('compositionstart', () => {
      state._composing = true;
      state._composingSince = Date.now();
    });
    ta.addEventListener('compositionend', () => {
      state._composing = false;
      state._composingSince = 0;
    });
    // Debounced autosave after every keystroke (2 s).
    ta.addEventListener('input', () => this._scheduleAnnotationCommentAutosave(state));

    state._commentOverlay = overlay;
    state._commentOverlayInput = ta;
    return overlay;
  },

  /**
   * Resolve the annotation item for a key via the attachment's child-item
   * list.  Zotero.Items.get() only accepts numeric IDs — a bare key returns
   * false — so the previous direct lookup silently broke comment prefill and
   * saving.  Loads the 'annotation' data type on demand so annotationComment
   * and annotationText are readable.
   */
  async _resolveAnnotationItem(reader, key) {
    try {
      const attachment = Zotero.Items.get(reader.itemID);
      if (!attachment) return null;
      let item = null;
      try { item = attachment.getAnnotations().find(a => a.key === key) || null; } catch (_) {}
      if (!item) {
        // Fallback: a freshly created annotation may not be in the
        // attachment's child list yet, but is registered by library+key.
        try { item = Zotero.Items.getByLibraryAndKey(attachment.libraryID, key) || null; } catch (_) {}
      }
      if (item && item.loadDataType) {
        try { await item.loadDataType('annotation'); } catch (_) {}
      }
      return item;
    } catch (_) {}
    return null;
  },

  /**
   * Resolve the annotation item for saving, using the numeric item ID stashed
   * at insert-session start (works with the synchronous cache); falls back to
   * an async library+key lookup for robustness.
   */
  async _getAnnotationItemForSave(state) {
    let item = null;
    try {
      if (state._commentItemID) item = Zotero.Items.get(state._commentItemID) || null;
      if (!item && state._commentLibraryID && state.lastAnnotationKey) {
        try {
          item = Zotero.Items.getByLibraryAndKey(state._commentLibraryID, state.lastAnnotationKey);
        } catch (_) {}
      }
      if (!item && state._commentLibraryID && state.lastAnnotationKey
          && Zotero.Items.getByLibraryAndKeyAsync) {
        try {
          item = await Zotero.Items.getByLibraryAndKeyAsync(
            state._commentLibraryID, state.lastAnnotationKey);
        } catch (_) {}
      }
      if (item && item.loadDataType) {
        try { await item.loadDataType('annotation'); } catch (_) {}
      }
    } catch (_) {}
    return item;
  },

  /**
   * Persist the overlay's text as the official annotation comment and remove
   * the overlay.  The overlay is removed first for a snappy response; the
   * saveTx completes in the background.  Resolves true when the text is
   * safely stored (or already up to date), false when no annotation item
   * could be resolved or the save failed.
   */
  async _saveAndCloseAnnotationCommentOverlay(state) {
    const ta = state._commentOverlayInput;
    const key = state.lastAnnotationKey;
    let text = null;
    try { text = ta ? ta.value : null; } catch (_) {}
    try {
      const overlay = state._commentOverlay;
      if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
    } catch (_) {}
    state._commentOverlay = null;
    state._commentOverlayInput = null;
    clearTimeout(state._commentAutosaveTimer);
    state._commentAutosaveTimer = null;
    this._disarmAnnotationPopupGuard(state);
    try {
      if (key && text !== null) {
        const item = await this._getAnnotationItemForSave(state);
        if (!item) {
          try { zvLogFile('[ZoteroVim] comment save FAILED: annotation not resolved key=' + key); } catch (_) {}
          return false;
        }
        if (!item.deleted && (item.annotationComment || '') !== text) {
          item.annotationComment = text;
          await item.saveTx();
          try { zvLogFile('[ZoteroVim] comment saved key=' + key + ' len=' + text.length); } catch (_) {}
        }
      }
      return true;
    } catch (e) {
      Zotero.debug('[ZoteroVim] save annotation comment error: ' + e);
      try { zvLogFile('[ZoteroVim] comment save error: ' + e); } catch (_) {}
      return false;
    }
  },

  /**
   * Debounced autosave (2 s after the last keystroke) so an unexpected
   * window switch never loses the typed comment.
   */
  _scheduleAnnotationCommentAutosave(state) {
    clearTimeout(state._commentAutosaveTimer);
    state._commentAutosaveTimer = setTimeout(async () => {
      try {
        const ta = state._commentOverlayInput;
        const key = state.lastAnnotationKey;
        if (!ta || !key) return;
        const item = await this._getAnnotationItemForSave(state);
        if (!item || item.deleted) return;
        if ((item.annotationComment || '') !== ta.value) {
          item.annotationComment = ta.value;
          await item.saveTx();
        }
      } catch (_) {}
    }, 2000);
  },

  /**
   * Watch for Zotero's own annotation popup appearing while the plugin's
   * comment overlay is open (e.g. an Enter forwarded to the KeyboardManager
   * opens the popup) and close it by dispatching Escape at its editor, so it
   * never steals focus or sits next to the overlay.
   */
  _armAnnotationPopupGuard(state, reader) {
    this._disarmAnnotationPopupGuard(state);
    const outerWin = reader?._iframeWindow;
    const outerDoc = outerWin?.document;
    if (!outerDoc?.body || typeof outerWin?.MutationObserver !== 'function') return;
    const guard = new outerWin.MutationObserver((muts) => {
      try {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            const popup = node.classList?.contains('annotation-popup')
              ? node : node.querySelector?.('.annotation-popup');
            if (!popup) continue;
            try { zvLogFile('[ZoteroVim] insert: stray annotation popup appeared — closing'); } catch (_) {}
            const ed = popup.querySelector?.('[contenteditable="true"], textarea, input');
            if (ed) {
              ed.dispatchEvent(new outerWin.KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
              }));
            }
          }
        }
      } catch (_) {}
    });
    try { guard.observe(outerDoc.body, { childList: true, subtree: true }); } catch (_) {}
    state._annotationPopupGuard = guard;
  },

  _disarmAnnotationPopupGuard(state) {
    try { state._annotationPopupGuard?.disconnect(); } catch (_) {}
    state._annotationPopupGuard = null;
  },

  /**
   * Restore Zotero's _enableAnnotationDeletionFromComment to the value it had
   * before an insert session disabled it (so native comment editors keep
   * their original Backspace behavior after we hand over).
   */
  _restoreAnnotationDeletionFlag(state, reader) {
    try {
      const ir = reader?._internalReader;
      if (ir && state._prevAnnotationDeletionFromComment !== undefined) {
        ir._enableAnnotationDeletionFromComment = state._prevAnnotationDeletionFromComment;
      }
    } catch (_) {}
  },

  /**
   * Keyboard-only annotation comment editing via the plugin's own overlay
   * input rendered inside the PDF iframe document.
   *
   * Flow:
   *   1. Resolve the annotation key (plugin bookkeeping ? Zotero selection).
   *   2. Navigate to the annotation (selection box, no Zotero popup).
   *   3. Show the overlay with the existing comment (plus the annotation's
   *      quoted text) and focus its textarea ? the textarea receives
   *      keystrokes and IME composition natively.
   *   4. A gentle watchdog keeps the textarea focused (never while an IME
   *      composition is active).  Escape saves via saveTx, closes the
   *      overlay and returns to normal mode; a 2 s autosave is a safety net.
   */
  async _enterAnnotationInsertMode(state, reader, opts = null) {
    const ir = reader._internalReader;
    const readerWin = reader._iframeWindow;
    const Cu = Components.utils;

    const key = opts?.item?.key || this._selectedAnnotationKey(state, reader);
    if (!key) {
      this._showStatus(state, '✗ navigate first with [a / ]a', 2000);
      return;
    }
    state.lastAnnotationKey = key;

    // Claim a fresh insert session before the first await. If the user
    // presses Escape while the annotation item is being resolved, _setMode()
    // invalidates this session and the rest of the function must not open
    // the comment overlay.
    const mySession = (state._insertSessionID = (state._insertSessionID || 0) + 1);

    // Resolve the annotation item via the attachment's child list — a bare
    // key passed to Zotero.Items.get() returns false (IDs only), which left
    // the overlay permanently empty.
    const item = opts?.item || await this._resolveAnnotationItem(reader, key);
    if (state._insertSessionID !== mySession || state.mode !== 'insert') return;

    state._commentItemID = item?.id || null;
    state._commentLibraryID = item?.libraryID || null;
    if (!item) {
      Zotero.debug('[ZoteroVim] annotation item not resolved key=' + key);
    }
    let commentText = '';
    let quotedText = '';
    if (item) {
      try {
        commentText = item.annotationComment || '';
        quotedText = (item.annotationText || '')
          .normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 200);
      } catch (_) {}
    }

    // Navigate: selects the annotation (selection box) and does NOT open
    // Zotero's popup.
    try {
      if (typeof ir?.navigate === 'function' && readerWin) {
        ir.navigate(Cu.cloneInto({ annotationID: key }, readerWin));
      }
    } catch (_) {}

    // Guard against Zotero's Backspace-deletes-annotation behavior while
    // forwarded keys still reach its KeyboardManager.  Stash the previous
    // value so it can be restored when the session ends (Esc, handover to a
    // native editor, or reader cleanup).
    try {
      state._prevAnnotationDeletionFromComment = ir._enableAnnotationDeletionFromComment;
      ir._enableAnnotationDeletionFromComment = false;
    } catch (_) {}

    const pdfWin = opts?.pdfWin || this._activeReaderPdfWin?.(reader)
      || state.activePdfWin || state.pdfWin;
    this._createAnnotationCommentOverlay(state, pdfWin, key, commentText, quotedText);
    const ta = state._commentOverlayInput;
    this._armAnnotationPopupGuard(state, reader);

    const initialDelayMs = Math.max(0, Number(opts?.initialDelayMs ?? 60));
    const holdMs = Math.max(100, Number(opts?.holdMs || 500));

    const tryKeep = (attempt) => {
      if (state.mode !== 'insert' || state._insertSessionID !== mySession) {
        state.insertWatchdog = null;
        return;
      }
      // If the user has focused a Zotero-native editor (annotation popup or
      // sidebar comment field), hand over instead of fighting for focus.
      if (this._nativeEditableFocused(reader)) {
        this._handOverAnnotationInsert(state, reader);
        state.insertWatchdog = null;
        return;
      }
      // Gentle keepalive: refocus the textarea only when it lost focus and
      // no IME composition is in progress.  Never touch style or value.
      const doc = pdfWin?.document;
      const input = state._commentOverlayInput;
      if (input?.isConnected && !state._composing && doc?.activeElement !== input) {
        try { input.focus(); } catch (_) {}
      }
      state.insertWatchdog = setTimeout(() => tryKeep(attempt + 1), holdMs);
    };

    state.insertWatchdog = null;
    const focusEditor = () => {
      // The overlay may have been closed (Esc) or handed over while this
      // focus timeout was pending. Never resurrect the insert session then.
      if (state._insertSessionID !== mySession || !ta?.isConnected) return;
      try { ta.focus(); } catch (_) {}
      try {
        const len = ta.value.length || 0;
        ta.selectionStart = len;
        ta.selectionEnd = len;
      } catch (_) {}
      const zh = this._isZhLocale();
      this._showStatus(state, zh ? '-- INSERT --  Esc 保存' : '-- INSERT --  Esc save', 2000);
      tryKeep(0);
    };
    if (initialDelayMs > 0) setTimeout(focusEditor, initialDelayMs);
    else focusEditor();
  },
  /** Start editing a freshly saved annotation in the PDF pane that created it. */
  async _enterInsertForAnnotation(state, reader, item, pdfWin) {
    try {
      if (state.mode !== 'insert') this._setMode(state, 'insert');
      await this._enterAnnotationInsertMode(state, reader, { item, pdfWin, initialDelayMs: 0 });
    } catch (e) {
      Zotero.debug('[ZoteroVim] _enterInsertForAnnotation error: ' + e);
    }
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
   * Delete the annotation currently selected with [a / ]a.
   * Clears the reader selection first, then calls eraseTx() on the item.
   */
  async _deleteAnnotation(state, reader) {
    const key = state.lastAnnotationKey;
    if (!key) {
      this._showStatus(state, '✗ navigate first with [a / ]a', 2000);
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

  /** Resolve one selected annotation, using the jump key on older readers. */
  _selectedAnnotation(state, reader) {
    if (!reader?.itemID) return null;
    try {
      const ids = reader._internalReader?._state?.selectedAnnotationIDs;
      const key = Array.isArray(ids) ? (ids.length === 1 ? ids[0] : null)
        : state.lastAnnotationKey;
      if (!key) return null;
      const attachment = Zotero.Items.get(reader.itemID);
      return attachment?.getAnnotations().find(item => item.key === key && !item.deleted) || null;
    } catch (e) {
      Zotero.debug('[ZoteroVim] _selectedAnnotation: ' + e);
      return null;
    }
  },

  /** Resolve the selected annotation only if its style can be edited. */
  _annotationStyleTarget(state, reader) {
    if (reader?._internalReader?._state?.readOnly) return null;
    const target = this._selectedAnnotation(state, reader);
    return target && !target.annotationIsExternal && target.isEditable?.() !== false ? target : null;
  },

  _canConvertAnnotation(item) {
    return item.annotationType === 'highlight' || item.annotationType === 'underline';
  },

  /** Apply style to the same Zotero item so links, tags and comments keep their identity. */
  async _styleAnnotation(state, reader, target, color, type) {
    try {
      let typeChanged = false;
      await Zotero.DB.executeTransaction(async () => {
        if (target.deleted || target.isEditable?.() === false) {
          throw new Error(this._isZhLocale() ? '标注已不可编辑' : 'Annotation is no longer editable');
        }
        if (type && this._canConvertAnnotation(target)) {
          typeChanged = target.annotationType !== type;
          target.annotationType = type;
        }
        target.annotationColor = color;
        await target.save();
      });

      if (typeChanged) await this._refreshAnnotationType(reader, target);

      const colorName = color === '#000000' ? (this._isZhLocale() ? '黑色' : 'black')
        : Object.entries(this.COLORS).find(([, value]) => value === color)?.[0];
      this._showStatus(state, '✓ → ' + colorName, 1200);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _styleAnnotation error: ' + e);
      this._showStatus(state, '✗ ' + (e.message || String(e)).slice(0, 45), 3000);
    }
  },

  /**
   * Repaint a saved type change in every open view of this attachment.
   * Zotero's view diff omits annotation type, so same-colour conversions can
   * leave the PDF painted with the old style until another event redraws it.
   */
  async _refreshAnnotationType(reader, target) {
    const readers = new Set([reader]);
    for (const state of this._readerState.values()) {
      if (state.reader?.itemID === reader.itemID) readers.add(state.reader);
    }
    for (const owner of readers) {
      try {
        if (!owner._internalReader) continue;
        // Publish the saved item before repainting. Notifier delivery alone may
        // still be converting it to reader JSON when the transaction resolves.
        await owner.setAnnotations([target]);
        const position = JSON.parse(target.annotationPosition);
        if (!Number.isInteger(position.pageIndex) || position.pageIndex < 0) continue;
        const pageIndexes = [position.pageIndex];
        if (position.nextPageRects?.length) pageIndexes.push(position.pageIndex + 1);
        const internal = owner._internalReader;
        const views = new Set([internal?._primaryView, internal?._secondaryView,
          internal?._getActiveView?.(true), internal?._getActiveView?.(false)]);
        const pages = Components.utils.cloneInto(pageIndexes, owner._iframeWindow);
        for (const view of views) {
          if (!view?._iframeWindow) continue;
          try {
            if (typeof view._render === 'function') view._render(pages);
            else view._renderAnnotations?.();
            view._pdfThumbnails?.render(pages, true);
          } catch (e) {
            Zotero.debug('[ZoteroVim] repaint annotation type: ' + e);
          }
        }
      } catch (e) {
        Zotero.debug('[ZoteroVim] refresh annotation type: ' + e);
      }
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
      reader._internalReader?.setFilter?.(filter);
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

  /** Copy the selected markup text or the body of a note or text annotation. */
  _yankAnnotation(state, reader) {
    this._copyAnnotationText(state, reader, false);
  },

  _yankAnnotationComment(state, reader) {
    this._copyAnnotationText(state, reader, true);
  },

  /** Preserve note bodies as typed and use the existing normalization for excerpts. */
  _copyAnnotationText(state, reader, commentOnly) {
    const zh = this._isZhLocale();
    const target = this._selectedAnnotation(state, reader);
    if (!target) {
      this._showStatus(state, zh ? '✗ 请先选中一个标注' : '✗ Select an annotation first', 2000);
      return;
    }
    try {
      const body = target.annotationType === 'note' || target.annotationType === 'text';
      const source = commentOnly || body ? target.annotationComment : target.annotationText;
      const text = !commentOnly && body ? source || ''
        : (source || '').normalize('NFKC').replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim();
      if (!text.trim()) {
        this._showStatus(state, zh ? '✗ 标注没有可复制的内容' : '✗ Annotation has no text to copy', 2000);
        return;
      }
      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper).copyString(text);
      this._showStatus(state, zh ? '✓ 已复制 ' + text.length + ' 个字符'
        : '✓ copied ' + text.length + ' chars', 1500);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _yankAnnotation error: ' + e);
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
      const endpoints = this._readerVisualEndpoints(state, pdfWin);
      if (!endpoints) { this._showStatus(state, '✗ no selection', 2000); return; }
      const keys = this._readingOrderKeys(doc, state);
      const paragraph = this._readerParagraphAt(keys, endpoints.focus);
      if (!paragraph) { this._showStatus(state, '✗ no text', 2000); return; }
      const { items, start, end } = paragraph;
      const first = items[start].node, last = items[end].node;
      const selected = this._readerVisualRuns(doc, { node: first, offset: 0 },
        { node: last, offset: last.length }, keys);
      const text = this._normalizeReaderSelectionText(selected?.text || '');

      if (!text) { this._showStatus(state, '✗ no text', 2000); return; }

      Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper).copyString(text);
      this._showStatus(state, '✓ copied paragraph (' + text.length + ' chars)', 1500);
      Zotero.debug('[ZoteroVim] yankParagraph spans=' + (end - start + 1) +
                   ' len=' + text.length);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _yankParagraph error: ' + e);
      this._showStatus(state, '✗ ' + String(e).slice(0, 35), 3000);
    }
  },

});

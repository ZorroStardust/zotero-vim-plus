/* global Zotero, Components, ZoteroVim */
/* eslint-disable no-unused-vars */

/** Visible PDF link hints, based on Zotero Neo's Reader Normal f action. */
Object.assign(ZoteroVim, {
  _readerLinkHintsCurrent(state, ui) {
    try {
      const ir = ui.reader._internalReader;
      return state._readerLinkHints === ui && state.mode === 'normal'
        && !ui.pdfWin.closed && !ui.win?.closed && ui.pdfWin.document === ui.doc
        && ui.pdfWin.PDFViewerApplication?.pdfDocument === ui.pdfDoc
        && [ir?._primaryView, ir?._secondaryView].includes(ui.view)
        && ui.view._iframeWindow === ui.pdfWin && ui.tabID === ui.win?.Zotero_Tabs?.selectedID;
    } catch (_) { return false; }
  },

  _readerLinkPosition(position, pages) {
    const index = position?.pageIndex;
    if (!Number.isInteger(index) || index < 0 || index >= pages || !Array.isArray(position.rects)) {
      return null;
    }
    // Copy into this compartment before using callbacks on the coordinates.
    const rects = [];
    for (const rect of position.rects) {
      if (!Array.isArray(rect) || rect.length !== 4) continue;
      const values = Array.from(rect);
      if (values.every(Number.isFinite)) rects.push(values);
    }
    return rects.length ? { pageIndex: index, rects } : null;
  },

  _readerLinkURL(value) {
    // Match PDF.js's supported external protocols and retain the exact destination.
    return typeof value === 'string' && /^(?:https?|ftp|mailto|tel):/i.test(value) ? value : null;
  },

  /** Resolve the first visible part of a link in this pane's current viewport. */
  _readerLinkRect(ui, source, visible = this._flashViewport(ui.pdfWin)) {
    const page = ui.viewer.getPageView?.(source.pageIndex);
    if (!page?.viewport || !page.div?.isConnected) return null;
    const bounds = page.div.getBoundingClientRect();
    const x = bounds.left + (page.div.clientLeft || 0);
    const y = bounds.top + (page.div.clientTop || 0);
    for (const rect of source.rects) {
      const [left, top, right, bottom] = this._readerJumpViewportRect(page.viewport, rect);
      const client = { left: x + left, top: y + top, right: x + right, bottom: y + bottom,
        width: right - left, height: bottom - top };
      if (this._flashRectVisible(client, visible)) {
        return { ...client, left: Math.max(client.left, visible.left),
          top: Math.max(client.top, visible.top) };
      }
    }
    return null;
  },

  _readerVisibleLinkPages(ui, visible) {
    const displayed = ui.viewer._getVisiblePages?.()?.views;
    if (Array.isArray(displayed)) return Array.from(displayed, page => page.id - 1);
    return Array.from(ui.doc.querySelectorAll('.page[data-page-number]'))
      .filter(node => this._flashRectVisible(node.getBoundingClientRect(), visible))
      .map(node => Number(node.dataset.pageNumber) - 1);
  },

  /** Prefer Zotero's overlay targets, including its inferred citation links. */
  _readerNativeLinkTargets(ui, index) {
    const overlays = ui.view._pdfPages?.[index]?.overlays;
    if (!Array.isArray(overlays)) return [];
    const result = [];
    for (const overlay of overlays) {
      const source = this._readerLinkPosition(overlay?.position, ui.pdfDoc.numPages);
      if (!source || source.pageIndex !== index) continue;
      if (overlay.type === 'external-link') {
        const url = this._readerLinkURL(overlay.url);
        if (url) result.push({ source, url });
      } else if (overlay.type === 'internal-link' || overlay.type === 'citation') {
        const dest = overlay.type === 'citation'
          ? overlay.references?.[0]?.position : overlay.destinationPosition;
        const position = this._readerLinkPosition(dest, ui.pdfDoc.numPages);
        if (position) result.push({ source, position });
      }
    }
    return result;
  },

  /** Older views or pages whose overlay data is still loading can use authored PDF links. */
  async _readerAuthoredLinkTargets(ui, index) {
    const page = await this._readerPdfPage(ui.pdfDoc, index);
    if (typeof page?.getAnnotations !== 'function') return [];
    const annotations = await page.getAnnotations(Components.utils.cloneInto({
      intent: 'display',
    }, ui.pdfWin));
    const result = [];
    for (const annotation of annotations || []) {
      if (annotation?.subtype !== 'Link' || annotation.hidden) continue;
      const source = this._readerLinkPosition({ pageIndex: index,
        rects: [annotation.rect] }, ui.pdfDoc.numPages);
      if (!source) continue;
      const dest = annotation.dest;
      if ((typeof dest === 'string' && dest) || (Array.isArray(dest) && dest.length >= 2)) {
        result.push({ source, dest });
      } else {
        const url = this._readerLinkURL(annotation.url);
        if (url) result.push({ source, url });
      }
    }
    return result;
  },

  async _openReaderLinkHints(state, reader, pdfWin) {
    if (state.mode !== 'normal') return;
    this._closeReaderLinkHints(state);
    const app = pdfWin?.PDFViewerApplication;
    const ir = reader._internalReader;
    const view = [ir?._primaryView, ir?._secondaryView]
      .find(candidate => candidate && candidate._iframeWindow === pdfWin);
    const zh = this._isZhLocale();
    if (!view || !app?.pdfDocument || !app.pdfViewer) {
      this._showStatus(state, zh ? '链接提示需要已加载的 PDF' : 'Link hints need a loaded PDF');
      return;
    }
    const win = reader._window || reader._iframe?.ownerDocument?.defaultView;
    const ui = { reader, view, win, pdfWin, doc: pdfWin.document, viewer: app.pdfViewer,
      pdfDoc: app.pdfDocument, tabID: win?.Zotero_Tabs?.selectedID, badges: [], prefix: '', zh };
    state._readerLinkHints = ui;
    try {
      this._stopSmoothHoldScroll(state, pdfWin);
      const visible = this._flashViewport(pdfWin);
      const pages = [...new Set(this._readerVisibleLinkPages(ui, visible))].filter(index =>
        Number.isInteger(index) && index >= 0 && index < ui.pdfDoc.numPages);
      const targets = [], missing = [];
      for (const index of pages) {
        const native = this._readerNativeLinkTargets(ui, index);
        if (native.length) targets.push(...native);
        else missing.push(index);
      }
      if (missing.length && typeof ui.pdfDoc.getPage === 'function') {
        const fallback = await Promise.allSettled(missing.map(index =>
          this._readerAuthoredLinkTargets(ui, index)));
        for (const page of fallback) {
          if (page.status === 'fulfilled') targets.push(...page.value);
          else Zotero.debug('[ZoteroVim] read PDF links: ' + page.reason);
        }
      }
      if (!this._readerLinkHintsCurrent(state, ui)) {
        if (state._readerLinkHints === ui) this._closeReaderLinkHints(state);
        return;
      }
      const seen = new Set();
      const positioned = [];
      const viewport = this._flashViewport(pdfWin);
      for (const target of targets) {
        const rect = this._readerLinkRect(ui, target.source, viewport);
        if (!rect) continue;
        const key = target.source.pageIndex + ':' + target.source.rects
          .map(part => part.map(value => Math.round(value * 10)).join(',')).join(';');
        if (seen.has(key)) continue;
        seen.add(key);
        positioned.push({ target, rect });
      }
      if (!positioned.length) {
        this._closeReaderLinkHints(state);
        this._showStatus(state, zh ? '当前窗格没有可见链接' : 'No visible links');
        return;
      }
      positioned.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
      const labels = this._flashLabels(positioned.length, new Set());
      for (const [i, item] of positioned.entries()) {
        const badge = this._createHintBadge(ui.doc, labels[i], null, 0, item.rect);
        badge.target = item.target;
        badge.el.setAttribute('data-zv-link-hint', '');
        ui.badges.push(badge);
      }
      this._layoutHintBadges(ui.doc, ui.badges, false);
      this._showStatus(state, zh ? '输入标签打开链接 · Esc 取消' : 'Type a link label · Esc cancels');
      ui.statusTimer = state._statusTimer;
    } catch (e) {
      if (state._readerLinkHints !== ui) return;
      this._closeReaderLinkHints(state);
      Zotero.debug('[ZoteroVim] open link hints: ' + e);
      this._showStatus(state, zh ? '无法读取链接' : 'Could not read links');
    }
  },

  _readerLinkHintOwnsKey(state, key, pdfWin) {
    const ui = state._readerLinkHints;
    return ui && (!pdfWin || ui.pdfWin === pdfWin)
      && (/^[a-z]$/i.test(key) || ['escape', 'backspace', 'enter', 'return'].includes(key));
  },

  _onReaderLinkHintKeyDown(event, state, pdfWin) {
    const ui = state._readerLinkHints;
    if (!ui) return false;
    if (ui.pdfWin !== pdfWin || !this._readerLinkHintsCurrent(state, ui)
        || this._isEditableElement(event.target)) {
      this._closeReaderLinkHints(state);
      return false;
    }
    if (event.isComposing || event.keyCode === 229) return false;
    const key = this._keyString(event);
    if (!key) return false;
    if (!this._readerLinkHintOwnsKey(state, key, pdfWin)) {
      this._closeReaderLinkHints(state);
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'escape') this._closeReaderLinkHints(state);
    else if (key === 'backspace') ui.prefix = ui.prefix.slice(0, -1);
    else if (!event.repeat && /^[a-z]$/i.test(key)) {
      const next = ui.prefix + key.toUpperCase();
      const exact = ui.badges.find(badge => badge.label === next);
      if (exact) {
        void this._followReaderLinkHint(state, ui, exact.target);
        return true;
      }
      ui.prefix = ui.badges.some(badge => badge.label.startsWith(next)) ? next : '';
    }
    for (const badge of ui.badges) {
      badge.el.hidden = !badge.label.startsWith(ui.prefix);
      badge.prefixEl.textContent = ui.prefix;
      badge.restEl.textContent = badge.label.slice(ui.prefix.length);
    }
    return true;
  },

  _closeReaderLinkHints(state, pdfWin = null) {
    const ui = state._readerLinkHints;
    if (!ui || (pdfWin && ui.pdfWin !== pdfWin)) return;
    state._readerLinkHints = null;
    if (ui.statusTimer && ui.statusTimer === state._statusTimer) {
      clearTimeout(ui.statusTimer);
      state._statusTimer = null;
      state._statusActive = false;
      this._updateIndicator(state);
    }
    for (const badge of ui.badges) {
      try { badge.el.remove(); } catch (_) {}
    }
  },

  async _followReaderLinkHint(state, ui, target) {
    if (!this._readerLinkHintsCurrent(state, ui)) return;
    this._closeReaderLinkHints(state);
    const { reader, view, pdfWin } = ui;
    const request = {};
    state._readerJumpRequest = request;
    const current = () => state._readerJumpRequest === request && !pdfWin.closed
      && pdfWin.PDFViewerApplication?.pdfDocument === ui.pdfDoc
      && [reader._internalReader?._primaryView, reader._internalReader?._secondaryView].includes(view)
      && ui.tabID === ui.win?.Zotero_Tabs?.selectedID;
    try {
      if (!this._readerLinkRect(ui, target.source)) return;
      if (target.url) {
        if (typeof view._onOpenLink === 'function') await view._onOpenLink(target.url);
        else Zotero.launchURL(target.url);
        return;
      }
      this._clearReaderJumpCue(state, pdfWin);
      if (target.position) {
        const outer = reader._iframeWindow;
        await view.navigate(Components.utils.cloneInto({ position: target.position }, outer),
          Components.utils.cloneInto({ behavior: 'instant' }, outer));
        if (!current()) return;
        const { pageIndex, rects } = target.position;
        const page = ui.viewer.getPageView?.(pageIndex);
        this._showReaderJumpCue(state, pdfWin, page, rects.reduce(this._readerUnionRects));
      } else {
        const linkService = pdfWin.PDFViewerApplication.pdfLinkService;
        const dest = typeof target.dest === 'string'
          ? target.dest : Components.utils.cloneInto(target.dest, pdfWin);
        await this._recordReaderHistoryPoint(reader, state, pdfWin, linkService.goToDestination(dest));
        if (!current()) return;
        const position = await this._readerOutlineHeadingPosition({ dest: target.dest }, ui.pdfDoc);
        if (!current() || !Number.isInteger(position.pageIndex)) return;
        const page = ui.viewer.getPageView?.(position.pageIndex);
        const region = this._readerJumpAnchorRect(page, position);
        if (region) this._showReaderJumpCue(state, pdfWin, page, region);
      }
      if (current()) state.lastAnnotationKey = null;
    } catch (e) {
      Zotero.debug('[ZoteroVim] follow PDF link: ' + e);
      if (current()) this._showStatus(state, ui.zh ? '无法打开链接' : 'Could not open link');
    }
  },
});

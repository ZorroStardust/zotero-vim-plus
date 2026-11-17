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

  /** Resolve the visible parts of a native link in this pane's current viewport. */
  _readerLinkRects(ui, source, visible) {
    const page = ui.viewer.getPageView?.(source.pageIndex);
    if (!page?.viewport || !page.div?.isConnected) return [];
    const bounds = page.div.getBoundingClientRect();
    const x = bounds.left + (page.div.clientLeft || 0);
    const y = bounds.top + (page.div.clientTop || 0);
    const result = [];
    for (const rect of source.rects) {
      const [left, top, right, bottom] = this._readerJumpViewportRect(page.viewport, rect);
      const client = { left: x + left, top: y + top, right: x + right, bottom: y + bottom,
        width: right - left, height: bottom - top };
      if (this._flashRectVisible(client, visible)) result.push(client);
    }
    return result;
  },

  _readerVisibleLinkPages(ui, visible) {
    const displayed = ui.viewer._getVisiblePages?.()?.views;
    if (Array.isArray(displayed)) return Array.from(displayed, page => page.id - 1);
    return Array.from(ui.doc.querySelectorAll('.page[data-page-number]'))
      .filter(node => this._flashRectVisible(node.getBoundingClientRect(), visible))
      .map(node => Number(node.dataset.pageNumber) - 1);
  },

  _readerLinkPositionKey(position) {
    return position.pageIndex + ':' + position.rects
      .map(rect => rect.map(value => Math.round(value * 10)).join(',')).join(';');
  },

  /** A Zotero citation can point to several bibliography entries on the same page. */
  _readerCitationReferences(overlay, pages) {
    const references = [], seen = new Set();
    if (!Array.isArray(overlay.references)) return references;
    for (const reference of overlay.references) {
      const position = this._readerLinkPosition(reference?.position, pages);
      if (!position) continue;
      const key = this._readerLinkPositionKey(position);
      if (seen.has(key)) continue;
      seen.add(key);
      const number = /^\d+$/u.test(reference.index) ? String(reference.index) : '';
      let excerpt = typeof reference.text === 'string' ? reference.text.replace(/\s+/gu, ' ').trim()
        : Array.from(reference.chars || []).slice(0, 240)
          .map(char => (char?.c || '') + (char?.spaceAfter ? ' ' : '')).join('').trim();
      if (number && (excerpt.startsWith('[' + number + ']') || excerpt.startsWith(number + '.'))) {
        excerpt = excerpt.slice(excerpt.startsWith('[') ? number.length + 2 : number.length + 1).trim();
      }
      if (excerpt.length > 240) excerpt = excerpt.slice(0, 240).trimEnd() + '…';
      references.push({ position, number, excerpt });
    }
    return references;
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
        if (url) result.push({ source, url, parsed: overlay.source === 'parsed' });
      } else if (overlay.type === 'citation') {
        const references = this._readerCitationReferences(overlay, ui.pdfDoc.numPages);
        if (references.length > 1) result.push({ source, references });
        else if (references.length) result.push({ source, position: references[0].position });
      } else if (overlay.type === 'internal-link') {
        const position = this._readerLinkPosition(overlay.destinationPosition, ui.pdfDoc.numPages);
        if (position) result.push({ source, position });
      }
    }
    const groups = result.filter(target => target.references);
    // Replace a PDF's whole-group link when Zotero knows its individual references.
    // A narrower authored link on one of the numbers still has its own target.
    return result.filter(target => !target.position || !groups.some(group => {
      if (!group.references.some(ref => ref.position.pageIndex === target.position.pageIndex)) return false;
      const [left, bottom, right, top] = target.source.rects.reduce(this._readerUnionRects);
      return group.source.rects.every(([x1, y1, x2, y2]) => {
        const width = Math.max(0, Math.min(right, x2) - Math.max(left, x1));
        const height = Math.max(0, Math.min(top, y2) - Math.max(bottom, y1));
        return x2 > x1 && y2 > y1 && width * height >= (x2 - x1) * (y2 - y1) * 0.8;
      });
    }));
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

  /** Keep balanced URL/DOI punctuation and remove sentence punctuation and outer wrappers. */
  _readerIdentifierEnd(text, start, end) {
    const brackets = { ')': '(', ']': '[', '}': '{', '>': '<', "'": "'" };
    let wordStart = start;
    while (wordStart > 0 && !/\s/u.test(text[wordStart - 1])) wordStart--;
    let prefix = text.slice(wordStart, start);
    while (end > start) {
      while (end > start && /[.,]/u.test(text[end - 1])) end--;
      const close = text[end - 1], open = brackets[close];
      if (!open) break;
      const wrapper = prefix.lastIndexOf(open);
      if (wrapper < 0 || (open !== close && wrapper < prefix.lastIndexOf(close))) break;
      if (open !== close) {
        let balance = 0;
        for (let i = start; i < end; i++) {
          if (text[i] === open) balance++;
          else if (text[i] === close) balance--;
        }
        if (balance >= 0) break;
      }
      prefix = prefix.slice(0, wrapper) + prefix.slice(wrapper + 1);
      end--;
    }
    return end;
  },

  /** Scan original UTF-16 offsets so a URL opens with exactly the spelling on the page. */
  *_readerTextIdentifiers(text) {
    // Consume full URI tokens first, including unsupported schemes, to shield embedded IDs.
    const pattern = /([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"“”‘’，。；、！？]+)|(10(?:\.\d{4,}(?:\.\d+)*)?\/[^\s"“”‘’，。；、！？]+)|((?:[A-Za-z][A-Za-z-]*(?:\.[A-Za-z]{2})?\/\d{2}(?:0[1-9]|1[0-2])\d{3}|\d{2}(?:0[1-9]|1[0-2])\.\d{4,5})(?:v\d+)?)/gu;
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      if (start && /[\p{L}\p{N}_.\/@%+-]/u.test(text[start - 1])) continue;
      const end = this._readerIdentifierEnd(text, start, start + match[0].length);
      const raw = text.slice(start, end);
      if (match[1]) {
        if (/^https?:\/\/[^/?#]+/iu.test(raw)) yield { start, end, url: raw };
        continue;
      }
      const arxiv = !!match[3];
      if (arxiv && (/^[\p{L}\p{N}_\/-]/u.test(text.slice(end))
          || /^\.\d/u.test(text.slice(end)))) continue;
      if (!arxiv && !/\/[^\s]+$/u.test(raw)) continue;
      // A bare numeric fraction may resemble a shortDOI. A DOI label disambiguates it.
      if (raw.startsWith('10/') && !/^10\/\d*[a-z][a-z0-9]*$/iu.test(raw)
          && !/\bdoi\s*:?\s*$/iu.test(text.slice(0, start))) continue;
      const value = !arxiv && /%3c.*%3e/iu.test(raw)
        ? raw.replace(/%3c/giu, '<').replace(/%3e/giu, '>') : raw;
      try {
        const encoded = encodeURIComponent(value).replace(/%2f/giu, '/');
        const resolver = arxiv ? 'https://arxiv.org/abs/' : 'https://doi.org/';
        yield { start, end, url: resolver + encoded };
      } catch (_) {} // A malformed UTF-16 identifier has no usable destination.
    }
  },

  /** Assemble independent visual lines with exact source offsets across adjacent PDF spans. */
  *_readerTextLinkTargets(ui, pages, visible, readablePages) {
    for (const pageIndex of pages) {
      const layer = ui.viewer.getPageView?.(pageIndex)?.div?.querySelector('.textLayer');
      if (!layer?.isConnected || layer.hidden) continue;
      const bounds = layer.getBoundingClientRect();
      if (!this._flashRectVisible(bounds, visible)
          || ui.pdfWin.getComputedStyle?.(layer)?.visibility === 'hidden') continue;
      const { lines } = this._readerPageTextLayout(layer, bounds);
      const visualLines = new Set(lines.map(line => line.geometry || line));
      for (const line of visualLines) {
        if (line.bottom + bounds.top <= visible.top || line.top + bounds.top >= visible.bottom) continue;
        readablePages.add(pageIndex);
        let text = '', previous = null;
        const spans = [];
        for (const item of line.spans) {
          const { node, span, rect } = item;
          if (previous && (item.wordBreakBefore === previous.domIndex
              || this._pdfTextHasGap(previous.rect, rect)
              || rect.left < previous.rect.right - Math.min(1, rect.height * 0.1))) text += ' ';
          const value = node.data;
          spans.push({ node, span, value, start: text.length, end: text.length + value.length });
          text += value;
          previous = item;
        }
        for (const { start, end, url } of this._readerTextIdentifiers(text)) {
          const parts = spans.filter(span => span.start < end && span.end > start).map(span => ({
            node: span.node, span: span.span, value: span.value,
            start: Math.max(0, start - span.start), end: Math.min(span.end, end) - span.start,
          }));
          if (parts.length) yield { pageIndex, url, layer, parts };
        }
      }
    }
  },

  /** Recheck the text nodes and read only the exact link substring, even across styled spans. */
  _readerTextLinkRects(ui, target, visible) {
    try {
      if (!target.layer.isConnected || target.layer.hidden
          || ui.pdfWin.getComputedStyle?.(target.layer)?.visibility === 'hidden') return [];
      const rects = [];
      const range = ui.doc.createRange();
      for (const { node, span, value, start, end } of target.parts) {
        if (!node.isConnected || node.ownerDocument !== ui.doc || node.parentElement !== span
            || node.data !== value || !target.layer.contains(span)) return [];
        range.setStart(node, start);
        range.setEnd(node, end);
        for (const rect of range.getClientRects()) {
          if (this._flashRectVisible(rect, visible)) rects.push(rect);
        }
      }
      return rects;
    } catch (_) { return []; } // PDF.js can replace a text layer while it is being measured.
  },

  _readerLinkRectsOverlap(a, b) {
    const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return width > 0 && height > 0
      && width * height >= Math.min(a.width * a.height, b.width * b.height) * 0.5;
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
      const readablePages = new Set();
      const textTargets = [...this._readerTextLinkTargets(ui, pages, viewport, readablePages)];
      for (const target of targets) {
        // On readable lines use the complete source text, including when it
        // rejects a fragment guessed by Zotero. Keep its wrapped-link fallback.
        if (target.parsed && target.source.rects.length === 1
            && readablePages.has(target.source.pageIndex)) continue;
        const rects = this._readerLinkRects(ui, target.source, viewport);
        if (!rects.length) continue;
        const key = this._readerLinkPositionKey(target.source);
        if (seen.has(key)) continue;
        seen.add(key);
        positioned.push({ target, rects });
      }
      // Overprinted text may expose both a URL and a shorter prefix at the same coordinates.
      textTargets.sort((a, b) => b.url.length - a.url.length);
      for (const target of textTargets) {
        const rects = this._readerTextLinkRects(ui, target, viewport);
        if (!rects.length) continue;
        const overlaps = item => (item.target.source?.pageIndex === target.pageIndex
          || (item.target.pageIndex === target.pageIndex && item.target.url.startsWith(target.url)))
          && rects.some(rect => item.rects.some(earlier => this._readerLinkRectsOverlap(rect, earlier)));
        if (positioned.some(overlaps)) continue;
        positioned.push({ target, rects });
      }
      if (!positioned.length) {
        this._closeReaderLinkHints(state);
        this._showStatus(state, zh ? '当前窗格没有可见链接' : 'No visible links');
        return;
      }
      positioned.sort((a, b) => a.rects[0].top - b.rects[0].top || a.rects[0].left - b.rects[0].left);
      const labels = this._flashLabels(positioned.length, new Set());
      for (const [i, item] of positioned.entries()) {
        const rect = item.rects[0];
        const badge = this._createHintBadge(ui.doc, labels[i], null, 0, {
          left: Math.max(rect.left, viewport.left), top: Math.max(rect.top, viewport.top),
          height: rect.height,
        });
        badge.target = item.target;
        badge.el.setAttribute('data-zv-link-hint', '');
        if (item.target.references) badge.restEl.textContent += ' ›';
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
      && (/^[a-z]$/i.test(key) || ['escape', 'backspace', 'enter', 'return'].includes(key)
        || (ui.citationPicker && ['arrowdown', 'arrowup'].includes(key)));
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
    if (key === 'escape') {
      this._closeReaderLinkHints(state);
      return true;
    }
    const picker = ui.citationPicker;
    const choices = picker?.choices || ui.badges;
    if (key === 'backspace') {
      if (picker && !ui.prefix) {
        picker.el.remove();
        ui.citationPicker = null;
        this._refreshReaderLinkChoices(ui, ui.badges);
        return true;
      }
      ui.prefix = ui.prefix.slice(0, -1);
      if (picker) picker.selected = null;
    } else if (picker && (key === 'arrowdown' || key === 'arrowup')) {
      const visible = choices.filter(choice => !choice.el.hidden);
      const index = visible.indexOf(picker.selected);
      const next = index < 0 ? (key === 'arrowdown' ? 0 : visible.length - 1)
        : Math.max(0, Math.min(index + (key === 'arrowdown' ? 1 : -1), visible.length - 1));
      picker.selected = visible[next] || null;
      picker.selected?.el.scrollIntoView(Components.utils.cloneInto({ block: 'nearest' }, ui.pdfWin));
    } else if (picker && (key === 'enter' || key === 'return') && !event.repeat && picker.selected) {
      void this._followReaderLinkHint(state, ui, picker.selected.target);
      return true;
    } else if (!event.repeat && /^[a-z]$/i.test(key)) {
      const next = ui.prefix + key.toUpperCase();
      const exact = choices.find(choice => choice.label === next);
      if (exact) {
        if (exact.target.references) this._openReaderCitationPicker(state, ui, exact.target);
        else void this._followReaderLinkHint(state, ui, exact.target);
        return true;
      }
      ui.prefix = choices.some(choice => choice.label.startsWith(next)) ? next : '';
      if (picker) picker.selected = null;
    }
    this._refreshReaderLinkChoices(ui, choices);
    return true;
  },

  _refreshReaderLinkChoices(ui, choices) {
    for (const choice of choices) {
      choice.el.hidden = !choice.label.startsWith(ui.prefix);
      choice.prefixEl.textContent = ui.prefix;
      choice.restEl.textContent = choice.label.slice(ui.prefix.length)
        + (choice.target.references ? ' ›' : '');
      if (ui.citationPicker) {
        choice.el.style.background = ui.citationPicker.selected === choice ? '#313244' : '';
      }
    }
  },

  /** Keep one hint in the body and display the available reference destinations on selection. */
  _openReaderCitationPicker(state, ui, group) {
    if (!this._readerLinkHintsCurrent(state, ui)) return;
    try {
      const visible = this._flashViewport(ui.pdfWin);
      if (!this._readerLinkRects(ui, group.source, visible).length) {
        this._closeReaderLinkHints(state);
        return;
      }
      const { doc, zh } = ui;
      const el = doc.createElement('div');
      el.setAttribute('data-zv-citation-picker', '');
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', zh ? '选择参考文献' : 'Choose a reference');
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:100001;'
        + 'width:min(540px,calc(100vw - 28px));box-sizing:border-box;'
        + 'padding:10px;border:1px solid #585b70;border-radius:8px;background:#1e1e2e;'
        + 'color:#cdd6f4;box-shadow:0 3px 16px #0006;font:13px/1.45 sans-serif;pointer-events:none;';
      const title = doc.createElement('div');
      title.textContent = zh ? '选择参考文献' : 'Choose a reference';
      title.style.cssText = 'font-weight:bold;margin-bottom:6px;';
      const list = doc.createElement('div');
      list.style.cssText = 'max-height:40vh;overflow:auto;color-scheme:dark;'
        + 'scrollbar-width:thin;scrollbar-color:#585b70 transparent;';
      const labels = this._flashLabels(group.references.length, new Set());
      const choices = group.references.map((ref, i) => {
        const row = doc.createElement('div');
        row.style.cssText = 'padding:5px;border-radius:4px;overflow-wrap:anywhere;';
        const badge = doc.createElement('kbd');
        badge.style.cssText = 'color:#f9e2af;font-weight:bold;margin-right:8px;';
        const prefixEl = doc.createElement('span');
        prefixEl.style.opacity = '0.48';
        const restEl = doc.createElement('span');
        restEl.textContent = labels[i];
        badge.appendChild(prefixEl);
        badge.appendChild(restEl);
        const text = doc.createElement('span');
        text.textContent = [ref.number && '[' + ref.number + ']', ref.excerpt
          || (zh ? '第 ' + (ref.position.pageIndex + 1) + ' 页' : 'p. ' + (ref.position.pageIndex + 1))]
          .filter(Boolean).join(' ');
        row.appendChild(badge);
        row.appendChild(text);
        list.appendChild(row);
        return { label: labels[i], el: row, prefixEl, restEl,
          target: { source: group.source, position: ref.position } };
      });
      const footer = doc.createElement('div');
      footer.textContent = zh ? '标签或 ↑/↓ + Enter · Backspace 返回 · Esc 取消'
        : 'Label or ↑/↓ + Enter · Backspace back · Esc cancel';
      footer.style.cssText = 'margin-top:6px;color:#a6adc8;font-size:11px;';
      el.appendChild(title);
      el.appendChild(list);
      el.appendChild(footer);
      doc.body.appendChild(el);
      ui.prefix = '';
      ui.citationPicker = { el, choices, selected: null };
      for (const badge of ui.badges) badge.el.hidden = true;
    } catch (e) {
      this._closeReaderLinkHints(state);
      Zotero.debug('[ZoteroVim] open citation picker: ' + e);
    }
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
    try { ui.citationPicker?.el.remove(); } catch (_) {}
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
      const visible = this._flashViewport(pdfWin);
      const rects = target.source ? this._readerLinkRects(ui, target.source, visible)
        : this._readerTextLinkRects(ui, target, visible);
      if (!rects.length) return;
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

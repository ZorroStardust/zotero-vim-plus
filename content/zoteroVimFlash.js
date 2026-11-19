/* global Zotero, ZoteroVim */
/* eslint-disable no-unused-vars */

Object.assign(ZoteroVim, {
  /** Index normalized text without losing original DOM offsets (e.g. ﬁ → fi). */
  _buildFlashIndex(items) {
    let source = '';
    const points = [];
    let previous = null;
    for (const item of items) {
      const { node, rect, pageIdx, colIdx, line } = item;
      if (previous && (previous.pageIdx !== pageIdx || previous.colIdx !== colIdx
          || previous.line?.block !== line?.block)) {
        source += '\0';
        points.push(null);
      } else if (previous && (Number.isInteger(item.wordBreakBefore)
          && item.wordBreakBefore === previous.domIndex || this._pdfTextHasGap(previous.rect, rect))) {
        source += ' ';
        points.push(null);
      }
      source += node.data;
      for (let offset = 0; offset < node.length; offset++) points.push({ node, offset });
      previous = item;
    }

    let text = '';
    const starts = [], ends = [];
    // Grapheme segmentation lets a combining mark span two PDF text nodes.
    const graphemes = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source)
      : Array.from(source.matchAll(/[\s\S]\p{M}*/gu), m => ({ index: m.index, segment: m[0] }));
    for (const { index, segment } of graphemes) {
      let value = segment.normalize('NFKC').replace(/[\u200B\uFEFF\p{White_Space}]+/gu, ' ');
      if (value !== '\0' && /^[\p{Cf}\p{Cc}\p{Default_Ignorable_Code_Point}]+$/u.test(value)) {
        value = '';
      }
      if (value === ' ' && text.endsWith(' ')) value = '';
      const start = points[index];
      const last = points[index + segment.length - 1];
      const end = last && { node: last.node, offset: last.offset + 1 };
      text += value;
      for (let i = 0; i < value.length; i++) { starts.push(start); ends.push(end); }
    }

    const tokens = [];
    const words = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)
      : Array.from(text.matchAll(/[\p{L}\p{M}\p{N}_]+|[^\s]/gu),
        m => ({ index: m.index, segment: m[0] }));
    for (const { index, segment } of words) {
      if (!starts[index] || /^\s+$/u.test(segment)) continue;
      const end = index + segment.length;
      const token = { start: index, end };
      for (let i = index; i < end; i++) tokens[i] = token;
    }
    return { text, starts, ends, tokens };
  },

  /** Literal smartcase matching, expanded and deduplicated by source word range. */
  *_flashMatches(index, value, continuations = null) {
    const normalized = value.normalize('NFKC').replace(/\s+/g, ' ');
    const query = normalized.trim();
    const endsWithSpace = normalized.endsWith(' ');
    if (!query || query.includes('\0')) return;
    const literal = query.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(literal, /[A-Z]/.test(query) ? 'gu' : 'giu');
    const seen = new Set();
    let hit;
    while ((hit = pattern.exec(index.text)) !== null) {
      // Overlapping phrases may refer to distinct word ranges.
      pattern.lastIndex = hit.index + (index.text.codePointAt(hit.index) > 0xFFFF ? 2 : 1);
      const rawEnd = hit.index + hit[0].length;
      if (continuations) {
        // Reserve letters from every raw match, even if several hits expand to the same word.
        const next = endsWithSpace
          ? (index.text[rawEnd] === ' ' ? index.text[rawEnd + 1] : '')
          : index.text[rawEnd];
        if (next && /^[a-z]$/i.test(next)) continuations.add(next.toUpperCase());
      }
      const start = index.tokens[hit.index]?.start ?? hit.index;
      const last = rawEnd - 1;
      const end = index.tokens[last]?.end ?? last + 1;
      const key = start + ':' + end;
      if (seen.has(key) || !index.starts[start] || !index.ends[end - 1]) continue;
      seen.add(key);
      yield { start: index.starts[start], end: index.ends[end - 1] };
    }
  },

  /** Use safe first letters and fixed-length labels, so none prefixes another. */
  _flashLabels(count, continuations) {
    const alphabet = this._hintAlphabet();
    const first = [...alphabet].filter(letter => !continuations.has(letter));
    if (!first.length) return [];
    let suffixCapacity = 1;
    while (first.length * suffixCapacity < count) suffixCapacity *= alphabet.length;
    return Array.from({ length: count }, (_, index) => {
      let label = first[Math.floor(index / suffixCapacity)];
      let remainder = index % suffixCapacity;
      for (let place = suffixCapacity / alphabet.length; place >= 1; place /= alphabet.length) {
        label += alphabet[Math.floor(remainder / place)];
        remainder %= place;
      }
      return label;
    });
  },

  _flashViewport(pdfWin) {
    const container = this._getScrollContainer(pdfWin);
    const rect = container?.getBoundingClientRect?.();
    return { left: Math.max(0, rect?.left ?? 0), top: Math.max(0, rect?.top ?? 0),
      right: Math.min(pdfWin.innerWidth, rect?.right ?? pdfWin.innerWidth),
      bottom: Math.min(pdfWin.innerHeight, rect?.bottom ?? pdfWin.innerHeight) };
  },

  _flashRectVisible(rect, viewport) {
    return rect.width > 0 && rect.height > 0 && rect.right > viewport.left
      && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom;
  },

  _flashTargetRect(ui, target, viewport) {
    const { node, offset } = target.start;
    if (!node.isConnected || !target.end.node.isConnected
        || node.ownerDocument !== ui.doc || target.end.node.ownerDocument !== ui.doc) return null;
    try {
      const range = ui.doc.createRange();
      range.setStart(node, offset);
      const endOffset = target.end.node === node ? target.end.offset : node.length;
      range.setEnd(node, endOffset);
      if (range.collapsed) return null;
      return Array.from(range.getClientRects()).find(rect => this._flashRectVisible(rect, viewport));
    } catch (_) { return null; }
  },

  _readerFlashCurrent(state) {
    const ui = state._readerFlash;
    if (!ui) return false;
    try {
      const reader = state.reader;
      const internal = reader?._internalReader;
      return !ui.pdfWin.closed && !ui.win?.closed && ui.pdfWin.document === ui.doc
        && ui.view._iframeWindow === ui.pdfWin
        && [internal?._primaryView, internal?._secondaryView].includes(ui.view)
        && ui.tabID === ui.win?.Zotero_Tabs?.selectedID && ui.panel.isConnected;
    } catch (_) { return false; }
  },

  /** Paint the saved range independently of Gecko's selection focus. */
  _paintReaderFlashSelection(ui) {
    const { doc, pdfWin, preview } = ui;
    if (!preview || ui.previewRegistry) return;
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    doc.documentElement.removeAttribute('data-zv-flash-preview');
    const saved = ui.selection;
    if (!saved.anchor.isConnected || !saved.focus.isConnected) return;
    try {
      let ranges = ui.ordered?.runs.map(run => run.range);
      if (!ranges) {
        const anchor = { node: saved.anchor, offset: saved.anchorOffset };
        const focus = { node: saved.focus, offset: saved.focusOffset };
        const [start, end] = this._compareReaderPoints(anchor, focus) <= 0
          ? [anchor, focus] : [focus, anchor];
        const range = doc.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        ranges = [range];
      }
      if (!ranges.length) return;
      try {
        const registry = pdfWin.CSS?.highlights;
        if (registry && typeof pdfWin.Highlight === 'function') {
          const highlight = new pdfWin.Highlight(ranges[0]);
          for (const range of ranges.slice(1)) highlight.add(range);
          registry.set('zv-flash-selection', highlight);
          ui.previewRegistry = registry;
          doc.documentElement.setAttribute('data-zv-flash-preview', '');
          return;
        }
      } catch (_) {} // Older reader runtimes can use the rectangle layer below.

      const node = ranges[0].startContainer;
      const element = node.nodeType === 1 ? node : node.parentElement;
      const textLayer = element?.closest('.textLayer') || doc.querySelector('.textLayer');
      if (textLayer) {
        preview.style.setProperty('--zv-flash-text-layer-opacity',
          pdfWin.getComputedStyle(textLayer).opacity);
      }
      const rects = ranges.flatMap(range =>
        range.startContainer.nodeType === 3 && range.endContainer.nodeType === 3
          ? this._getRangeTextRects(range, doc) : Array.from(range.getClientRects()));
      const viewport = this._flashViewport(pdfWin);
      for (const rect of rects) {
        if (!this._flashRectVisible(rect, viewport)) continue;
        const left = Math.max(rect.left, viewport.left);
        const top = Math.max(rect.top, viewport.top);
        const width = Math.min(rect.right, viewport.right) - left;
        const height = Math.min(rect.bottom, viewport.bottom) - top;
        const box = doc.createElement('div');
        box.className = 'zv-flash-selection-rect';
        box.style.cssText = 'position:absolute;left:' + left + 'px;top:' + top
          + 'px;width:' + width + 'px;height:' + height + 'px;';
        preview.appendChild(box);
      }
      if (preview.firstChild) doc.documentElement.setAttribute('data-zv-flash-preview', '');
    } catch (e) {
      Zotero.debug('[ZoteroVim] Flash selection preview: ' + e);
    }
  },

  _openReaderFlash(state, pdfWin, mode) {
    if (!this.isModeEnabled(mode)) return;
    const reader = state.reader;
    const internal = reader?._internalReader;
    const view = [internal?._primaryView, internal?._secondaryView]
      .find(candidate => candidate?._iframeWindow === pdfWin);
    if (!view || !pdfWin.PDFViewerApplication?.pdfViewer) {
      this._showStatus(state, this._isZhLocale() ? 'Flash 需要 PDF 文字层' : 'Flash needs a PDF text layer');
      return;
    }

    this._closeReaderFlash(state, false);
    this._stopSmoothHoldScroll(state, pdfWin);
    const doc = pdfWin.document;
    const win = reader._window || reader._iframe?.ownerDocument?.defaultView;
    const zh = this._isZhLocale();
    const panel = doc.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Flash');
    panel.id = 'zv-flash-panel';
    panel.style.cssText = 'position:fixed;right:14px;bottom:14px;'
      + 'z-index:100001;width:min(420px,85vw);box-sizing:border-box;padding:8px 10px;'
      + 'border:1px solid var(--zv-theme-border, #585b70);border-radius:7px;background:var(--zv-theme-surface, #1e1e2e);color:var(--zv-theme-text, #cdd6f4);'
      + 'box-shadow:0 2px 12px #0005;font:13px sans-serif';
    const input = doc.createElement('input');
    input.type = 'text';
    input.placeholder = zh ? '输入可见的词句' : 'Type visible text';
    input.setAttribute('aria-label', input.placeholder);
    input.style.cssText = 'width:100%;box-sizing:border-box;background:var(--zv-theme-control, #313244);'
      + 'color:var(--zv-theme-text, #cdd6f4);border:1px solid var(--zv-theme-border, #585b70);border-radius:4px;padding:5px;';
    const status = doc.createElement('div');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'margin-top:5px;';
    panel.appendChild(input);
    panel.appendChild(status);
    const selection = pdfWin.getSelection();
    const extending = mode === 'visual' && state.mode === 'visual';
    const ordered = extending ? this._orderedReaderVisual(state, pdfWin) : null;
    const endpoints = extending ? this._readerVisualEndpoints(state, pdfWin) : null;
    const visualAnchor = endpoints?.wordAnchor
      || (endpoints && { start: endpoints.anchor, end: endpoints.anchor });
    const ui = { pdfWin, win, doc, view, mode, zh, panel, input, status,
      tabID: win?.Zotero_Tabs?.selectedID, visualAnchor, ordered,
      badges: [], label: '', composing: false,
      selection: ordered ? { anchor: ordered.anchor.node, anchorOffset: ordered.anchor.offset,
        focus: ordered.focus.node, focusOffset: ordered.focus.offset } : selection?.anchorNode && {
        anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
        focus: selection.focusNode, focusOffset: selection.focusOffset,
      } };
    ui.deactivate = () => {
      if (state._readerFlash === ui) this._closeReaderFlash(state, false);
    };
    ui.pointerdown = event => {
      if (state._readerFlash !== ui || panel.contains(event.target)) return;
      if (ui.badges.some(badge => badge.el.contains(event.target))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        this._closeReaderFlash(state, false);
        if (event.button === 0 && event.target?.closest?.('.page')) {
          this._clearOrderedReaderVisual(state, pdfWin);
        }
      }
    };
    state._readerFlash = ui;
    try {
      doc.body.appendChild(panel);
      const saved = ui.selection;
      if (extending && saved?.focus
          && (saved.anchor !== saved.focus || saved.anchorOffset !== saved.focusOffset)) {
        const preview = doc.createElement('div');
        preview.className = 'zv-flash-selection-preview';
        preview.setAttribute('aria-hidden', 'true');
        preview.style.cssText = 'position:fixed;inset:0;z-index:99997;pointer-events:none;';
        ui.preview = preview;
        doc.body.appendChild(preview);
        this._paintReaderFlashSelection(ui);
      }
      win?.addEventListener('deactivate', ui.deactivate);
      doc.addEventListener('pointerdown', ui.pointerdown, true);
      panel.addEventListener('focusout', event => {
        if (state._readerFlash !== ui) return;
        const intoPanel = event.relatedTarget?.nodeType && panel.contains(event.relatedTarget);
        if (!intoPanel) this._closeReaderFlash(state, false);
      });
      input.addEventListener('compositionstart', () => { ui.composing = true; });
      input.addEventListener('compositionend', () => {
        ui.composing = false;
        this._renderReaderFlash(state, ui);
      });
      input.addEventListener('input', () => {
        if (!ui.composing) this._renderReaderFlash(state, ui);
      });
      input.focus();
      this._renderReaderFlash(state, ui);
    } catch (e) {
      this._closeReaderFlash(state, false);
      Zotero.debug('[ZoteroVim] Flash open: ' + e);
    }
  },

  _renderReaderFlash(state, ui) {
    if (state._readerFlash !== ui || !this._readerFlashCurrent(state)) return;
    for (const badge of ui.badges) badge.el.remove();
    ui.badges = [];
    ui.label = '';
    const { pdfWin, doc, input, status, zh } = ui;
    const viewport = this._flashViewport(pdfWin);
    if (!ui.index?.text || !ui.index.starts.find(Boolean)?.node.isConnected) {
      const { items } = this._readingOrderKeys(doc, state);
      ui.index = this._buildFlashIndex(items.filter(item => this._flashRectVisible(item.rect, viewport)));
    }
    const limit = 48;
    const targets = [];
    const continuations = new Set();
    let matchCount = 0;
    for (const target of this._flashMatches(ui.index, input.value, continuations)) {
      const rect = this._flashTargetRect(ui, target, viewport);
      if (!rect) continue;
      matchCount++;
      if (targets.length < limit) targets.push({ target, rect });
    }
    const count = zh ? matchCount + ' 个匹配'
      : matchCount + (matchCount === 1 ? ' match' : ' matches');
    status.textContent = count;
    if (!ui.index.text.trim()) {
      status.textContent += zh ? ' · 当前窗格没有可搜索的文字' : ' · No searchable text in this pane';
      return;
    }
    const labels = matchCount <= limit ? this._flashLabels(matchCount, continuations) : [];
    if (matchCount && !labels.length) {
      status.textContent += zh ? ' · 请继续输入' : ' · Keep typing';
      return;
    }
    const x = (viewport.left + viewport.right) / 2;
    const y = (viewport.top + viewport.bottom) / 2;
    const distance = rect => Math.hypot(rect.left - x, rect.top - y);
    targets.sort((a, b) => distance(a.rect) - distance(b.rect));
    for (const [i, { target, rect }] of targets.entries()) {
      const badge = this._createHintBadge(doc, labels[i], target.start.node, target.start.offset, rect);
      if (!badge) continue;
      badge.target = target;
      badge.el.style.pointerEvents = 'auto';
      badge.el.style.cursor = 'pointer';
      badge.el.addEventListener('mousedown', event => event.preventDefault());
      badge.el.addEventListener('click', () => this._acceptReaderFlash(state, ui, badge));
      ui.badges.push(badge);
    }
    this._layoutHintBadges(doc, [...ui.badges].sort((a, b) => a.top - b.top || a.left - b.left),
      false);
  },

  _refreshReaderFlash(state, pdfWin) {
    const ui = state._readerFlash;
    if (!ui || ui.pdfWin !== pdfWin) return;
    ui.index = null;
    if (ui.frame != null) return;
    ui.frame = pdfWin.requestAnimationFrame(() => {
      ui.frame = null;
      if (state._readerFlash !== ui || !this._readerFlashCurrent(state)) return;
      this._paintReaderFlashSelection(ui);
      if (!ui.composing) this._renderReaderFlash(state, ui);
    });
  },

  _onReaderFlashKeyDown(event, state) {
    const ui = state._readerFlash;
    event.stopImmediatePropagation();
    if (ui.composing || event.isComposing || event.keyCode === 229) return;
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      this._closeReaderFlash(state);
      return;
    }
    if (key === 'Enter' || key === 'Return') {
      event.preventDefault();
      if (!ui.label && !event.repeat) this._acceptReaderFlash(state, ui, ui.badges[0]);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const atQueryEnd = ui.input.selectionStart == null
      || (ui.input.selectionStart === ui.input.value.length
        && ui.input.selectionEnd === ui.input.value.length);
    if (!ui.label && !atQueryEnd) return;
    let next;
    if (ui.label && key === 'Backspace') next = ui.label.slice(0, -1);
    else if (/^[a-z]$/i.test(key)) next = ui.label + key.toUpperCase();
    else return;
    const matches = ui.badges.filter(badge => badge.label.startsWith(next));
    if (!ui.label && !matches.length) return;
    event.preventDefault();
    if (event.repeat) return;
    ui.label = matches.length ? next : '';
    const exact = matches.find(badge => badge.label === next);
    if (exact) { this._acceptReaderFlash(state, ui, exact); return; }
    for (const badge of ui.badges) {
      badge.el.style.opacity = badge.label.startsWith(ui.label) ? '' : '0.25';
    }
  },

  _acceptReaderFlash(state, ui, badge) {
    if (state._readerFlash !== ui || !badge || !ui.badges.includes(badge)) return;
    if (!this._readerFlashCurrent(state)) { this._closeReaderFlash(state, false); return; }
    const { pdfWin, mode } = ui;
    if (!this._flashTargetRect(ui, badge.target, this._flashViewport(pdfWin))) return;
    const original = ui.visualAnchor;
    if (original && (![original.start, original.end].every(point =>
      point.node.isConnected && point.node.ownerDocument === ui.doc))) {
      this._closeReaderFlash(state, false);
      return;
    }
    try {
      const target = badge.target;
      const keys = this._readingOrderKeys(ui.doc, state);
      const admitted = original && (!state._readerBodyText
        || [original.start, original.end].every(point => keys.byNode.has(point.node)));
      const wordAnchor = admitted ? original : null;
      const { anchor, focus } = mode === 'visual'
        ? this._readerAnchoredTokenEndpoints(wordAnchor, target, keys)
        : { anchor: target.start, focus: target.start };
      this._closeReaderFlash(state, false);
      pdfWin.focus();
      state.activePdfWin = pdfWin;
      state.visualPreferredX = null;
      state.cursorPreferredX = null;
      if (mode === 'visual') {
        this._setMode(state, 'visual');
        this._applyReaderVisualSelection(state, pdfWin, anchor, focus,
          { keys, wordAnchor: wordAnchor || target, updatePreferredX: false });
      } else {
        this._setMode(state, 'cursor');
        pdfWin.getSelection().setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        state.visualCursor = { textNode: anchor.node, offset: anchor.offset };
        state.selectionParams = null;
        this._updateVisualCursor(state, pdfWin);
      }
    } catch (e) {
      Zotero.debug('[ZoteroVim] Flash select: ' + e);
    }
  },

  _closeReaderFlash(state, restore = true) {
    const ui = state._readerFlash;
    if (!ui) return;
    const current = restore && this._readerFlashCurrent(state);
    state._readerFlash = null;
    try { if (ui.frame != null) ui.pdfWin.cancelAnimationFrame(ui.frame); } catch (_) {}
    try { ui.win?.removeEventListener('deactivate', ui.deactivate); } catch (_) {}
    try { ui.doc.removeEventListener('pointerdown', ui.pointerdown, true); } catch (_) {}
    if (ui.preview) {
      try { ui.previewRegistry?.delete('zv-flash-selection'); } catch (_) {}
      try { ui.doc.documentElement.removeAttribute('data-zv-flash-preview'); } catch (_) {}
      try { ui.preview.remove(); } catch (_) {}
    }
    try { ui.panel.remove(); } catch (_) {}
    for (const badge of ui.badges) {
      try { badge.el.remove(); } catch (_) {}
    }
    if (!current) return;
    try {
      ui.pdfWin.focus();
      const range = ui.selection;
      if (ui.ordered && this._orderedReaderVisual(state, ui.pdfWin) === ui.ordered) {
        this._paintOrderedReaderVisual(ui.pdfWin, ui.ordered);
      } else if (!ui.ordered && range?.anchor.isConnected && range.focus?.isConnected) {
        ui.pdfWin.getSelection()?.setBaseAndExtent?.(
          range.anchor, range.anchorOffset, range.focus, range.focusOffset);
      }
    } catch (_) {}
  },
});

/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */

/**
 * Zotero Vim Plus — reader-side methods: outline explorer, visual /
 * cursor mode, annotations. Loaded by bootstrap.js after zoteroVim.js;
 * every method here is merged onto the ZoteroVim object.
 */

Object.assign(ZoteroVim, {
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
        await reader?._internalReader?.navigate?.(payload);
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
      } else if (granularity === 'character') {
        // Deterministic char movement over reading-ordered text nodes
        // (column-aware), same as visual _extendByChar.
        const doc = pdfWin.document;
        const sel = pdfWin.getSelection();
        if (!sel) return;
        const nodes = this._cursorOrderedTextNodes(doc);
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
      const target = this._lineMoveTarget(doc, sel.focusNode, sel.focusOffset, direction, state.cursorPreferredX);
      if (!target) return false;
      if (target.staleX) state.cursorPreferredX = null;
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

  /**
   * Detect text columns of the visible page via an x-coverage histogram:
   * column bodies cover their x-range on almost every line, while gutters
   * are covered only by occasional centred elements (captions, running
   * headers) — so a deep histogram valley marks the gutter.  Full-width
   * spans are excluded first (they would fill every bucket and hide the
   * valley).  Returns [{ left, right, count }] sorted by left;
   * single-column pages return one column.  Recurses once per side for
   * three-column layouts.
   */
  _detectColumns(doc) {
    const container =
      doc.getElementById('viewerContainer') ||
      doc.querySelector('.pdfViewer') || doc.body;
    const viewH = container.clientHeight;
    // Lookahead window shared with _cursorVisibleLines: adjacent pages feed
    // the histogram so column detection and line grouping see the same set
    // of pages.
    const winPad = Math.max(40, viewH * 0.25);

    const spans = [];
    let pageW = 0;
    const pages = doc.querySelectorAll('.page');
    if (pages.length > 0) {
      for (const page of pages) {
        const pr = page.getBoundingClientRect();
        if (pr.bottom < -winPad || pr.top > viewH + winPad) continue;
        pageW = Math.max(pageW, pr.width);
        for (const span of page.querySelectorAll('.textLayer span')) {
          const tn = span.firstChild;
          if (!tn || tn.nodeType !== 3 || !tn.data || !tn.data.trim()) continue;
          const r = span.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          spans.push(r);
        }
      }
    } else {
      for (const span of doc.querySelectorAll('.textLayer span')) {
        const tn = span.firstChild;
        if (!tn || tn.nodeType !== 3 || !tn.data || !tn.data.trim()) continue;
        const r = span.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.bottom < -winPad || r.top > viewH + winPad) continue;
        spans.push(r);
      }
    }
    if (spans.length < 4) return [];

    const filtered = pageW > 0 ? spans.filter(r => r.width <= 0.6 * pageW) : spans;
    if (filtered.length < 4) return [];

    const splitX = this._histogramSplit(filtered);
    if (splitX === null) return [this._columnFromSpans(filtered)];

    const parts = [
      filtered.filter(r => (r.left + r.right) / 2 < splitX),
      filtered.filter(r => (r.left + r.right) / 2 >= splitX),
    ].filter(g => g.length >= 3);
    if (!parts.length) return [this._columnFromSpans(filtered)];

    const cols = [];
    for (const g of parts) {
      const sub = this._histogramSplit(g);
      if (sub !== null && g.length >= 12) {
        const subParts = [
          g.filter(r => (r.left + r.right) / 2 < sub),
          g.filter(r => (r.left + r.right) / 2 >= sub),
        ].filter(sg => sg.length >= 3);
        if (subParts.length >= 2) {
          for (const sg of subParts) cols.push(this._columnFromSpans(sg));
          continue;
        }
      }
      cols.push(this._columnFromSpans(g));
    }
    cols.sort((a, b) => a.left - b.left);
    return cols;
  },

  _columnFromSpans(spans) {
    let left = Infinity, right = -Infinity;
    for (const r of spans) {
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    return { left, right, count: spans.length };
  },

  /**
   * Find a column-gutter x via the coverage histogram: return the x of the
   * deepest local minimum in the middle 70% of the span width, or null when
   * no minimum is deep enough (single column).
   */
  _histogramSplit(spans) {
    let xMin = Infinity, xMax = -Infinity;
    for (const r of spans) {
      xMin = Math.min(xMin, r.left);
      xMax = Math.max(xMax, r.right);
    }
    const width = xMax - xMin;
    if (width < 60) return null;

    const buckets = Math.max(24, Math.min(120, Math.round(width / 8)));
    const cov = new Array(buckets).fill(0);
    for (const r of spans) {
      const b0 = Math.max(0, Math.floor((r.left - xMin) / width * (buckets - 1)));
      const b1 = Math.min(buckets - 1, Math.floor((r.right - xMin) / width * (buckets - 1)));
      for (let b = b0; b <= b1; b++) cov[b]++;
    }

    const sm = new Array(buckets).fill(0);
    for (let b = 0; b < buckets; b++) {
      sm[b] = (b > 0 ? cov[b - 1] : 0) + cov[b] + (b < buckets - 1 ? cov[b + 1] : 0);
    }

    let maxC = 0;
    for (const v of sm) maxC = Math.max(maxC, v);

    let valley = -1, valleyVal = Infinity;
    for (let b = 1; b < buckets - 1; b++) {
      const frac = (b + 0.5) / buckets;
      if (frac < 0.15 || frac > 0.85) continue;
      if (sm[b] <= sm[b - 1] && sm[b] <= sm[b + 1] && sm[b] < valleyVal) {
        valleyVal = sm[b];
        valley = b;
      }
    }
    if (valley < 0 || valleyVal > 0.35 * maxC) return null;
    return xMin + (valley + 0.5) / buckets * width;
  },

  /**
   * Column index a rect belongs to: the column with the largest x-overlap,
   * or the nearest column centre when nothing overlaps.  0 on single-column
   * pages.
   */
  _spanColIndex(rect, columns) {
    if (!columns || columns.length <= 1) return 0;
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.right)) return 0;
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      const ov = Math.min(rect.right, c.right) - Math.max(rect.left, c.left);
      const score = ov > 0
        ? ov / Math.max(1, rect.right - rect.left)
        : -(Math.abs((rect.left + rect.right) / 2 - (c.left + c.right) / 2));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  },

  /** Page index per span via its .textLayer position in document order. */
  _readingOrderKeys(doc) {
    const columns = this._detectColumns(doc);
    const layers = Array.from(doc.querySelectorAll('.textLayer'));
    const layerIdx = new Map();
    for (let i = 0; i < layers.length; i++) layerIdx.set(layers[i], i);
    return { columns, layerIdx };
  },

  /**
   * Reading-order comparator: page, then column, then line top, then left.
   * Column-major within a page (one column is read top-to-bottom before the
   * next) and page-major across pages (page rects never overlap in y, so
   * pages must come first).
   */
  _compareReadingOrder(a, b) {
    if (a.pageIdx !== b.pageIdx) return a.pageIdx - b.pageIdx;
    if (a.colIdx !== b.colIdx) return a.colIdx - b.colIdx;
    const dy = a.rect.top - b.rect.top;
    return Math.abs(dy) > 4 ? dy : a.rect.left - b.rect.left;
  },

  /** Sort span elements into reading order; returns [{ span, rect, pageIdx, colIdx }]. */
  _orderSpanItems(doc, spans, keys = null) {
    const k = keys || this._readingOrderKeys(doc);
    const items = spans.map(span => {
      const rect = span.getBoundingClientRect();
      return {
        span,
        rect,
        pageIdx: k.layerIdx.get(span.closest('.textLayer')) ?? 0,
        colIdx: this._spanColIndex(rect, k.columns),
      };
    });
    items.sort((a, b) => this._compareReadingOrder(a, b));
    return items;
  },

  /**
   * Visible text lines in reading order, split by page, column and y-band
   * (multi-column layouts get one line entry per column band instead of one
   * giant band spanning both columns).
   *
   * Visibility uses the same page-window test as _detectColumns, so column
   * detection and line grouping always see the same set of spans.  On
   * multi-column pages, header/footer decorations (full-width lines and
   * narrow gutter lines that overlap no column) are excluded from the list
   * entirely — they are not part of the column flow, and landing a caret on
   * them stalls j/k.  The y-band tolerance adapts to the median span height
   * instead of a fixed 4 px.
   *
   * Returns { lines, lineH } where lineH is the median visible body-line
   * height (informational for callers).
   */
  _cursorVisibleLines(doc) {
    const container =
      doc.getElementById('viewerContainer') ||
      doc.querySelector('.pdfViewer') || doc.body;
    const viewH = container.clientHeight;
    // Lookahead window shared with _detectColumns: adjacent pages must be in
    // the line list so j/k can continue across page boundaries (the auto-pan
    // then scrolls the target into view).
    const winPad = Math.max(40, viewH * 0.25);

    const spans = [];
    const pages = doc.querySelectorAll('.page');
    if (pages.length > 0) {
      for (const page of pages) {
        const pr = page.getBoundingClientRect();
        if (pr.bottom < -winPad || pr.top > viewH + winPad) continue;
        for (const span of page.querySelectorAll('.textLayer span')) {
          const tn = span.firstChild;
          if (!tn || tn.nodeType !== 3 || !span.textContent.trim()) continue;
          spans.push(span);
        }
      }
    } else {
      for (const span of doc.querySelectorAll('.textLayer span')) {
        const tn = span.firstChild;
        if (!tn || tn.nodeType !== 3 || !span.textContent.trim()) continue;
        const r = span.getBoundingClientRect();
        if (r.bottom < -winPad || r.top > viewH + winPad) continue;
        spans.push(span);
      }
    }

    // One reading-order pass for both the line list and the decoration
    // filter (avoids re-running the column histogram).
    const keys = this._readingOrderKeys(doc);
    const multiCol = keys.columns.length >= 2;

    // Widest visible page — the full-width test uses the same 0.6 ratio as
    // _detectColumns' histogram filter.
    let maxPageW = 0;
    for (const page of pages) {
      const pr = page.getBoundingClientRect();
      if (pr.bottom < -winPad || pr.top > viewH + winPad) continue;
      maxPageW = Math.max(maxPageW, pr.width);
    }

    /**
     * Header/footer lines on multi-column pages: full-width spans (running
     * heads, titles) and narrow gutter decorations with no x-overlap with
     * any column (page numbers).  Both stall j/k when a caret lands on
     * them, so they stay out of the line list.
     */
    const isDecoration = (it) => {
      if (maxPageW > 0 && it.rect.width > 0.6 * maxPageW) return true;
      if (it.rect.width < 0.5 * maxPageW) {
        let overlap = 0;
        for (const c of keys.columns) {
          overlap = Math.max(overlap,
            Math.min(it.rect.right, c.right) - Math.max(it.rect.left, c.left));
        }
        if (overlap <= 2) return true;
      }
      return false;
    };

    const items = this._orderSpanItems(doc, spans, keys).filter(it =>
      it.rect.width >= 2 && it.rect.height >= 2
      && !(multiCol && isDecoration(it)));

    // Adaptive y-band tolerance: half the median span height, clamped to
    // [2, 10] px — adjacent visual lines are ~1 line height apart, while
    // spans of the same line cluster far closer than that.
    let lineH = 10;
    if (items.length) {
      const hs = items.map(it => it.rect.height).sort((a, b) => a - b);
      lineH = hs[Math.floor(hs.length / 2)];
    }
    const bandTol = Math.max(2, Math.min(10, lineH * 0.5));

    const lines = [];
    for (const it of items) {
      const midY = (it.rect.top + it.rect.bottom) / 2;
      const last = lines[lines.length - 1];
      if (!last || last.pageIdx !== it.pageIdx || last.colIdx !== it.colIdx ||
          Math.abs(last.midY - midY) > bandTol) {
        lines.push({
          midY,
          top: it.rect.top,
          bottom: it.rect.bottom,
          spans: [it],
          colIdx: it.colIdx,
          pageIdx: it.pageIdx,
          colLeft: it.rect.left,
          colRight: it.rect.right,
        });
      } else {
        last.spans.push(it);
        last.top = Math.min(last.top, it.rect.top);
        last.bottom = Math.max(last.bottom, it.rect.bottom);
        last.colLeft = Math.min(last.colLeft, it.rect.left);
        last.colRight = Math.max(last.colRight, it.rect.right);
      }
    }
    return { lines, lineH };
  },

  /**
   * Index of the line containing (focusY, focusX): strict band+column match
   * first, then band-only, then nearest midY.  Column containment keeps j/k
   * inside the current column on multi-column pages.
   */
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

  /**
   * Compute the next caret target for a line move (j/k) in reading order:
   * lines are sorted page → column → y, so index ±1 stays inside the
   * column, wraps to the next column's first line (previous column's last
   * line) at column ends on the same page — like flowed text — and crosses
   * page boundaries into the next page's first column.  Header/footer
   * decorations are excluded from the line list by _cursorVisibleLines, so
   * a caret can never land on them and stall there.  The move only stops at
   * the true beginning/end of the line list.
   *
   * Returns { node, offset, stopped, staleX }:
   *   node/offset — target caret position (node is null when stopped)
   *   stopped     — 'end' / 'top' when the document boundary was hit
   *   staleX      — true when preferredX belonged to another column and was
   *                 ignored (callers should reset their preferredX)
   */
  _lineMoveTarget(doc, focusNode, focusOffset, direction, preferredX = null) {
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
    const { lines } = this._cursorVisibleLines(doc);
    if (!lines.length) return null;

    const curLineIdx = this._currentLineIndex(lines, focusY, charX);
    if (curLineIdx < 0) return null;
    const curLine = lines[curLineIdx];

    // Stale preferredX check: an x captured in another column lies outside
    // the current line's own x-extent — re-anchor on the focus character.
    let selX = charX;
    let staleX = false;
    if (Number.isFinite(preferredX)) {
      if (preferredX >= curLine.colLeft - 8 && preferredX <= curLine.colRight + 8) {
        selX = preferredX;
      } else {
        staleX = true;
      }
    }

    // Reading-order step: index ±1.  At a column end this lands on the next
    // column's first line of the same page (lines are grouped per page and
    // column); after the last column of a page it lands on the next page's
    // first body line — headers are already excluded from the list.
    const targetIdx = curLineIdx + (direction > 0 ? 1 : -1);
    if (targetIdx < 0 || targetIdx >= lines.length) {
      return { node: null, offset: 0, stopped: direction > 0 ? 'end' : 'top', staleX };
    }

    const targetLine = lines[targetIdx];

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
    if (!node) return { node: null, offset: 0, stopped: null, staleX };

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

    return { node: targetNode, offset: targetOffset, stopped: null, staleX };
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
      spans.push(span);
    }
    const items = this._orderSpanItems(doc, spans).filter(it =>
      it.rect.width >= 2 && it.rect.height >= 2);
    return items.map(it => it.span.firstChild).filter(Boolean);
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
    const focusX = (focusRect.left + focusRect.right) / 2;
    const { lines } = this._cursorVisibleLines(doc);
    if (!lines.length) return null;

    // Line lookup is column-aware: 0/$ stay inside the current column.
    const curLineIdx = this._currentLineIndex(lines, focusY, focusX);
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
   * Hint label generator: uppercase, prefix-free labels in home-row-first
   * order.  count ≤ 26 → single letters; more → uniform two-letter labels
   * (26² = 676).  With `reserved` set (fine stage), the first label is the
   * reserved one and all following labels avoid its first character, so
   * typing the reserved label is always an exact, unambiguous match.
   */
  _hintAlphabet() {
    return 'ASDFJKLGHQWERTYUIOPZXCVBNM';
  },

  _hintLabelList(count, reserved = null) {
    const alphabet = this._hintAlphabet();
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
    const starts = this._findSentenceStarts(pdfWin);
    if (!starts.length) {
      this._placeCursorAtFirstText(state, pdfWin);
      return;
    }
    const labels = this._hintLabelList(starts.length);
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
  _createHintBadge(doc, label, textNode, offset) {
    let badgeLeft, badgeTop, badgeHeight;
    try {
      const r = doc.createRange();
      r.setStart(textNode, offset);
      r.setEnd(textNode, Math.min(offset + 1, textNode.length));
      const rects = r.getClientRects();
      if (rects.length > 0) {
        badgeLeft = rects[0].left;
        badgeTop = rects[0].top;
        badgeHeight = rects[0].height;
      }
    } catch (_) {}
    if (badgeLeft === undefined) {
      const pr = textNode.parentElement?.getBoundingClientRect?.();
      if (!pr) return null;
      badgeLeft = pr.left;
      badgeTop = pr.top;
      badgeHeight = pr.height;
    }

    const badge = doc.createElement('div');
    badge.setAttribute('data-zv-hint', label);
    const prefix = doc.createElement('span');
    prefix.setAttribute('data-zv-hint-part', 'prefix');
    prefix.textContent = '';
    prefix.style.cssText = 'color:#8f7d1c;';
    const rest = doc.createElement('span');
    rest.setAttribute('data-zv-hint-part', 'rest');
    rest.textContent = label;
    rest.style.cssText = 'color:#000;font-weight:bold;';
    badge.appendChild(prefix);
    badge.appendChild(rest);
    badge.style.cssText =
      'position:fixed;' +
      'left:' + Math.max(0, Math.round(badgeLeft) - 2) + 'px;' +
      'top:' + Math.round(badgeTop) + 'px;' +
      'background:#FFD400;' +
      'font:bold 11px/1.4 monospace;' +
      'padding:0 3px;border-radius:2px;' +
      'z-index:99999;pointer-events:none;' +
      'border:1px solid #b8960c;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.4);';
    doc.body.appendChild(badge);
    return {
      label,
      textNode,
      offset,
      el: badge,
      prefixEl: prefix,
      restEl: rest,
      left: badgeLeft,
      top: badgeTop,
      height: badgeHeight || 12,
    };
  },

  /**
   * Position every badge at the top-left of its character.  Only badges that
   * truly overlap (same visual line AND horizontal intersection) are nudged
   * down, and the cascade resets on every line, so badges stay glued to
   * their words.  Layout covers ALL badges — positions must never depend on
   * which badges are currently visible, otherwise filtering would make the
   * remaining badges drift.
   */
  _layoutHintBadges(doc, badges) {
    let lineTop = null;
    let prevRight = -Infinity;
    let prevBottom = -Infinity;
    for (const b of badges) {
      let { left, top, height } = b;
      try {
        const r = doc.createRange();
        r.setStart(b.textNode, b.offset);
        r.setEnd(b.textNode, Math.min(b.offset + 1, b.textNode.length));
        const rects = r.getClientRects();
        if (rects.length > 0) {
          left = rects[0].left;
          top = rects[0].top;
          height = rects[0].height;
        }
      } catch (_) {}
      const badgeH = Math.max(16, height + 6);
      const badgeW = Math.max(12, b.label.length * 7 + 8);
      if (lineTop === null || Math.abs(top - lineTop) > 6) {
        lineTop = top;
        prevRight = -Infinity;
        prevBottom = -Infinity;
      }
      if (left < prevRight && top < prevBottom) {
        top = prevBottom + 2;
      }
      b.el.style.left = Math.max(0, Math.round(left) - 2) + 'px';
      b.el.style.top = Math.round(top) + 'px';
      prevRight = Math.max(prevRight, left + badgeW);
      prevBottom = Math.max(prevBottom, top + badgeH);
    }
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
  _findSentenceStarts(pdfWin) {
    const doc = pdfWin.document;
    const container =
      doc.getElementById('viewerContainer') ||
      doc.querySelector('.pdfViewer') || doc.body;
    const viewH = container.clientHeight;

    // Collect visible, non-empty text spans in reading order (page, column,
    // line, left) so the span-to-span rules below never cross columns.
    const items = this._orderSpanItems(
      doc,
      Array.from(doc.querySelectorAll('.textLayer span')).filter(s =>
        s.textContent.trim() && s.firstChild?.nodeType === 3
      )
    );
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

    const words = this._findWordStartsInSentence(pdfWin, coarseBadge, next);
    if (!words.length) {
      this._clearVisualHints(state, pdfWin);
      return;
    }
    const labels = this._hintLabelList(words.length, coarseBadge.label);
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
  _findWordStartsInSentence(pdfWin, coarseBadge, nextStart) {
    const doc = pdfWin.document;
    const keys = this._readingOrderKeys(doc);
    const nodes = this._cursorOrderedTextNodes(doc);
    const startIdx = this._cursorNodeIndex(nodes, coarseBadge.textNode);
    if (startIdx < 0) {
      return [{ textNode: coarseBadge.textNode, offset: coarseBadge.offset }];
    }

    // Column of the sentence start, for stopping open-ended ranges at the
    // column boundary.
    const coarseColIdx = this._spanColIndex(
      coarseBadge.textNode.parentElement?.getBoundingClientRect?.() || null,
      keys.columns
    );

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
        const colIdx = this._spanColIndex(elRect, keys.columns);
        if (colIdx !== coarseColIdx) {
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
      if (!target) return;
      if (target.staleX) state.visualPreferredX = null;
      if (target.stopped) {
        this._showStatus(state, direction > 0 ? '→ document end' : '→ document top', 900);
        return;
      }
      if (!target.node) return;

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

      // Collect and sort visible text spans in reading order (page, column,
      // line, left) so paragraph gaps never cross columns.
      const spans = Array.from(doc.querySelectorAll('.textLayer span')).filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 4 && r.height > 3 && s.textContent.trim() && s.firstChild?.nodeType === 3;
      });
      const ordered = this._orderSpanItems(doc, spans);
      const spanList = ordered.map(it => it.span);
      if (spanList.length === 0) return;

      // Find which span contains the selection focus.
      const focusNode = sel.focusNode;
      const focusEl   = focusNode?.nodeType === 3 ? focusNode.parentElement : focusNode;
      let focusIdx    = spanList.findIndex(s => s === focusEl || s.contains(focusEl));
      if (focusIdx < 0) focusIdx = direction > 0 ? 0 : spanList.length - 1;

      // Line height for gap threshold.
      const fr          = spanList[focusIdx].getBoundingClientRect();
      const lineH       = Math.max(fr.height, 8);
      const gapThreshold = lineH * 0.5;

      // Build paragraph boundary set: index i means gap between spans[i] and spans[i+1].
      const boundaries = [];
      for (let i = 0; i < spanList.length - 1; i++) {
        const r1 = spanList[i].getBoundingClientRect();
        const r2 = spanList[i + 1].getBoundingClientRect();
        if (r2.top - r1.bottom > gapThreshold) boundaries.push(i);
      }

      let targetNode = null, targetOffset = 0;

      if (direction > 0) {
        // Forward: find first boundary index >= focusIdx.
        const bIdx = boundaries.find(b => b >= focusIdx);
        const lastSpan = bIdx !== undefined ? spanList[bIdx] : spanList[spanList.length - 1];
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

        const tn = spanList[startIdx].firstChild;
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
      // (one .textLayer per PDF page — querySelectorAll returns them all),
      // in reading order: page, column, line, left.
      const items = this._orderSpanItems(doc, Array.from(doc.querySelectorAll('.textLayer span')));
      const textNodes = [];
      for (const it of items) {
        const tn = it.span.firstChild;
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

  _clearSearch(reader, pdfWin) {
    // Close the find popup via the reader app (deactivates the search and
    // clears highlights, matching Zotero's own Escape semantics).  Do NOT
    // re-dispatch an Escape keydown into the PDF.js document — the plugin's
    // own capture listener would process it again (normal:escape →
    // clearSearch), causing unbounded recursion.
    try {
      const ir = reader?._internalReader;
      if (typeof ir?.toggleFindPopup === 'function') {
        ir.toggleFindPopup(Cu.cloneInto({ open: false }, reader._iframeWindow));
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

      this._navigateToAnnotationKey(state, reader, target);
    } catch (e) {
      Zotero.debug('[ZoteroVim] _navigateAnnotation error: ' + e);
      this._showStatus(state, '✗ nav: ' + String(e).slice(0, 30), 4000);
    }
  },

  /**
   * Navigate to an annotation by key: smooth-scroll the PDF and select it.
   * Shared by annotation navigation ([ / ]) and persisted mark jumps.
   *
   * _internalReader lives in a different JS compartment (reader.html iframe);
   * arrays/objects passed as arguments must be cloned into that compartment
   * with Cu.cloneInto() — otherwise the security wrapper blocks property
   * access and the calls silently fail or throw "Permission denied".
   */
  _navigateToAnnotationKey(state, reader, target) {
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
  async _jumpMark(state, reader, pdfWin, char) {
    try {
      const mark = state.marks[char];
      if (!mark) {
        this._showStatus(state, '✗ mark ' + char + ' not set', 2000);
        return;
      }
      let pageIndex = mark.pageIndex;
      let ratio = mark.ratio;
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
        if (pageIndex === null && target) {
          const pos = await this._annotationPageRatio(pdfWin, target);
          pageIndex = pos.pageIndex;
          ratio = pos.ratio;
        }
      }
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
    } catch (e) {
      Zotero.debug('[ZoteroVim] _jumpMark error: ' + e);
      this._showStatus(state, '✗ mark: ' + String(e).slice(0, 35), 3000);
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
      'background:rgba(24,24,37,0.96);color:#cdd6f4;border-right:1px solid #313244;' +
      'display:flex;flex-direction:column;box-shadow:12px 0 40px rgba(0,0,0,0.35);' +
      'font:13px/1.35 monospace;';

    const header = h('div');
    header.style.cssText =
      'padding:12px 14px;border-bottom:1px solid #313244;font-weight:bold;letter-spacing:0.04em;';
    header.textContent = 'Marks';

    const list = h('div');
    list.style.cssText = 'flex:1;overflow:auto;padding:8px 0;';

    const status = h('div');
    status.style.cssText =
      'padding:6px 12px;border-top:1px solid #313244;color:#6c7086;font-size:11px;';
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
      empty.style.cssText = 'padding:10px 14px;color:#6c7086;';
      empty.textContent = 'No marks — press m<x> in Normal mode to set one';
      list.appendChild(empty);
      return 0;
    }
    chars.forEach((char, idx) => {
      const mark = state.marks[char];
      const row = doc.createElementNS(H, 'div');
      row.style.cssText = 'padding:6px 14px;cursor:pointer;white-space:nowrap;';
      if (idx === state.marksExplorerSelected) {
        row.style.background = 'rgba(138,173,244,0.22)';
        row.style.color = '#a6d189';
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
    this._enterAnnotationInsertMode(state, reader, opts);
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
      'width:min(560px,92%);z-index:99998;background:rgba(24,24,37,0.97);' +
      'color:#cdd6f4;border:1px solid #313244;border-radius:8px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.45);display:flex;flex-direction:column;' +
      'font:13px/1.4 sans-serif;';

    if (quotedText) {
      const quote = h('div');
      quote.style.cssText =
        'padding:8px 12px;color:#6c7086;font-size:12px;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis;';
      quote.textContent = quotedText;
      overlay.appendChild(quote);
    }

    const ta = h('textarea');
    ta.id = 'zv-annotation-comment-input';
    ta.value = commentText || '';
    ta.style.cssText =
      'width:100%;box-sizing:border-box;min-height:72px;max-height:220px;' +
      'padding:10px 12px;background:transparent;color:#cdd6f4;border:0;' +
      'outline:none;resize:none;font:13px/1.5 sans-serif;';
    ta.setAttribute('spellcheck', 'false');
    overlay.appendChild(ta);

    const hint = h('div');
    hint.style.cssText =
      'padding:5px 12px;border-top:1px solid #313244;color:#6c7086;font-size:11px;';
    hint.textContent = 'Enter 换行 · Esc 保存并关闭';
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
          item.saveTx();
          try { zvLogFile('[ZoteroVim] autosave key=' + key); } catch (_) {}
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

    const key = this._selectedAnnotationKey(state, reader);
    if (!key) {
      this._showStatus(state, '✗ navigate first with [ / ]', 2000);
      return;
    }
    state.lastAnnotationKey = key;

    // Resolve the annotation item via the attachment's child list — a bare
    // key passed to Zotero.Items.get() returns false (IDs only), which left
    // the overlay permanently empty.
    const item = await this._resolveAnnotationItem(reader, key);
    state._commentItemID = item?.id || null;
    state._commentLibraryID = item?.libraryID || null;
    if (!item) {
      try { zvLogFile('[ZoteroVim] insert: annotation item not resolved key=' + key); } catch (_) {}
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

    const pdfWin = this._activeReaderPdfWin?.(reader) || state.activePdfWin || state.pdfWin;
    this._createAnnotationCommentOverlay(state, pdfWin, key, commentText, quotedText);
    const ta = state._commentOverlayInput;
    this._armAnnotationPopupGuard(state, reader);

    const initialDelayMs = Math.max(0, Number(opts?.initialDelayMs || 60));
    const holdMs = Math.max(100, Number(opts?.holdMs || 500));
    const mySession = (state._insertSessionID = (state._insertSessionID || 0) + 1);

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
      if (attempt % 10 === 0) {
        try {
          zvLogFile('[ZoteroVim] insert: watch ' + attempt + ' key=' + key
            + ' overlay=' + !!state._commentOverlay
            + ' focused=' + (doc?.activeElement === input));
        } catch (_) {}
      }
      state.insertWatchdog = setTimeout(() => tryKeep(attempt + 1), holdMs);
    };

    state.insertWatchdog = null;
    setTimeout(() => {
      try { ta?.focus(); } catch (_) {}
      try {
        const len = ta?.value?.length || 0;
        if (ta) { ta.selectionStart = len; ta.selectionEnd = len; }
      } catch (_) {}
      if (state.mode !== 'insert') this._setMode(state, 'insert');
      this._showStatus(state, '-- INSERT --  Esc 保存', 2000);
      tryKeep(0);
    }, initialDelayMs);
  },
  _enterInsertForAnnotation(state, reader, annotationKey) {
    try {
      state.lastAnnotationKey = annotationKey;
      if (state.mode !== 'insert') this._setMode(state, 'insert');
      this._enterAnnotationInsertMode(state, reader, { initialDelayMs: 150 });
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

      // Collect and sort visible .textLayer spans in reading order (same as
      // _extendByParagraph), so paragraph gaps never cross columns.
      const spans = Array.from(doc.querySelectorAll('.textLayer span')).filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 4 && r.height > 3 && s.textContent.trim() && s.firstChild?.nodeType === 3;
      });
      const spanList = this._orderSpanItems(doc, spans).map(it => it.span);
      if (spanList.length === 0) { this._showStatus(state, '✗ no text', 2000); return; }

      let focusIdx = spanList.findIndex(s => s === focusEl || s.contains(focusEl));
      if (focusIdx < 0) focusIdx = 0;

      const lineH       = Math.max(spanList[focusIdx].getBoundingClientRect().height, 8);
      const gapThreshold = lineH * 0.5;

      // Walk backward to find paragraph start.
      let paraStart = 0;
      for (let i = focusIdx; i > 0; i--) {
        const r1 = spanList[i - 1].getBoundingClientRect();
        const r2 = spanList[i].getBoundingClientRect();
        if (r2.top - r1.bottom > gapThreshold) { paraStart = i; break; }
      }

      // Walk forward to find paragraph end.
      let paraEnd = spanList.length - 1;
      for (let i = focusIdx + 1; i < spanList.length; i++) {
        const r1 = spanList[i - 1].getBoundingClientRect();
        const r2 = spanList[i].getBoundingClientRect();
        if (r2.top - r1.bottom > gapThreshold) { paraEnd = i - 1; break; }
      }

      // Concatenate span text and normalise.
      const parts = [];
      for (let i = paraStart; i <= paraEnd; i++) parts.push(spanList[i].textContent);
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

});

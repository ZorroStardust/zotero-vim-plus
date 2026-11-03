/* global Zotero, ZoteroVim */
/* eslint-disable no-unused-vars */

/** Native library search controls. No reader or note search state is shared here. */
Object.assign(ZoteroVim, {
  // ── Native controls and focus ─────────────────────────────────────────────

  _librarySearchControls(win) {
    const doc = win.document;
    const host = doc.getElementById('zotero-tb-search');
    const items = host?.searchTextbox || doc.getElementById('zotero-tb-search-textbox')
      || doc.getElementById('zotero-tb-search-input')
      || host?.querySelector('input, search-textbox, textbox')
      || (host?.inputField ? host : null);
    return { host, items, collections: doc.getElementById('zotero-collections-search') };
  },

  /** Follow open shadow roots; querySelector on the outer document cannot reach these inputs. */
  _librarySearchInput(field) {
    return field?.inputField || field?.shadowRoot?.querySelector('input')
      || field?.querySelector?.('input') || field;
  },

  _librarySearchContains(root, node) {
    for (let depth = 0; node && depth < 15; depth++) {
      if (node === root) return true;
      if (root?.contains?.(node)) return true;
      node = node.parentNode || node.host;
    }
    return false;
  },

  _librarySearchHasFocus(win, field) {
    const active = win.document.activeElement;
    return !!field && (this._librarySearchContains(field, active)
      || active === this._librarySearchInput(field));
  },

  _mainOpenSearch(win, state) {
    const panel = this._mainDetectFocusedPanel(win, state, { strict: true });
    if (panel === 'collections') this._mainOpenCollectionSearch(win, state);
    else if (panel === 'items') this._mainOpenItemSearch(win, state);
  },

  _mainOpenItemSearch(win, state) {
    const { host, items } = this._librarySearchControls(win);
    if (!items) {
      this._mainShowStatus(win, 'Search unavailable', 1200);
      return;
    }
    this._beginLibrarySearch(win, state, 'items', items, host);
    const input = this._librarySearchInput(items);
    input.focus();
    input.select?.();
  },

  _mainOpenCollectionSearch(win, state) {
    const { collections } = this._librarySearchControls(win);
    const button = win.document.getElementById('zotero-tb-collections-search');
    if (!collections || !button || !win.ZoteroPane?.collectionsView?.setFilter) {
      // Older Zotero versions have no native collection filter.
      this._openFuzzyPicker(win, state, 'collections');
      return;
    }
    this._beginLibrarySearch(win, state, 'collections', collections);
    // Reveal the native control synchronously. Clicking the native button starts
    // a 250 ms disabled animation whose delayed focus can lose the first letters
    // or steal focus after Enter/Escape. Its normal blur/command handlers still run.
    button.style.display = 'none';
    const width = collections.getAttribute('data-expanded-width');
    if (width) collections.style.maxWidth = width + 'px';
    collections.style.visibility = 'visible';
    collections.classList.add('visible');
    collections.classList.remove('expanding');
    collections.removeAttribute('disabled');
    const input = this._librarySearchInput(collections);
    input.focus();
    input.select?.();
  },

  _beginLibrarySearch(win, state, kind, field, host = null) {
    if (!state) return null;
    this._cancelLibrarySearch(state);
    const session = { kind, field, host, tab: win.Zotero_Tabs?.selectedID,
      view: kind === 'items' ? win.ZoteroPane?.itemsView : win.ZoteroPane?.collectionsView };
    state._librarySearch = session;
    const onFocus = () => {
      if (!this._librarySearchHasFocus(win, host || field)) this._cancelLibrarySearch(state);
    };
    win.document.addEventListener('focusin', onFocus, true);
    session.cleanup = () => win.document.removeEventListener('focusin', onFocus, true);
    return session;
  },

  _cancelLibrarySearch(state) {
    const session = state?._librarySearch;
    if (!session) return;
    session.cleanup?.();
    state._librarySearch = null;
  },

  _librarySearchCurrent(win, state, session) {
    return state._librarySearch === session && !win.closed
      && session.tab === win.Zotero_Tabs?.selectedID
      && session.view === (session.kind === 'items'
        ? win.ZoteroPane?.itemsView : win.ZoteroPane?.collectionsView)
      && this._librarySearchHasFocus(win, session.host || session.field);
  },

  /** Return true for native search/menu ownership, even for ordinary typing. */
  _onLibrarySearchKeyDown(event, win, state) {
    const controls = this._librarySearchControls(win);
    const path = event.composedPath?.() || [event.target];
    // Native mode popup keys must reach Gecko, including Enter/Escape and J/K.
    if (path.some(node => node?.id === 'search-mode-popup'
        || /^(menupopup|menuitem)$/i.test(node?.localName || ''))
        || controls.host?._searchModePopup?.state === 'open'
        || controls.host?._searchModePopup?.state === 'showing') return true;

    const kind = this._librarySearchHasFocus(win, controls.collections) ? 'collections'
      : this._librarySearchHasFocus(win, controls.items) ? 'items' : null;
    if (!kind) {
      // The mode button and its shadow root are not an editable search field.
      return !!controls.host && this._librarySearchHasFocus(win, controls.host);
    }
    const field = controls[kind];
    // Never consume composition confirmation/cancellation or text input.
    if (event.isComposing || event.keyCode === 229) return true;
    const key = String(event.key || '').toLowerCase();
    const cycleMode = kind === 'items' && event.ctrlKey && !event.altKey
      && !event.metaKey && !event.shiftKey && (key === 'h' || key === 'l');
    const finish = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      && (key === 'enter' || key === 'escape');
    if (!cycleMode && !finish) return true;
    event.preventDefault();
    event.stopPropagation();
    // Canceling keydown also suppresses Gecko's native follow-up keypress handler.
    if (finish && event.repeat) return true;
    const session = this._beginLibrarySearch(win, state, kind, field,
      kind === 'items' ? controls.host : null);
    if (cycleMode) this._cycleLibrarySearchMode(win, key === 'h' ? -1 : 1, controls);
    else void this._finishLibrarySearch(win, state, session, key === 'escape');
    return true;
  },

  _cycleLibrarySearchMode(win, direction, { host, items }) {
    try {
      const modes = ['titleCreatorYear', 'fields', 'everything'];
      const current = Zotero.Prefs.get('search.quicksearch-mode');
      const index = Math.max(0, modes.indexOf(current));
      const mode = modes[(index + direction + modes.length) % modes.length];
      if (typeof host?.updateMode === 'function') {
        Zotero.Prefs.set('search.quicksearch-mode', mode);
        host.updateMode();
      } else {
        const menu = host?.searchModePopup
          || win.document.getElementById('zotero-tb-search-menu');
        const item = menu?.querySelector('menuitem[value="' + mode + '"]');
        if (!item?.doCommand) return;
        item.doCommand();
      }
      // Match native search semantics, including deferred quoted queries.
      Promise.resolve(win.ZoteroPane.search()).catch(error => {
        Zotero.debug('[ZoteroVim] library search mode error: ' + error);
      });
      const label = host?._searchModes?.[mode] || this._librarySearchInput(items)?.placeholder
        || mode;
      this._mainShowStatus(win, label + ' · Ctrl+h/l', 1600);
    } catch (error) {
      Zotero.debug('[ZoteroVim] _cycleLibrarySearchMode error: ' + error);
    }
  },

  /** Flush native debounce before returning focus; stale completions never refocus a new tab. */
  async _finishLibrarySearch(win, state, session, clear) {
    if (!session) return;
    try {
      const { field, kind, view } = session;
      const query = clear ? '' : field.value;
      // The native value setter cancels its pending debounce timer and updates
      // the clear icon. This prevents a second reload after our immediate search.
      field.value = query;
      if (kind === 'collections') {
        await view.setFilter(query);
        if (!this._librarySearchCurrent(win, state, session) || field.value !== query) return;
        if (query && view.focusedRowMatchesFilter && !view.focusedRowMatchesFilter()
            && view.getRow && view._matchesFilter) {
          // setFilter expands matching descendants. Select through the native API,
          // but defer focus until selection finishes so a tab change can cancel it.
          for (let index = 0; index < view.rowCount; index++) {
            const row = view.getRow(index);
            if (!row || ['separator', 'header'].includes(row.type)
                || !view._matchesFilter(row.ref).matchesFilter) continue;
            if (await view.selectByID(row.id)) break;
            if (!this._librarySearchCurrent(win, state, session)) return;
          }
          if (!this._librarySearchCurrent(win, state, session) || field.value !== query) return;
        }
      } else {
        await win.ZoteroPane.search(true);
        if (!this._librarySearchCurrent(win, state, session) || field.value !== query) return;
      }
      this._cancelLibrarySearch(state);
      this._mainFocusPanel(win, state, kind);
      if (kind === 'collections') win.ZoteroPane.hideCollectionSearch?.();
    } catch (error) {
      Zotero.debug('[ZoteroVim] _finishLibrarySearch error: ' + error);
    }
  },

  /** Native filtered navigation skips dim ancestor/context rows and honors Vim counts. */
  _mainNavigateFilteredCollections(win, state, view, direction, count) {
    if (!view._isFilterEmpty || view._isFilterEmpty()
        || !view.focusNextMatchingRow) return false;
    const tab = win.Zotero_Tabs?.selectedID;
    const run = async () => {
      if (direction === 'first') await view.focusFirstMatchingRow(true);
      else if (direction === 'last') await view.focusLastMatchingRow();
      else {
        for (let i = 0; i < Math.max(1, count || 1); i++) {
          if (win.closed || tab !== win.Zotero_Tabs?.selectedID
              || view !== win.ZoteroPane?.collectionsView
              || this._mainWindowState.get(win) !== state
              || this._mainDetectFocusedPanel(win, state, { strict: true }) !== 'collections') break;
          if (!await view.focusNextMatchingRow(view.selection.focused, direction < 0)) break;
        }
      }
    };
    // Selection APIs are async; queue repeats so held j/k and counts do not race.
    state._collectionFilterNavigation = Promise.resolve(state._collectionFilterNavigation)
      .then(() => {
        if (tab === win.Zotero_Tabs?.selectedID
            && view === win.ZoteroPane?.collectionsView
            && this._mainWindowState.get(win) === state
            && this._mainDetectFocusedPanel(win, state, { strict: true }) === 'collections') {
          return run();
        }
      }).catch(error => Zotero.debug('[ZoteroVim] filtered navigation error: ' + error));
    return true;
  },

  /** Compatibility picker includes collapsed descendants, library names and saved searches. */
  async _buildCollectionPickerItems() {
    const libraries = Zotero.Libraries.getAll();
    const result = [];
    const zh = String(Zotero.locale || '').startsWith('zh');
    for (const library of libraries) {
      const libraryID = library.libraryID;
      const name = library.name || Zotero.getString('pane.collections.library');
      const add = (id, title, path, kind) => {
        result.push({ id, title, path, kind,
          searchStr: [title, path].join(' ').toLowerCase() });
      };
      add('L' + libraryID, name, '', zh ? '文献库' : 'Library');
      const collections = Zotero.Collections.getByLibrary(libraryID, true);
      const byID = new Map(collections.map(collection => [collection.id, collection]));
      for (const collection of collections) {
        const parents = [name];
        const seen = new Set([collection.id]);
        let parent = byID.get(collection.parentID);
        while (parent && !seen.has(parent.id)) {
          seen.add(parent.id);
          parents.splice(1, 0, parent.name);
          parent = byID.get(parent.parentID);
        }
        add('C' + collection.id, collection.name, parents.join(' / '),
          zh ? '分类' : 'Collection');
      }
      const searches = await Zotero.Searches?.getAll(libraryID) || [];
      for (const search of searches) {
        add('S' + search.id, search.name, name, zh ? '保存的搜索' : 'Saved search');
      }
    }
    return result;
  },
});

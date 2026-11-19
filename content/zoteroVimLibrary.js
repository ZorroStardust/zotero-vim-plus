/* global Zotero, ZoteroVim */
/* eslint-disable no-unused-vars */

Object.assign(ZoteroVim, {
  _libraryActions: [
    'mainToggleWorkset', 'mainShowWorkset', 'mainClearWorkset',
    'mainCreateReadingGroup', 'mainAppendReadingGroup', 'mainShowReadingGroups',
    'mainAddWorksetTag', 'mainRemoveWorksetTag', 'mainAddWorksetToCollection',
  ],

  async _runLibraryAction(action, win, state) {
    const zh = this._isZhLocale();
    try {
      switch (action) {
        case 'mainToggleWorkset':
          if (this._mainDetectFocusedPanel(win, state, { strict: true }) === 'items') {
            this._toggleWorkset(win, state);
          }
          return;
        case 'mainShowWorkset': return await this._showWorkset(win, state);
        case 'mainClearWorkset':
          state._libraryWorkset?.clear();
          this._syncWorksetMarkers(win, state);
          this._mainShowStatus(win, zh ? '已清空选择集' : 'Selection set cleared');
          return;
        case 'mainShowReadingGroups': return await this._showReadingGroups(win, state);
      }

      const targets = this._libraryTargets(win, state);
      if (!targets.items.length) {
        this._mainShowStatus(win, zh ? '请先选择有效条目' : 'Select at least one available item');
        return;
      }
      switch (action) {
        case 'mainCreateReadingGroup':
        case 'mainAppendReadingGroup':
          return await this._importReadingGroup(win, state, targets,
            action === 'mainCreateReadingGroup');
        case 'mainAddWorksetTag':
        case 'mainRemoveWorksetTag':
          return await this._editWorksetTag(win, state, targets, action === 'mainAddWorksetTag');
        case 'mainAddWorksetToCollection':
          return await this._chooseWorksetCollection(win, state, targets);
      }
    } catch (e) {
      this._libraryActionError(win, e);
    }
  },

  _libraryActionError(win, error) {
    Zotero.debug('[ZoteroVim] Library action: ' + error);
    this._mainShowStatus(win, this._isZhLocale() ? '操作失败，请查看错误控制台'
      : 'Library action failed. See the Error Console.', 3500);
  },

  _libraryRefID(ref) {
    return ref.libraryID + ':' + ref.key;
  },

  _libraryItemTitle(item) {
    return item.getDisplayTitle?.() || item.getField('title') || item.attachmentFilename || item.key;
  },

  _resolveLibraryRef(ref) {
    const item = Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.key);
    return item && !item.deleted ? item : null;
  },

  _nativeLibraryItems(win) {
    return Array.from(win.ZoteroPane?.getSelectedItems?.() || [])
      .filter(item => !item.deleted && item.key && item.libraryID);
  },

  /** The temporary set survives changes in scope within its main window. */
  _toggleWorkset(win, state) {
    const zh = this._isZhLocale();
    const items = this._nativeLibraryItems(win);
    if (!items.length) {
      this._mainShowStatus(win, zh ? '请先选择条目' : 'Select an item first');
      return;
    }
    const workset = state._libraryWorkset ??= new Map();
    const remove = items.every(item => workset.has(this._libraryRefID(item)));
    for (const item of items) {
      const id = this._libraryRefID(item);
      if (remove) workset.delete(id);
      else workset.set(id, { libraryID: item.libraryID, key: item.key,
        title: this._libraryItemTitle(item) });
    }
    this._syncWorksetMarkers(win, state);
    this._mainShowStatus(win, zh ? '选择集条目数：' + workset.size
      : 'Selection set: ' + workset.size + ' items');
  },

  /** Map visible virtualized rows back to current items on scroll and rerender. */
  _syncWorksetMarkers(win, state) {
    const workset = state._libraryWorkset;
    const doc = win.document;
    const view = win.ZoteroPane?.itemsView;
    const root = workset?.size && (doc.getElementById?.(view?.id || 'item-tree-main-default')
      || doc.getElementById?.('item-tree-main-default'));
    if (state._worksetMarkers && root !== state._worksetMarkers.root) this._clearWorksetMarkers(state);
    if (!root) return;
    if (!state._worksetMarkers) {
      const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
      style.textContent = '.row.zv-workset-member::before {'
        + "content:'';position:absolute;left:2px;top:2px;bottom:2px;width:3px;"
        + 'border-radius:2px;background:var(--zv-theme-accent, #89b4fa);box-shadow:0 0 0 1px var(--zv-theme-border, #33476c);'
        + 'pointer-events:none;z-index:4;}';
      (doc.head || doc.documentElement).appendChild(style);
      const refresh = () => this._syncWorksetMarkers(win, state);
      const observer = win.MutationObserver ? new win.MutationObserver(refresh) : null;
      observer?.observe(root, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['id', 'data-id'] });
      root.addEventListener('scroll', refresh, true);
      state._worksetMarkers = { root, style, observer, refresh };
    }
    const prefix = (root.id || 'item-tree-main-default') + '-row-';
    for (const row of root.querySelectorAll('.row[id]')) {
      if (!row.id.startsWith(prefix)) continue;
      const index = /-row-(\d+)$/.exec(row.id);
      const item = index && view?.getRow?.(Number(index[1]))?.ref;
      const marked = item && !item.deleted && workset.has(this._libraryRefID(item));
      row.classList.toggle('zv-workset-member', Boolean(marked));
    }
  },

  _clearWorksetMarkers(state) {
    const markers = state._worksetMarkers;
    if (!markers) return;
    state._worksetMarkers = null;
    const { root, style, observer, refresh } = markers;
    observer?.disconnect();
    root.removeEventListener('scroll', refresh, true);
    for (const row of root.querySelectorAll('.zv-workset-member')) {
      row.classList.remove('zv-workset-member');
    }
    style.parentNode?.removeChild(style);
  },

  /** Snapshot explicit targets before a picker takes focus or a view changes. */
  _libraryTargets(win, state) {
    const refs = Array.from(state._libraryWorkset?.values() || []);
    if (!refs.length) return { items: this._nativeLibraryItems(win), hidden: 0, missing: 0 };
    const items = refs.map(ref => this._resolveLibraryRef(ref)).filter(Boolean);
    const visible = this._visibleWorksetItems(win);
    return { items, missing: refs.length - items.length,
      hidden: visible ? items.filter(item => !visible.has(item.id)).length : null };
  },

  _visibleWorksetItems(win) {
    const view = win.ZoteroPane?.itemsView;
    if (typeof view?.getRow !== 'function') return null;
    const ids = new Set();
    for (let i = 0; i < view.rowCount; i++) ids.add(view.getRow(i)?.ref?.id);
    return ids;
  },

  _libraryTargetSummary(targets) {
    const zh = this._isZhLocale();
    const parts = [zh ? targets.items.length + ' 个条目' : targets.items.length + ' items'];
    if (targets.hidden) parts.push(zh ? targets.hidden + ' 个不在当前列表'
      : targets.hidden + ' outside the current list');
    if (targets.missing) parts.push(zh ? targets.missing + ' 个已失效'
      : targets.missing + ' unavailable');
    return parts.join(' · ');
  },

  _openLibraryPicker(win, state, placeholder, rows, select, commands, extra = '', initialID = null) {
    const zh = this._isZhLocale();
    const hint = (zh ? 'Ctrl+j/k 导航 · Enter 选择 · Esc 关闭'
      : 'Ctrl+j/k navigate · Enter select · Esc close') + (extra ? ' · ' + extra : '');
    return this._openFuzzyPicker(win, state, 'libraryChoices', {
      placeholder, hint, rows: rows.map(row => ({ ...row,
        searchStr: [row.title, row.kind, row.parent].join(' ').toLowerCase() })),
      select, commands, initialID,
    });
  },

  _showWorkset(win, state) {
    const zh = this._isZhLocale();
    const refs = Array.from(state._libraryWorkset?.values() || []);
    if (!refs.length) {
      this._mainShowStatus(win, zh ? '选择集为空' : 'Selection set is empty');
      return;
    }
    const visible = this._visibleWorksetItems(win);
    const rows = refs.map(ref => {
      const item = this._resolveLibraryRef(ref);
      const kind = !item ? (zh ? '已失效' : 'Unavailable')
        : visible && !visible.has(item.id) ? (zh ? '不在当前列表' : 'Outside current list') : '';
      return { ref, kind, title: item ? this._libraryItemTitle(item) : ref.title };
    });
    return this._openLibraryPicker(win, state, zh ? '搜索选择集…' : 'Search selection set…',
      rows, async ({ ref }) => {
        const item = this._resolveLibraryRef(ref);
        if (item) await win.ZoteroPane.selectItem(item.id);
        else this._mainShowStatus(win, zh ? '条目已失效' : 'Item is unavailable');
      }, {
        delete: ({ ref }) => {
          state._libraryWorkset.delete(this._libraryRefID(ref));
          this._syncWorksetMarkers(win, state);
          return this._showWorkset(win, state);
        },
      }, zh ? 'Delete 移出选择集' : 'Delete removes from selection set');
  },

  /** Keep unknown or damaged preference data intact. Each write starts from current prefs. */
  _readReadingGroups() {
    const raw = this.getPref('library.readingGroups', '');
    if (!raw) return [];
    const data = JSON.parse(raw);
    const validMember = member => Number.isInteger(member?.libraryID) && member.libraryID > 0
      && typeof member.key === 'string' && !!member.key && typeof member.title === 'string';
    if (data?.version !== 1 || !Array.isArray(data.groups) || !data.groups.every(group =>
      typeof group?.id === 'string' && !!group.id && typeof group.name === 'string'
        && Array.isArray(group.members) && group.members.every(validMember))) {
      throw new Error('Invalid reading group preference');
    }
    return data.groups;
  },

  _writeReadingGroups(groups) {
    this.setPref('library.readingGroups', JSON.stringify({ version: 1, groups }));
  },

  _openLibraryForm(win, state, form) {
    const zh = this._isZhLocale();
    return this._openFuzzyPicker(win, state, 'libraryForm', {
      form, placeholder: form.field || '',
      hint: zh ? 'Tab 切换焦点 · Enter 执行 · Esc 取消'
        : 'Tab moves focus · Enter activates · Esc cancels',
    });
  },

  _readingPDFs(item) {
    const candidates = item.isRegularItem()
      ? item.getAttachments().map(id => Zotero.Items.get(id)) : [item];
    return candidates.filter(attachment => attachment && !attachment.deleted
      && (attachment.isPDFAttachment?.() ?? (attachment.isAttachment()
        && attachment.attachmentContentType === 'application/pdf')));
  },

  /** Resolve one PDF per source item before committing any changes to the group. */
  async _importReadingGroup(win, state, targets, create) {
    const zh = this._isZhLocale();
    const candidates = targets.items.map(item => ({ item, pdfs: this._readingPDFs(item) }));
    const available = candidates.filter(candidate => candidate.pdfs.length);
    const skipped = candidates.length - available.length;
    if (!available.length) {
      this._mainShowStatus(win, zh ? '所选条目中没有可用 PDF' : 'No PDFs in the selected items');
      return;
    }
    const groups = this._readReadingGroups();
    if (!create && !groups.length) {
      this._mainShowStatus(win, zh ? '请先创建阅读分组' : 'Create a reading group first');
      return;
    }

    const selected = [];
    const finish = () => {
      if (create) return this._saveReadingImport(win, state, selected, targets, skipped, {});
      return this._openLibraryPicker(win, state, zh ? '选择目标分组…' : 'Choose a group…',
        this._readingGroupRows(this._readReadingGroups()), ({ id }) =>
          this._saveReadingImport(win, state, selected, targets, skipped, { id }));
    };

    const choose = async start => {
      for (let i = start; i < available.length; i++) {
        const { item, pdfs } = available[i];
        if (pdfs.length === 1) {
          selected.push(pdfs[0]);
          continue;
        }
        const rows = pdfs.map(pdf => ({ pdf, title: this._libraryItemTitle(pdf),
          kind: pdf.attachmentFilename, parent: pdf.key }));
        const title = this._libraryItemTitle(item);
        return this._openLibraryPicker(win, state, (zh ? '选择 PDF：' : 'Choose PDF for ') + title,
          rows, ({ pdf }) => {
            selected.push(pdf);
            return choose(i + 1);
          });
      }
      return finish();
    };
    return choose(0);
  },

  _saveReadingImport(win, state, selected, targets, skipped, destination) {
    const zh = this._isZhLocale();
    const groups = this._readReadingGroups();
    const group = groups.find(entry => entry.id === destination.id);
    if (destination.id && !group) {
      this._mainShowStatus(win, zh ? '目标分组已不存在' : 'The target group no longer exists');
      return;
    }
    const seen = new Set(group?.members.map(member => this._libraryRefID(member)));
    const additions = [];
    for (const pdf of selected) {
      const current = this._resolveLibraryRef(pdf);
      if (!current || !this._readingPDFs(current).length) {
        skipped += 1;
        continue;
      }
      const key = this._libraryRefID(current);
      if (seen.has(key)) continue;
      seen.add(key);
      additions.push({ libraryID: current.libraryID, key: current.key,
        title: this._libraryItemTitle(current) });
    }
    const result = zh ? '新增 ' + additions.length + ' 份 PDF' : additions.length + ' PDFs to add';
    if (!additions.length) {
      this._mainShowStatus(win, zh ? '没有可新增的 PDF' : 'No new PDFs to add');
      return;
    }
    const message = [group?.name, this._libraryTargetSummary(targets), result].filter(Boolean);
    if (skipped) message.push(zh ? skipped + ' 个条目无可用 PDF'
      : skipped + ' items without an available PDF');
    return this._openLibraryForm(win, state, {
      title: group ? (zh ? '追加 PDF 到阅读分组' : 'Add PDFs to reading group')
        : (zh ? '创建阅读分组' : 'Create reading group'),
      field: group ? undefined : (zh ? '分组名称' : 'Group name'),
      details: message.join('\n'),
      confirm: group ? (zh ? '添加' : 'Add') : (zh ? '创建' : 'Create'),
      submit: name => {
        const latest = this._readReadingGroups();
        const target = destination.id ? latest.find(entry => entry.id === destination.id)
          : { id: Zotero.Utilities.randomString(20), name, members: [] };
        if (!target) {
          this._mainShowStatus(win, zh ? '目标分组已不存在' : 'The target group no longer exists');
          return;
        }
        const existing = new Set(target.members.map(member => this._libraryRefID(member)));
        const fresh = additions.filter(member => !existing.has(this._libraryRefID(member))
          && this._resolveLibraryRef(member));
        if (fresh.length) {
          target.members.push(...fresh);
          if (!destination.id) latest.push(target);
          this._writeReadingGroups(latest);
        }
        this._mainShowStatus(win, zh ? '已添加 ' + fresh.length + ' 份 PDF'
          : 'Added ' + fresh.length + ' PDFs');
      },
    });
  },

  _readingGroupRows(groups) {
    const zh = this._isZhLocale();
    return groups.map(group => ({ id: group.id, title: group.name,
      kind: group.members.length + (zh ? ' 份 PDF' : ' PDFs') }));
  },

  _showReadingGroups(win, state, initialID) {
    const zh = this._isZhLocale();
    const rows = this._readingGroupRows(this._readReadingGroups());
    if (!rows.length) {
      this._mainShowStatus(win, zh ? '还没有阅读分组' : 'No reading groups yet');
      return;
    }
    return this._openLibraryPicker(win, state, zh ? '搜索阅读分组…' : 'Search reading groups…',
      rows, ({ id }) => this._showReadingGroup(win, state, id), {
        'ctrl+r': ({ id, title }) => this._openLibraryForm(win, state, {
          title: zh ? '重命名阅读分组' : 'Rename reading group',
          field: zh ? '分组名称' : 'Group name',
          initial: title,
          confirm: zh ? '保存' : 'Save',
          cancel: () => this._showReadingGroups(win, state, id),
          submit: name => {
            this._changeReadingGroup(id, group => { group.name = name; });
            return this._showReadingGroups(win, state, id);
          },
        }),
        delete: ({ id, title }) => this._openLibraryForm(win, state, {
          title: zh ? '删除阅读分组' : 'Delete reading group',
          details: title,
          destructive: true,
          confirm: zh ? '删除分组' : 'Delete group',
          cancel: () => this._showReadingGroups(win, state, id),
          submit: () => {
            this._changeReadingGroup(id, (group, groups) => groups.splice(groups.indexOf(group), 1));
            return this._showReadingGroups(win, state);
          },
        }),
      }, zh ? 'Ctrl+r 重命名 · Delete 移除分组' : 'Ctrl+r rename · Delete removes group', initialID);
  },

  _changeReadingGroup(id, change) {
    const groups = this._readReadingGroups();
    const group = groups.find(entry => entry.id === id);
    if (!group) return;
    change(group, groups);
    this._writeReadingGroups(groups);
  },

  _showReadingGroup(win, state, id, initialID) {
    const zh = this._isZhLocale();
    const group = this._readReadingGroups().find(entry => entry.id === id);
    if (!group) return this._showReadingGroups(win, state);
    const rows = group.members.map(ref => {
      const item = this._resolveLibraryRef(ref);
      return { ref, id: this._libraryRefID(ref), title: item ? this._libraryItemTitle(item) : ref.title,
        kind: item ? item.attachmentFilename : (zh ? 'PDF 已失效' : 'PDF unavailable') };
    });
    const move = (ref, step) => {
      this._changeReadingGroup(id, current => {
        const index = current.members.findIndex(member =>
          this._libraryRefID(member) === this._libraryRefID(ref));
        if (index < 0 || !current.members[index + step]) return;
        const [member] = current.members.splice(index, 1);
        current.members.splice(index + step, 0, member);
      });
      return this._showReadingGroup(win, state, id, this._libraryRefID(ref));
    };
    return this._openLibraryPicker(win, state, group.name, rows, async ({ ref }) => {
      const item = this._resolveLibraryRef(ref);
      if (item && this._readingPDFs(item).length) await this._mainOpenPDF(win, state, item);
      else {
        this._mainShowStatus(win, zh ? 'PDF 已失效' : 'PDF is unavailable');
        return this._showReadingGroup(win, state, id);
      }
    }, {
      delete: ({ ref }) => {
        this._changeReadingGroup(id, current => {
          current.members = current.members.filter(member =>
            this._libraryRefID(member) !== this._libraryRefID(ref));
        });
        return this._showReadingGroup(win, state, id);
      },
      'alt+arrowup': ({ ref }) => move(ref, -1),
      'alt+arrowdown': ({ ref }) => move(ref, 1),
    }, zh ? 'Delete 移出 · Alt+↑/↓ 排序' : 'Delete removes PDF · Alt+↑/↓ reorders', initialID);
  },

  _editWorksetTag(win, state, targets, add) {
    const zh = this._isZhLocale();
    const title = add ? (zh ? '添加标签' : 'Add tag') : (zh ? '移除标签' : 'Remove tag');
    return this._openLibraryForm(win, state, {
      title,
      field: zh ? '标签名称' : 'Tag name',
      details: this._libraryTargetSummary(targets),
      confirm: add ? (zh ? '添加' : 'Add') : (zh ? '移除' : 'Remove'),
      submit: tag => this._applyWorksetChange(win, targets, item => {
        const present = item.hasTag(tag);
        if (present === add) return false;
        if (add) item.addTag(tag);
        else item.removeTag(tag);
        return true;
      }),
    });
  },

  async _chooseWorksetCollection(win, state, targets) {
    const zh = this._isZhLocale();
    const libraryID = targets.items[0].libraryID;
    if (!targets.items.every(item => item.libraryID === libraryID && !item.parentID)) {
      this._mainShowStatus(win, zh ? '请选择同一文献库中的顶层条目'
        : 'Select top-level items from one library');
      return;
    }
    const tab = win.Zotero_Tabs?.selectedID;
    const rows = (await this._buildCollectionPickerItems(zh)).flatMap(row => {
      if (!row.id.startsWith('C')) return [];
      const collection = Zotero.Collections.get(Number(row.id.slice(1)));
      if (!collection || collection.deleted || collection.libraryID !== libraryID
          || collection.isEditable?.() === false) return [];
      return [{ ...row, parent: row.path }];
    });
    if (win.closed || this._mainWindowState.get(win) !== state
        || win.Zotero_Tabs?.selectedID !== tab) return;
    if (!rows.length) {
      this._mainShowStatus(win, zh ? '该文献库没有可选分类' : 'No collections in this library');
      return;
    }
    return this._openLibraryPicker(win, state, zh ? '选择目标分类…' : 'Choose a collection…',
      rows, ({ id, title }) => this._openLibraryForm(win, state, {
        title: zh ? '添加到分类' : 'Add to collection',
        details: title + '\n' + this._libraryTargetSummary(targets),
        confirm: zh ? '添加' : 'Add',
        submit: () => this._applyWorksetChange(win, targets, item => {
          const collection = Zotero.Collections.get(Number(id.slice(1)));
          if (!collection || collection.deleted || collection.libraryID !== item.libraryID
              || collection.isEditable?.() === false || item.parentID) {
            throw new Error('Collection or item is no longer eligible');
          }
          if (item.inCollection(collection.id)) return false;
          item.addToCollection(collection.id);
          return true;
        }),
      }));
  },

  /** Revalidate the captured target set and apply it in one transaction. */
  async _applyWorksetChange(win, targets, change) {
    const zh = this._isZhLocale();
    const items = targets.items.map(item => this._resolveLibraryRef(item));
    if (items.some(item => !item || item.isEditable?.() === false)) {
      this._mainShowStatus(win, zh ? '选择中有已失效或只读的条目'
        : 'The selection includes unavailable or read-only items');
      return;
    }
    let updated = 0;
    await Zotero.DB.executeTransaction(async () => {
      const current = items.map(item => this._resolveLibraryRef(item));
      if (current.some(item => !item || item.isEditable?.() === false)) {
        throw new Error('An item is no longer editable');
      }
      for (const item of current) {
        if (!change(item)) continue;
        await item.save();
        updated += 1;
      }
    });
    this._mainShowStatus(win, zh ? '已更新 ' + updated + ' 个条目' : 'Updated ' + updated + ' items');
  },
});

/* global Zotero, Services, ZV_KEYMAP_LABELS, ZoteroVim */
/* eslint-disable no-unused-vars */

/** Searchable shortcut reference. All DOM is outside managed note content. */
Object.assign(ZoteroVim, {
  // Action order also defines key/description order. Group by meaning within a
  // single scope, never by the spelling of a default key (which may be remapped).
  // Columns: actions, English/Chinese labels, prefixes, then suffixes.
  SHORTCUT_GROUPS: [
    ['scrollDown scrollUp scrollLeft scrollRight', 'down|up|left|right', '下|上|左|右',
      'Scroll ', '向', '', '滚动'],
    ['prevPage nextPage', 'Previous page|next page', '上一页|下一页'],
    ['firstPage lastPage', 'First page|last page', '首页|末页'],
    ['halfPageDown halfPageUp', 'down|up', '下|上', 'Half-page ', '向', '', '半页'],
    ['fullPageDown fullPageUp', 'down|up', '下|上', 'Page ', '向', '', '整页'],
    ['navigateBack navigateForward', 'back|forward', '后退|前进', 'Reading history: ', '阅读历史：'],
    ['searchWordForward searchWordBackward', 'forward|backward', '前|后',
      'Search word ', '向', '', '搜索当前词'],
    ['findNext findPrevious', 'Next|previous', '下一个|上一个', '', '', ' match', '匹配'],
    ['prevAnnotation nextAnnotation', 'Previous|next', '上一个|下一个', '', '', ' annotation', '标注'],
    ['scrollTop scrollCenter scrollBottom', 'top|centre|bottom', '页顶|居中|页底',
      'Position: ', '定位：'],
    ['yankAnnotation yankAnnotationComment', 'annotation text|comment', '标注原文|标注评论',
      'Copy ', '复制：'],
    ['enterVisual enterCursor enterInsert', 'Visual|Cursor|Insert', '可视|光标|插入',
      'Enter ', '进入', ' mode', '模式'],
    ['recolorYellow recolorRed recolorGreen recolorBlue recolorPurple',
      'yellow|red|green|blue|purple', '黄|红|绿|蓝|紫', 'Recolour: ', '标注改色：'],
    ['highlightYellow highlightRed highlightGreen highlightBlue highlightPurple',
      'yellow|red|green|blue|purple', '黄|红|绿|蓝|紫', 'Highlight: ', '高亮：'],
    ['filterYellow filterRed filterGreen filterBlue filterPurple filterClear',
      'yellow|red|green|blue|purple|clear', '黄|红|绿|蓝|紫|清除', 'Filter: ', '筛选标注：'],
    ['extendDown extendUp extendLeft extendRight', 'down|up|left|right', '下|上|左|右',
      'Extend ', '向', '', '扩展选区'],
    ['extendWordForward extendWordBackward', 'next word|previous word', '下一词|上一词',
      'Extend to ', '扩展到'],
    ['extendLineStart extendLineEnd', 'line start|line end', '行首|行尾', 'Extend to ', '扩展到'],
    ['extendSentenceForward extendSentenceBackward', 'next sentence|previous sentence', '下一句|上一句',
      'Extend to ', '扩展到'],
    ['extendParagraphForward extendParagraphBackward', 'next paragraph|previous paragraph', '下一段|上一段',
      'Extend to ', '扩展到'],
    ['visualInnerWord visualInnerDoubleQuote visualInnerParen visualInnerBracket visualInnerBrace',
      'word|quotes|parentheses|brackets|braces', '单词|双引号|圆括号|方括号|花括号',
      'Select inside ', '选中内部：'],
    ['cursorDown cursorUp cursorLeft cursorRight', 'down|up|left|right', '下|上|左|右',
      'Move caret ', '向', '', '移动光标'],
    ['cursorWordForward cursorBigWordForward cursorWordBackward cursorBigWordBackward',
      'next word|next WORD|previous word|previous WORD', '下一词|下一大词|上一词|上一大词'],
    ['cursorLineStart cursorLineEnd', 'Line start|line end', '行首|行尾'],
    ['cursorFindForward cursorFindBackward cursorTillForward cursorTillBackward',
      'find forward|find backward|till forward|till backward', '向前查找|向后查找|向前到目标前|向后到目标后'],
    ['mainNavDown mainNavUp', 'Down|up', '向下|向上', '', '', '', '选择'],
    ['mainNavFirst mainNavLast', 'First row|last row', '首行|末行'],
    ['mainTreeCollapse mainTreeExpand', 'collapse/return to tree|expand/enter items',
      '折叠或返回分类|展开或进入条目'],
    ['mainTreeToggle mainTreeOpenOnly mainTreeCloseOnly', 'toggle|expand|collapse', '切换|展开|折叠',
      'Collection: ', '分类：'],
    ['mainTreeExpandAll mainTreeCollapseAll', 'Expand all|collapse all', '全部展开|全部折叠'],
    ['mainFuzzyAll mainFuzzyCollection readerOutlinePick', 'all items|collection|PDF headings',
      '全库|当前分类|目录标题', 'Search: ', '搜索：'],
    ['mainPrevTab mainNextTab', 'Previous tab|next tab', '上一个标签页|下一个标签页'],
    ['mainFocusLeft mainFocusRight mainFocusItems', 'collections|details|items', '分类树|详情栏|条目列表',
      'Focus ', '聚焦：'],
    ['focusReaderSplitLeft focusReaderSplitDown focusReaderSplitUp focusReaderSplitRight',
      'left|down|up|right', '左|下|上|右', 'Focus pane: ', '聚焦分栏：'],
    ['toggleReaderSplitHorizontal toggleReaderSplitVertical', 'Horizontal|vertical', '上下|左右',
      '', '', ' split', '分栏'],
    ['toggleReaderSpread toggleReaderSpreadParity', 'single/two-page|odd/even pairing', '单／双页|奇／偶配对',
      'Toggle ', '切换：'],
    ['mainColoredTag1 mainColoredTag2 mainColoredTag3 mainColoredTag4 mainColoredTag5 '
      + 'mainColoredTag6 mainColoredTag7 mainColoredTag8 mainColoredTag9 mainColoredTagClear',
      'tag 1|tag 2|tag 3|tag 4|tag 5|tag 6|tag 7|tag 8|tag 9|clear all',
      '标签1|标签2|标签3|标签4|标签5|标签6|标签7|标签8|标签9|清除全部',
      'Coloured tags: ', '彩色标签：'],
  ],

  // Fixed commands are described as families rather than enumerating every count,
  // literal character or operator combination. Configurable keys come from getBindings().
  SHORTCUT_REFERENCE: [
    ['reader', 'normal', 'm{a–z,0–9}', 'Set a position mark', '设置位置标记'],
    ['reader', 'normal', '`{a–z,0–9}', 'Jump to a position mark', '跳转到位置标记'],
    ['reader', 'normal', 'dm{a–z,0–9}', 'Delete one position mark', '删除一个位置标记'],
    ['reader', 'normal', 'dM', 'Delete all position marks', '删除所有位置标记'],
    ['reader', 'normal', '{count}{motion}', 'Repeat a motion; e.g. 3j, 5G, 2Ctrl+o',
      '重复移动或指定页码，例如 3j、5G、2Ctrl+o'],
    ['reader', 'cursor', '{count}{motion}', 'Repeat a caret motion or character find',
      '按次数重复光标移动或字符查找'],
    ['reader', 'cursor', 'Esc', 'Cancel a pending character find', '取消等待中的字符查找'],
    ['notes', 'noteNormal', 'i / a / A / I', 'Insert here / after caret / at line end / first nonblank',
      '在当前位置／光标后／行尾／首个非空字符处进入插入模式'],
    ['notes', 'noteNormal', 'o / O', 'Insert a clean line below / above', '在下方／上方插入空行'],
    ['notes', 'noteNormal', 'h/j/k/l / ←↓↑→', 'Move the caret by character or logical line',
      '按字符或逻辑行移动光标'],
    ['notes', 'noteNormal', 'w / e / b / W / E / B', 'Word and WORD motions', '按单词或空白分隔的大词移动'],
    ['notes', 'noteNormal', '0 / ^ / $', 'Line start / first nonblank / line end', '行首／首个非空字符／行尾'],
    ['notes', 'noteNormal', 'gg / G / {count}G / {count}gg', 'First / last / specified logical line',
      '首行／末行／指定逻辑行，例如 12G'],
    ['notes', 'noteNormal', '{count}{motion}', 'Repeat motions; operator counts multiply: 2d3w',
      '重复移动；操作符前后的次数相乘，例如 2d3w'],
    ['notes', 'noteNormal', 'f/F/t/T + {char}', 'Find a character on the logical line; e.g. 2fx',
      '在逻辑行内查找字符，例如 2fx'],
    ['notes', 'noteNormal', '; / ,', 'Repeat / reverse the last character find', '重复／反向重复上次字符查找'],
    ['notes', 'noteNormal', '% / {count}%', 'Match brackets / jump to a percentage', '跳到匹配括号／文档百分比位置'],
    ['notes', 'noteNormal', '/ / ?', 'Literal forward / backward search', '向前／向后搜索字面文本'],
    ['notes', 'noteNormal', 'n / N / * / #', 'Next / previous match; search the word under caret',
      '下一个／上一个匹配；搜索光标所在单词'],
    ['notes', 'noteNormal', 'v / V / gv', 'Character / line Visual mode; restore the last selection',
      '字符／行可视模式；恢复上次选区'],
    ['notes', 'noteNormal', 'x / dd / yy', 'Delete character / delete line / copy line; accepts counts',
      '删除字符／删除行／复制行，支持次数前缀'],
    ['notes', 'noteNormal', 'd/y/c + {motion}', 'Delete / copy / change by motion; e.g. dw, y$, cf,',
      '按移动范围删除／复制／修改，例如 dw、y$、cf,'],
    ['notes', 'noteNormal', 'd/y/c + i/a + {object}', 'Inner / around text objects; e.g. ciw, da(',
      '内部／包含边界的文本对象，例如 ciw、da('],
    ['notes', 'noteNormal', 'p / P', 'Paste after / before caret or below / above a line',
      '在光标后／前或行下／上粘贴'],
    ['notes', 'noteNormal', 'u / Ctrl+r', 'Undo / redo', '撤销／重做'],
    ['notes', 'noteNormal', 'Esc', 'Cancel pending commands and return to Normal', '取消待完成命令并返回普通模式'],
    ['notes', 'noteVisual', 'h/j/k/l / ←↓↑→',
      'Extend left/down/up/right; accepts counts', '向左／下／上／右扩展，支持次数'],
    ['notes', 'noteVisual', 'w/e/b / W/E/B',
      'Extend by word / WORD', '按单词／大词扩展'],
    ['notes', 'noteVisual', '0/^/$ / gg/G',
      'Extend to line start/first nonblank/end or document start/end',
      '扩展到行首／非空首字／行尾或文档首尾'],
    ['notes', 'noteVisual', 'f/F/t/T + {char}',
      'Extend by a character find', '通过字符查找扩展选区'],
    ['notes', 'noteVisual', '; / , / %',
      'Repeat/reverse find / match brackets', '重复／反向查找／匹配括号'],
    ['notes', 'noteVisual', '/ / ? / n / N / * / #', 'Extend selection using search', '通过搜索扩展选区'],
    ['notes', 'noteVisual', 'i/a + {object}',
      'Inner/around text objects (see below)', '内部／含边界的文本对象，详见下方'],
    ['notes', 'noteVisual', 'o', 'Swap the active end of the selection', '交换选区活动端'],
    ['notes', 'noteVisual', 'y / d / x / c', 'Copy / delete / delete / change selection', '复制／删除／删除／修改选区'],
    ['notes', 'noteVisual', 'v / V / Esc', 'Change selection type or leave Visual mode', '切换选区类型或退出可视模式'],
    ['notes', 'noteObjects', 'i/a + w/W/s/p',
      'Inner/around word, WORD, sentence or paragraph', '内部／含边界的单词、大词、句子、段落',
      'iw aw iW aW is as ip ap'],
    ['notes', 'noteObjects', 'i/a + " / \' / `', 'Quoted text; escaped quotes are skipped',
      '引号文本，跳过转义引号', 'i" a" i\' a\' i` a`'],
    ['notes', 'noteObjects', 'i/a + ()/[]/{}/<>',
      'Bracket objects (b/B aliases); counts expand outward',
      '成对括号（b/B 为别名），次数前缀选择外层',
      'i( a( i) a) ib ab i[ a[ i] a] i{ a{ i} a} iB aB i< a< i> a>'],
    ['notes', 'noteObjects', 'it / at', 'Paired literal HTML/XML tags in note text', '笔记字面文本中的成对 HTML/XML 标签'],
    ['notes', 'noteNormal', 'd/y/c + / or ?', 'Operate up to a search match; e.g. d/search, c?text',
      '操作到搜索匹配位置，例如 d/search、c?text'],
    ['notes', 'noteInsert', 'Esc', 'Close an editor palette first, then return to Normal',
      '先关闭编辑器命令面板，再返回普通模式'],
    ['notes', 'noteAll', 'Ctrl+h / Ctrl+l', 'Focus the PDF / sidebar note editor', '聚焦 PDF／侧栏笔记编辑器'],
    ['popups', 'hints', '{label}', 'Pick a sentence hint, then a word hint', '先选择句子标签，再选择单词标签'],
    ['popups', 'hints', 'Backspace / Esc', 'Remove a label character / return a hint stage or leave',
      '删除标签字符／返回上一提示阶段或退出'],
    ['popups', 'picker', 'Ctrl+j/k / Ctrl+n/p / ↓/↑', 'Move the result selection', '移动结果选择'],
    ['popups', 'picker', 'Ctrl+h / Ctrl+l', 'Cycle the search scope (item picker only)',
      '切换搜索范围，仅条目选择器可用'],
    ['popups', 'picker', 'Ctrl+Shift+h / Ctrl+Shift+l', 'Cycle the item type (item picker only)',
      '切换条目类型，仅条目选择器可用'],
    ['popups', 'picker', 'Enter / Esc', 'Select a result / close the picker', '选择结果／关闭选择器'],
    ['popups', 'picker', 'Ctrl+o', 'Open the highlighted result (item picker only)',
      '打开高亮的结果，仅条目选择器可用'],
    ['popups', 'picker', 'Ctrl+y / Ctrl+Shift+y', 'Copy citation / citekey (item picker only)',
      '复制引用／引用键，仅条目选择器可用'],
    ['popups', 'picker', '{label}', 'Choose a tab by hint when the tab query is empty',
      '标签页搜索为空时按提示字母选择标签页'],
    ['popups', 'headings', 'Ctrl+j/k / Ctrl+n/p / ↓/↑ / Enter / Esc',
      'Select a heading / jump / return; ordinary text filters titles',
      '选择标题／跳转／返回；普通输入筛选目录标题'],
    ['popups', 'outline', '/ / Ctrl+h / Ctrl+l', 'Search headings / focus outline / return to PDF',
      '搜索目录标题／聚焦目录／返回 PDF'],
    ['popups', 'outline', 'j/k / Ctrl+d/u / gg/G', 'Move / fast move / first or last entry',
      '移动／快速移动／首个或末个目录条目'],
    ['popups', 'outline', 'h/l / R/M', 'Collapse/expand node / expand/collapse all',
      '折叠／展开节点；展开／折叠全部'],
    ['popups', 'outline', '{label} / Enter / Esc', 'Select a hinted entry / jump / close',
      '按提示选择条目／跳转／关闭'],
    ['popups', 'marks', 'j/k / G / Enter', 'Move / last mark / jump to the selected mark',
      '移动／最后一个标记／跳到选中标记'],
    ['popups', 'marks', '{mark} / d / x / Esc', 'Jump by mark character / delete / delete all / close',
      '按标记字符跳转／删除／全部删除／关闭；j/k/g/d/x 保留给导航'],
    ['popups', 'notesLayout', 'j/k / Ctrl+d/u / gg/G', 'Move / fast move / first or last note',
      '移动／快速移动／首篇或末篇笔记'],
    ['popups', 'notesLayout', 'Ctrl+j/k / Ctrl+h/l', 'Change note group / focus list or preview',
      '切换笔记组／聚焦列表或预览'],
    ['popups', 'notesLayout', 'n / N', 'Create a child note in the sidebar / a new tab',
      '新建子笔记并在侧栏／新标签页打开'],
    ['popups', 'notesLayout', '{label} / Enter / Shift+Enter / Esc',
      'Select by hint / open in sidebar / open in new tab / close',
      '按提示选择／侧栏打开／新标签页打开／关闭'],
    ['popups', 'translation', 'j/k / ↓/↑ / Ctrl+d/u / PageDown/PageUp',
      'Scroll the translation result', '滚动翻译结果'],
    ['popups', 'translation', 'y / Ctrl+c / Tab / Esc',
      'Copy translation / native text copy / change button / close',
      '复制译文／原生复制选中文字／切换按钮／关闭'],
    ['popups', 'noteSearch', 'Enter / Esc', 'Confirm a literal note search / cancel and restore selection',
      '确认笔记字面搜索／取消并恢复选区'],
    ['popups', 'readerSearch', 'Enter / Shift+Enter', 'Find next/previous and return focus to the document',
      '查找下一个／上一个并返回文档焦点'],
    ['library', 'librarySearch', 'Ctrl+h/l',
      'In item search: previous/next native search mode; keep the query',
      '条目搜索中：循环切换原生三种搜索模式，保留搜索词'],
    ['library', 'librarySearch', 'Enter / Esc',
      'Keep / clear the native search and return to its collection tree or item list',
      '保留／清空原生搜索，并返回对应分类树或条目列表'],
    ['popups', 'comment', 'Enter / Esc', 'New line / save annotation comment and close',
      '换行／保存标注评论并关闭'],
    ['popups', 'help', 'Ctrl+j/k / ↓/↑ / PageDown/PageUp', 'Scroll this shortcut reference',
      '滚动快捷键总览'],
    ['popups', 'help', 'Ctrl+h/l', 'Previous/next category (wraps); keep the query',
      '循环切换上一个／下一个分类，保留搜索词'],
    ['popups', 'help', 'Ctrl+f / Esc', 'Focus search / close and restore focus',
      '聚焦搜索／关闭并恢复焦点'],
    ['popups', 'help', 'j/k / gg/G / Space', 'When the list has focus: scroll / first or last / page down',
      '列表获得焦点时：滚动／首尾／向下翻页'],
    ['popups', 'spacekeys', 'Space + {chord} / Esc', 'Narrow leader hints / cancel the pending chord',
      '逐层筛选 Space 组合键／取消待完成组合'],
  ],

  _shortcutScope(scope, zh) {
    const names = {
      normal: ['Reader · Normal', '阅读器 · 普通'],
      visual: ['Reader · Visual', '阅读器 · 可视'],
      cursor: ['Reader · Cursor', '阅读器 · 光标'],
      insert: ['Reader · Insert', '阅读器 · 插入'],
      main: ['Library', '文献库'],
      noteNormal: ['Note · Normal', '笔记 · 普通'],
      noteVisual: ['Note · Visual', '笔记 · 可视'],
      noteInsert: ['Note · Insert', '笔记 · 插入'],
      noteObjects: ['Note · Text objects', '笔记 · 文本对象'],
      noteAll: ['Note · All modes', '笔记 · 所有模式'],
      hints: ['Sentence/word hints', '句子／单词提示'],
      picker: ['Item/tab picker', '条目／标签页选择器'],
      headings: ['Heading search', '目录标题搜索'],
      outline: ['Outline explorer', '目录浏览'], marks: ['Marks explorer', '标记浏览'],
      notesLayout: ['Notes layout', '笔记布局'], translation: ['Translation', '翻译'],
      noteSearch: ['Note search', '笔记搜索'], readerSearch: ['Reader search', '阅读器搜索'],
      librarySearch: ['Library search', '文献库搜索'],
      comment: ['Annotation comment', '标注评论'], help: ['Shortcut reference', '快捷键总览'],
      spacekeys: ['Spacekeys', 'Spacekeys'],
    };
    return names[scope]?.[zh ? 1 : 0] || scope;
  },

  /** Shared descriptions omit baked-in default-key hints after a remap. */
  _shortcutActionLabel(action, zh) {
    const labels = ZV_KEYMAP_LABELS[zh ? 'zh-CN' : 'en'];
    return (labels[action] || String(action).replace(/([a-z])([A-Z])/g, '$1 $2'))
      .split(/\s+\(|（/)[0]
      .replace(/^(?:(?:Main window|Reader):\s*|(?:主窗口|阅读器)：\s*)/, '');
  },

  _shortcutKeyDisplay(key) {
    return key.replace(/ /g, 'Space ').trimEnd()
      .replace(/ctrl\+/g, 'Ctrl+').replace(/alt\+/g, 'Alt+')
      .replace(/^(enter|return)$/i, 'Enter').replace(/^escape$/i, 'Esc');
  },

  /** Build a fresh reference on every open, including note-inherited main chords. */
  _shortcutHelpRows() {
    const rows = [], seen = new Set();
    const add = (category, scope, key, en, zh, action = '', custom = false, search = '') => {
      const id = scope + '\n' + key + '\n' + action;
      if (seen.has(id)) return;
      seen.add(id);
      rows.push({ category, scope, key, en, zh, action, custom, search });
    };
    const bindings = this.getBindings();
    for (const [binding, action] of Object.entries(bindings)) {
      const colon = binding.indexOf(':');
      const mode = binding.slice(0, colon), key = binding.slice(colon + 1);
      if (!['normal', 'cursor', 'visual', 'insert', 'main'].includes(mode)) continue;
      const find = ['cursorFindForward', 'cursorFindBackward',
        'cursorTillForward', 'cursorTillBackward'].includes(action);
      const display = this._shortcutKeyDisplay(key) + (find ? ' + {char}' : '');
      const en = this._shortcutActionLabel(action, false);
      const zh = this._shortcutActionLabel(action, true);
      const custom = this.DEFAULT_BINDINGS[binding] !== action;
      add(mode === 'main' ? 'library' : 'reader', mode, display, en, zh, action, custom);
      if (mode === 'main' && (key.startsWith(' ')
          || (['mainPrevTab', 'mainNextTab'].includes(action)
            && !['i', 'escape', 'ctrl+h', 'ctrl+H', 'ctrl+backspace', 'ctrl+l'].includes(key)))) {
        add('notes', 'noteNormal', display, en, zh, action, custom);
      }
    }
    for (const [category, scope, key, en, zh, search = ''] of this.SHORTCUT_REFERENCE) {
      if (category === 'reader' && scope === 'normal' && /^[md`]/.test(key)
          && (bindings['normal:m'] || bindings['normal:`'])) continue;
      add(category, scope, key, en, zh, '', false, search);
    }
    return rows;
  },

  /** Shorten only shared modifier/leader tokens; literal key case is significant. */
  _shortcutGroupKeys(keys) {
    for (const prefix of ['Space ', 'Ctrl+Alt+', 'Ctrl+', 'Alt+']) {
      if (keys.every(key => key.startsWith(prefix))) {
        return prefix + keys.map(key => key.slice(prefix.length)).join('/');
      }
    }
    return keys.join('/');
  },

  /**
   * Compact related actions within one mode. Original rows remain as members
   * for search and aliases; missing/unbound actions never reappear in a group.
   */
  _compactShortcutHelpRows(rows) {
    const families = this.SHORTCUT_GROUPS.map(([actions, en, zh,
      enPrefix = '', zhPrefix = '', enSuffix = '', zhSuffix = ''], index) => ({
      actions: actions.split(' '), en: en.split('|'), zh: zh.split('|'),
      enPrefix, zhPrefix, enSuffix, zhSuffix, index,
    }));
    const byAction = new Map();
    for (const family of families) {
      for (const action of family.actions) byAction.set(action, family);
    }
    const buckets = new Map(), ordered = [];
    for (const row of rows) {
      const family = byAction.get(row.action);
      if (!family) { ordered.push({ rows: [row], family: null }); continue; }
      const id = row.category + ':' + row.scope + ':' + family.index;
      if (!buckets.has(id)) {
        const bucket = { rows: [], family };
        buckets.set(id, bucket); ordered.push(bucket);
      }
      buckets.get(id).rows.push(row);
    }
    const result = [];
    for (const { rows: members, family } of ordered) {
      const actions = new Set(members.map(row => row.action));
      if (!family || actions.size < 2) {
        for (const row of members) result.push({ ...row, members: [row] });
        continue;
      }
      const slots = family.actions.map((action, i) => ({
        rows: members.filter(row => row.action === action), en: family.en[i], zh: family.zh[i],
      })).filter(slot => slot.rows.length);
      const argument = members.every(row => row.key.endsWith(' + {char}'));
      const keys = slots.map(slot => {
        const aliases = slot.rows.map(row => argument ? row.key.slice(0, -9) : row.key);
        return aliases.length > 1 ? '(' + aliases.join(', ') + ')' : aliases[0];
      });
      const row = { ...members[0], members, action: slots.map(slot => slot.rows[0].action).join(' '),
        key: this._shortcutGroupKeys(keys) + (argument ? ' + {char}' : ''),
        en: family.enPrefix + slots.map(slot => slot.en).join(' / ') + family.enSuffix,
        zh: family.zhPrefix + slots.map(slot => slot.zh).join('／') + family.zhSuffix,
        custom: members.some(member => member.custom),
      };
      const tags = members.every(member => /^mainColoredTag/.test(member.action));
      if (tags && members.length === 10 && members.every(member =>
        member.key === 't' + (member.action.match(/[1-9]$/)?.[0] || '0'))) {
        row.key = 't1…t9 / t0';
        row.en = 'Toggle coloured tag 1–9 / clear all';
        row.zh = '切换第1–9个彩色标签／清除全部';
      }
      const blue = members.filter(member => member.action === 'recolorBlue');
      if (row.scope === 'normal' && blue.length) {
        const key = blue.map(member => member.key).join('/');
        row.en += '; no annotation: ' + key + ' → page bottom';
        row.zh += '；无标注时 ' + key + '→页底';
      }
      result.push(row);
    }
    return result;
  },

  /** One-time migration of the old search shortcut; other overrides stay intact. */
  _migrateShortcutHelpBinding() {
    if (this.getPref('shortcutHelp.migrated', false)) return;
    try {
      const saved = JSON.parse(this.getPref('bindings', '') || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)
          && saved['main: /'] === 'mainFocusSearch') {
        delete saved['main: /'];
        this.setPref('bindings', JSON.stringify(saved));
      }
      this.setPref('shortcutHelp.migrated', true);
    } catch (e) { Zotero.debug('[ZoteroVim] shortcut help migration: ' + e); }
  },

  _shortcutHelpForWindow(win) {
    if (!win) return null;
    for (const state of [...this._readerState.values(), ...this._mainWindowState.values()]) {
      if (state._shortcutHelp?.win === win) return state._shortcutHelp;
    }
    return null;
  },

  /** Own the popup on its originating state so closing a reader also removes it. */
  _openShortcutHelp(owner, win, sourceWin = null) {
    if (!win?.document || !owner) return;
    const previous = this._shortcutHelpForWindow(win);
    if (previous) { previous.input.focus(); return; }
    const doc = win.document;
    const zh = /^zh/i.test(this.getPref('language', '') || Zotero.locale || '');
    sourceWin = sourceWin || Services.focus?.focusedWindow || win;
    const sourceDoc = sourceWin.document;
    const note = sourceDoc === owner._contextNoteEditorDoc;
    const scope = owner.reader ? owner.mode : note ? 'noteNormal' : 'main';
    const ui = { owner, win, doc, sourceWin, sourceDoc, zh, scope,
      tabID: win.Zotero_Tabs?.selectedID, focus: sourceDoc.activeElement,
      category: 'all', composing: false, focusing: false, listeners: [], timer: null,
      handledKeys: new WeakSet(), rows: this._compactShortcutHelpRows(this._shortcutHelpRows()),
      ranges: [], anchor: null, textSelection: null };
    try {
      const selection = sourceWin.getSelection?.();
      for (let i = 0; i < (selection?.rangeCount || 0); i++) {
        ui.ranges.push(selection.getRangeAt(i).cloneRange());
      }
      if (selection?.anchorNode && selection.focusNode) {
        ui.anchor = [selection.anchorNode, selection.anchorOffset,
          selection.focusNode, selection.focusOffset];
      }
      if (typeof ui.focus?.selectionStart === 'number') {
        ui.textSelection = [ui.focus.selectionStart, ui.focus.selectionEnd, ui.focus.selectionDirection];
      }
      this._cancelWindowSpacekeys(win);
      for (const state of this._readerState.values()) {
        const readerWin = state.reader?._window || state.reader?._iframe?.ownerDocument?.defaultView;
        if (readerWin === win) {
          this._stopSmoothHoldScroll(state, state.activePdfWin || state.pdfWin);
        }
      }
      owner._shortcutHelp = ui;
      this._createShortcutHelp(ui);
      const listen = (target, type, handler) => {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler, true);
        ui.listeners.push([target, type, handler]);
      };
      const key = event => this._onShortcutHelpKeyDown(event, ui);
      for (const target of new Set([win, sourceWin])) listen(target, 'keydown', key);
      listen(doc, 'focusin', event => {
        if (!ui.overlay.contains(event.target)) this._focusShortcutHelp(ui);
      });
      listen(ui.overlay, 'wheel', event => {
        if (!ui.list.contains(event.target)) event.preventDefault();
      });
      listen(win, 'deactivate', () => this._closeShortcutHelp(owner, false));
      this._renderShortcutHelp(ui);
      this._focusShortcutHelp(ui);
      ui.timer = setTimeout(() => {
        ui.timer = null;
        if (owner._shortcutHelp === ui && !ui.overlay.contains(doc.activeElement)) {
          this._focusShortcutHelp(ui);
        }
      }, 30);
    } catch (e) {
      this._closeShortcutHelp(owner, false);
      Zotero.debug('[ZoteroVim] open shortcut help: ' + e);
    }
  },

  _createShortcutHelp(ui) {
    const h = tag => ui.doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    const overlay = h('div');
    overlay.id = 'zv-shortcut-help';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0006;'
      + 'display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;';
    const panel = h('section');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'zv-shortcut-help-title');
    panel.style.cssText = 'width:min(1100px,100%);max-height:88vh;display:flex;flex-direction:column;'
      + 'background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:12px;'
      + 'box-shadow:0 20px 70px #0006;font:13px/1.6 sans-serif;overflow:hidden;';
    const header = h('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;'
      + 'gap:12px;padding:12px 18px 8px;flex-shrink:0;';
    const heading = h('div');
    heading.style.cssText = 'display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 14px;';
    const title = h('h2');
    title.id = 'zv-shortcut-help-title';
    title.textContent = ui.zh ? '快捷键总览' : 'Keyboard shortcuts';
    title.style.cssText = 'margin:0;font-size:20px;color:#cdd6f4;';
    const subtitle = h('div');
    subtitle.style.cssText = 'color:#a6adc8;font-size:12px;';
    subtitle.textContent = (ui.zh ? '当前：' : 'Current: ') + this._shortcutScope(ui.scope, ui.zh);
    heading.appendChild(title); heading.appendChild(subtitle);
    const close = h('button');
    close.type = 'button'; close.textContent = ui.zh ? '关闭 · Esc' : 'Close · Esc';
    close.style.cssText = 'background:#313244;color:#cdd6f4;border:1px solid #45475a;'
      + 'border-radius:6px;padding:5px 10px;cursor:pointer;';
    close.addEventListener('click', () => this._closeShortcutHelp(ui.owner));
    header.appendChild(heading); header.appendChild(close);
    const searchWrap = h('div');
    searchWrap.style.cssText = 'padding:0 18px 8px;flex-shrink:0;';
    const input = h('input');
    input.type = 'text';
    input.placeholder = ui.zh ? '搜索按键、功能或模式，例如：Space、标注、删除…'
      : 'Search keys, actions or modes…';
    input.setAttribute('aria-label', input.placeholder);
    input.style.cssText = 'width:100%;box-sizing:border-box;background:#313244;color:#cdd6f4;'
      + 'border:1px solid #585b70;border-radius:7px;padding:6px 10px;font:inherit;';
    input.addEventListener('input', () => this._renderShortcutHelp(ui));
    input.addEventListener('compositionstart', () => { ui.composing = true; });
    input.addEventListener('compositionend', () => { ui.composing = false; });
    searchWrap.appendChild(input);
    const tabs = h('div');
    tabs.style.cssText = 'padding:0 18px 8px;display:flex;flex-wrap:wrap;gap:6px;flex-shrink:0;';
    const categories = [['all', 'All', '全部'], ['reader', 'Reader', '阅读器'],
      ['library', 'Library', '文献库'], ['notes', 'Notes', '笔记'],
      ['popups', 'Popups', '弹窗操作']];
    ui.categories = categories.map(([category, en, zh]) => {
      const button = h('button'); button.type = 'button';
      button.textContent = ui.zh ? zh : en;
      button.addEventListener('click', () => {
        ui.category = category;
        this._renderShortcutHelp(ui);
      });
      tabs.appendChild(button);
      return { category, button };
    });
    const list = h('div');
    list.tabIndex = 0;
    list.setAttribute('role', 'region');
    list.setAttribute('aria-label', ui.zh ? '快捷键列表' : 'Shortcut list');
    list.style.cssText = 'overflow:auto;overscroll-behavior:contain;min-height:0;'
      + 'flex:1;padding:0 18px 8px;outline-offset:-3px;';
    const style = h('style');
    style.textContent = '#zv-shortcut-help .zv-shortcut-grid {'
      + 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px;}'
      + '#zv-shortcut-help .zv-shortcut-row {'
      + 'display:grid;grid-template-columns:fit-content(44%) minmax(0,1fr);'
      + 'column-gap:8px;align-items:start;min-width:0;padding:3px 0;'
      + 'border-bottom:1px solid #313244;}'
      + '#zv-shortcut-help .zv-shortcut-key {'
      + 'color:#f9e2af;font:12px/1.6 monospace;white-space:pre-wrap;overflow-wrap:anywhere;}'
      + '#zv-shortcut-help .zv-shortcut-description {min-width:0;overflow-wrap:anywhere;}'
      + '@media(max-width:760px) {'
      + '#zv-shortcut-help .zv-shortcut-grid {grid-template-columns:minmax(0,1fr);}}';
    const footer = h('div');
    footer.style.cssText = 'padding:8px 18px;border-top:1px solid #45475a;color:#a6adc8;'
      + 'font-size:11px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;flex-shrink:0;';
    const count = h('span'); count.setAttribute('aria-live', 'polite');
    const hint = h('span');
    hint.textContent = ui.zh ? 'Ctrl+h/l 分类 · Ctrl+j/k 滚动 · Ctrl+f 搜索 · Esc 关闭'
      : 'Ctrl+h/l categories · Ctrl+j/k scroll · Ctrl+f search · Esc close';
    footer.appendChild(count); footer.appendChild(hint);
    for (const node of [style, header, searchWrap, tabs, list, footer]) panel.appendChild(node);
    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) {
        event.preventDefault();
        event.stopPropagation();
        this._closeShortcutHelp(ui.owner);
      }
    });
    ui.overlay = overlay; ui.input = input; ui.list = list; ui.count = count;
    (ui.doc.body || ui.doc.documentElement).appendChild(overlay);
  },

  _renderShortcutHelp(ui) {
    const h = tag => ui.doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    const terms = ui.input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const filtered = ui.rows.filter(row => {
      if (ui.category !== 'all' && row.category !== ui.category) return false;
      const haystack = [row.key, row.key.replace(/Space/g, '空格'), row.en, row.zh, row.action,
        ...row.members.flatMap(member =>
          [member.key, member.en, member.zh, member.action, member.search]),
        this._shortcutScope(row.scope, false), this._shortcutScope(row.scope, true)]
        .join(' ').toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
    for (const { category, button } of ui.categories) {
      const selected = category === ui.category;
      button.setAttribute('aria-pressed', String(selected));
      button.style.cssText = 'border:1px solid #45475a;border-radius:6px;padding:3px 10px;'
        + 'font:inherit;cursor:pointer;background:' + (selected ? '#89b4fa' : '#313244')
        + ';color:' + (selected ? '#11111b' : '#cdd6f4') + ';';
    }
    while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);
    const scopes = new Map();
    for (const row of filtered) {
      if (!scopes.has(row.scope)) scopes.set(row.scope, []);
      scopes.get(row.scope).push(row);
    }
    for (const [scope, rows] of scopes) {
      const heading = h('h3');
      heading.textContent = this._shortcutScope(scope, ui.zh);
      const disabled = ['noteNormal', 'noteVisual', 'noteInsert', 'noteAll', 'noteObjects']
        .includes(scope) ? !this.isNoteEditorVimEnabled()
        : ['visual', 'cursor', 'insert'].includes(scope) && !this.isModeEnabled(scope);
      if (disabled) heading.textContent += ui.zh ? '（设置中已关闭）' : ' (disabled in settings)';
      heading.style.cssText = 'font-size:12px;letter-spacing:.04em;color:#89b4fa;margin:10px 0 4px;';
      ui.list.appendChild(heading);
      const grid = h('div');
      grid.className = 'zv-shortcut-grid';
      for (const row of rows) {
        const entry = h('div');
        entry.className = 'zv-shortcut-row';
        entry.title = row.members.map(member => member.key + ' — '
          + (ui.zh ? member.zh : member.en)).join('\n');
        const kbd = h('kbd');
        kbd.className = 'zv-shortcut-key';
        kbd.textContent = row.key;
        const description = h('span');
        description.className = 'zv-shortcut-description';
        description.textContent = (ui.zh ? row.zh : row.en)
          + (row.custom ? (ui.zh ? ' · ' + (row.members.length > 1 ? '含自定义' : '自定义')
            : ' · ' + (row.members.length > 1 ? 'includes custom' : 'custom')) : '');
        entry.appendChild(kbd); entry.appendChild(description); grid.appendChild(entry);
      }
      ui.list.appendChild(grid);
    }
    if (!filtered.length) {
      const empty = h('p');
      empty.textContent = ui.zh ? '没有匹配的快捷键，请尝试其他按键或功能名称。'
        : 'No matching shortcuts. Try another key or action name.';
      empty.style.cssText = 'padding:24px 0;color:#a6adc8;';
      ui.list.appendChild(empty);
    }
    ui.filtered = filtered;
    ui.count.textContent = ui.zh ? filtered.length + ' 组快捷键／命令规则'
      : filtered.length + ' shortcut groups / command patterns';
    ui.list.scrollTop = 0;
  },

  _focusShortcutHelp(ui) {
    if (ui.owner._shortcutHelp !== ui || ui.focusing) return;
    ui.focusing = true;
    try { ui.win.focus(); ui.input.focus(); } catch (_) {}
    ui.focusing = false;
  },

  _switchShortcutHelpCategory(ui, direction) {
    const index = ui.categories.findIndex(entry => entry.category === ui.category);
    const next = (index + direction + ui.categories.length) % ui.categories.length;
    ui.category = ui.categories[next].category;
    this._renderShortcutHelp(ui);
  },

  /** Capture before reader/note handlers; leave text entry and IME defaults native. */
  _onShortcutHelpKeyDown(event, ui) {
    if (ui.owner._shortcutHelp !== ui || ui.handledKeys.has(event)) return;
    ui.handledKeys.add(event);
    event.stopImmediatePropagation();
    if (event.isComposing || ui.composing || event.keyCode === 229) return;
    const key = this._keyString(event);
    if (key === 'escape') {
      event.preventDefault(); this._closeShortcutHelp(ui.owner); return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const letter = String(event.key || '').toLowerCase();
      const left = event.code === 'KeyH' || letter === 'h' || letter === '\b';
      const right = event.code === 'KeyL' || letter === 'l' || letter === '\f';
      if (left || right) {
        event.preventDefault();
        this._switchShortcutHelpCategory(ui, left ? -1 : 1);
        return;
      }
    }
    if (key === 'ctrl+f') {
      event.preventDefault(); this._focusShortcutHelp(ui); ui.input.select(); return;
    }
    const onList = event.target === ui.list;
    let delta = 0;
    if (['ctrl+j', 'ctrl+n', 'arrowdown'].includes(key) || (onList && key === 'j')) delta = 60;
    if (['ctrl+k', 'ctrl+p', 'arrowup'].includes(key) || (onList && key === 'k')) delta = -60;
    if (['pagedown', 'ctrl+d'].includes(key) || (onList && key === ' ')) {
      delta = ui.list.clientHeight * (event.shiftKey ? -0.8 : 0.8);
    }
    if (['pageup', 'ctrl+u'].includes(key)) delta = -ui.list.clientHeight * 0.8;
    if (delta) { event.preventDefault(); ui.list.scrollTop += delta; return; }
    if (onList && ['home', 'end', 'G', 'g'].includes(key)) {
      event.preventDefault();
      ui.list.scrollTop = ['end', 'G'].includes(key) ? ui.list.scrollHeight : 0;
      return;
    }
    if (!ui.overlay.contains(event.target)) {
      event.preventDefault(); this._focusShortcutHelp(ui);
    }
  },

  _syncShortcutHelp(owner) {
    const ui = owner?._shortcutHelp;
    if (!ui) return;
    const views = owner.reader?._internalReader;
    if (ui.sourceWin.closed || !ui.overlay.isConnected
        || ui.tabID !== ui.win.Zotero_Tabs?.selectedID
        || (views && ![views._primaryView?._iframeWindow,
          views._secondaryView?._iframeWindow].includes(ui.sourceWin))
        || (ui.scope === 'noteNormal' && owner._contextNoteEditorDoc !== ui.sourceDoc)) {
      this._closeShortcutHelp(owner, false);
    }
  },

  /** Restore selection/focus only on user dismissal in the same live input context. */
  _closeShortcutHelp(owner, restore = true) {
    const ui = owner?._shortcutHelp;
    if (!ui) return;
    owner._shortcutHelp = null;
    clearTimeout(ui.timer);
    for (const [target, type, handler] of ui.listeners) {
      try { target.removeEventListener(type, handler, true); } catch (_) {}
    }
    try { ui.overlay?.remove(); } catch (_) {}
    if (!restore || ui.sourceWin.closed || ui.tabID !== ui.win.Zotero_Tabs?.selectedID) return;
    const views = owner.reader?._internalReader;
    if (views && ![views._primaryView?._iframeWindow,
      views._secondaryView?._iframeWindow].includes(ui.sourceWin)) return;
    if (ui.scope === 'noteNormal' && owner._contextNoteEditorDoc !== ui.sourceDoc) return;
    try {
      ui.sourceWin.focus();
      if (ui.focus?.isConnected) ui.focus.focus();
      if (ui.textSelection && ui.focus?.isConnected) {
        ui.focus.setSelectionRange(...ui.textSelection);
      } else if (ui.anchor && ui.anchor[0].isConnected && ui.anchor[2].isConnected) {
        ui.sourceWin.getSelection().setBaseAndExtent(...ui.anchor);
      } else if (ui.ranges.length && ui.ranges.every(range => range.commonAncestorContainer.isConnected)) {
        const selection = ui.sourceWin.getSelection();
        selection.removeAllRanges();
        for (const range of ui.ranges) selection.addRange(range);
      }
    } catch (_) {}
  },
});

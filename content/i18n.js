"use strict";

/* global Zotero, Components */
/* eslint-disable no-unused-vars */

// ── Localization for the preferences pane ─────────────────────────────────────
// Loaded before prefs.js via Zotero.PreferencePanes.register (scripts array).
// English action labels live in prefs.js's ZV_ACTION_LABELS; this file only
// supplies the zh-CN action labels and the dictionary/apply helpers.

// Legacy preference branch, kept for migration/compatibility with the
// original zotero-vim add-on.
const ZV_I18N_PREFIX = "extensions.zotero-vim@zotero-vim.";
const ZV_XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const ZV_I18N = {
  en: {
    "zv.lang.label":        "Language",
    "zv.modes":             "Modes",
    "zv.mode.visual":       "Enable Visual mode (v — select text and annotate)",
    "zv.mode.insert":       "Enable Insert / passthrough mode (i — disable vim keys temporarily)",
    "zv.mode.noteEditor":   "Enable Vim-style editing in note editors (context pane and note tabs)",
    "zv.scroll":            "Scroll",
    "zv.scroll.help":       "Pick one scrolling mode for j/k/H/L — only its parameters are shown.",
    "zv.scroll.mode":       "Scrolling mode",
    "zv.scroll.mode.step":  "Step scrolling",
    "zv.scroll.mode.follow": "Constant-speed scrolling",
    "zv.scroll.mode.trapezoid": "Accelerating (trapezoid curve)",
    "zv.scroll.step":       "Scroll step (pixels)",
    "zv.scroll.followSpeed": "Scroll speed (px/s)",
    "zv.scroll.initialSpeed": "Initial speed (px/s)",
    "zv.scroll.maxSpeed":   "Max speed (px/s)",
    "zv.scroll.accel":      "Acceleration (px/s²)",
    "zv.scroll.decel":      "Deceleration (px/s²)",
    "zv.scroll.stopOnRelease": "Stop immediately on key release instead of decelerating",
    "zv.scroll.autosave":   "Scroll settings save automatically on change.",
    "zv.marks":             "Marks",
    "zv.marks.persist":     "Persist marks in the parent item's Extra field (m / ` / dm) — survive restarts and sync",
    "zv.marks.staged":      "Marks settings save automatically on change.",
    "zv.color.group":       "Default highlight colour",
    "zv.color.help":        "Used when no explicit colour prefix is given (zh in the default bindings, if bound).",
    "zv.color.default":     "Default colour",
    "zv.color.opt.yellow":  "Yellow  (#FFD400)",
    "zv.color.opt.red":     "Red     (#FF6666)",
    "zv.color.opt.green":   "Green   (#5FB236)",
    "zv.color.opt.blue":    "Blue    (#2EA8E5)",
    "zv.color.opt.purple":  "Purple  (#A28AE5)",
    "zv.bindings":          "Keybindings",
    "zv.bindings.help1":    "Each row binds a key sequence in a given mode to an action.",
    "zv.bindings.help2a":   "Click a ",
    "zv.bindings.help2b":   "Key sequence",
    "zv.bindings.help2c":   " cell to edit it.",
    "zv.bindings.help3a":   "Use lowercase letters; prefix with ",
    "zv.bindings.help3b":   " for Ctrl/Cmd.",
    "zv.bindings.help4a":   "Multi-key sequences such as ",
    "zv.bindings.help4b":   " or ",
    "zv.bindings.help4c":   " are supported.",
    "zv.bindings.add":      "+ Add binding",
    "zv.bindings.reset":    "Reset to defaults",
    "zv.bindings.mode":     "Mode",
    "zv.bindings.key":      "Key sequence",
    "zv.bindings.action":   "Action",
    "zv.bindings.footer":   "Modes, marks, colour and scroll settings save automatically.",
    "zv.bindings.apply":    "Apply bindings",
    "zv.status.saved":      "Saved!",
  },
  "zh-CN": {
    "zv.lang.label":        "语言",
    "zv.modes":             "模式",
    "zv.mode.visual":       "启用可视模式（v — 选择文本并标注）",
    "zv.mode.insert":       "启用插入 / 透传模式（i — 临时禁用 vim 按键）",
    "zv.mode.noteEditor":   "在笔记编辑器中启用类 Vim 编辑（侧栏面板和笔记标签页）",
    "zv.scroll":            "滚动",
    "zv.scroll.help":       "为 j/k/H/L 选择一种滚动模式 — 仅显示当前模式的参数。",
    "zv.scroll.mode":       "滚动模式",
    "zv.scroll.mode.step":  "步进模式",
    "zv.scroll.mode.follow": "匀速跟随模式",
    "zv.scroll.mode.trapezoid": "梯形加速模式",
    "zv.scroll.step":       "滚动步长（像素）",
    "zv.scroll.followSpeed": "滚动速度（px/s）",
    "zv.scroll.initialSpeed": "初始速度（px/s）",
    "zv.scroll.maxSpeed":   "最大速度（px/s）",
    "zv.scroll.accel":      "加速度（px/s²）",
    "zv.scroll.decel":      "减速度（px/s²）",
    "zv.scroll.stopOnRelease": "松开按键立即停止而不是减速",
    "zv.scroll.autosave":   "滚动设置在更改时自动保存。",
    "zv.marks":             "标记",
    "zv.marks.persist":     "将标记保存到父条目的 Extra 字段（m / ` / dm）— 重启后保留并同步",
    "zv.marks.staged":      "标记设置在更改时自动保存。",
    "zv.color.group":       "默认高亮颜色",
    "zv.color.help":        "未按显式颜色前缀时使用（默认绑定中的 zh，若已绑定）。",
    "zv.color.default":     "默认颜色",
    "zv.color.opt.yellow":  "黄色  (#FFD400)",
    "zv.color.opt.red":     "红色     (#FF6666)",
    "zv.color.opt.green":   "绿色   (#5FB236)",
    "zv.color.opt.blue":    "蓝色    (#2EA8E5)",
    "zv.color.opt.purple":  "紫色  (#A28AE5)",
    "zv.bindings":          "按键绑定",
    "zv.bindings.help1":    "每一行将某个模式下的键序列绑定到一个动作。",
    "zv.bindings.help2a":   "点击",
    "zv.bindings.help2b":   "键序列",
    "zv.bindings.help2c":   "单元格即可编辑。",
    "zv.bindings.help3a":   "使用小写字母；以",
    "zv.bindings.help3b":   "前缀表示 Ctrl/Cmd。",
    "zv.bindings.help4a":   "支持",
    "zv.bindings.help4b":   "或",
    "zv.bindings.help4c":   "等多键序列。",
    "zv.bindings.add":      "+ 添加绑定",
    "zv.bindings.reset":    "重置为默认值",
    "zv.bindings.mode":     "模式",
    "zv.bindings.key":      "键序列",
    "zv.bindings.action":   "动作",
    "zv.bindings.footer":   "模式、标记、颜色与滚动设置在更改时自动保存。",
    "zv.bindings.apply":    "应用绑定",
    "zv.status.saved":      "已保存！",
  },
};

// zh-CN labels for the keybinding action dropdown. English labels are kept in
// prefs.js's ZV_ACTION_LABELS (single source of truth for the "en" language).
const ZV_I18N_ACTION_LABELS = {
  scrollDown:               "向下滚动",
  scrollUp:                 "向上滚动",
  scrollLeft:               "向左滚动（Shift+h）",
  scrollRight:              "向右滚动（Shift+l）",
  prevPage:                 "上一页",
  nextPage:                 "下一页",
  firstPage:                "第一页（gg）",
  lastPage:                 "最后一页（G）",
  halfPageDown:             "向下半页",
  halfPageUp:               "向上半页",
  fullPageDown:             "向下整页",
  fullPageUp:               "向上整页",
  scrollTop:                "滚动 — 当前页面到视图顶部（zt）",
  scrollCenter:             "滚动 — 当前页面到视图中央（zz）",
  scrollBottom:             "滚动 — 当前页面到视图底部（zb）",
  openSearch:               "打开查找栏",
  findNext:                 "跳转到下一个搜索结果（n）",
  findPrevious:             "跳转到上一个搜索结果（N）",
  prevAnnotation:           "跳到上一个标注",
  nextAnnotation:           "跳到下一个标注",
  clearSearch:              "清除 / 关闭搜索",
  enterVisual:              "进入可视模式",
  enterCursor:              "进入光标模式（c）",
  enterInsert:              "进入插入模式（选中标注时聚焦其注释）",
  exitMode:                 "退出到普通模式",
  extendDown:               "扩展选择 — 向下（行）",
  extendUp:                 "扩展选择 — 向上（行）",
  extendLeft:               "扩展选择 — 向左（字符）",
  extendRight:              "扩展选择 — 向右（字符）",
  extendSentenceForward:    "扩展选择 — 下一个句首（)）",
  extendSentenceBackward:   "扩展选择 — 上一个句首（(）",
  extendParagraphForward:   "扩展选择 — 段落结尾（}）",
  extendParagraphBackward:  "扩展选择 — 段落开头（{）",
  extendWordForward:        "扩展选择 — 下一个单词",
  extendWordBackward:       "扩展选择 — 上一个单词",
  extendLineStart:          "扩展选择 — 当前行行首（0）",
  extendLineEnd:            "扩展选择 — 当前行行尾（$）",
  cursorDown:               "光标按可视行下移（光标模式）",
  cursorUp:                 "光标按可视行上移（光标模式）",
  cursorLeft:               "光标按字符左移（光标模式）",
  cursorRight:              "光标按字符右移（光标模式）",
  cursorWordForward:        "光标向前移动一个单词（光标模式）",
  cursorBigWordForward:     "光标向前移动一个 WORD（光标模式）",
  cursorWordBackward:       "光标向后移动一个单词（光标模式）",
  cursorBigWordBackward:    "光标向后移动一个 WORD（光标模式）",
  cursorLineStart:          "光标移动到行首（光标模式）",
  cursorLineEnd:            "光标移动到行尾（光标模式）",
  cursorToVisual:           "从当前光标位置进入可视模式（光标模式）",
  highlightYellow:          "高亮 — 黄色",
  highlightRed:             "高亮 — 红色",
  highlightGreen:           "高亮 — 绿色",
  highlightBlue:            "高亮 — 蓝色",
  highlightPurple:          "高亮 — 紫色",
  addNote:                  "添加笔记 / 注释",
  copySelection:            "将选区复制到剪贴板",
  searchSelection:          "打开查找栏并搜索选区（#）",
  swapVisualEnds:           "交换选区锚点 / 焦点 — 跳到另一端（o）",
  editAnnotation:           "打开标注注释进行编辑（在 [ / ] 之后）",
  deleteAnnotation:         "删除所选标注（dd）",
  filterYellow:             "筛选侧边栏 → 黄色标注（Zy）",
  filterRed:                "筛选侧边栏 → 红色标注（Zr）",
  filterGreen:              "筛选侧边栏 → 绿色标注（Zg）",
  filterBlue:               "筛选侧边栏 → 蓝色标注（Zb）",
  filterPurple:             "筛选侧边栏 → 紫色标注（Zp）",
  filterClear:              "清除标注颜色筛选（Za）",
  recolorYellow:            "将标注颜色改为黄色（[ / ] 之后按 zy）",
  recolorRed:               "将标注颜色改为红色（[ / ] 之后按 zr）",
  recolorGreen:             "将标注颜色改为绿色（[ / ] 之后按 zg）",
  recolorBlue:              "将标注颜色改为蓝色（[ / ] 之后按 zb）",
  recolorPurple:            "将标注颜色改为紫色（[ / ] 之后按 zp）",
  yankAnnotation:           "复制标注高亮文本（[ / ] 之后按 y）",
  yankAnnotationComment:    "复制标注注释文本（[ / ] 之后按 yy）",
  yankParagraph:            "将整个段落复制到剪贴板（可视模式下按 yy）",
  mainFuzzyAll:             "主窗口：模糊选择器 — 所有条目（<space>ff）",
  mainFuzzyCollection:      "主窗口：模糊选择器 — 当前分类（<space>fb）",
  mainNotesLayout:          "主窗口：打开笔记布局（<space>n）",
  mainFocusTree:            "主窗口：聚焦分类树（<space>e）",
  mainFocusLeft:            "主窗口：聚焦分类树（<space>wh）",
  mainFocusRight:           "主窗口：聚焦详情面板（<space>wl）",
  mainFocusItems:           "主窗口：聚焦条目列表（<space>ww）",
  mainYankCitekey:          "主窗口：复制 BetterBibTeX citekey（<space>yy）",
  mainOpenPDF:              "主窗口：打开所选条目的 PDF（<space>o）",
  mainClosePDF:             "主窗口：关闭活动 PDF 标签页（<space>q）",
  mainFocusSearch:          "主窗口：聚焦搜索栏（<space>/）",
  mainNavDown:              "主窗口：向下导航（j）",
  mainNavUp:                "主窗口：向上导航（k）",
  mainNavFirst:             "主窗口：跳到第一个条目（gg）",
  mainNavLast:              "主窗口：跳到最后一个条目（G）",
  mainActivate:             "主窗口：打开所选条目的 PDF（Enter）",
  mainTabPick:              "主窗口：标签选择器（<space>bj）",
  mainPrevTab:              "主窗口：切换到上一个标签页（J）",
  mainNextTab:              "主窗口：切换到下一个标签页（K）",
  mainTreeToggle:           "主窗口：切换分类展开 / 折叠（za）",
  mainTreeOpenOnly:         "主窗口：仅展开分类（zo）",
  mainTreeCloseOnly:        "主窗口：仅折叠分类（zc）",
  mainTreeExpand:           "主窗口：展开分类或进入条目列表（l）",
  mainTreeCollapse:         "主窗口：折叠分类或移到父级（h）",
  mainTreeParent:           "主窗口：跳到父分类（Backspace）",
  mainTreeExpandAll:        "主窗口：展开所有分类（R）",
  mainTreeCollapseAll:      "主窗口：折叠所有分类（M）",
  focusReaderSplitLeft:     "阅读器：聚焦左侧分栏面板（水平分栏中则切换）",
  focusReaderSplitDown:     "阅读器：聚焦下方分栏面板（垂直分栏中则切换）",
  focusReaderSplitUp:       "阅读器：聚焦上方分栏面板（垂直分栏中则切换）",
  focusReaderSplitRight:    "阅读器：聚焦右侧分栏面板（水平分栏中则切换）",
  toggleReaderSplitHorizontal: "阅读器：切换水平分栏（<space>-）",
  toggleReaderSplitVertical:   "阅读器：切换垂直分栏（<space>|）",
  toggleReaderSidebarOutline:  "阅读器：切换目录浏览浮层（<space>e）",
  focusReaderSidebar:          "阅读器：聚焦或重新打开目录浏览浮层",
  toggleMarksExplorer:         "阅读器：切换标记浏览浮层（<space>m）",
};

function _zvI18nPrefs() {
  return Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefBranch);
}

// Read the saved language pref; "" when unset.
function ZV_I18N_READ_LANG() {
  try {
    const p = _zvI18nPrefs();
    const full = ZV_I18N_PREFIX + "language";
    if (p.getPrefType(full) !== 0) {
      const v = p.getStringPref(full);
      if (v === "en" || v === "zh-CN") return v;
    }
  } catch (_) {}
  return "";
}

// Follow the Zotero UI language unless the user has chosen explicitly.
function ZV_I18N_DEFAULT_LANG() {
  try {
    if (typeof Zotero !== "undefined" && Zotero.locale && /^zh/i.test(Zotero.locale)) {
      return "zh-CN";
    }
  } catch (_) {}
  try {
    const svc = Components.classes["@mozilla.org/intl/locale-service;1"]
      .getService(Components.interfaces.nsILocaleService);
    if (/^zh/i.test(svc.getLocaleComponentForUserAgent())) return "zh-CN";
  } catch (_) {}
  return "en";
}

function ZV_I18N_CURRENT_LANG() {
  const saved = ZV_I18N_READ_LANG();
  return saved || ZV_I18N_DEFAULT_LANG();
}

function ZV_I18N_STR(key, lang) {
  const dict = ZV_I18N[lang] || ZV_I18N.en;
  if (dict[key] != null) return dict[key];
  if (ZV_I18N.en[key] != null) return ZV_I18N.en[key];
  return key;
}

// Action dropdown labels: en comes from prefs.js's ZV_ACTION_LABELS (loaded
// after this file), zh-CN from ZV_I18N_ACTION_LABELS.
function ZV_I18N_ACTION(action, lang) {
  if (lang === "zh-CN" && ZV_I18N_ACTION_LABELS[action]) return ZV_I18N_ACTION_LABELS[action];
  if (typeof ZV_ACTION_LABELS !== "undefined" && ZV_ACTION_LABELS[action]) return ZV_ACTION_LABELS[action];
  return action;
}

// Apply the dictionary to every [data-i18n] element in the pane.
function ZV_I18N_APPLY(doc, lang) {
  const dict = ZV_I18N[lang] || ZV_I18N.en;
  for (const el of doc.querySelectorAll("[data-i18n]")) {
    const text = dict[el.getAttribute("data-i18n")];
    if (text == null) continue;
    if (el.namespaceURI === ZV_XUL_NS) {
      if (el.localName === "label") el.setAttribute("value", text);
      else if (el.localName === "checkbox" || el.localName === "button") el.setAttribute("label", text);
      else if (el.localName === "menulist" || el.localName === "menuitem") el.setAttribute("label", text);
      else el.textContent = text;
    } else {
      el.textContent = text;
    }
  }
}

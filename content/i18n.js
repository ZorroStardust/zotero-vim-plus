"use strict";

/* global Zotero, Components, ZV_KEYMAP_LABELS */
/* eslint-disable no-unused-vars */

// ── Localization for the preferences pane ─────────────────────────────────────
// Loaded before prefs.js via Zotero.PreferencePanes.register (scripts array).
// Action descriptions are shared through keymapLabels.js; this file supplies
// the preferences UI dictionary and localization helpers.

// Legacy preference branch, kept for migration/compatibility with the
// original zotero-vim add-on.
const ZV_I18N_PREFIX = "extensions.zotero-vim@zotero-vim.";
const ZV_XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const ZV_I18N = {
  en: {
    "zv.lang.label":        "Language",
    "zv.modes":             "Modes",
    "zv.mode.visual":       "Enable Visual mode (v — select text and annotate)",
    "zv.mode.cursor":       "Enable Cursor mode (c — move a text caret without selecting)",
    "zv.mode.insert":       "Enable Insert / passthrough mode (i — disable vim keys temporarily)",
    "zv.mode.noteEditor":   "Enable Vim-style editing in note editors (context pane and note tabs)",
    "zv.note.lineNumbers":  "Show absolute line numbers in note editors",
    "zv.note.lineNumbers.help": "Numbers match 12G / 12gg; wrapped text keeps the same number. Requires note Vim mode.",
    "zv.reader.progress":    "Reader page progress",
    "zv.reader.progress.off": "Off",
    "zv.reader.progress.transient": "Briefly after navigation",
    "zv.reader.progress.always": "Always visible",
    "zv.reader.progress.help": "Shows page/total and percentage in the small mode indicator.",
    "zv.spacekeys.enabled": "Show leader-key hints in the bottom-right corner",
    "zv.spacekeys.help": "Press Space to see available chords. Works in the library, reader and note Normal mode.",
    "zv.spacekeys.delay": "Popup delay (ms)",
    "zv.spacekeys.timeout": "Leader chord timeout (seconds)",
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
    "zv.bindings.help3a":   "Keys are case-sensitive (g and G differ); prefix with ",
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
    "zv.bindings.unbind":   "Unbind this key (then Apply bindings)",
    "zv.bindings.unbindHelp": "× unbinds a key after Apply, including defaults. Use <space> for a leading Space key. Note editing commands are fixed, not remapped here.",
    "zv.bindings.error.empty": "Enter a key, or delete this row to unbind it.",
    "zv.bindings.error.key": "Invalid key. Examples: G, gg, ctrl+f, alt+arrowleft, <space>ff. Use uppercase letters instead of shift+.",
    "zv.bindings.error.count": "An initial 1–9 is reserved for repeat counts in this mode.",
    "zv.bindings.error.insert": "Insert bindings must be a single key, not a multi-key sequence.",
    "zv.bindings.error.duplicate": "This mode + key is repeated; keep only one row.",
    "zv.bindings.error.summary": "Bindings not applied: fix the marked rows. Your saved bindings are unchanged.",
    "zv.bindings.error.save": "Could not save bindings. Your edits remain in the table; try again.",
    "zv.status.saved":      "Saved!",
  },
  "zh-CN": {
    "zv.lang.label":        "语言",
    "zv.modes":             "模式",
    "zv.mode.visual":       "启用可视模式（v — 选择文本并标注）",
    "zv.mode.cursor":       "启用光标模式（c — 移动文本光标，不选中文本）",
    "zv.mode.insert":       "启用插入 / 透传模式（i — 临时禁用 vim 按键）",
    "zv.mode.noteEditor":   "在笔记编辑器中启用类 Vim 编辑（侧栏面板和笔记标签页）",
    "zv.note.lineNumbers":  "在笔记编辑器中显示绝对行号",
    "zv.note.lineNumbers.help": "行号与 12G / 12gg 一致；自动折行不增加编号。需启用笔记 Vim 模式。",
    "zv.reader.progress":    "阅读器页码与进度",
    "zv.reader.progress.off": "关闭",
    "zv.reader.progress.transient": "导航后短暂显示",
    "zv.reader.progress.always": "始终显示",
    "zv.reader.progress.help": "在小型模式指示器中显示当前页/总页数和百分比。",
    "zv.spacekeys.enabled": "在右下角显示 Space 组合键提示",
    "zv.spacekeys.help": "按 Space 查看可用组合键；支持文献库、阅读器和笔记普通模式。",
    "zv.spacekeys.delay": "提示显示延迟（毫秒）",
    "zv.spacekeys.timeout": "组合键等待时间（秒）",
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
    "zv.bindings.help3a":   "区分大小写（g 与 G 不同）；以",
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
    "zv.bindings.unbind":   "解绑此按键（随后点击应用绑定）",
    "zv.bindings.unbindHelp": "× 删除后点击应用，即可解绑，包括默认按键。开头空格写作 <space>。笔记编辑命令是固定键位，不在此处重映射。",
    "zv.bindings.error.empty": "请输入按键；如需解绑，请删除此行。",
    "zv.bindings.error.key": "无效按键。示例：G、gg、ctrl+f、alt+arrowleft、<space>ff。不要写 shift+，请直接使用大写字母。",
    "zv.bindings.error.count": "此模式下开头的 1–9 保留用于重复次数，不能绑定。",
    "zv.bindings.error.insert": "插入模式只能绑定单次按键，不能使用多键序列。",
    "zv.bindings.error.duplicate": "同一模式中此按键重复，请只保留一行。",
    "zv.bindings.error.summary": "绑定未应用：请修正标出的行。已保存的绑定保持不变。",
    "zv.bindings.error.save": "保存绑定失败。编辑内容仍保留在表中，请重试。",
    "zv.status.saved":      "已保存！",
  },
};

// Shared zh-CN action descriptions for the keybinding dropdown.
const ZV_I18N_ACTION_LABELS = ZV_KEYMAP_LABELS["zh-CN"];

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

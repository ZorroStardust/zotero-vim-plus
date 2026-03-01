"use strict";

// ── Pref helpers ─────────────────────────────────────────────────────────────
// Uses raw XPCOM — the only thing reliably available in every Gecko chrome
// sandbox without imports or external globals.

const ZV_PREFIX = "extensions.zotero-vim@zotero-vim.";

function _zvPrefs() {
  return Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefBranch);
}

function _zvGet(key, fallback) {
  try {
    const p    = _zvPrefs();
    const full = ZV_PREFIX + key;
    const t    = p.getPrefType(full);
    if (t === 0)   return fallback;
    if (t === 128) return p.getBoolPref(full);
    if (t === 64)  return p.getIntPref(full);
    return p.getStringPref(full);
  } catch (_) {
    return fallback;
  }
}

function _zvSet(key, value) {
  try {
    const p    = _zvPrefs();
    const full = ZV_PREFIX + key;
    if (typeof value === "boolean")     p.setBoolPref(full, value);
    else if (typeof value === "number") p.setIntPref(full, value);
    else                                p.setStringPref(full, String(value));
  } catch (e) {
    dump("[ZoteroVim] prefs set failed (" + key + "): " + e + "\n");
  }
}

// ── Default bindings (kept in sync with zoteroVim.js) ────────────────────────
const ZV_DEFAULT_BINDINGS = {
  "normal:j":       "scrollDown",
  "normal:k":       "scrollUp",
  "normal:h":       "prevPage",
  "normal:l":       "nextPage",
  "normal:gg":      "firstPage",
  "normal:G":       "lastPage",
  "normal:ctrl+d":  "halfPageDown",
  "normal:ctrl+u":  "halfPageUp",
  "normal:ctrl+f":  "fullPageDown",
  "normal:ctrl+b":  "fullPageUp",
  "normal:/":       "openSearch",
  "normal:[":       "prevAnnotation",
  "normal:]":       "nextAnnotation",
  "normal:return":  "editAnnotation",
  "normal:dd":      "deleteAnnotation",
  "normal:y":       "yankAnnotation",
  "normal:yy":      "yankAnnotationComment",
  "normal:zt":      "scrollTop",
  "normal:zz":      "scrollCenter",
  "normal:zb":      "scrollBottom",
  "normal:v":       "enterVisual",
  "normal:i":       "enterInsert",
  "normal:escape":  "clearSearch",
  "visual:j":       "extendDown",
  "visual:k":       "extendUp",
  "visual:h":       "extendLeft",
  "visual:l":       "extendRight",
  "visual:)":       "extendSentenceForward",
  "visual:(":       "extendSentenceBackward",
  "visual:}":       "extendParagraphForward",
  "visual:{":       "extendParagraphBackward",
  "visual:w":       "extendWordForward",
  "visual:b":       "extendWordBackward",
  "visual:zy":      "highlightYellow",
  "visual:zr":      "highlightRed",
  "visual:zg":      "highlightGreen",
  "visual:zb":      "highlightBlue",
  "visual:zp":      "highlightPurple",
  "visual:za":      "addNote",
  "visual:y":       "copySelection",
  "visual:yy":      "yankParagraph",
  "visual:o":       "swapVisualEnds",
  "visual:v":       "exitMode",
  "visual:escape":  "exitMode",
  "insert:escape":  "exitMode",
};

const ZV_ACTION_LABELS = {
  scrollDown:              "Scroll down",
  scrollUp:                "Scroll up",
  prevPage:                "Previous page",
  nextPage:                "Next page",
  firstPage:               "First page (gg)",
  lastPage:                "Last page (G)",
  halfPageDown:            "Half-page down",
  halfPageUp:              "Half-page up",
  fullPageDown:            "Full-page down",
  fullPageUp:              "Full-page up",
  scrollTop:               "Scroll — current page to top of view (zt)",
  scrollCenter:            "Scroll — current page to center of view (zz)",
  scrollBottom:            "Scroll — current page to bottom of view (zb)",
  openSearch:              "Open find bar",
  prevAnnotation:          "Jump to previous annotation",
  nextAnnotation:          "Jump to next annotation",
  clearSearch:             "Clear / close search",
  enterVisual:             "Enter Visual mode",
  enterInsert:             "Enter Insert mode (focuses annotation comment if selected)",
  exitMode:                "Exit to Normal mode",
  extendDown:              "Extend selection — down (line)",
  extendUp:                "Extend selection — up (line)",
  extendLeft:              "Extend selection — left (char)",
  extendRight:             "Extend selection — right (char)",
  extendSentenceForward:   "Extend selection — next sentence start ())",
  extendSentenceBackward:  "Extend selection — previous sentence start (()",
  extendParagraphForward:  "Extend selection — paragraph end (})",
  extendParagraphBackward: "Extend selection — paragraph start ({)",
  extendWordForward:       "Extend selection — next word",
  extendWordBackward:      "Extend selection — previous word",
  highlightYellow:         "Highlight — Yellow",
  highlightRed:            "Highlight — Red",
  highlightGreen:          "Highlight — Green",
  highlightBlue:           "Highlight — Blue",
  highlightPurple:         "Highlight — Purple",
  addNote:                 "Add note / comment",
  copySelection:           "Copy selection to clipboard",
  swapVisualEnds:          "Swap selection anchor/focus — jump to other end (o)",
  editAnnotation:          "Open annotation comment for editing (after [ / ])",
  deleteAnnotation:        "Delete selected annotation (dd)",
  yankAnnotation:          "Copy annotation highlighted text (y after [ / ])",
  yankAnnotationComment:   "Copy annotation comment text (yy after [ / ])",
  yankParagraph:           "Copy whole paragraph to clipboard (yy in visual)",
};

const ZV_ALL_ACTIONS = Object.keys(ZV_ACTION_LABELS).sort();

// ── DOM init (retry until elements appear) ────────────────────────────────────

var _zvRetries = 0;

function _zvInit() {
  const scrollInput = document.getElementById("zv-scroll-step");
  if (!scrollInput) {
    if (++_zvRetries <= 40) {
      window.setTimeout(_zvInit, 50);
    }
    return;
  }
  if (scrollInput._zvInited) return;
  scrollInput._zvInited = true;

  // ── Modes ──────────────────────────────────────────────────────────────────
  const visualCb = document.getElementById("zv-visual-enabled");
  const insertCb = document.getElementById("zv-insert-enabled");

  if (visualCb) {
    visualCb.checked = _zvGet("mode.visual.enabled", true);
    visualCb.addEventListener("change", () => _zvSet("mode.visual.enabled", visualCb.checked));
  }
  if (insertCb) {
    insertCb.checked = _zvGet("mode.insert.enabled", true);
    insertCb.addEventListener("change", () => _zvSet("mode.insert.enabled", insertCb.checked));
  }

  // ── Scroll step ────────────────────────────────────────────────────────────
  scrollInput.value = _zvGet("scrollStep", 60);
  scrollInput.addEventListener("change", () => {
    const v = parseInt(scrollInput.value, 10);
    if (v >= 10 && v <= 500) _zvSet("scrollStep", v);
  });

  // ── Default highlight colour ───────────────────────────────────────────────
  const colorSelect = document.getElementById("zv-default-color");
  if (colorSelect) {
    const saved = _zvGet("defaultHighlightColor", "yellow");
    for (const opt of colorSelect.options) {
      if (opt.value === saved) { opt.selected = true; break; }
    }
    colorSelect.addEventListener("change", () => {
      _zvSet("defaultHighlightColor", colorSelect.value);
    });
  }

  // ── Keybindings table ──────────────────────────────────────────────────────
  let currentBindings = {};
  try {
    const raw = _zvGet("bindings", "");
    currentBindings = raw ? Object.assign({}, ZV_DEFAULT_BINDINGS, JSON.parse(raw))
                           : Object.assign({}, ZV_DEFAULT_BINDINGS);
  } catch (_) {
    currentBindings = Object.assign({}, ZV_DEFAULT_BINDINGS);
  }

  _zvRenderTable(currentBindings);

  const addBtn   = document.getElementById("zv-add-binding");
  const resetBtn = document.getElementById("zv-reset-bindings");

  if (addBtn)   addBtn.addEventListener("click",   _zvAddRow);
  if (resetBtn) resetBtn.addEventListener("click", () => {
    _zvRenderTable(ZV_DEFAULT_BINDINGS);
    _zvSaveBindings();
  });

  // ── Remove Save button — settings are live ────────────────────────────────
  const saveBtn    = document.getElementById("zv-save");
  const saveStatus = document.getElementById("zv-save-status");
  if (saveBtn) {
    saveBtn.textContent = "Apply bindings";
    saveBtn.addEventListener("click", () => {
      _zvSaveBindings();
      if (saveStatus) {
        saveStatus.textContent = "Saved!";
        window.setTimeout(() => { saveStatus.textContent = ""; }, 1500);
      }
    });
  }
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function _zvBindingsToRows(bindings) {
  const modeOrder = { normal: 0, visual: 1, insert: 2 };
  return Object.entries(bindings)
    .map(([full, action]) => {
      const colon = full.indexOf(":");
      return { mode: full.slice(0, colon), key: full.slice(colon + 1), action };
    })
    .sort((a, b) => {
      const d = (modeOrder[a.mode] ?? 9) - (modeOrder[b.mode] ?? 9);
      return d !== 0 ? d : a.key < b.key ? -1 : 1;
    });
}

function _zvMakeRow(mode, key, action, isNew) {
  const tr = document.createElement("tr");
  tr.style.borderBottom = "1px solid #eee";
  tr.dataset.mode = mode || "normal";   // CSS [data-mode=...] handles colouring

  // Mode cell
  const tdMode = document.createElement("td");
  tdMode.style.cssText = "padding:5px 10px;font-family:monospace;text-transform:uppercase;font-size:.85em;font-weight:bold;";

  if (isNew) {
    const modeSel = document.createElement("select");
    modeSel.style.cssText = "padding:2px 4px;font-family:monospace;";
    for (const m of ["normal", "visual", "insert"]) {
      const o = document.createElement("option");
      o.value = m; o.textContent = m;
      if (m === mode) o.selected = true;
      modeSel.appendChild(o);
    }
    modeSel.addEventListener("change", () => {
      tr.dataset.mode = modeSel.value;   // CSS re-colours via [data-mode]
    });
    tdMode.appendChild(modeSel);
    tr.dataset.newRow = "1";
  } else {
    tdMode.textContent = mode;
  }
  tr.appendChild(tdMode);

  // Key cell
  const tdKey   = document.createElement("td");
  tdKey.style.cssText = "padding:5px 10px;";
  const keyInput = document.createElement("input");
  keyInput.type  = "text";
  keyInput.value = key;
  keyInput.style.cssText = "font-family:monospace;width:120px;padding:2px 4px;";
  tdKey.appendChild(keyInput);
  tr.appendChild(tdKey);

  // Action cell
  const tdAct   = document.createElement("td");
  tdAct.style.cssText = "padding:5px 10px;";
  const actSel  = document.createElement("select");
  actSel.style.cssText = "width:100%;padding:2px 4px;";
  for (const a of ZV_ALL_ACTIONS) {
    const o = document.createElement("option");
    o.value = a; o.textContent = ZV_ACTION_LABELS[a] || a;
    if (a === action) o.selected = true;
    actSel.appendChild(o);
  }
  tdAct.appendChild(actSel);
  tr.appendChild(tdAct);

  // Delete cell
  const tdDel = document.createElement("td");
  tdDel.style.cssText = "padding:5px 6px;text-align:center;";
  const delBtn = document.createElement("button");
  delBtn.textContent = "×";
  delBtn.style.cssText = "cursor:pointer;padding:0 6px;font-size:1.1em;background:none;border:1px solid #ccc;border-radius:3px;";
  delBtn.addEventListener("click", () => tr.remove());
  tdDel.appendChild(delBtn);
  tr.appendChild(tdDel);

  return tr;
}

function _zvRenderTable(bindings) {
  const tbody = document.getElementById("zv-bindings-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const { mode, key, action } of _zvBindingsToRows(bindings)) {
    tbody.appendChild(_zvMakeRow(mode, key, action, false));
  }
}

function _zvAddRow() {
  const tbody = document.getElementById("zv-bindings-body");
  if (!tbody) return;
  tbody.appendChild(_zvMakeRow("normal", "", "scrollDown", true));
}

function _zvReadTable() {
  const tbody  = document.getElementById("zv-bindings-body");
  const result = {};
  if (!tbody) return result;
  for (const tr of tbody.querySelectorAll("tr")) {
    const keyInput = tr.querySelector("input");
    const actSel   = tr.querySelectorAll("select")[tr.dataset.newRow ? 1 : 0];
    const modeSel  = tr.dataset.newRow ? tr.querySelector("select") : null;
    const modeTd   = tr.querySelector("td:first-child");

    const mode   = modeSel ? modeSel.value : (modeTd?.textContent.trim().toLowerCase() || "");
    const key    = keyInput ? keyInput.value.trim().toLowerCase() : "";
    const action = actSel  ? actSel.value : "";

    if (mode && key && action) result[mode + ":" + key] = action;
  }
  return result;
}

function _zvSaveBindings() {
  const bindings = _zvReadTable();
  const isDefault = JSON.stringify(bindings) === JSON.stringify(ZV_DEFAULT_BINDINGS);
  _zvSet("bindings", isDefault ? "" : JSON.stringify(bindings));
}

// Boot
_zvInit();

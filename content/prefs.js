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
  "normal:H":       "scrollLeft",
  "normal:L":       "scrollRight",
  "normal:h":       "prevPage",
  "normal:l":       "nextPage",
  "normal:gg":      "firstPage",
  "normal:G":       "lastPage",
  "normal:ctrl+d":  "halfPageDown",
  "normal:ctrl+u":  "halfPageUp",
  "normal:ctrl+f":  "fullPageDown",
  "normal:ctrl+b":  "fullPageUp",
  "normal:/":       "openSearch",
  "normal:n":       "findNext",
  "normal:N":       "findPrevious",
  "normal:[":       "prevAnnotation",
  "normal:]":       "nextAnnotation",
  "normal:return":  "editAnnotation",
  "normal:dd":      "deleteAnnotation",
  "normal:zy":      "recolorYellow",
  "normal:zr":      "recolorRed",
  "normal:zg":      "recolorGreen",
  "normal:zb":      "recolorBlue",
  "normal:zp":      "recolorPurple",
  "normal:y":       "yankAnnotation",
  "normal:yy":      "yankAnnotationComment",
  "normal:zt":      "scrollTop",
  "normal:zz":      "scrollCenter",
  "normal:Zy":      "filterYellow",
  "normal:Zr":      "filterRed",
  "normal:Zg":      "filterGreen",
  "normal:Zb":      "filterBlue",
  "normal:Zp":      "filterPurple",
  "normal:Za":      "filterClear",
  "normal:v":       "enterVisual",
  "normal:c":       "enterCursor",
  "normal:i":       "enterInsert",
  "normal:J":       "mainPrevTab",
  "normal:K":       "mainNextTab",
  "normal:ctrl+h":  "focusReaderSplitLeft",
  "normal:ctrl+j":  "focusReaderSplitDown",
  "normal:ctrl+k":  "focusReaderSplitUp",
  "normal:ctrl+l":  "focusReaderSplitRight",
  "normal:escape":  "clearSearch",
  // Normal mode — space-chord bindings (delegate to main window)
  "normal: e":   "toggleReaderSidebarOutline",
  "normal: -":   "toggleReaderSplitHorizontal",
  "normal: |":   "toggleReaderSplitVertical",
  "normal: bj":  "mainTabPick",
  "normal: ff":  "mainFuzzyAll",
  "normal: fb":  "mainFuzzyCollection",
  "normal: n":   "mainNotesLayout",
  "normal: yy":  "mainYankCitekey",
  "normal: o":   "mainOpenPDF",
  "normal: q":   "mainClosePDF",
  "normal: m":   "toggleMarksExplorer",
  "visual:j":       "extendDown",
  "visual:k":       "extendUp",
  "visual:h":       "extendLeft",
  "visual:l":       "extendRight",
  "visual:0":       "extendLineStart",
  "visual:$":       "extendLineEnd",
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
  "visual:i":       "addNote",
  "visual:y":       "copySelection",
  "visual:yy":      "yankParagraph",
  "visual:#":       "searchSelection",
  "visual:o":       "swapVisualEnds",
  "visual:v":       "exitMode",
  "visual:escape":  "exitMode",
  "cursor:j":       "cursorDown",
  "cursor:k":       "cursorUp",
  "cursor:h":       "cursorLeft",
  "cursor:l":       "cursorRight",
  "cursor:w":       "cursorWordForward",
  "cursor:W":       "cursorBigWordForward",
  "cursor:b":       "cursorWordBackward",
  "cursor:B":       "cursorBigWordBackward",
  "cursor:0":       "cursorLineStart",
  "cursor:$":       "cursorLineEnd",
  "cursor:v":       "cursorToVisual",
  "cursor:escape":  "exitMode",
  "insert:escape":  "exitMode",
  // Main window — <space> chords
  // The space key generates ' ' so the key part starts with a space character.
  // Displayed as <space>xx in the UI to avoid confusion.
  "main: ff":   "mainFuzzyAll",
  "main: fb":   "mainFuzzyCollection",
  "main: bj":   "mainTabPick",
  "main: n":    "mainNotesLayout",
  "main: e":    "mainFocusTree",
  "main: yy":   "mainYankCitekey",
  "main: o":    "mainOpenPDF",
  "main: q":    "mainClosePDF",
  "main: /":    "mainFocusSearch",
  "main: wh":   "mainFocusLeft",
  "main: wl":   "mainFocusRight",
  "main: ww":   "mainFocusItems",
  // Main window — bare keys
  "main:j":      "mainNavDown",
  "main:k":      "mainNavUp",
  "main:h":      "mainTreeCollapse",
  "main:l":      "mainTreeExpand",
  "main:gg":     "mainNavFirst",
  "main:G":      "mainNavLast",
  "main:J":      "mainPrevTab",
  "main:K":      "mainNextTab",
  "main:za":     "mainTreeToggle",
  "main:zo":     "mainTreeOpenOnly",
  "main:zc":     "mainTreeCloseOnly",
  "main:R":      "mainTreeExpandAll",
  "main:M":      "mainTreeCollapseAll",
  "main:backspace": "mainTreeParent",
  "main:enter":     "mainActivate",
  "main:return":    "mainActivate",
};

const ZV_ACTION_LABELS = {
  scrollDown:              "Scroll down",
  scrollUp:                "Scroll up",
  scrollLeft:              "Scroll left (Shift+h)",
  scrollRight:             "Scroll right (Shift+l)",
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
  findNext:                "Jump to next search match (n)",
  findPrevious:            "Jump to previous search match (N)",
  prevAnnotation:          "Jump to previous annotation",
  nextAnnotation:          "Jump to next annotation",
  clearSearch:             "Clear / close search",
  enterVisual:             "Enter Visual mode",
  enterCursor:             "Enter Cursor mode (c)",
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
  extendLineStart:         "Extend selection — start of current line (0)",
  extendLineEnd:           "Extend selection — end of current line ($)",
  // Cursor mode
  cursorDown:              "Move caret down one visual line (cursor mode)",
  cursorUp:                "Move caret up one visual line (cursor mode)",
  cursorLeft:              "Move caret left one character (cursor mode)",
  cursorRight:             "Move caret right one character (cursor mode)",
  cursorWordForward:       "Move caret forward one word (cursor mode)",
  cursorBigWordForward:    "Move caret forward one WORD (cursor mode)",
  cursorWordBackward:      "Move caret backward one word (cursor mode)",
  cursorBigWordBackward:   "Move caret backward one WORD (cursor mode)",
  cursorLineStart:         "Move caret to start of line (cursor mode)",
  cursorLineEnd:           "Move caret to end of line (cursor mode)",
  cursorToVisual:          "Enter Visual mode from current caret (cursor mode)",
  highlightYellow:         "Highlight — Yellow",
  highlightRed:            "Highlight — Red",
  highlightGreen:          "Highlight — Green",
  highlightBlue:           "Highlight — Blue",
  highlightPurple:         "Highlight — Purple",
  addNote:                 "Add note / comment",
  copySelection:           "Copy selection to clipboard",
  searchSelection:         "Open find bar and search for selection (#)",
  swapVisualEnds:          "Swap selection anchor/focus — jump to other end (o)",
  editAnnotation:          "Open annotation comment for editing (after [ / ])",
  deleteAnnotation:        "Delete selected annotation (dd)",
  filterYellow:            "Filter sidebar → Yellow annotations (Zy)",
  filterRed:               "Filter sidebar → Red annotations (Zr)",
  filterGreen:             "Filter sidebar → Green annotations (Zg)",
  filterBlue:              "Filter sidebar → Blue annotations (Zb)",
  filterPurple:            "Filter sidebar → Purple annotations (Zp)",
  filterClear:             "Clear annotation colour filter (Za)",
  recolorYellow:           "Change annotation colour → Yellow (zy after [ / ])",
  recolorRed:              "Change annotation colour → Red (zr after [ / ])",
  recolorGreen:            "Change annotation colour → Green (zg after [ / ])",
  recolorBlue:             "Change annotation colour → Blue (zb after [ / ])",
  recolorPurple:           "Change annotation colour → Purple (zp after [ / ])",
  yankAnnotation:          "Copy annotation highlighted text (y after [ / ])",
  yankAnnotationComment:   "Copy annotation comment text (yy after [ / ])",
  yankParagraph:           "Copy whole paragraph to clipboard (yy in visual)",
  // Main window actions
  mainFuzzyAll:        "Main window: fuzzy picker — all items (<space>ff)",
  mainFuzzyCollection: "Main window: fuzzy picker — current collection (<space>fb)",
  mainNotesLayout:     "Main window: open notes layout (<space>n)",
  mainFocusTree:       "Main window: focus collection tree (<space>e)",
  mainFocusLeft:       "Main window: focus collection tree (<space>wh)",
  mainFocusRight:      "Main window: focus detail pane (<space>wl)",
  mainFocusItems:      "Main window: focus items list (<space>ww)",
  mainYankCitekey:     "Main window: copy BetterBibTeX citekey (<space>yy)",
  mainOpenPDF:         "Main window: open PDF of selected item (<space>o)",
  mainClosePDF:        "Main window: close active PDF tab (<space>q)",
  mainFocusSearch:     "Main window: focus search bar (<space>/)",
  mainNavDown:         "Main window: navigate down (j)",
  mainNavUp:           "Main window: navigate up (k)",
  mainNavFirst:        "Main window: go to first item (gg)",
  mainNavLast:         "Main window: go to last item (G)",
  mainActivate:        "Main window: open PDF of selected item (Enter)",
  mainTabPick:         "Main window: tab picker (<space>bj)",
  mainPrevTab:         "Main window: switch to previous tab (J)",
  mainNextTab:         "Main window: switch to next tab (K)",
  mainTreeToggle:      "Main window: toggle expand/collapse collection (za)",
  mainTreeOpenOnly:    "Main window: expand collection only (zo)",
  mainTreeCloseOnly:   "Main window: collapse collection only (zc)",
  mainTreeExpand:      "Main window: expand collection or enter item list (l)",
  mainTreeCollapse:    "Main window: collapse collection or move to parent (h)",
  mainTreeParent:      "Main window: jump to parent collection (Backspace)",
  mainTreeExpandAll:   "Main window: expand all collections (R)",
  mainTreeCollapseAll: "Main window: collapse all collections (M)",
  // Reader split view / outline
  focusReaderSplitLeft:   "Reader: focus left split pane (or toggle in horizontal split)",
  focusReaderSplitDown:   "Reader: focus lower split pane (or toggle in vertical split)",
  focusReaderSplitUp:     "Reader: focus upper split pane (or toggle in vertical split)",
  focusReaderSplitRight:  "Reader: focus right split pane (or toggle in horizontal split)",
  toggleReaderSplitHorizontal: "Reader: toggle horizontal split (<space>-)",
  toggleReaderSplitVertical:   "Reader: toggle vertical split (<space>|)",
  toggleReaderSidebarOutline:  "Reader: toggle outline explorer overlay (<space>e)",
  toggleMarksExplorer:         "Reader: toggle marks explorer overlay (<space>m)",
};

const ZV_ALL_ACTIONS = Object.keys(ZV_ACTION_LABELS).sort();

const ZV_SCROLL_DEFAULTS = {
  scrollStep: 60,
  smoothScroll: true,
  smoothInitialSpeed: 2000,
  smoothMaxSpeed: 2000,
  smoothAcceleration: 2600,
  smoothDeceleration: 4200,
  smoothStopOnRelease: false,
};

function _zvClampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _zvFlashStatus(el, text, color) {
  if (!el) return;
  el.textContent = text;
  if (color) el.style.color = color;
  window.setTimeout(() => { el.textContent = ""; }, 1800);
}

// XUL <checkbox> fires neither "change" nor "input": state changes arrive as
// "command" (click path) and "CheckboxStateChange" (checked setter — covers
// keyboard and programmatic toggles). Bind both, plus click, deduped by the
// last seen value so saving happens exactly once per toggle.
function _zvBindCheckbox(cb, onChange) {
  let last = cb.checked;
  const handler = () => {
    if (cb.checked === last) return;
    last = cb.checked;
    onChange(cb.checked);
  };
  cb.addEventListener("command", handler);
  cb.addEventListener("CheckboxStateChange", handler);
  cb.addEventListener("click", handler);
}

// Bind a checkbox to a pref key and flash "Saved!" feedback on toggle.
function _zvSaveCheckbox(cb, key, statusEl) {
  _zvBindCheckbox(cb, (value) => {
    _zvSet(key, value);
    _zvFlashStatus(statusEl, ZV_I18N_STR("zv.status.saved", ZV_I18N_CURRENT_LANG()), "#5FB236");
  });
}

// ── DOM init ─────────────────────────────────────────────────────────────────
// Zotero loads pane scripts BEFORE inserting the pane markup (see _loadPane()
// in Zotero's preferences.js), so _zvInit() must wait for the pane elements.
// A fixed retry budget silently kills the whole pane if the first insertion is
// slow (e.g. right after install), so the wait is unbounded: exponential
// backoff capped at 1s, plus a MutationObserver that wakes up the moment the
// markup lands.

var _zvInitTries = 0;
var _zvInitStarted = 0;
var _zvInitObserver = null;
var _zvLogTS = 0;

// Append a diagnostic line to <profile>/zv-startup.log (same file bootstrap.js
// uses) and mirror it to Zotero.debug.
function _zvLog(msg) {
  try { Zotero.debug('[ZoteroVim] [prefs] ' + msg); } catch (_) {}
  try {
    if (!_zvLogTS) _zvLogTS = Date.now();
    const dir = (typeof Zotero.getProfileDirectory === 'function')
      ? Zotero.getProfileDirectory()
      : Components.classes['@mozilla.org/file/directory_service;1']
          .getService(Components.interfaces.nsIProperties)
          .get('ProfD', Components.interfaces.nsIFile);
    const file = dir.clone();
    file.append('zv-startup.log');
    const stream = Components.classes['@mozilla.org/network/file-output-stream;1']
      .createInstance(Components.interfaces.nsIFileOutputStream);
    stream.init(file, 0x02 | 0x08 | 0x10, 0o600, 0);
    const line = (Date.now() - _zvLogTS) + 'ms  [prefs] ' + msg + '\n';
    stream.write(line, line.length);
    stream.close();
  } catch (_) {}
}

// Run one init section in isolation so a single failure can't kill the pane.
function _zvSection(name, fn) {
  try {
    fn();
    _zvLog('section "' + name + '" wired');
  } catch (e) {
    _zvLog('section "' + name + '" FAILED: ' + e);
    if (e && e.stack) _zvLog(e.stack);
  }
}

function _zvScheduleInit() {
  // 50ms → 100ms → 200ms → 400ms → 800ms → 1000ms (capped), forever.
  const delay = Math.min(1000, 50 * Math.pow(2, Math.min(5, _zvInitTries++)));
  window.setTimeout(_zvInit, delay);
}

// Wake up the moment the pane markup is inserted into the prefs document.
function _zvWatchForPane() {
  try {
    if (_zvInitObserver) return;
    _zvInitObserver = new MutationObserver(() => _zvInit());
    _zvInitObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
}

function _zvInit() {
  const scrollInput = document.getElementById("zv-scroll-step");
  if (!scrollInput) {
    _zvScheduleInit();
    return;
  }
  if (scrollInput._zvInited) return;
  scrollInput._zvInited = true;
  if (!_zvInitStarted) _zvInitStarted = Date.now();
  const lang = ZV_I18N_CURRENT_LANG();

  _zvSection("language", () => {
    const langSelect = document.getElementById("zv-language");
    if (langSelect) {
      langSelect.value = lang;
      langSelect.addEventListener("command", () => {
        const next = langSelect.value === "zh-CN" ? "zh-CN" : "en";
        _zvSet("language", next);
        ZV_I18N_APPLY(document, next);
        // Re-render action dropdowns with labels in the new language,
        // preserving any unsaved edits in the table.
        _zvRenderTable(_zvReadTable());
      });
    }
    ZV_I18N_APPLY(document, lang);
  });

  // ── Modes ──────────────────────────────────────────────────────────────────
  _zvSection("modes", () => {
    const visualCb = document.getElementById("zv-visual-enabled");
    const insertCb = document.getElementById("zv-insert-enabled");
    const noteEditorCb = document.getElementById("zv-note-editor-enabled");
    const modesStatus = document.getElementById("zv-modes-status");

    if (visualCb) {
      visualCb.checked = _zvGet("mode.visual.enabled", true);
      _zvSaveCheckbox(visualCb, "mode.visual.enabled", modesStatus);
    }
    if (insertCb) {
      insertCb.checked = _zvGet("mode.insert.enabled", true);
      _zvSaveCheckbox(insertCb, "mode.insert.enabled", modesStatus);
    }
    if (noteEditorCb) {
      noteEditorCb.checked = _zvGet("noteEditor.enabled", true);
      _zvSaveCheckbox(noteEditorCb, "noteEditor.enabled", modesStatus);
    }
  });

  // ── Marks ──────────────────────────────────────────────────────────────────
  _zvSection("marks", () => {
    const marksPersistCb = document.getElementById("zv-marks-persist-enabled");
    const marksStatus = document.getElementById("zv-marks-config-status");
    if (marksPersistCb) {
      marksPersistCb.checked = _zvGet("marks.persist", false);
      _zvSaveCheckbox(marksPersistCb, "marks.persist", marksStatus);
    }
  });

  // ── Scroll step ────────────────────────────────────────────────────────────
  _zvSection("scroll", () => {
    const smoothScrollCb = document.getElementById("zv-smooth-scroll-enabled");
    const initialSpeedInput = document.getElementById("zv-smooth-initial-speed");
    const maxSpeedInput = document.getElementById("zv-smooth-max-speed");
    const accelInput = document.getElementById("zv-smooth-accel");
    const decelInput = document.getElementById("zv-smooth-decel");
    const stopOnReleaseCb = document.getElementById("zv-smooth-stop-on-release");
    const scrollStatus = document.getElementById("zv-scroll-config-status");

    scrollInput.value = _zvGet("scrollStep", ZV_SCROLL_DEFAULTS.scrollStep);
    if (smoothScrollCb) {
      smoothScrollCb.checked = _zvGet("smoothScroll", ZV_SCROLL_DEFAULTS.smoothScroll);
    }
    if (initialSpeedInput) {
      initialSpeedInput.value = _zvGet("smoothScroll.initialSpeed", ZV_SCROLL_DEFAULTS.smoothInitialSpeed);
    }
    if (maxSpeedInput) {
      maxSpeedInput.value = _zvGet("smoothScroll.maxSpeed", ZV_SCROLL_DEFAULTS.smoothMaxSpeed);
    }
    if (accelInput) {
      accelInput.value = _zvGet("smoothScroll.acceleration", ZV_SCROLL_DEFAULTS.smoothAcceleration);
    }
    if (decelInput) {
      decelInput.value = _zvGet("smoothScroll.deceleration", ZV_SCROLL_DEFAULTS.smoothDeceleration);
    }
    if (stopOnReleaseCb) {
      stopOnReleaseCb.checked = _zvGet("smoothScroll.stopOnRelease", ZV_SCROLL_DEFAULTS.smoothStopOnRelease);
    }

    // Scroll settings save automatically on change; numeric inputs are clamped
    // on "change" (fires on blur / Enter), so typing is never interrupted.
    const saveScrollConfig = () => {
      const scrollStep = _zvClampInt(scrollInput.value, ZV_SCROLL_DEFAULTS.scrollStep, 10, 500);
      const initialSpeed = _zvClampInt(initialSpeedInput?.value, ZV_SCROLL_DEFAULTS.smoothInitialSpeed, 50, 2000);
      const maxSpeed = _zvClampInt(maxSpeedInput?.value, ZV_SCROLL_DEFAULTS.smoothMaxSpeed, 100, 6000);
      const acceleration = _zvClampInt(accelInput?.value, ZV_SCROLL_DEFAULTS.smoothAcceleration, 100, 10000);
      const deceleration = _zvClampInt(decelInput?.value, ZV_SCROLL_DEFAULTS.smoothDeceleration, 100, 12000);
      const finalMaxSpeed = Math.max(maxSpeed, initialSpeed);

      scrollInput.value = scrollStep;
      if (initialSpeedInput) initialSpeedInput.value = initialSpeed;
      if (maxSpeedInput) maxSpeedInput.value = finalMaxSpeed;
      if (accelInput) accelInput.value = acceleration;
      if (decelInput) decelInput.value = deceleration;

      _zvSet("scrollStep", scrollStep);
      _zvSet("smoothScroll", !!smoothScrollCb?.checked);
      _zvSet("smoothScroll.initialSpeed", initialSpeed);
      _zvSet("smoothScroll.maxSpeed", finalMaxSpeed);
      _zvSet("smoothScroll.acceleration", acceleration);
      _zvSet("smoothScroll.deceleration", deceleration);
      _zvSet("smoothScroll.stopOnRelease", !!stopOnReleaseCb?.checked);

      _zvFlashStatus(scrollStatus, ZV_I18N_STR("zv.status.saved", ZV_I18N_CURRENT_LANG()), "#5FB236");
    };

    scrollInput.addEventListener("change", saveScrollConfig);
    if (smoothScrollCb) _zvSaveCheckbox(smoothScrollCb, "smoothScroll", scrollStatus);
    if (initialSpeedInput) initialSpeedInput.addEventListener("change", saveScrollConfig);
    if (maxSpeedInput) maxSpeedInput.addEventListener("change", saveScrollConfig);
    if (accelInput) accelInput.addEventListener("change", saveScrollConfig);
    if (decelInput) decelInput.addEventListener("change", saveScrollConfig);
    if (stopOnReleaseCb) _zvSaveCheckbox(stopOnReleaseCb, "smoothScroll.stopOnRelease", scrollStatus);
  });

  // ── Default highlight colour ───────────────────────────────────────────────
  _zvSection("colour", () => {
    const colorSelect = document.getElementById("zv-default-color");
    const colorStatus = document.getElementById("zv-default-color-status");
    if (colorSelect) {
      colorSelect.value = _zvGet("defaultHighlightColor", "yellow");
      colorSelect.addEventListener("command", () => {
        _zvSet("defaultHighlightColor", colorSelect.value);
        _zvFlashStatus(colorStatus, ZV_I18N_STR("zv.status.saved", ZV_I18N_CURRENT_LANG()), "#5FB236");
      });
    }
  });

  // ── Keybindings table ──────────────────────────────────────────────────────
  _zvSection("bindings", () => {
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

    if (addBtn)   addBtn.addEventListener("click", _zvAddRow);
    if (resetBtn) resetBtn.addEventListener("click", () => {
      _zvRenderTable(ZV_DEFAULT_BINDINGS);
      _zvSaveBindings();
    });

    // ── Remove Save button — settings are live ──────────────────────────────
    const saveBtn    = document.getElementById("zv-save");
    const saveStatus = document.getElementById("zv-save-status");
    if (saveBtn) {
      saveBtn.textContent = ZV_I18N_STR("zv.bindings.apply", lang);
      saveBtn.addEventListener("click", () => {
        _zvSaveBindings();
        if (saveStatus) {
          _zvFlashStatus(saveStatus, ZV_I18N_STR("zv.status.saved", ZV_I18N_CURRENT_LANG()), "#5FB236");
        }
      });
    }
  });

  try { _zvInitObserver?.disconnect(); } catch (_) {}
  _zvLog('prefs init complete in ' + (Date.now() - _zvInitStarted) + 'ms ('
         + (_zvInitTries + 1) + ' attempts)');
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function _zvBindingsToRows(bindings) {
  const modeOrder = { normal: 0, visual: 1, insert: 2, main: 3 };
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

// Convert a stored key (e.g. " ff") to a display string (e.g. "<space>ff").
function _zvKeyToDisplay(key) {
  return key.replace(/^ /, "<space>");
}
// Convert a display string back to a stored key.
function _zvKeyFromDisplay(display) {
  return display.replace(/^<space>/, " ");
}

function _zvMakeRow(mode, key, action, isNew) {
  const lang = ZV_I18N_CURRENT_LANG();
  const tr = document.createElement("tr");
  tr.style.borderBottom = "1px solid #eee";
  tr.dataset.mode = mode || "normal";   // CSS [data-mode=...] handles colouring

  // Mode cell
  const tdMode = document.createElement("td");
  tdMode.style.cssText = "padding:5px 10px;font-family:monospace;text-transform:uppercase;font-size:.85em;font-weight:bold;";

  if (isNew) {
    const modeSel = document.createElement("select");
    modeSel.style.cssText = "padding:2px 4px;font-family:monospace;";
    for (const m of ["normal", "visual", "insert", "main"]) {
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
  keyInput.value = _zvKeyToDisplay(key);   // ' ff' → '<space>ff'
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
    o.value = a; o.textContent = ZV_I18N_ACTION(a, lang) || a;
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
    // Convert display form back to stored form ('<space>ff' → ' ff'), then
    // strip only trailing whitespace (leading space is the space-key leader).
    const rawKey = keyInput ? _zvKeyFromDisplay(keyInput.value).replace(/\s+$/, "") : "";
    // Preserve case for keys like G, Za, Zy etc. — only lowercase non-space chars
    // that aren't part of the space alias (already handled above).
    const key    = rawKey;   // keep original case from input
    const action = actSel  ? actSel.value : "";

    if (mode && key && action) result[mode + ":" + key] = action;
  }
  return result;
}

function _zvBindingsEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function _zvSaveBindings() {
  const bindings = _zvReadTable();
  const isDefault = _zvBindingsEqual(bindings, ZV_DEFAULT_BINDINGS);
  _zvSet("bindings", isDefault ? "" : JSON.stringify(bindings));
}

// Boot
_zvInit();
_zvWatchForPane();

/* global ZoteroVim, Zotero, Services, Components */
/* eslint-disable no-unused-vars */

/**
 * Issue #6 diagnostic build only. These observers never cancel events, edit
 * notes, change modes or forward keys. Recording needs an explicit click,
 * expires after 60 seconds and is bounded to 450 records per main window.
 * Never record note text, selection offsets, URLs, titles or element IDs.
 */
Object.assign(ZoteroVim, {
  NOTE_DIAGNOSTICS_VERSION: '1.9.1pre3',
  NOTE_DIAGNOSTICS_BUILD: 'issue-6-input-guard-3',
  NOTE_DIAGNOSTICS_SOURCE: '__NOTE_DIAGNOSTICS_SOURCE_SHA256__',
  NOTE_DIAGNOSTICS_LIMIT: 450,

  _initNoteDiagnostics(win, winState) {
    if (this.version !== this.NOTE_DIAGNOSTICS_VERSION || winState._noteDiagnostics) return;
    const doc = win.document;
    const html = 'http://www.w3.org/1999/xhtml';
    const panel = doc.createElementNS(html, 'div');
    panel.setAttribute('style', [
      'position:fixed', 'bottom:10px', 'left:12px', 'z-index:100000',
      'background:#242424', 'color:#fff', 'padding:8px 10px',
      'border:1px solid #777', 'border-radius:5px', 'font:12px/1.5 sans-serif',
      'max-width:440px', 'box-shadow:0 2px 8px #0005',
    ].join(';'));
    const label = doc.createElementNS(html, 'div');
    label.textContent = 'Issue #6 diagnostics — ' + this.version;
    panel.appendChild(label);
    const status = doc.createElementNS(html, 'div');
    status.textContent = 'Not recording. Use a disposable test note.';
    panel.appendChild(status);
    const output = doc.createElementNS(html, 'textarea');
    output.readOnly = true;
    output.hidden = true;
    output.setAttribute('style', 'display:block;width:400px;height:160px;margin-top:6px;');
    // hidden must not be overridden by display:block on Gecko HTML elements.
    output.style.display = 'none';
    const data = {
      win, panel, status, output, active: false, records: [], listeners: [],
      editorListeners: [], noteWin: null, noteDoc: null, observer: null,
      eventIDs: new WeakMap(), windowIDs: new WeakMap(), nextEvent: 0, nextWindow: 0,
      pending: new Map(), nextPending: 0, scheduled: new WeakSet(), timer: null,
      startedAt: null, elapsedMs: 0, stoppedReason: 'not-started', stopping: false,
      lastNativeDoc: null, lastSelection: null, lastNormalMotion: null,
    };
    winState._noteDiagnostics = data;
    for (const [title, action] of [
      ['Start recording', () => this._startNoteDiagnostics(winState)],
      ['Stop', () => this._stopNoteDiagnostics(winState, 'user')],
      ['Copy report', () => this._copyNoteDiagnostics(winState)],
    ]) {
      const button = doc.createElementNS(html, 'button');
      button.textContent = title;
      button.setAttribute('style', 'margin:4px 5px 0 0;padding:2px 6px;cursor:pointer;');
      button.addEventListener('click', action);
      panel.appendChild(button);
    }
    panel.appendChild(output);
    (doc.body || doc.documentElement).appendChild(panel);
    this._listenNoteDiagnostics(winState, win, 'main-window', data.listeners);
    this._listenNoteDiagnostics(winState, doc, 'main-document', data.listeners);
  },

  _listenNoteDiagnostics(winState, target, source, listeners) {
    for (const type of [
      'keydown', 'keypress', 'keyup', 'beforeinput', 'input',
      'compositionstart', 'compositionend',
    ]) {
      for (const capture of [true, false]) {
        const handler = event => {
          const data = winState._noteDiagnostics;
          if (!data?.active) return;
          if (source.startsWith('main-')
              && !this._noteDiagnosticsRelevant(winState, event)) return;
          this._noteDiagnosticsEvent(winState, event,
            source + (capture ? '-capture' : '-bubble'));
          if (data.active && capture && !data.scheduled.has(event)) {
            data.scheduled.add(event);
            const id = ++data.nextPending;
            const finish = () => {
              data.pending.delete(id);
              this._noteDiagnosticsEvent(winState, event, source + '-after-dispatch');
            };
            const timer = data.win.setTimeout(finish, 0);
            data.pending.set(id, { timer, finish });
          }
        };
        try {
          target.addEventListener(type, handler, capture);
          listeners.push({ target, type, handler, capture });
        } catch (_) {
          this._noteDiagnosticsRecord(winState, 'listener-unavailable', { source, type });
        }
      }
    }
  },

  _noteDiagnosticsRelevant(winState, event) {
    const data = winState?._noteDiagnostics;
    if (!data?.active) return false;
    if (this._isStandaloneNoteTabSelected(data.win)
        || event.target?.ownerDocument === data.noteDoc) return true;
    try {
      return (!!data.noteWin && Services.focus?.focusedWindow === data.noteWin)
        || this._isMainNoteTextEditing(data.win, event);
    } catch (_) {
      return false;
    }
  },

  /** Anonymous window labels make forwarded/original events comparable. */
  _noteDiagnosticsWindow(data, win) {
    if (!win) return 'none';
    if (!data.windowIDs.has(win)) data.windowIDs.set(win, 'w' + (++data.nextWindow));
    return data.windowIDs.get(win);
  },

  _noteDiagnosticsRecord(winState, kind, details) {
    const data = winState?._noteDiagnostics;
    if (!data?.active) return;
    if (data.records.length < this.NOTE_DIAGNOSTICS_LIMIT) {
      data.records.push({
        n: data.records.length + 1, ms: Date.now() - data.startedAt, kind, ...details,
      });
    }
    if (data.records.length >= this.NOTE_DIAGNOSTICS_LIMIT && !data.stopping) {
      this._stopNoteDiagnostics(winState, 'record-limit');
    }
  },

  _noteDiagnosticsNativeState(data) {
    try {
      const editorWin = data.noteWin?.wrappedJSObject || data.noteWin;
      const view = editorWin?._currentEditorInstance?._editorCore?.view;
      if (!view?.state?.doc) return { nativeView: false };
      const selection = view.state.selection;
      const next = [selection.anchor, selection.head];
      const result = {
        nativeView: true,
        documentChanged: !!data.lastNativeDoc && data.lastNativeDoc !== view.state.doc,
        selectionChanged: !!data.lastSelection
          && (next[0] !== data.lastSelection[0] || next[1] !== data.lastSelection[1]),
      };
      data.lastNativeDoc = view.state.doc;
      data.lastSelection = next;
      return result;
    } catch (_) {
      return { nativeView: false, nativeStateUnavailable: true };
    }
  },

  _noteDiagnosticsEvent(winState, event, stage) {
    const data = winState?._noteDiagnostics;
    if (!data?.active) return;
    try {
      if (!data.eventIDs.has(event)) data.eventIDs.set(event, ++data.nextEvent);
      const mode = String(winState._contextNoteMode || 'normal');
      const enabled = this.isNoteEditorVimEnabled();
      const printable = typeof event.key === 'string' && event.key.length === 1;
      const motion = enabled && mode === 'normal' && /^[hjkl]$/.test(event.key || '')
        && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (event.type === 'keydown' && stage.endsWith('-capture')) {
        data.lastNormalMotion = motion ? event.key : null;
      }
      const namedKeys = [
        'Escape', 'Backspace', 'Delete', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown',
        'ArrowLeft', 'ArrowRight', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock',
        'Dead', 'Unidentified',
      ];
      const key = motion ? event.key : printable ? '[printable]'
        : namedKeys.includes(event.key) ? event.key : '[other]';
      const targetWin = event.target?.ownerDocument?.defaultView || null;
      const editable = event.target?.isContentEditable === true;
      // Element names are structural only; do not expose arbitrary custom tag names.
      const tag = String(event.target?.localName || '').toLowerCase();
      const target = /^(div|p|span|h[1-6]|body|html|input|textarea|iframe|browser)$/.test(tag)
        ? tag : 'other';
      const inputTypes = [
        'insertText', 'insertCompositionText', 'insertFromComposition',
        'insertReplacementText', 'insertParagraph', 'insertLineBreak',
        'deleteContentBackward', 'deleteContentForward', 'historyUndo', 'historyRedo',
        'insertFromPaste', 'insertFromDrop',
      ];
      this._noteDiagnosticsRecord(winState, 'event', {
        event: data.eventIDs.get(event), stage, type: event.type, mode, vimEnabled: enabled,
        key: /^key/.test(event.type) ? key : undefined,
        code: motion ? /^Key[A-Z]$/.test(event.code || '') ? event.code : '[other]' : undefined,
        eventView: this._noteDiagnosticsWindow(data, event.view),
        targetWindow: this._noteDiagnosticsWindow(data, targetWin),
        observedEditor: this._noteDiagnosticsWindow(data, data.noteWin),
        registeredEditor: this._noteDiagnosticsWindow(data, winState._contextNoteEditorWin),
        targetIsObservedEditor: !!targetWin && targetWin === data.noteWin,
        viewIsRegisteredEditor: !!event.view && event.view === winState._contextNoteEditorWin,
        focusedWindow: this._noteDiagnosticsWindow(data, Services.focus?.focusedWindow),
        focusIsObservedEditor: !!data.noteWin && Services.focus?.focusedWindow === data.noteWin,
        noteTab: this._isStandaloneNoteTabSelected(data.win),
        searchOpen: !!winState._contextNoteSearchUI, imeKeyCode: event.keyCode === 229,
        target, editable, trusted: event.isTrusted === true,
        phase: event.eventPhase, cancelable: event.cancelable === true,
        defaultPrevented: event.defaultPrevented === true,
        propagationStopped: event.cancelBubble === true, composing: event.isComposing === true,
        ctrl: !!event.ctrlKey, meta: !!event.metaKey, alt: !!event.altKey,
        shift: !!event.shiftKey, repeat: !!event.repeat,
        syntheticEditorCommand: event._zvNoteEditorCommand === true,
        inputType: event.inputType
          ? inputTypes.includes(event.inputType) ? event.inputType : '[other]' : undefined,
        dataLength: typeof event.data === 'string' ? event.data.length : undefined,
        dataMatchesLastNormalMotion: typeof event.data === 'string'
          ? !!data.lastNormalMotion && event.data === data.lastNormalMotion : undefined,
        ...this._noteDiagnosticsNativeState(data),
      });
    } catch (_) {
      this._noteDiagnosticsRecord(winState, 'event-unavailable', { stage });
    }
  },

  _disconnectNoteDiagnosticsEditor(data) {
    try { data.observer?.disconnect(); } catch (_) {}
    data.observer = null;
    for (const { target, type, handler, capture } of data.editorListeners) {
      try { target.removeEventListener(type, handler, capture); } catch (_) {}
    }
    data.editorListeners = [];
    data.noteWin = null;
    data.noteDoc = null;
    data.lastNativeDoc = null;
    data.lastSelection = null;
  },

  _syncNoteDiagnosticsEditor(win, winState, noteWin) {
    const data = winState?._noteDiagnostics;
    if (!data) return;
    const noteDoc = noteWin?.document || null;
    if (data.noteWin === noteWin && data.noteDoc === noteDoc) return;
    this._disconnectNoteDiagnosticsEditor(data);
    data.noteWin = noteWin;
    data.noteDoc = noteDoc;
    this._noteDiagnosticsRecord(winState, 'editor-binding', {
      found: !!noteWin, editor: this._noteDiagnosticsWindow(data, noteWin),
      noteTab: this._isStandaloneNoteTabSelected(win),
    });
    if (!noteWin || !noteDoc) return;
    this._listenNoteDiagnostics(winState, noteWin, 'editor-window', data.editorListeners);
    this._listenNoteDiagnostics(winState, noteDoc, 'editor-document', data.editorListeners);
    if (data.active) this._observeNoteDiagnosticsMutations(winState);
  },

  _observeNoteDiagnosticsMutations(winState) {
    const data = winState._noteDiagnostics;
    const editable = data.noteDoc?.querySelector('.ProseMirror');
    if (!editable || !data.noteWin?.MutationObserver) return;
    try {
      data.observer?.disconnect();
      data.observer = new data.noteWin.MutationObserver(records => {
        const changes = Array.from(records);
        this._noteDiagnosticsRecord(winState, 'editor-mutation', {
          mode: String(winState._contextNoteMode || 'normal'),
          characterDataRecords: changes.filter(r => r.type === 'characterData').length,
          childListRecords: changes.filter(r => r.type === 'childList').length,
          ...this._noteDiagnosticsNativeState(data),
        });
      });
      const options = Components.utils.cloneInto({
        childList: true, characterData: true, subtree: true,
      }, data.noteWin);
      data.observer.observe(editable, options);
    } catch (_) {
      this._noteDiagnosticsRecord(winState, 'mutation-observer-unavailable', {});
    }
  },

  _startNoteDiagnostics(winState) {
    const data = winState._noteDiagnostics;
    this._stopNoteDiagnostics(winState, 'restart');
    data.records = [];
    data.eventIDs = new WeakMap();
    data.windowIDs = new WeakMap();
    data.scheduled = new WeakSet();
    data.nextEvent = 0;
    data.nextWindow = 0;
    data.lastNormalMotion = null;
    data.lastNativeDoc = null;
    data.lastSelection = null;
    data.startedAt = Date.now();
    data.stoppedReason = 'recording';
    data.active = true;
    data.output.hidden = true;
    data.output.style.display = 'none';
    data.output.value = '';
    data.status.textContent = 'Recording for up to 60 seconds. Reproduce, then Copy report.';
    this._syncNoteDiagnosticsEditor(data.win, winState,
      this._getActiveMainNoteEditorWindow(data.win));
    this._observeNoteDiagnosticsMutations(winState);
    this._noteDiagnosticsRecord(winState, 'session-start', {
      vimEnabled: this.isNoteEditorVimEnabled(),
      noteTab: this._isStandaloneNoteTabSelected(data.win),
      editorFound: !!data.noteWin,
      editor: this._noteDiagnosticsWindow(data, data.noteWin),
      registeredEditor: this._noteDiagnosticsWindow(data, winState._contextNoteEditorWin),
      ...this._noteDiagnosticsNativeState(data),
    });
    data.timer = data.win.setTimeout(() => this._stopNoteDiagnostics(winState, 'timeout'), 60000);
  },

  _stopNoteDiagnostics(winState, reason) {
    const data = winState?._noteDiagnostics;
    if (!data?.active || data.stopping) return;
    data.stopping = true;
    try {
      for (const { timer, finish } of Array.from(data.pending.values())) {
        data.win.clearTimeout(timer);
        finish();
      }
      data.pending.clear();
      this._noteDiagnosticsRecord(winState, 'session-stop', { reason });
      data.active = false;
      data.elapsedMs = Date.now() - data.startedAt;
      data.stoppedReason = reason;
      data.win.clearTimeout(data.timer);
      data.timer = null;
      try { data.observer?.disconnect(); } catch (_) {}
      data.observer = null;
      data.status.textContent = 'Stopped (' + reason + '): ' + data.records.length + ' records.';
    } finally {
      data.stopping = false;
    }
  },

  _noteDiagnosticsReport(winState) {
    const data = winState._noteDiagnostics;
    const metadata = {
      build: this.NOTE_DIAGNOSTICS_BUILD, pluginVersion: this.version,
      sourceSHA256: this.NOTE_DIAGNOSTICS_SOURCE, zoteroVersion: Zotero.version || 'unknown',
      geckoVersion: Services.appinfo?.platformVersion || 'unknown',
      platform: data.win.navigator?.platform || 'unknown',
      startedAt: data.startedAt ? new Date(data.startedAt).toISOString() : null,
      elapsedMs: data.elapsedMs, stoppedReason: data.stoppedReason,
      recordCount: data.records.length,
      privacy: 'No note text, titles, URLs, item IDs, selection offsets or clipboard contents.',
    };
    return 'Zotero Vim Plus — issue #6 diagnostic report\n'
      + JSON.stringify(metadata, null, 2) + '\n\n'
      + data.records.map(record => JSON.stringify(record)).join('\n');
  },

  _copyNoteDiagnostics(winState) {
    const data = winState._noteDiagnostics;
    this._stopNoteDiagnostics(winState, 'copy-report');
    const report = this._noteDiagnosticsReport(winState);
    if (this._noteCopyText(report)) {
      data.status.textContent = 'Report copied (' + data.records.length + ' records).';
    } else {
      data.output.hidden = false;
      data.output.style.display = 'block';
      data.output.value = report;
      data.output.focus();
      data.output.select();
      data.status.textContent = 'Clipboard unavailable. Copy the selected report below.';
    }
  },

  _clearNoteDiagnostics(winState) {
    const data = winState?._noteDiagnostics;
    if (!data) return;
    this._stopNoteDiagnostics(winState, 'window-cleanup');
    this._disconnectNoteDiagnosticsEditor(data);
    for (const { target, type, handler, capture } of data.listeners) {
      try { target.removeEventListener(type, handler, capture); } catch (_) {}
    }
    data.panel.remove();
    winState._noteDiagnostics = null;
  },
});

// Observe the actual handlers as well as DOM phases. A consumed keydown never
// reaches later DOM observers, but the finally block records its final flags.
for (const [method, source] of [
  ['_onMainKeyDown', 'main-handler'],
  ['_onMainContextNoteKeyDown', 'note-handler'],
]) {
  const original = ZoteroVim[method];
  ZoteroVim[method] = function (event, win, winState) {
    const data = winState?._noteDiagnostics;
    const relevant = data?.active && (source === 'note-handler'
      || this._noteDiagnosticsRelevant(winState, event));
    if (relevant) this._noteDiagnosticsEvent(winState, event, source + '-before');
    try {
      return original.call(this, event, win, winState);
    } finally {
      if (relevant) this._noteDiagnosticsEvent(winState, event, source + '-after');
    }
  };
}

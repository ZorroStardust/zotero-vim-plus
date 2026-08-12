/* global Zotero, Services, Components */
/* eslint-disable no-unused-vars */

var ZoteroVim;

// Approximate app-process start time, for startup-timing diagnostics.
var APP_START_TS = Date.now();
var ZV_LOGFILE_TS = 0;

function log(msg) {
  Zotero.debug('[ZoteroVim] ' + msg);
}

/**
 * Append a timestamped line to <profile>/zv-startup.log.  The Error Console
 * can hide Zotero.debug output behind filters, so startup diagnostics are
 * also written to this file for reliable inspection.
 */
function zvLogFile(msg) {
  try {
    if (!ZV_LOGFILE_TS) ZV_LOGFILE_TS = Date.now();
    const dir = (typeof Zotero.getProfileDirectory === 'function')
      ? Zotero.getProfileDirectory()
      : Services.dirsvc.get('ProfD', Components.interfaces.nsIFile);
    const file = dir.clone();
    file.append('zv-startup.log');
    const stream = Components.classes['@mozilla.org/network/file-output-stream;1']
      .createInstance(Components.interfaces.nsIFileOutputStream);
    // nsIFileOutputStream: PR_APPEND | PR_WRONLY | PR_CREATE_FILE
    stream.init(file, 0x02 | 0x08 | 0x10, 0o600, 0);
    const line = (Date.now() - ZV_LOGFILE_TS) + 'ms  ' + msg + '\n';
    stream.write(line, line.length);
    stream.close();
  } catch (_) {}
}

async function startup({ id, version, rootURI }) {
  const T0 = Date.now();
  log('startup called at ' + T0 + ' (app process start +' + (T0 - APP_START_TS) + 'ms)');
  zvLogFile('startup called (app process +' + (T0 - APP_START_TS) + 'ms)');

  Services.scriptloader.loadSubScript(rootURI + 'content/zoteroVim.js');
  Services.scriptloader.loadSubScript(rootURI + 'content/zoteroVimReader.js');
  Services.scriptloader.loadSubScript(rootURI + 'content/zoteroVimMain.js');

  // Two-phase startup: wire up everything that does not need Zotero's full
  // initialization BEFORE Zotero.initializationPromise resolves.  Restored
  // reader tabs fire renderToolbar during initialization; if our listeners
  // are registered only afterwards, those events are missed and restored
  // readers stay dead until a later sweep tick.  init()/addToWindow() are
  // idempotent, so the post-await pass below is a safe safety net.
  try {
    ZoteroVim.init({ id, version, rootURI });
  } catch (e) {
    log('Early init failed: ' + e);
    zvLogFile('early init FAILED: ' + e);
  }
  try {
    for (const win of Zotero.getMainWindows()) {
      ZoteroVim.addToWindow(win);
    }
  } catch (e) {
    log('Early window injection failed: ' + e);
    zvLogFile('early window injection FAILED: ' + e);
  }

  await Zotero.initializationPromise;

  log('initializationPromise resolved at ' + Date.now()
      + ' (startup +' + (Date.now() - T0) + 'ms)');
  zvLogFile('initializationPromise resolved (startup +' + (Date.now() - T0) + 'ms)');

  // Re-run init so anything that was unavailable pre-init (e.g.
  // Zotero.PreferencePanes) gets registered; all registrations are guarded.
  try {
    ZoteroVim.init({ id, version, rootURI });
  } catch (e) {
    log('Init after initialization failed: ' + e);
  }
  try {
    for (const win of Zotero.getMainWindows()) {
      ZoteroVim.addToWindow(win);
    }
  } catch (e) {
    log('Window injection after init failed: ' + e);
  }
}

function onMainWindowLoad({ window }) {
  ZoteroVim?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  ZoteroVim?.removeFromWindow(window);
}

function shutdown() {
  log('Shutting down');
  ZoteroVim?.shutdown();
  ZoteroVim = undefined;
}

function install() {
  log('Installed');
}

function uninstall() {
  log('Uninstalled');
}

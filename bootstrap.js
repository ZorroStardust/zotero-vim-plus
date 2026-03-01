/* global Zotero, Services */
/* eslint-disable no-unused-vars */

var ZoteroVim;

function log(msg) {
  Zotero.debug('[ZoteroVim] ' + msg);
}

async function startup({ id, version, rootURI }) {
  log('Starting up v' + version);

  Services.scriptloader.loadSubScript(rootURI + 'content/zoteroVim.js');

  await Zotero.initializationPromise;

  ZoteroVim.init({ id, version, rootURI });

  for (const win of Zotero.getMainWindows()) {
    ZoteroVim.addToWindow(win);
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

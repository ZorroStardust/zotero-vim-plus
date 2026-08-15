#!/usr/bin/env node
/*
 * Consistency check between content/zoteroVim.js (DEFAULT_BINDINGS) and
 * content/prefs.js (ZV_DEFAULT_BINDINGS, ZV_ACTION_LABELS).
 *
 * These tables are maintained by hand in two files, so drift silently breaks
 * the Preferences panel: "Reset to defaults" and the action dropdown would
 * omit bindings/actions. Run from the repo root:
 *
 *   node tools/check-sync.js
 *
 * Exits 0 when everything is in sync, 1 otherwise.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readLines(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
}

// Find the line range of an object literal `name: { ... }` / `name = { ... }`.
// Line-based: the object must be flat (no nested braces), like the tables here.
function objectRange(lines, startRe, endRe) {
  let start = null;
  for (let i = 0; i < lines.length; i++) {
    if (start === null) {
      if (startRe.test(lines[i])) start = i;
    } else if (endRe.test(lines[i])) {
      return { start, end: i };
    }
  }
  throw new Error('object range not found: ' + startRe);
}

function extractTable(rel, startRe, endRe, pairRe) {
  const lines = readLines(rel);
  const { start, end } = objectRange(lines, startRe, endRe);
  const body = lines.slice(start, end).join('\n');
  const table = {};
  for (const m of body.matchAll(pairRe)) {
    table[m[1]] = m[2];
  }
  return table;
}

// Object literals silently discard duplicate keys (last one wins). Detect them
// explicitly, otherwise a duplicated default binding or action label would
// pass this script while still being wrong in the Preferences UI.
function reportDuplicateKeys(rel, startRe, endRe, pairRe, label) {
  const lines = readLines(rel);
  const { start, end } = objectRange(lines, startRe, endRe);
  const seen = new Map();
  for (let i = start; i <= end; i++) {
    for (const m of lines[i].matchAll(pairRe)) {
      if (seen.has(m[1])) {
        report(`${label} has duplicate key "${m[1]}" (first occurrence line ${seen.get(m[1]) + 1})`);
      } else {
        seen.set(m[1], i);
      }
    }
  }
}

let failed = false;

function report(msg) {
  failed = true;
  console.error('  [sync] ' + msg);
}

function diff(a, b) {
  return Object.keys(a).filter((k) => !(k in b));
}

const zoteroVimBindings = extractTable(
  'content/zoteroVim.js',
  /DEFAULT_BINDINGS\s*:\s*\{/,
  /^\s*\},\s*$/,
  /'([^']+)'\s*:\s*'([^']+)'/g
);

const prefsBindings = extractTable(
  'content/prefs.js',
  /ZV_DEFAULT_BINDINGS\s*=\s*\{/,
  /^\s*\};\s*$/,
  /"([^"]+)"\s*:\s*"([^"]+)"/g
);

const actionLabels = extractTable(
  'content/prefs.js',
  /ZV_ACTION_LABELS\s*=\s*\{/,
  /^\s*\};\s*$/,
  /^\s*(\w+)\s*:\s*"([^"]+)"/gm
);

const zhActionLabels = extractTable(
  'content/i18n.js',
  /ZV_I18N_ACTION_LABELS\s*=\s*\{/,
  /^\s*\};\s*$/,
  /^\s*(\w+)\s*:\s*"([^"]+)"/gm
);

console.log('[sync] zoteroVim.js bindings: ' + Object.keys(zoteroVimBindings).length);
console.log('[sync] prefs.js bindings:     ' + Object.keys(prefsBindings).length);
console.log('[sync] prefs.js action labels:' + Object.keys(actionLabels).length);
console.log('[sync] zh-CN action labels:   ' + Object.keys(zhActionLabels).length);

reportDuplicateKeys(
  'content/zoteroVim.js',
  /DEFAULT_BINDINGS\s*:\s*\{/,
  /^\s*\},\s*$/,
  /'([^']+)'\s*:\s*'([^']+)'/g,
  'zoteroVim.js DEFAULT_BINDINGS'
);
reportDuplicateKeys(
  'content/prefs.js',
  /ZV_DEFAULT_BINDINGS\s*=\s*\{/,
  /^\s*\};\s*$/,
  /"([^"]+)"\s*:\s*"([^"]+)"/g,
  'prefs.js ZV_DEFAULT_BINDINGS'
);
reportDuplicateKeys(
  'content/prefs.js',
  /ZV_ACTION_LABELS\s*=\s*\{/,
  /^\s*\};\s*$/,
  /^\s*(\w+)\s*:\s*"([^"]+)"/gm,
  'prefs.js ZV_ACTION_LABELS'
);

// 1. The two default-binding tables must be identical.
for (const key of diff(zoteroVimBindings, prefsBindings)) {
  report('binding missing in prefs.js ZV_DEFAULT_BINDINGS: "' + key + '"');
}
for (const key of diff(prefsBindings, zoteroVimBindings)) {
  report('binding present only in prefs.js (stale): "' + key + '"');
}
for (const key of Object.keys(zoteroVimBindings)) {
  if (zoteroVimBindings[key] !== prefsBindings[key]) {
    report(
      'binding value mismatch for "' + key + '": '
        + zoteroVimBindings[key] + ' vs ' + prefsBindings[key]
    );
  }
}

// 2. Every action used by a default binding must have a label, or the
//    Preferences action dropdown cannot represent it.
for (const action of new Set(Object.values(zoteroVimBindings))) {
  if (!(action in actionLabels)) {
    report('action missing from prefs.js ZV_ACTION_LABELS: ' + action);
  }
}

// 3. Binding modes must stay within the modes the Preferences panel can edit.
const supportedModes = new Set(['normal', 'visual', 'cursor', 'insert', 'main']);
for (const key of Object.keys(zoteroVimBindings)) {
  const mode = key.slice(0, key.indexOf(':'));
  if (!supportedModes.has(mode)) {
    report('binding uses unsupported mode "' + mode + '": "' + key + '"');
  }
}

// 4. English and zh-CN action dropdowns must contain the same actions.
for (const action of diff(actionLabels, zhActionLabels)) {
  report('action missing from zh-CN ZV_I18N_ACTION_LABELS: ' + action);
}
for (const action of diff(zhActionLabels, actionLabels)) {
  report('action present only in zh-CN ZV_I18N_ACTION_LABELS: ' + action);
}

if (failed) {
  console.error('[sync] FAILED — sync the tables above (see content/prefs.js).');
  process.exit(1);
}
console.log('[sync] OK — bindings and action labels are in sync.');

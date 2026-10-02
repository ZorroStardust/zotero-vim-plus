/* global require, __dirname, console */
// Run with: node tools/build-note-diagnostics.js
// Generate a separate test package without changing the stable manifest.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { checkPluginManifest } = require('./check-plugin-manifest');

const root = path.join(__dirname, '..');
const output = path.join(root, 'dist', 'note-diagnostics');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'zv-note-diagnostics-'));
const version = '1.9.1pre3';
const xpiName = 'zotero-vim-plus-' + version + '-diagnostics.xpi';
const zipName = 'zotero-vim-plus-issue-6-diagnostics.zip';
const files = ['bootstrap.js', 'content', 'icons'];

try {
  // Run the same checks as a normal build before creating the test artifact.
  execFileSync('bash', ['./build.sh'], { cwd: root, stdio: 'inherit' });
  fs.mkdirSync(output, { recursive: true });
  for (const name of files) fs.cpSync(path.join(root, name), path.join(stage, name), {
    recursive: true,
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  manifest.version = version;
  manifest.name = 'Zotero Vim Plus (Issue #6 Diagnostics)';
  // Zotero 10 requires applications.zotero.update_url even for local test
  // packages. Preserve the stable URLs and ID rather than invalidating the
  // manifest to disable updates.
  const errors = checkPluginManifest(manifest);
  if (errors.length) throw new Error('Invalid diagnostic manifest: ' + errors.join('; '));
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const hash = crypto.createHash('sha256');
  for (const name of [
    'bootstrap.js', 'content/zoteroVim.js', 'content/zoteroVimReader.js',
    'content/zoteroVimMain.js', 'content/zoteroVimNoteDiagnostics.js',
  ]) {
    hash.update(name + '\n');
    hash.update(fs.readFileSync(path.join(root, name)));
  }
  const sourceHash = hash.digest('hex');
  const diagnosticsPath = path.join(stage, 'content', 'zoteroVimNoteDiagnostics.js');
  const diagnostics = fs.readFileSync(diagnosticsPath, 'utf8');
  if (!diagnostics.includes("NOTE_DIAGNOSTICS_VERSION: '" + version + "'")) {
    throw new Error('Diagnostic version does not match the builder');
  }
  fs.writeFileSync(diagnosticsPath,
    diagnostics.replace('__NOTE_DIAGNOSTICS_SOURCE_SHA256__', sourceHash));
  const xpiPath = path.join(output, xpiName);
  const zipPath = path.join(output, zipName);
  // These exact paths are generated artifacts only, never repository sources.
  for (const generated of [xpiPath, zipPath]) fs.rmSync(generated, { force: true });
  execFileSync('zip', ['-qr', xpiPath, 'manifest.json', ...files], {
    cwd: stage, stdio: 'inherit',
  });
  const instructions = 'issue-6-diagnostics.md';
  fs.copyFileSync(path.join(root, 'docs', instructions), path.join(output, instructions));
  execFileSync('zip', ['-q', zipPath, xpiName, instructions], {
    cwd: output, stdio: 'inherit',
  });
  console.log('Diagnostic XPI: ' + xpiPath);
  console.log('GitHub attachment ZIP: ' + zipPath);
  console.log('Diagnostic source SHA256: ' + sourceHash);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

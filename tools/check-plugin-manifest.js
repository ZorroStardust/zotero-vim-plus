/* global require, module, __dirname, process, console, URL */
// Run with: node tools/check-plugin-manifest.js
// Validate a packaged manifest: unzip -p plugin.xpi manifest.json |
//   node tools/check-plugin-manifest.js --stdin
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

/** Mirror Zotero's extra manifest checks, not Firefox-only assumptions. */
function checkPluginManifest(manifest) {
  const errors = [];
  if (manifest?.manifest_version !== 2) errors.push('manifest_version must be 2');
  for (const key of ['name', 'version']) {
    if (typeof manifest?.[key] !== 'string' || !manifest[key]) {
      errors.push(key + ' not provided');
    }
  }
  const zotero = manifest?.applications?.zotero;
  for (const key of ['id', 'update_url', 'strict_max_version']) {
    if (typeof zotero?.[key] !== 'string' || !zotero[key]) {
      errors.push('applications.zotero.' + key + ' not provided');
    }
  }
  if (zotero?.update_url) {
    try {
      const url = new URL(zotero.update_url);
      if (url.protocol !== 'https:') errors.push('update_url must use HTTPS');
    } catch (_) {
      errors.push('update_url must be a valid URL');
    }
  }
  if (zotero?.strict_min_version?.split('.').includes('*')) {
    errors.push("The use of '*' in strict_min_version is invalid");
  }
  return errors;
}

module.exports = { checkPluginManifest };

if (require.main === module) {
  if (process.argv.includes('--stdin')) {
    const errors = checkPluginManifest(JSON.parse(fs.readFileSync(0, 'utf8')));
    assert.deepEqual(errors, [], errors.join('; '));
    console.log('Packaged Zotero manifest checks passed.');
  } else {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json')));
    let passed = 0;
    const check = (label, fn) => { fn(); passed++; console.log('  ok  ' + label); };
    const copy = () => JSON.parse(JSON.stringify(manifest));
    check('stable manifest provides all mandatory Zotero metadata', () => {
      assert.deepEqual(checkPluginManifest(manifest), []);
    });
    check('diagnostic name/version are valid when the required URL is retained', () => {
      const test = copy();
      test.version = '1.9.1pre3';
      test.name += ' (Issue #6 Diagnostics)';
      assert.deepEqual(checkPluginManifest(test), []);
    });
    check('missing update URL reproduces the pre1 installation rejection', () => {
      const test = copy();
      delete test.applications.zotero.update_url;
      assert.ok(checkPluginManifest(test)
        .includes('applications.zotero.update_url not provided'));
    });
    check('Firefox metadata cannot replace required Zotero application metadata', () => {
      const test = copy();
      delete test.applications.zotero;
      assert.equal(checkPluginManifest(test).length, 3);
    });
    check('wildcard minimum compatibility and invalid update URLs are rejected', () => {
      const test = copy();
      test.applications.zotero.strict_min_version = '7.*';
      test.applications.zotero.update_url = 'not a URL';
      assert.equal(checkPluginManifest(test).length, 2);
    });
    console.log('Zotero manifest checks passed (' + passed + ' cases).');
  }
}

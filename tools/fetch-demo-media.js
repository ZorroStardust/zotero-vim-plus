'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const LOCALES = ['en', 'zh-CN', 'es-ES', 'ja', 'ko', 'fr', 'it', 'de', 'ru'];
const FORMATS = ['mp4', 'gif', 'webp'];

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw new Error(`Could not download ${url}`, { cause: error });
      await delay(attempt * 1000);
    }
  }
}

async function main() {
  const [manifestPath, destination] = process.argv.slice(2);
  if (!manifestPath || !destination) {
    throw new Error('Usage: node tools/fetch-demo-media.js <manifest.json> <destination>');
  }

  const { repository, tag, assets } = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^promo-\d+$/.test(tag)) {
    throw new Error('Invalid promotional media release');
  }

  const names = LOCALES.flatMap(locale => FORMATS.map(format => `${locale}.${format}`));
  if (Object.keys(assets).length !== names.length) {
    throw new Error(`Expected ${names.length} promotional media files`);
  }
  for (const name of names) {
    const entry = assets[name];
    if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0
        || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid or missing manifest entry for ${name}`);
    }
  }

  const release = `https://github.com/${repository}/releases/download/${tag}`;
  await fs.mkdir(destination, { recursive: true });

  // Limit parallel downloads. Any missing or modified file stops the Pages build.
  for (let start = 0; start < names.length; start += 6) {
    await Promise.all(names.slice(start, start + 6).map(async name => {
      const bytes = await download(`${release}/${name}`);
      const { bytes: expectedSize, sha256 } = assets[name];
      if (bytes.length !== expectedSize || createHash('sha256').update(bytes).digest('hex') !== sha256) {
        throw new Error(`Promotional media integrity check failed for ${name}`);
      }
      await fs.writeFile(path.join(destination, name), bytes);
    }));
  }

  console.log(`Verified ${names.length} promotional media files from ${repository}@${tag}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

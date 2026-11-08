// Fetch the Electron zip for this platform/arch into a directory for Forge's `electronZipDir`
// (see forge.config.js, ELECTRON_ZIP_DIR). Tries GitHub, then npmmirror. Either way the zip is
// validated against electron/checksums.json from the npm package, so a mirror can't swap it.
// Usage: node scripts/fetch-electron.mjs <outDir> [arch] [platform]
import { downloadArtifact } from '@electron/get';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [outDir, arch = process.arch, platform = process.platform] = process.argv.slice(2);
if (!outDir) throw new Error('usage: fetch-electron.mjs <outDir> [arch] [platform]');
const read = (f) => JSON.parse(readFileSync(new URL(`../node_modules/electron/${f}`, import.meta.url)));
const opts = { version: read('package.json').version, artifactName: 'electron', platform, arch, checksums: read('checksums.json') };

let zip;
try {
  zip = await downloadArtifact(opts);
} catch (err) {
  console.log(`::warning::GitHub Electron download failed (${err.message}); using npmmirror, checksum-verified`);
  zip = await downloadArtifact({ ...opts, mirrorOptions: { mirror: 'https://npmmirror.com/mirrors/electron/' } });
}
mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, path.basename(zip));
copyFileSync(zip, dest);
console.log(dest);

import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { readFileSync } from 'node:fs';

// Official checksums shipped in the electron npm package. With these, @electron/get validates the
// cached zip (fetched by `npm ci`) offline; without them it fetches SHASUMS256.txt from GitHub
// uncached, and a GitHub 504 there forces a full re-download (and fails the build).
const electronChecksums = JSON.parse(readFileSync(new URL('./node_modules/electron/checksums.json', import.meta.url)));

// macOS signing + notarization, driven by env (local: ./.env via `make dist`; CI: repo secrets).
// APP_IDENTITY = Developer ID Application identity (name or SHA-1, `security find-identity -v -p codesigning`).
// Unset = unsigned build; identity without the Apple ID trio = signed but not notarized.
const { APP_IDENTITY, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env;
const notarize = APP_IDENTITY && APPLE_ID && APPLE_TEAM_ID && APPLE_APP_SPECIFIC_PASSWORD;
if (!APP_IDENTITY) console.warn('forge: APP_IDENTITY unset, building UNSIGNED');
else if (!notarize) console.warn('forge: Apple ID credentials incomplete, signing WITHOUT notarization');

export default {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.rgr4y.sky-toppower-psu',
    download: { checksums: electronChecksums },
    // CI: zip prefetched by scripts/fetch-electron.mjs (GitHub or checksum-verified mirror).
    ...(process.env.ELECTRON_ZIP_DIR && { electronZipDir: process.env.ELECTRON_ZIP_DIR }),
    // Hardened runtime + osx-sign's default Electron entitlements.
    ...(APP_IDENTITY && { osxSign: { identity: APP_IDENTITY } }),
    ...(notarize && {
      osxNotarize: { appleId: APPLE_ID, appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD, teamId: APPLE_TEAM_ID },
    }),
    icon: 'assets/icon',
    // Ship only what the app runs; the rest of the repo (docs, hardware dumps, tooling) stays out.
    // Plus assets/icon.png, the Linux window icon (main.js).
    ignore: (file) => file !== '' && !/^\/(main\.js|preload\.js|package\.json|src(\/.*)?|assets|assets\/icon\.png)$/.test(file),
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

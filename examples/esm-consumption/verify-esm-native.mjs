// verify:esm:native — confirms the *packed* package loads under native Node
// ESM, without a bundler.
//
// Background: verify:esm (issue #109) proves the ESM entry point bundles
// cleanly downstream. Review of the dual-package work (#108) found the gap
// that check cannot see: Parcel emits named imports for the CommonJS-only
// @eyevinn dependencies in dist/module.mjs. Bundlers accept those through
// their own CJS interop, but native Node only honors named imports from CJS
// that cjs-module-lexer can statically detect — and @eyevinn/csai-manager's
// Parcel-built CJS is not detectable, so the whole ESM entry throws at import
// time. That breaks non-bundled consumers, e.g. SSR frameworks that
// externalize dependencies and load them with plain Node.
//
// scripts/fix-esm-interop.mjs rewrites those imports at build time; this
// script is the regression gate proving the shipped artifact actually loads.
//
// It verifies the package exactly as a consumer receives it:
//   1. `npm pack` the repo (dist/ must already be built — run `npm run build`).
//   2. Install the tarball into a temporary project (fetches the package's
//      runtime dependencies from the registry).
//   3. Import the package by name with `node --input-type=module` and assert
//      the public API is present; also `require()` it to cover the CJS half of
//      the dual package.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const importTest = [
  "import * as m from '@eyevinn/webrtc-player';",
  "if (typeof m.WebRTCPlayer !== 'function')",
  "  throw new Error('WebRTCPlayer missing from ESM entry');",
  "if (typeof m.ListAvailableAdapters !== 'function')",
  "  throw new Error('ListAvailableAdapters missing from ESM entry');",
  "console.log('native ESM import OK');"
].join('\n');

const requireTest = [
  "const m = require('@eyevinn/webrtc-player');",
  "if (typeof m.WebRTCPlayer !== 'function')",
  "  throw new Error('WebRTCPlayer missing from CJS entry');",
  "console.log('CJS require OK');"
].join('\n');

async function main() {
  try {
    await access(resolve(repoRoot, 'dist', 'module.mjs'));
  } catch {
    throw new Error('dist/module.mjs not found — run `npm run build` first.');
  }

  const workDir = await mkdtemp(join(tmpdir(), 'webrtc-player-native-'));

  try {
    // Pack the package exactly as `npm publish` would ship it.
    const { stdout: packOut } = await run(
      'npm',
      ['pack', '--pack-destination', workDir],
      { cwd: repoRoot }
    );
    const tarball = join(workDir, packOut.trim().split('\n').pop());

    // A minimal consumer project; installing the tarball resolves the
    // package's runtime dependencies from the registry.
    await writeFile(
      join(workDir, 'package.json'),
      JSON.stringify({ name: 'native-esm-consumer', private: true })
    );
    await run('npm', ['install', '--no-audit', '--no-fund', tarball], {
      cwd: workDir
    });

    const { stdout: esmOut } = await run(
      process.execPath,
      ['--input-type=module', '-e', importTest],
      { cwd: workDir }
    );
    process.stdout.write(esmOut);

    const { stdout: cjsOut } = await run(
      process.execPath,
      ['-e', requireTest],
      { cwd: workDir }
    );
    process.stdout.write(cjsOut);

    console.log(
      'verify:esm:native OK — packed package loads under native Node (ESM import and CJS require).'
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(
    'verify:esm:native FAILED — packed package did not load under native Node.'
  );
  console.error(err && err.message ? err.message : err);
  if (err && err.stderr) {
    console.error(err.stderr);
  }
  process.exit(1);
});

// verify:esm — confirms the package can be consumed via its ESM entry point by
// a downstream bundler.
//
// Background: issue #68 reported that the CommonJS-only package broke downstream
// bundler builds (e.g. Cloudflare Pages). Issue #108 adds dual CJS+ESM output;
// this script (issue #109) is the reproducible verification that the ESM entry
// point actually bundles cleanly in a downstream build.
//
// It runs in two esbuild passes so it does not depend on any particular
// published-package layout and stays green regardless of how #108 finally wires
// up the `module`/`exports` fields:
//   1. Build an ESM bundle of the package from `src/index.ts` (format: 'esm').
//      This is the "ESM entry point" a downstream consumer would import.
//   2. Act as the downstream bundler: bundle `consumer.mjs`, which does
//      `import { WebRTCPlayer, ListAvailableAdapters } from '@eyevinn/webrtc-player'`,
//      aliasing the bare specifier to the ESM entry produced in step 1. If
//      resolution or ESM interop breaks, esbuild fails and this script exits 1.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const packageEntry = resolve(repoRoot, 'src', 'index.ts');
const consumerEntry = resolve(here, 'consumer.mjs');

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), 'webrtc-player-esm-'));
  const esmEntry = join(workDir, 'webrtc-player.esm.mjs');
  const downstreamBundle = join(workDir, 'downstream.mjs');

  try {
    // Pass 1: produce the package's ESM entry point.
    await build({
      entryPoints: [packageEntry],
      outfile: esmEntry,
      format: 'esm',
      bundle: true,
      platform: 'browser',
      // Keep runtime deps external — a downstream bundler resolves those too;
      // we only need to prove *this* package's source is ESM-consumable.
      packages: 'external',
      logLevel: 'silent'
    });
    await access(esmEntry);

    // Pass 2: the downstream bundler build, importing the ESM entry by its
    // package name.
    await build({
      entryPoints: [consumerEntry],
      outfile: downstreamBundle,
      format: 'esm',
      bundle: true,
      platform: 'browser',
      packages: 'external',
      alias: {
        '@eyevinn/webrtc-player': esmEntry
      },
      logLevel: 'silent'
    });
    await access(downstreamBundle);

    console.log(
      'verify:esm OK — downstream bundler resolved and built against the ESM entry point.'
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('verify:esm FAILED — ESM consumption did not build cleanly.');
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

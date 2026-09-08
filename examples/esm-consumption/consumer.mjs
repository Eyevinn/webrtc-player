// Minimal downstream consumer that imports the package's public API using
// ESM `import` syntax. If the package cannot be resolved/bundled as an ES
// module by a downstream bundler, bundling this file fails and `verify:esm`
// exits non-zero.
//
// The import specifier is rewritten to the freshly built ESM entry point by
// verify-esm.mjs via an esbuild alias, so this file mirrors exactly what a
// real downstream consumer writes:
//
//   import { WebRTCPlayer, ListAvailableAdapters } from '@eyevinn/webrtc-player';
import { WebRTCPlayer, ListAvailableAdapters } from '@eyevinn/webrtc-player';

// Reference the public exports so the bundler must actually resolve them and
// tree-shaking cannot drop the import.
export function smokeTest() {
  if (typeof WebRTCPlayer !== 'function') {
    throw new Error('WebRTCPlayer is not exported from the ESM entry point');
  }
  if (typeof ListAvailableAdapters !== 'function') {
    throw new Error(
      'ListAvailableAdapters is not exported from the ESM entry point'
    );
  }
  return { WebRTCPlayer, ListAvailableAdapters };
}

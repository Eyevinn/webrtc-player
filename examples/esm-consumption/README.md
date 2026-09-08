# ESM consumption verification

A lightweight, reproducible smoke check that confirms `@eyevinn/webrtc-player`
can be consumed via its **ESM entry point** by a downstream bundler.

## Why

Issue [#68](https://github.com/Eyevinn/webrtc-player/issues/68) reported that the
CommonJS-only package broke downstream bundler builds (e.g. Cloudflare Pages).
Dual CJS+ESM output was added in
[#108](https://github.com/Eyevinn/webrtc-player/issues/108); this check
([#109](https://github.com/Eyevinn/webrtc-player/issues/109)) is the automated
proof that the ESM path bundles cleanly downstream.

## What it does

`verify-esm.mjs` runs two `esbuild` passes:

1. Bundles the package source (`src/index.ts`) as an ESM module — the "ESM
   entry point" a downstream consumer imports.
2. Acts as the downstream bundler: bundles `consumer.mjs`, which does
   `import { WebRTCPlayer, ListAvailableAdapters } from '@eyevinn/webrtc-player'`,
   with the bare package specifier aliased to the ESM entry from step 1.

If resolution or ESM interop breaks, esbuild fails and the script exits non-zero.

## Run it

```
npm run verify:esm
```

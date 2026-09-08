// Post-build fixup for dist/module.mjs: make the ESM entry point loadable
// under native Node ESM (no bundler).
//
// Parcel emits named imports for externalized dependencies, e.g.
//
//   import {CSAIManager as $abc$CSAIManager} from "@eyevinn/csai-manager";
//
// Both @eyevinn runtime dependencies are published as CommonJS. When Node
// itself loads dist/module.mjs (SSR frameworks that externalize dependencies,
// or any non-bundled consumer), a named import from a CJS module only works if
// cjs-module-lexer can statically detect that export. @eyevinn/csai-manager is
// Parcel-built CJS whose exports are Object.defineProperty getters — not
// detectable — so the import above throws at load time:
//
//   SyntaxError: The requested module '@eyevinn/csai-manager' does not provide
//   an export named 'CSAIManager'
//
// Bundlers resolve the same import through their own CJS interop, which is why
// bundler-based checks (verify:esm) stay green. This script rewrites each
// named import from the packages listed below into a namespace import plus a
// destructuring assignment that works in both worlds:
//
//   import * as $ns from "@eyevinn/csai-manager";
//   const {CSAIManager: $abc$CSAIManager} =
//     $ns.CSAIManager !== undefined ? $ns : $ns.default;
//
// - native Node, non-lexable CJS: the name is absent on the namespace, so use
//   $ns.default (=== module.exports, which carries the getters);
// - native Node, lexable CJS / real ESM / bundler interop namespaces: the name
//   is present on the namespace, so use it directly.
//
// `npm run verify:esm:native` is the regression gate proving the shipped
// artifact actually loads under native Node.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runtime dependencies published as CommonJS that Parcel externalizes into
// named imports. Add a package here if a future dependency hits the same
// native-ESM named-import problem.
const CJS_PACKAGES = ['@eyevinn/csai-manager', '@eyevinn/whpp-client'];

const moduleFile = fileURLToPath(
  new URL('../dist/module.mjs', import.meta.url)
);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  if (!existsSync(moduleFile)) {
    console.error(
      `fix-esm-interop: ${moduleFile} not found — run the parcel build first.`
    );
    process.exit(1);
  }

  let source = readFileSync(moduleFile, 'utf8');
  let rewrites = 0;

  for (const pkg of CJS_PACKAGES) {
    const importRe = new RegExp(
      String.raw`import\s*\{([^}]*)\}\s*from\s*(["'])${escapeRegExp(pkg)}\2;?`,
      'g'
    );
    let index = 0;
    source = source.replace(importRe, (match, specifierList) => {
      const bindings = specifierList
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((specifier) => {
          const aliased = specifier.match(/^(\S+)\s+as\s+(\S+)$/);
          return aliased
            ? { imported: aliased[1], local: aliased[2] }
            : { imported: specifier, local: specifier };
        });
      if (bindings.length === 0) {
        return match;
      }
      const nsVar = `$interop$${pkg.replace(/[^A-Za-z0-9]+/g, '_')}$${index++}`;
      const destructure = bindings
        .map((b) =>
          b.imported === b.local ? b.imported : `${b.imported}: ${b.local}`
        )
        .join(', ');
      // Probing one name is enough: every binding comes from the same module
      // object, so they are either all on the namespace or all on `.default`.
      const probe = bindings[0].imported;
      rewrites += 1;
      return (
        `import * as ${nsVar} from "${pkg}";\n` +
        `const {${destructure}} = ${nsVar}.${probe} !== undefined ? ${nsVar} : ${nsVar}.default;`
      );
    });
    if (index === 0) {
      // Not an error: the dependency may have been dropped, or Parcel may have
      // emitted a different (already interop-safe) form. verify:esm:native is
      // the authoritative gate either way.
      console.log(`fix-esm-interop: no named imports of ${pkg} — skipped.`);
    }
  }

  writeFileSync(moduleFile, source);
  console.log(
    `fix-esm-interop: rewrote ${rewrites} import(s) in dist/module.mjs for native Node CJS interop.`
  );
}

main();

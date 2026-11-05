# Dependency compatibility

Electron stays on the latest 43.x release because the application builds Windows x86 packages. Electron 44 and later no
longer provide that architecture. TypeScript stays on 6.x because localization tests use its Compiler API, which
TypeScript 7.0 does not provide.

`@xyflow/react` is pinned to 12.12.1. Its node and viewport ResizeObservers update the React store during resize
delivery, which can cause another layout and an undelivered-notifications error when resizing images. `npm install`
and `npm ci` apply `scripts/install/patch-xyflow.mjs` to the ESM and UMD builds. The patch batches notifications into
the next task, drops pending entries on unobserve and cancels pending work on disconnect; it does not replace the global
ResizeObserver or suppress browser errors. Task scheduling also works in background tabs where animation frames can
pause. The installer clears Vite's prebundled dependency cache. The image-resizing tests capture window error events
across reloads.

Review and remove the patch when upgrading to an upstream release that resolves this behavior. The installer rejects an
unexpected version or observer implementation.
See [the upstream ResizeObserver report](https://github.com/xyflow/xyflow/issues/4792)
and [the browser scheduling guidance](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors).

The minimatch override replaces affected versions 7–10 with 11.0.4 or newer. Electron Builder's ASAR and download
dependencies are overridden to `@electron/asar` 4.3.1 and `@electron/get` 5.1.0. These remove glob 7, inflight and boolean.
They can be loaded from CommonJS on the Node versions in `engines`. Glob is overridden to 14.0.3 or newer to include
the AbortSignal cancellation fix.

`patch-electron-deps.mjs` adapts two remaining imports in version-checked upstream packages. `electron-updater` uses
the maintained full Lodash package's `isEqual` export through an npm alias, preserving its metadata comparison semantics.
`temp`, used by the Squirrel packaging dependency, uses rimraf 6 with an adapter for callbacks and retry options.
`tests/desktop/dependency-compat.test.ts` checks update-cache comparisons and tracked temporary-directory cleanup.

`patch-capacitor-gradle.mjs` migrates Capacitor 8's library scripts and generated Cordova module to current Android
and Gradle DSL syntax. It runs after npm installation and Capacitor sync, so regeneration keeps the migration.
Android uses AGP's built-in Kotlin support with Kotlin 2.4.21; legacy opt-out properties are removed.

`patch-y-tiptap.mjs` restores CRDT text selections with `TextSelection.between` so stale cursor positions at block
boundaries resolve to valid selections. It patches both module formats and the source of `@tiptap/y-tiptap` 3.1.0.
The attachment rename browser test checks that switching back to a document emits no TextSelection warnings.

Review these patches when upgrading the affected packages. Installation rejects unexpected upstream versions or
import/selection implementations rather than silently applying an unverified patch.

# AIDP Bridge beta39 — Hang-proof mutation runtime

## Root cause found after beta38 30-minute spin

Beta38 removed the intentional per-operation save waits, but two unbounded failure paths remained:

1. The native structural adapters still inspected/assimilated framework return values (`Promise.resolve(maybePromise)` / `.catch`) after `handleRemoveRegion()` and controlled `onChange()`. Those return values are not part of the proven AIDP contract. A pathological/non-settling thenable can monopolize the page microtask queue even when the actual UI mutation has already been accepted.
2. Mutation-critical `chrome.scripting.executeScript()` and `chrome.tabs.sendMessage()` calls had no independent hard deadline. Therefore the outer 30-second save window was not a real bound: one hung renderer/content call could prevent the loop from ever reaching its timeout check.

This explains why a transaction could spin much longer than the nominal 30s/6min limits.

## beta39 changes

- Completely discard native framework return values for `handleRemoveRegion()` and controlled `onChange()`; do not inspect `.then`, call `.catch`, or use `Promise.resolve()` on them.
- Add hard deadlines around mutation-critical MAIN-world script calls.
  - normal mutation script: 12s
  - save-trace script: 5s
- Add hard deadlines around content-adapter messages used by snapshot/table/text mutation paths.
- Renderer/content timeout is classified as an unknown/pending state, not as proof of failure. Automatic compensation is skipped while the renderer is unresponsive; the Side Panel reload/persistence path resolves the server-derived state safely.
- Preserve `defer_recovery` across adapter wrapping layers.
- Side Panel mutation jobs have a 3-minute hard wall-clock stop in addition to the Port watchdog.
- Save-ACK wait now displays elapsed progress instead of appearing frozen.
- Existing tab isolation, journal, backup, transaction-level final save ACK, reload verification, and no-submit/no-stage policy remain.

## Safety note

After a renderer timeout or a user-observed long hang, do not blindly replay the old patch. Reload and export the current case first, because the server may have persisted a prefix of the transaction.

## Static verification

- JavaScript syntax: PASS
- `beta39_hang_proof_runtime.test.js`: PASS
- patch engine: PASS
- structural patch engine: PASS
- recovery engine: PASS
- dangerous native thenable assimilation search: 0 hits

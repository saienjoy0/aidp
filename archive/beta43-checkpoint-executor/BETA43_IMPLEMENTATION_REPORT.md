# Beta43 Implementation Report — Reload Checkpoint Structural Executor

## Why this is a redesign, not a timeout tweak

Live Beta40–42 evidence shows AIDP is eventually consistent: native mutation calls can persist while React/Neeko Model, WaveSurfer, intercepted autosave payloads, or content adapter readiness remain stale. Beta42 still coupled structural invocation to same-renderer settlement and therefore produced false negatives.

Beta43 changes the structural write model to **command → save grace → reload → server-derived checkpoint → next command**.

## Structural execution contract

Any patch containing `add_region`, `delete_region`, or `split_region` uses `reload_checkpoint_v1`.

For each operation:
1. Start only from a reload-derived known canonical state.
2. Invoke one native mutation only.
3. Do not hard-fail based on immediate Model/Wave/React settlement.
4. Give AIDP 6.5 s normal autosave grace.
5. Reload the same AIDP tab.
6. Wait for normal manifest content script + Model/Wave/Table readiness without automatic content-script reinjection.
7. Capture a stable canonical snapshot.
8. Classify as expected / unchanged / other.
9. Continue only on exact expected state.

`add_region` is two-phase:
- native add creates only start/end;
- after reload, resolve the one new AIDP-issued formal ID by new-ID + start/end signature while requiring all pre-existing regions to remain semantically unchanged (round_id renumbering is allowed);
- apply requested text/speaker/voice_type to that resolved ID;
- reload again and require the full final expected state.

`split_region` is decomposed into:
- update first part → reload checkpoint;
- native add second part → reload + formal-ID resolution;
- apply second-part text/labels → reload final checkpoint.

## Other changes

- `handleRemoveRegion`, native add and `handleUpdateRegion` are invocation-only in their MAIN-world mutation functions.
- Normal `pingContent()` no longer auto-injects `content.js`; the manifest content script is allowed to load normally after reload.
- Mixed structural patches checkpoint every operation, including ordinary updates between structural changes.
- A checkpoint-confirmed structural job is already persistence-confirmed; Side Panel does not perform a redundant final reload.
- Structural checkpoint wall clock is bounded to 12 minutes and Side Panel watchdog to 13 minutes, with visible progress. This is a hard safety ceiling, not a success criterion.
- Unknown/partial states STOP FIRST; no automatic inverse writes.

## Validation completed locally

- Active JavaScript syntax: PASS
- `tests/beta43_version_sync.test.js`: PASS
- `tests/beta43_checkpoint_executor.test.js`: PASS
- `tests/patch_engine.test.js`: PASS
- `tests/recovery_engine.test.js`: PASS
- `tests/structural_patch_engine.test.js`: PASS
- ZIP integrity: PASS

## Not yet proven

Beta43 structural execution has **not yet been live-tested on AIDP**. Do not reuse the Beta42 structural patch until the post-Beta42-failure server state has been reloaded and exported as a fresh ZIP.

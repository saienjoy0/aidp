# Beta 17 Implementation Report

## Purpose

Beta 17 fixes the recovery deadlock discovered after the Beta 13 structural trial and observed again in Beta 16. A structural operation can partially mutate AIDP and then fail before the live state equals any completed dry-run checkpoint. Beta 16 only recognized the backup state or complete per-operation states, so an orphan region could leave the journal permanently in `recovery_required`.

## What changed

- Added `recovery_engine.js`, a pure recovery classifier.
- Structural rollback now inspects `applied`, `executing`, and `failed` operations in reverse order.
- It accepts only journal-attributable partial states:
  - add: remove the journal-created region;
  - delete: restore the known pre-delete region;
  - split: remove the journal-created second region and/or restore the original first region;
  - update: restore the known before value.
- A split-created region may be treated as journal-attributable when its transcription is either the intended text or empty. Any third/manual text is a conflict and automatic deletion stops.
- All unrelated regions must match the known pre-operation state. Unknown IDs or user edits stop recovery.
- `round_id` differences are ignored only during intermediate classification because AIDP may renumber during structural changes. Final success still requires the exact backup fingerprint to return and remain stable.
- Operation exceptions now persist `adapter_result`, error text, code, and failure timestamp to the journal before recovery begins.
- Recovery structural mutations verify normal AIDP temporary-save HTTP 200 / `data` / `dataMap` evidence, but do not automatically undo themselves when verification is uncertain; a later rollback attempt re-classifies live state.

## Safety gate

Normal `split_region`, `add_region`, and `delete_region` are disabled in Beta 17. The currently proven Neeko `handleAddRegion` accepts a fully formed region object including its ID; that is not evidence of AIDP's own ID-generation path. The Bridge must not invent production IDs. Structural methods remain available internally for recovery of already-journaled operations.

Enabled normal writes:

- `update_region`: ON (`start / end / text`)
- `set_labels`: OFF
- `split_region`: OFF
- `add_region`: OFF
- `delete_region`: OFF
- submit / temporary-save button automation: absent

## Regression coverage

CI/static tests pass:

- `tests/patch_engine.test.js`
- `tests/structural_patch_engine.test.js`
- `tests/recovery_engine.test.js`
- `tests/beta17_static.test.js`
- every JavaScript file: `node --check` PASS
- every JSON file: parse PASS

`recovery_engine.test.js` includes the known orphan shape `region_1785680637086_x3duart` and verifies both safe removal (empty journal-created text) and conflict behavior for manual edits.

## Completion status

- Source recovery from Git history: PASS
- Static Beta17 recovery implementation: PASS
- Normal update safety path retained: PASS in code; prior real-machine evidence exists, but Beta17 itself still needs a browser regression run
- Existing `recovery_required` orphan recovery: implemented; real AIDP run still required
- Level B normal split/add: NOT enabled; native AIDP ID-generation discovery and controlled real-machine persistence/rollback test still required
- submit / temporary-save button automation: NOT implemented

Beta 17 is the next real-machine recovery build. It does not claim Level B until the remaining AIDP-native structural path has been verified on the live site.

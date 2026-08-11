# Beta 18 Implementation Report

## Purpose

Beta 18 removes the main reason normal structural operations were disabled in Beta 17: the live AIDP template's production region-ID and `round_id` rules are now known from the loaded `单语新字幕对齐` raw UIDL.

## Proven live-template contract used by this implementation

- controlled region source: `form.regions`
- `regionsControlled: true`
- native new-region ID: `region_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
- native new-region defaults: speaker `1`, keep `保留`, quality `无问题`, voice type `说话`
- after structural/time change: stable sort by `start`, then `round_id = index + 1`
- speaker-filter mode locks structural/timestamp edits
- delete authority is `form.regions`; Wave region removal is only a UI/runtime fallback

No credential or captured raw UIDL is stored in this repository.

## Beta18 implementation

- `split_region`, `add_region`, `delete_region` normal feature flags enabled.
- Structural operations still require explicit per-operation approval after dry-run.
- Dry-run uses only `__aidp_bridge_native__...` logical placeholders. It does not invent a production `region_...` ID.
- Normal add/split calls the live template `onChange` with a transient non-production region ID, then resolves exactly one AIDP-generated formal ID from the controlled model.
- The placeholder→formal-ID mapping is persisted to the transaction journal immediately before later text/time steps.
- Expected full-state fingerprints are recomputed after all AIDP-generated IDs are resolved; the provisional placeholder fingerprint is never used as the final apply/persistence truth.
- New-region text is applied through the existing row textarea React `onChange` path. Speaker/keep/voice-type are not automatically changed.
- Normal delete mutates the controlled `form.regions` reference, sorts/renumbers it, then invokes the same live template `onChange`.
- Recovery exact-add restores only a known backup ID. It does not generate a new production ID.
- Recovery can classify the narrow crash window where AIDP created a formal ID but the service worker stopped before persisting the mapping; it removes an extra region only when it is unique and matches expected geometry/native metadata with intended or empty text.
- Timestamp updates now perform the same speaker-filter safety precheck as structural operations.

## Deliberate restrictions

- `set_labels`: OFF.
- Split is rejected when the source region is not already `speaker=1 / keep=保留 / voice_type=说话`, because AIDP creates the second part with those native defaults and Bridge will not silently alter user-owned speaker/voice/keep decisions.
- Add accepts only the native defaults for speaker/keep/voice type (fields may be omitted and default to native values).
- No submit automation.
- No temporary-save button automation. The extension only observes AIDP's own autosave network evidence.
- No synthetic PointerEvent/MouseEvent drag path and no CDP/debugger permission.

## Verification completed in code

- all extension JavaScript: `node --check` PASS
- all extension JSON: parse PASS
- `patch_engine.test.js`: PASS
- `structural_patch_engine.test.js`: PASS
- `recovery_engine.test.js`: PASS, including unresolved-native-ID crash-window cases
- `beta18_static.test.js`: PASS

## Completion status

- Live AIDP structural contract discovery: PASS
- Beta18 implementation/static tests: PASS
- Real-machine Beta18 ADD/SPLIT/DELETE persistence: NOT YET RUN
- Real-machine structural rollback: NOT YET RUN
- Manual reload persistence after structural operations: NOT YET RUN
- Level B: NOT YET CLAIMED

Beta18 should be loaded as the next controlled E2E candidate. The first real-machine run should use a safe/unsubmitted test case and verify ADD, SPLIT, DELETE, rollback, Model/Wave/Table, autosave payload, and manual-reload persistence before wider use.

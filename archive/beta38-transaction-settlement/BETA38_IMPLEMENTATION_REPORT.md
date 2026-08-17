# Beta38 implementation report

## Trigger
Fresh beta37 export after a failed restore proved that rollback returned the case exactly to the pre-apply snapshot/fingerprint. The remaining problem was not partial mutation: apply could spend up to 30 seconds per operation waiting for a scoped autosave ACK, and the ACK additionally required 2.5 seconds with no later SubmitTempItemAnswer request. AIDP legitimately emits several autosaves in bursts, so a valid matching HTTP 200 could be followed by another save and keep resetting the quiet-period gate.

## Changes
- One temporary SubmitTempItemAnswer trace is installed for the entire patch transaction.
- `update_region`, `add_region`, `delete_region`, and `split_region` execute bounded native/local mutations without per-operation 30-second save waits during normal apply.
- After all operations and all AIDP-issued structural IDs are resolved, Bridge waits once for a SubmitTempItemAnswer HTTP 200 whose **entire `data.regions` and `dataMap.regions` exactly match the final expected canonical state**.
- Removed the 2.5-second quiet-period requirement. A matching HTTP 200 payload is the transport ACK.
- Reload/persistence verification remains the final Source of Truth.
- If final transaction ACK fails, the existing journal rollback path runs after the transaction trace is removed.
- Side-panel watchdog and per-tab isolation from beta37 remain.

## Safety invariants retained
- Dry-run/snapshot/fingerprint/expected checks before writes.
- Bounded native handler execution; no unbounded framework thenable await.
- No synthetic drag/CSS geometry mutation.
- No automatic staging or submission.
- Automatic rollback on apply failure.
- Final success only after reload/persistence verification.

## Evidence used
- Fresh beta37 case export after rollback: snapshot and fingerprint exactly equal to the pre-restore state; Model/Wave/Table triple match; no partial structural mutation remained.
- Prior AIDP probes show SubmitTempItemAnswer is XHR and contains current edited state in top-level `data.regions` and `dataMap.regions`.

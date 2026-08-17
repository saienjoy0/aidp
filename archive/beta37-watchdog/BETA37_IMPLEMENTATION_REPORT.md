# Beta37 implementation report

## Trigger
A mutation could already reach a terminal journal state (`rolled_back` / `rolled_back_after_failure`) while the Side Panel kept showing the spinner because the Port result/error was lost or delayed. Beta35 also had unbounded awaits on framework-returned thenables; Beta36 removed those awaits but did not make the UI independently reconcile terminal worker/journal state.

## Changes
- Added `AIDP_GET_MUTATION_JOB_STATUS` runtime status endpoint.
- Worker retains the most recent mutation job terminal state (`completed` / `failed`) after the Port result path.
- Side Panel mutation jobs poll the worker/journal every 2 seconds as a watchdog.
- If an apply journal reaches `rolled_back`, `rolled_back_after_failure`, or `not_applied`, the Side Panel terminates the spinner and reports that writes are finished and backup is restored.
- If an apply reaches `applied_pending_persistence`, the Side Panel can recover from a lost Port result and continue to the reload/persistence step.
- Mutation hard timeout reduced from 12 minutes to 6 minutes; terminal journal reconciliation normally ends much earlier.
- Worker failure report lookup is pinned to the source tab to preserve tab isolation.
- Native handler thenables remain non-awaited; success authority remains bounded state checks + save ACK.

## Safety invariants retained
- No automatic AIDP staging/submission.
- Dry-run required before apply.
- Per-tab patch/dry-run/journal state isolation.
- One mutation job at a time.
- Automatic compensation on failed apply.

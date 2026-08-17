# AIDP Bridge beta43 — checkpoint executor

Release: `0.7.9-beta.43`

This release replaces timeout-driven structural settlement with a reload-authoritative checkpoint state machine. Every patch containing add/delete/split is executed one operation at a time from a known server-derived state. After each mutation invocation, the Bridge allows normal AIDP save grace, reloads the same case, captures a stable canonical snapshot, and continues only if that snapshot matches the expected state.

Key points:
- native add/delete/update invocation is separated from settlement;
- no same-renderer Model/Wave polling is used as a structural success/failure authority;
- no automatic content-script reinjection in normal readiness polling;
- AIDP-issued add IDs are resolved after reload;
- mixed structural patches checkpoint every operation;
- unknown/partial state stops further writes;
- no automatic `暫存` / `提交`.

Package SHA-256:
`f2accf561f8cd0f4138c0b9ae37519a7ce99bbb68dab0d00ca4f9a3e013ccdda`

Local tests pass. Live AIDP structural validation is still pending. Before the first beta43 live structural run, capture a fresh ZIP after reloading the case affected by the beta42 timeout.

# Current AIDP Bridge development line

Current: **0.7.9-beta.41**.

Beta 41 fixes the live Beta 40 false-negative where `handleUpdateRegion` persisted `region_28` successfully, but local React/Neeko Model/Wave polling stayed stale and aborted the transaction before the next operation.

Ordinary update local settlement is now diagnostic/deferred. Success still requires final full-state `SubmitTempItemAnswer` HTTP 200 ACK plus reload-derived persistence verification.

Release/audit record: `archive/beta41-deferred-local-settlement/`.

The Bridge uses the Chrome Side Panel and never auto-clicks AIDP `暫存` or `提交`.

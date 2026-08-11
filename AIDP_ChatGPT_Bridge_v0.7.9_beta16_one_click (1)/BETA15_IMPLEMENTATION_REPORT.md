# Beta 15 Implementation Report

## Fix
- `applying` journal may remain after a side-panel disconnect or service-worker interruption.
- When no mutation job is active and the live fingerprint exactly equals the pre-apply backup, the journal is reconciled to `rolled_back` without mutating AIDP.
- The rollback button is enabled for `applying`, `rolling_back`, and `apply_failed_compensating` so explicit recovery remains available.
- No automatic stage or submit operation was added.

## Safety
- Automatic reconciliation runs only when case key and full source fingerprint both equal the backup.
- If they do not match, the journal remains unresolved and explicit rollback is required.

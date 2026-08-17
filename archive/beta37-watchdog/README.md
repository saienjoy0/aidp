# AIDP ↔ ChatGPT Bridge beta37

Latest fix line: `0.7.9-beta.37`.

This build fixes the case where the mutation journal has already reached a terminal rollback state but the Side Panel still spins because the Port result/error was lost or delayed.

Tracked here:
- `BETA37_IMPLEMENTATION_REPORT.md`
- `beta36_to_beta37.patch.gz.b64` (exact compressed patch from beta36 to beta37)

Local build artifact SHA256:
- full beta37 package: `c020926dd896e0cc2707b6271aca69552b164d27a5b73ffaa856fb6b32e1bfee`
- runtime-only beta37 ZIP: `09fe404ab97757eb8ca75faa00e5673a237e028194b71727ca04ac7d8b4225d6`

Safety invariants: dry-run before apply, per-tab isolation, automatic compensation on failed apply, and no automatic AIDP staging/submission.

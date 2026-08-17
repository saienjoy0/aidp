# AIDP Bridge beta39 — Hang-proof Runtime

Current release line: `0.7.9-beta.39`.

Beta39 fixes the remaining unbounded mutation paths found after beta38 could spin for 30+ minutes:

- native framework return values are discarded without Promise/thenable assimilation
- mutation-critical MAIN-world calls have hard timeouts
- mutation-critical content-adapter messages have hard timeouts
- renderer timeout becomes pending verification instead of unsafe blind rollback
- Side Panel has a 3-minute wall-clock stop
- save ACK wait shows elapsed progress

The normal UI remains three steps: export ZIP → JSON safety check → apply/reload/persistence verification.

Do not replay a patch after a long hang until the current case has been reloaded and exported again. `暫存` and `提交` are never auto-clicked.

## Exact beta38 → beta39 runtime diff

The compressed base64 patch is intentionally stored in four small files to avoid connector truncation:

- `beta38_to_beta39.patch.gz.b64.part00`
- `beta38_to_beta39.patch.gz.b64.part01`
- `beta38_to_beta39.patch.gz.b64.part02`
- `beta38_to_beta39.patch.gz.b64.part03`

Reconstruct in lexical order, then base64-decode and gunzip. The reconstructed plain patch must be 43,929 bytes.

Local packaged beta39 SHA-256: `d0dcc65a304899d2e16c2d824774fafdc01739d1ea3209965f13c57afbfe88f8`.

# AIDP ↔ ChatGPT Bridge

Current development line: **0.7.9-beta.38** (2026-08-17).

Latest tracked fix: `archive/beta38-transaction-settlement/`.

Beta38 changes apply settlement from per-operation autosave waits to one transaction-level final `SubmitTempItemAnswer` HTTP 200 + complete `data/dataMap` state ACK. Reload/persistence verification remains the final authority.

Normal target workflow:
1. Export case ZIP
2. Paste ChatGPT Annotation Patch JSON and safety-check
3. Apply → reload → persistence verification

Case state is isolated per AIDP tab. The Bridge never auto-clicks AIDP staging/submission.

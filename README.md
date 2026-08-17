# AIDP ↔ ChatGPT Bridge

Current development line: **0.7.9-beta.40** (2026-08-17).

Current tracked manifest / UI shell: `current/`.

Latest audit record: `archive/beta40-guarded-runtime/`.

Beta 40 supersedes Beta 39 after a deeper audit of the Beta 38/39 hang path. It adds guarded late execution, hard mutation/recovery deadlines, one-shot ③ authorization, STOP-FIRST failure handling, strict transaction save ACK semantics, reload-only journal classification, Port-disconnect recovery, and tighter per-tab state isolation.

Normal target workflow:
1. Export case ZIP
2. Paste ChatGPT Annotation Patch JSON and safety-check
3. Apply → reload → persistence verification

Important current rule: after an unknown/timeout write state, **reload + fresh case ZIP export comes before any new patch**. Reload-derived AIDP state is the final authority.

Beta 40 has passed local static/dynamic tests but has **not yet passed a live AIDP Beta 40 write**. The Bridge never auto-clicks AIDP staging/submission.

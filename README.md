# AIDP ↔ ChatGPT Bridge

Current development line: **0.7.9-beta.41** (2026-08-17).

Current tracked manifest / UI shell: `current/`.

Latest audit record: `archive/beta41-deferred-local-settlement/`.

Beta 41 incorporates live Beta 40 evidence: `region_28` persisted exactly even though local React/Neeko Model/Wave polling reported unsettled and aborted before `region_29`. Ordinary update local settlement is therefore diagnostic/deferred rather than a hard success/failure authority. Final full-state `SubmitTempItemAnswer` HTTP 200 ACK and reload-derived persistence verification remain mandatory.

Normal target workflow:
1. Export case ZIP
2. Paste ChatGPT Annotation Patch JSON and safety-check
3. Apply → reload → persistence verification

Important current rule: after an unknown/partial write state, **reload + fresh case ZIP export comes before any new patch**. Reload-derived AIDP state is the final authority.

The Bridge never auto-clicks AIDP staging/submission.

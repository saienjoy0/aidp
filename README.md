# AIDP ↔ ChatGPT Bridge

Current development line: **0.7.9-contractlab.1** / manifest **0.7.9.44** (2026-08-17).

Current tracked manifest / UI shell: `current/`.

Latest implementation/audit record: `archive/contractlab1-save-contract/`.

The project has moved from editor-settlement automation to **Save Contract / annotation-document qualification**. Live Beta40–42 evidence showed that an edit can already be persisted even while immediate React/Neeko Model, WaveSurfer, intercepted save observation, or content-adapter state remains stale. Therefore those UI/runtime observations are no longer persistence authorities.

Contract Lab 1 qualifies whether AIDP's document-level `SubmitTempItemAnswer` contract can safely become the deterministic write driver:

1. capture/reload current canonical state;
2. map a complete desired annotation document while preserving opaque raw metadata;
3. perform a final client-side CAS check;
4. invoke one logical save at most once;
5. reload;
6. classify actual canonical Model/Table state as desired, before, partial, or unavailable.

Wave is diagnostic/readiness information only. Transport uncertainty never causes automatic retry or inverse rollback. Unknown/partial states STOP-FIRST. Cross-tab unresolved journals block another write even after an expiring lease is gone.

Qualification is staged Q0→Q8. Normal production ③ write is disabled until capabilities are qualified. Local static/regression suite is **45/45 PASS**; live AIDP Q0–Q8 has **not yet been run**.

Important current rule: before first live Q0, reload the affected AIDP case and export a fresh read-only ZIP. The previous beta42 structural-delete attempt ended with an unknown outcome and must be classified separately from Save Contract probing.

The Bridge never auto-clicks AIDP staging/submission.

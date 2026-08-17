# AIDP ↔ ChatGPT Bridge

Current development line: **0.7.9-beta.43** (2026-08-17).

Current tracked manifest / UI shell: `current/`.

Latest audit record: `archive/beta43-checkpoint-executor/`.

Beta43 is a structural executor redesign, not another timeout increase. Live Beta40–42 evidence showed AIDP is eventually consistent: native mutation calls can persist while immediate React/Neeko Model, WaveSurfer, intercepted save payload, or content-adapter observations remain stale. Beta43 therefore separates **mutation invocation** from **settlement**.

Any patch containing add/delete/split runs as:
1. start from a reload-derived known canonical state;
2. invoke exactly one operation;
3. allow normal AIDP save grace;
4. reload the same case;
5. capture a stable server-derived canonical checkpoint;
6. continue only when that checkpoint matches the expected state.

Native add/delete no longer hard-fail because same-renderer Model/Wave settlement is slow. Added formal IDs are resolved only after reload from the new region set. Mixed structural patches checkpoint every operation so later writes never run on stale renderer state.

Normal target workflow remains:
1. Export case ZIP
2. Paste ChatGPT Annotation Patch JSON and safety-check
3. Apply → checkpoint/reload verification

Important current rule: after an unknown/partial write state, **reload + fresh case ZIP export comes before any new patch**. Beta43 has passed local static/regression tests but has not yet passed a live AIDP structural write.

The Bridge never auto-clicks AIDP staging/submission.

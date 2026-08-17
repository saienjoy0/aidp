# AIDP ↔ ChatGPT Bridge

Current development line: **0.7.9-beta.42** (2026-08-17).

Current tracked manifest / UI shell: `current/`.

Latest audit record: `archive/beta42-reload-authoritative/`.

Live Beta41 evidence proved that both `region_28` and `region_29` persisted correctly even though strict intercepted autosave matching failed and persistence readiness later timed out at `Table=20, Model=20, Wave=0`. Beta42 treats intercepted `SubmitTempItemAnswer` matching as bounded transport evidence, not final truth. Final success is determined from canonical AIDP state reconstructed after reload, with a longer but bounded slow-Wave readiness window.

Normal target workflow:
1. Export case ZIP
2. Paste ChatGPT Annotation Patch JSON and safety-check
3. Apply → reload → persistence verification

Important current rule: after an unknown/partial write state, **reload + fresh case ZIP export comes before any new patch**. Reload-derived AIDP state is the final authority.

The Bridge never auto-clicks AIDP staging/submission.

# Contract Lab 1 — current implementation

Runtime `0.7.9-contractlab.1`, manifest `0.7.9.44`.

Architecture: Save Contract / annotation-document qualification. Normal production ③ is disabled until Q0→Q8 capability qualification succeeds.

Implemented safety invariants:
- reload-derived Model+Table canonical persistence authority;
- Wave diagnostic/readiness only;
- raw metadata/precision preservation;
- independent `data.regions` / `dataMap.regions` mapping;
- pre-write CAS;
- one-shot save journal before invocation;
- no resend on worker/Port resume;
- no automatic retry on uncertain transport;
- STOP-FIRST on unknown/partial state;
- cross-tab unresolved-job blocking;
- cleanup blocked after unqualified original transport;
- native add allocator must have settled matching save evidence before another write;
- sensitive auth/cookie/token values not persisted;
- no automatic `暫存` / `提交`.

Local validation: active JavaScript syntax PASS, **45/45 tests PASS**, release ZIP integrity PASS.

Live AIDP Q0–Q8: **NOT YET RUN**. The previous beta42 structural-delete outcome must first be classified using reload + fresh read-only ZIP export.

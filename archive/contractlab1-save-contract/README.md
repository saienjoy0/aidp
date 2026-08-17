# AIDP Bridge Contract Lab 1 — Save Contract Qualification

Release identity: `0.7.9-contractlab.1` / manifest `0.7.9.44`.

This is the single qualification build for the Architecture v2.0 pivot from editor-settlement automation to annotation-document Save Contract qualification.

Key invariants:
- normal production ③ write is disabled;
- Q0→Q8 capability gates only;
- reload-derived Model+Table canonical state is persistence authority;
- Wave is diagnostic/readiness only;
- existing raw region objects are cloned and opaque metadata preserved;
- `data.regions` and `dataMap.regions` are independently mapped;
- final pre-write CAS is mandatory;
- logical saves are one-shot and journaled before invocation;
- reconnect/resume never resends an invoked save;
- transport uncertainty causes no automatic retry or inverse rollback;
- unknown/partial state is STOP-FIRST;
- unresolved Contract Lab write state blocks new writes from other AIDP tabs;
- sensitive auth/cookie/token/signed-URL values are not persisted in reports;
- AIDP `暫存` / `提交` are never automated.

Local validation: active JavaScript syntax PASS, **45/45 current tests PASS**, release ZIP integrity PASS.

Live AIDP Q0–Q8 qualification: **NOT YET RUN**. Before Q0, the existing beta42 structural-delete unknown state must first be classified by reload + fresh read-only ZIP export.

The exact binary ZIP is delivered separately; this GitHub archive records the build identity, safety design, implementation report, and package checksum.

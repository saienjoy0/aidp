# Current AIDP Bridge development line

Current: **0.7.9-contractlab.1** (manifest `0.7.9.44`).

Contract Lab 1 is the Save Contract Qualification build for Architecture v2.0. It stops treating immediate React/Neeko/Wave settlement as persistence truth and instead qualifies a document-level AIDP save contract with reload-derived canonical verification.

Normal production ③ mutation is deliberately disabled in this build. Qualification Q0→Q8 is isolated under the Contract Lab advanced panel. Existing raw region objects are cloned, `data.regions` and `dataMap.regions` are mapped independently, pre-write CAS is mandatory, save jobs are one-shot, transport uncertainty never retries automatically, and unknown/partial state is STOP-FIRST.

Persistence verification uses reload-derived Model+Table canonical state. Wave is diagnostic/readiness information only and Wave=0 is not classified as a failed save.

Local static/regression suite: **45/45 PASS**. Live AIDP Q0–Q8 qualification: **NOT YET RUN**.

Before the first live Q0, reload the affected AIDP case and export a fresh read-only ZIP because the previous beta42 structural-delete outcome is still unknown.

Release/audit record: `archive/contractlab1-save-contract/`.

The Bridge uses the Chrome Side Panel and never auto-clicks AIDP `暫存` or `提交`.

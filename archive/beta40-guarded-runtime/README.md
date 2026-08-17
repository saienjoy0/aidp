# AIDP Bridge beta40 — guarded runtime

Current release line: `0.7.9-beta.40`.

Beta 40 supersedes Beta 39 after a deeper audit of the Beta 38 30-minute hang. The final local audit found and fixed additional risks: late operations near the wall-clock deadline, lower-level automatic compensation after uncertain failures, same-page journal finalization, replay of the same approved ③ token, mutation Port disconnect handling, tab/report isolation, and a stale visible Side Panel version label.

Safety model:
- STOP FIRST on unknown write state
- final authority is AIDP state reconstructed after explicit reload
- one-shot dry-run/apply authorization
- hard deadlines on mutation-critical execution
- strict `SubmitTempItemAnswer` ACK semantics
- no automatic `暫存` / `提交`

Live AIDP Beta 40 write validation has **not yet been run**. After the unknown Beta 38 state, the next live action is read-only only: install/reload Beta 40, reload the AIDP case, do not press ③, export a fresh case ZIP with ①.

Local release ZIP SHA-256:
`f0907ca362bd9fcf2703d14d5d2f7219054a20d8112714411a2aec327f08cc0f`

The release ZIP is stored below as ordered Base64 chunks named `AIDP_ChatGPT_Bridge_v0.7.9_beta40_guarded_runtime.zip.b64.partXX`. Concatenate the chunks in lexical order and Base64-decode to reconstruct the exact ZIP.

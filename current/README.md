# Current AIDP Bridge development line

Current: **0.7.9-beta.40**.

Beta 40 is the guarded-runtime audit build after the Beta 38/39 hang investigation. It is locally tested but has not yet passed a live Beta 40 AIDP write.

Safety rule after an unknown/timeout write: explicit AIDP reload + fresh case ZIP export before any new patch. Reload-derived state is authoritative.

Release/audit record: `archive/beta40-guarded-runtime/`.

The Bridge uses the Chrome Side Panel and never auto-clicks AIDP `暫存` or `提交`.

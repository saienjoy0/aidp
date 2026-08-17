# Current AIDP Bridge development line

Current: **0.7.9-beta.42**.

Live Beta41 evidence proved that both `region_28` and `region_29` persisted correctly even though strict intercepted autosave matching failed and Wave readiness later timed out at `Table=20, Model=20, Wave=0`.

Beta42 therefore treats intercepted `SubmitTempItemAnswer` matching as bounded transport evidence rather than final truth. Final success is determined from canonical AIDP state after reload. Persistence tolerates delayed Wave initialization within a bounded 4-minute Side Panel verification window.

Release/audit record: `archive/beta42-reload-authoritative/`.

The Bridge uses the Chrome Side Panel and never auto-clicks AIDP `暫存` or `提交`.

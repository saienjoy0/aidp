# AIDP Bridge beta42 — reload-authoritative settlement

Current release line: `0.7.9-beta.42`.

Live Beta41 evidence showed that both intended update operations persisted correctly even though the strict intercepted autosave matcher did not see a qualifying final data/dataMap record and persistence readiness later timed out while Wave was still `0`.

Beta42 changes:
- intercepted `SubmitTempItemAnswer` matching is bounded transport evidence, not final truth;
- strong save-evidence wait is bounded to 12s, then records `soft_unconfirmed` and proceeds to reload;
- final authority is canonical AIDP state reconstructed after reload;
- Wave readiness budget is increased to tolerate the slow live AIDP case;
- confirm-persistence Side Panel watchdog is bounded to 4 minutes; apply/rollback remain 3 minutes;
- no automatic `暫存` / `提交`.

Package SHA-256: `7515478098e7080918ec563f7d2a9012555aef31d4f0ce011a5e31a45815c612`.

The exact Beta41→Beta42 source delta is stored as `beta41_to_beta42.patch.gz.b64`. The complete packaged ZIP is provided in the ChatGPT artifact for this release and is identified by the checksum above.

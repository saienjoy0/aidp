# Current AIDP Bridge development line

Current: **0.7.9-beta.43**.

Beta43 is the structural executor redesign after the Beta42 false-negative. AIDP is treated as eventually consistent: native mutation invocation is separated from settlement, and any patch containing add/delete/split now runs as **one operation → save grace → reload → stable server-derived canonical checkpoint → next operation**.

Immediate React/Neeko/Wave/content-adapter latency is telemetry, not semantic failure. Native add/delete no longer wait inside the same renderer call for Model/Wave settlement. Added formal IDs are resolved only after reload from the new server-derived region set. Mixed structural patches checkpoint every operation so later writes never run on stale renderer state.

Release/audit record: `archive/beta43-checkpoint-executor/`.

Important current rule: after an unknown/partial write state, **reload + fresh case ZIP export comes before any new patch**. Beta43 structural execution has passed local tests but has not yet passed a live structural write.

The Bridge uses the Chrome Side Panel and never auto-clicks AIDP `暫存` or `提交`.

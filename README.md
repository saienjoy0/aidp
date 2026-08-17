# AIDP ↔ ChatGPT Bridge

Current development line: **0.7.9-beta.39** (2026-08-17).

Latest tracked fix: `archive/beta39-hang-proof/`.

Beta39 removes the remaining unbounded mutation paths: native framework thenables are never assimilated, mutation-critical MAIN-world/content calls have hard deadlines, and the Side Panel has a 3-minute wall-clock stop. Renderer timeouts are treated as pending verification so the next reload can resolve server-derived state safely.

Normal target workflow:
1. Export case ZIP
2. Paste ChatGPT Annotation Patch JSON and safety-check
3. Apply → reload → persistence verification

Case state is isolated per AIDP tab. The Bridge never auto-clicks AIDP staging/submission.

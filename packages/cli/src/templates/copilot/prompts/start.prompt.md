---
description: "Trellis Copilot prompt: Start Session"
---

# Start Session

Load current worktree context and the canonical workflow once:

```bash
python3 ./.trellis/scripts/get_context.py
python3 ./.trellis/scripts/get_context.py --mode phase
```

Follow `.trellis/workflow.md` for request triage, authorization, planning and completion. Load `trellis-before-dev` before code changes. Resume any active task from its actual progress and the current request.

If context reports `Trellis update available:`, preserve its exact operational hint when reporting it; do not automatically upgrade a pinned fork CLI.

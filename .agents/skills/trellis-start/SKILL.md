---
name: trellis-start
description: "Initializes an AI development session by reading workflow guides, worktree context, git status, active tasks, and project guidelines from .trellis/. Classifies incoming tasks and routes to brainstorm, direct edit, or task workflow. Use when beginning a new coding session, resuming work, starting a new task, or re-establishing project context."
---

# Start Session

Load current worktree context and the canonical workflow once:

```bash
python3 ./.trellis/scripts/get_context.py
python3 ./.trellis/scripts/get_context.py --mode phase
```

Follow `.trellis/workflow.md` for request triage, authorization, planning and completion. Load `trellis-before-dev` before code changes. Resume any active task from its actual progress and the current request.

If context reports `Trellis update available:`, preserve its exact operational hint when reporting it; do not automatically upgrade a pinned fork CLI.

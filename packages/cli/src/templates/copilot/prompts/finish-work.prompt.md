---
description: "Trellis Copilot prompt: Finish Work — survey + archive task + record session journal"
---

# Finish Work

Follow Phase 3 of `.trellis/workflow.md` for acceptance, delivery authorization and archive eligibility.

```bash
python3 ./.trellis/scripts/get_context.py --mode record
```

Review the actual acceptance evidence for the current task. Record incomplete work and continue authorized fixes; never archive merely because a session ends. Do not sweep unrelated tasks into this session's cleanup.

For a completed task, archive locally:

```bash
python3 ./.trellis/scripts/task.py complete <completed-task> --reason "Acceptance evidence"
python3 ./.trellis/scripts/task.py archive <completed-task>
```

Record progress, checks, remaining work and existing business-code commit references when available:

```bash
python3 ./.trellis/scripts/add_session.py --title "Session Title" --summary "Progress and checks"
```

`--commit "hash1,hash2"` is optional evidence. These operations write local files only; preserve the Git index and ignore rules.

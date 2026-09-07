---
name: trellis-continue
description: "Resume work on the current task. Loads the workflow Phase Index, figures out which phase/step to pick up at, then pulls the step-level detail via get_context.py --mode phase. Use when coming back to an in-progress task and you need to know what to do next."
---

# Continue Current Work

```bash
python3 ./.trellis/scripts/get_context.py
python3 ./.trellis/scripts/get_context.py --mode phase
```

Resume from the current request, recorded progress and existing authorization according to `.trellis/workflow.md`. Load the needed step rather than repeating completed work:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform codex
```

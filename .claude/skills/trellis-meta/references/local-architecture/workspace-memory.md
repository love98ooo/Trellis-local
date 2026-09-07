# Local Workspace Memory

Each worktree owns `.trellis/workspace/index.md` and `journal-N.md`. There is no developer identity or per-person directory. Journals rotate at `max_journal_lines` and preserve completed or partial progress.

```bash
python3 ./.trellis/scripts/add_session.py --title "Session" --summary "Progress and checks"
```

Optional `--commit` references existing business commits; it never creates a commit. All generated `.trellis/` state remains local. Do not stage it or alter repository ignore rules.

Tasks store requirements and execution state; journals store session progress; specs store reusable conventions. Raw dialogue remains in platform session storage and can be read through `trellis-local mem`; use the current worktree as the default search scope and identify other worktrees explicitly.

# Change Local Workflow

Read `.trellis/workflow.md` and the affected platform entry before editing. The workflow file owns triage, planning, authorization, execution and completion rules; Skills and hooks only load and route.

Change the relevant Phase Index, detailed step and `[workflow-state:STATUS]` block together. Matching opening and closing status tags are required. Preserve step headings used by `get_context.py --mode phase --step`.

Keep each worktree's generated state local. Apply fork-wide defaults in the CLI template source so init and update agree. Preserve explicit approval and target-repository safety requirements.

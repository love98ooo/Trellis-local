# Development Workflow

## Phase Index

### Core Principles

This file is the single source of workflow rules. Platform Skills and hooks load and route to it.

- Read the request, existing evidence and applicable repository rules before changing code.
- Small tasks proceed directly. For complex work, record only the plan, design and acceptance details needed to execute reliably. Do not create a task merely to satisfy a process.
- Ask only about unresolved decisions that materially affect scope, acceptance or risk and cannot be determined from available evidence. Continue independent authorized work while awaiting an answer.
- Authorization persists within its agreed scope. Do not require a second approval merely because a phase ends. Respect explicit analysis-only instructions, approval gates, sandbox restrictions and target-repository safety rules.
- Continue authorized implementation through validation and necessary fixes. Do not hand the next phase back to the user. Never archive unfinished work.
- Generated `.trellis/` is private local state: never stage, commit or sync it, and never edit a business repository's ignore rules. Reuse existing global ignore. Fork source and shipped templates remain version controlled.
- Keep each worktree's tasks, current-task pointers, logs and runtime state independent. Never share the entire `.trellis/` directory. Specifications may be copied as a snapshot at initialization; do not synchronize mutable state.
- Do not run bootstrap or onboarding automatically. Initialize specifications only when explicitly requested or needed for a concrete task; missing specs do not block using existing repository guidance.

```text
Phase 1: Plan    → inspect evidence; record useful requirements and decisions
Phase 2: Execute → implement and validate within existing authorization
Phase 3: Finish  → complete acceptance, retain useful knowledge and record progress
```

### Skills and Context

Load `trellis-before-dev` for applicable repository guidelines and `trellis-check` for validation. Use `trellis-brainstorm` for unresolved requirements. Main sessions may delegate bounded work to `trellis-implement`, `trellis-research` and `trellis-check`; inline platforms work directly. Pass useful context through `implement.jsonl` / `check.jsonl` when a task exists, or explicit dispatch context otherwise.

Load step details with `python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y> --platform <platform>`.

### Request Triage

A small task needs no task record or task-creation question. For complex work, use a task when it helps persistence or Agent handoff. Keep `prd.md`, `design.md`, `implement.md` and research optional according to actual needs, without a fixed document count. A user request to implement authorizes its clear scope; an analysis request does not.

[workflow-state:no_task]
No active task. Follow the request and Core Principles above: small work proceeds directly; record complex work only when useful. Continue authorized work through validation.
[/workflow-state:no_task]

[workflow-state:task_error]
The active task record cannot be read. Inspect and repair the named record without discarding existing data or choosing another session's task. Ask only if safe reconstruction requires missing information.
[/workflow-state:task_error]

### Phase 1: Plan

- 1.1 Resolve requirements from evidence.
- 1.2 Research concrete unknowns as needed.
- 1.3 Prepare only useful Agent context.
- 1.4 Activate a recorded task when ready.

[workflow-state:planning]
Follow Phase 1 and existing authorization. Resolve material unknowns; use only useful planning artifacts and Agent context. Once ready, start implementation without repeated approval for the same scope.
[/workflow-state:planning]

[workflow-state:planning-inline]
Follow Phase 1 and existing authorization. Load relevant context directly; planning files are optional. Once ready, implement inline without repeated approval for the same scope.
[/workflow-state:planning-inline]

### Phase 2: Execute

- 2.1 Implement the authorized scope.
- 2.2 Run applicable quality and acceptance checks; fix failures.
- 2.3 Revisit decisions when evidence requires it.

[workflow-state:in_progress]
Continue implementation, checks and necessary fixes through acceptance under the Core Principles. The main session may dispatch trellis-implement, trellis-research and trellis-check when useful. Already-dispatched implement/check agents work directly and never recursively dispatch each other. Then perform Phase 3; unfinished work stays active.
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
Implement and check inline under the Core Principles. Continue through acceptance and Phase 3; unfinished work stays active.
[/workflow-state:in_progress-inline]

### Phase 3: Finish

- 3.2 Investigate recurring defects when relevant.
- 3.3 Retain useful project knowledge locally.
- 3.4 Follow target-repository requirements for code commits, MR, CI, merge and release.
- 3.5 Record progress; archive only completed tasks.

[workflow-state:completed]
Verify acceptance before archiving. Record local progress and follow target-repository commit, MR, CI, merge and release rules. Never stage or commit generated .trellis state.
[/workflow-state:completed]

## Phase 1: Plan

#### 1.1 Requirements

Inspect code, tests, configuration, instructions and relevant history before asking questions. Use `trellis-brainstorm` for unresolved scope. Record goals, boundaries, decisions and observable acceptance criteria together when useful; split design or execution notes only when they make the work easier to follow.

For a persistent task:

```bash
python3 ./.trellis/scripts/task.py create "<title>" --description "<goal>"
```

Parent/child tasks are optional for independently verifiable deliverables. Record real dependencies explicitly; tree position does not imply ordering.

#### 1.2 Research

Research specific unknowns directly or delegate a bounded question to `trellis-research`. Save findings needed across sessions or Agents in the task's `research/` directory when a task exists.

#### 1.3 Context

Load applicable specs with `trellis-before-dev`. If a task exists, use `implement.jsonl` / `check.jsonl` for useful spec and research paths, one `{"file":"path","reason":"purpose"}` per line. Do not add placeholder entries to meet a quota. Pass explicit scope and context in the dispatch prompt when no task is needed.

#### 1.4 Activate

When a recorded task is ready under existing authorization:

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

#### 1.5 Readiness

The outcome, scope and acceptance must be clear enough to implement safely. Respect any explicit pending approval; no fixed artifact count or fresh approval is required for an already authorized scope.

## Phase 2: Execute

#### 2.1 Implement

Load relevant repository guidelines and any existing task artifacts. Use the smallest change that satisfies the requirements. Main sessions may dispatch bounded implementation/research/check work using available platform Agents; Codex inline mode stays in the main session. Include `Active task: <path>` when one exists, otherwise state that no task is required and pass the concrete scope and context paths. Prefer native context injection and load missing context directly when necessary. Child agents must not recursively spawn implement/check agents.

#### 2.2 Quality check

Use `trellis-check` to verify the complete change against acceptance and repository requirements. Run appropriate lint, type checks, tests and real integration checks. Fix failures within scope, then rerun affected checks. Preserve security, accessibility, data integrity and explicit approvals. Report real limitations without declaring unfinished work complete.

#### 2.3 Revisit

Investigate failures at their source. Update the plan when evidence changes it; ask only for a material decision outside existing authorization. Preserve unrelated user and Agent edits.

## Phase 3: Finish

#### 3.2 Debug retrospective

Use `trellis-break-loop` if recurring failures need root-cause investigation.

#### 3.3 Knowledge

Record useful new conventions and prevention guidance in local specs when warranted; no mandatory documentation rewrite.

#### 3.4 Repository delivery

Business-code commits, MR, CI, merge and release follow the target repository's rules and existing authorization. Preserve unrelated changes. Never include generated `.trellis/` in staging or commits, and do not change ignore rules. Do not add a Trellis-specific approval round when the same action and scope are already authorized.

#### 3.5 Wrap up

Use `trellis-finish-work` operations to record a local journal. Archive a task only after its full acceptance is satisfied, including any required delivery steps. Incomplete tasks remain active with progress and blockers recorded. Continue authorized work without asking the user to invoke the next phase.

```bash
python3 ./.trellis/scripts/add_session.py --title "Session" --summary "Progress and checks"
python3 ./.trellis/scripts/task.py complete <completed-task> --reason "Acceptance evidence"
python3 ./.trellis/scripts/task.py archive <completed-task>
```

Logs are `.trellis/workspace/journal-N.md`; `--commit` may reference existing business-code commits but never creates one. Session pointers live under this worktree's `.trellis/.runtime/sessions/`. Use `task.py current --source` to inspect the active pointer and `task.py --help` for supported operations.

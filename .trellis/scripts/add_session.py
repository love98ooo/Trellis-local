#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Add a new session to journal file and update index.md.

Usage:
    python3 add_session.py --title "Title" --commit "hash" --summary "Summary" [--package cli]
    python3 add_session.py --title "Title" --branch "feat/my-branch"

    # Pipe detailed content via stdin (use --stdin to opt in):
    cat << 'EOF' | python3 add_session.py --stdin --title "Title" --summary "Summary"
    <session content here>
    EOF

    # Structured content (repeatable; a section with no bullets is omitted):
    python3 add_session.py --title "Title" --change "Did X" --test "Ran Y" --next-step "Do Z"

    # Commit evidence that cannot be resolved from the local object database
    # (amended, not yet fetched) needs an explicit subject, one per OID:
    python3 add_session.py --title "Title" --commit "abc1234" \
        --commit-subject "abc1234=fix(cli): stop truncating the manifest"

Commit evidence:
    Every --commit token is a bounded hex OID (7-40 chars). Each one is
    resolved to its real subject from the local object database BEFORE
    anything is written. An OID that cannot be resolved fails the command
    before the journal or index is touched — no placeholder prose is ever
    recorded. Pass "-" (the default) for a planning session with no commits.

Retry convergence:
    Journal and index writes are resumable and stay local. Repeating identical
    inputs repairs an interrupted record or returns success for a completed
    record. Use a new --idempotency-key for a separate identical session.

Branch resolution order:
    1. --branch CLI arg (explicit)
    2. task.json branch field (from active task, if still exists)
    3. git branch --show-current (auto-detect)
    4. None (omitted gracefully)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from common.paths import (
    FILE_JOURNAL_PREFIX,
    get_repo_root,
    get_current_task,
    get_workspace_dir,
)
from common.git import run_git
from common.io import write_text_atomic
from common.tasks import load_task
from common.types import TaskInfo
from common.config import (
    get_packages,
    get_max_journal_lines,
    is_monorepo,
    resolve_package,
    validate_package,
)


# Bounded, argv-safe input shapes. Anything outside them is rejected during
# preflight, before a single byte is written.
COMMIT_TOKEN_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")
IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
MAX_SUBJECT_LEN = 500

# Machine-readable record identity. An HTML comment renders as nothing, so the
# human evidence in the entry is unchanged by its presence.
MARKER_PREFIX = "<!-- trellis-session:"
# Bumped when the fingerprint inputs change. Untagged markers are v1, whose
# fingerprint mixed in the calendar date; see compute_record_fingerprint.
MARKER_VERSION = 2
SESSION_HEADING_RE = re.compile(r"^## Session (\d+):", re.MULTILINE)

# Recording states, in the order the operation walks them.
STATE_ABSENT = "absent"
STATE_JOURNAL_RECORDED = "journal-recorded"
STATE_INDEX_RECORDED = "index-recorded"


# =============================================================================
# Helper Functions
# =============================================================================

def get_latest_journal_info(dev_dir: Path) -> tuple[Path | None, int, int]:
    """Get latest journal file info.

    Returns:
        Tuple of (file_path, file_number, line_count).
    """
    latest_file: Path | None = None
    latest_num = -1

    for f in dev_dir.glob(f"{FILE_JOURNAL_PREFIX}*.md"):
        if not f.is_file():
            continue

        match = re.search(r"(\d+)$", f.stem)
        if match:
            num = int(match.group(1))
            if num > latest_num:
                latest_num = num
                latest_file = f

    if latest_file:
        lines = len(latest_file.read_text(encoding="utf-8").splitlines())
        return latest_file, latest_num, lines

    return None, 0, 0


def get_current_session(index_file: Path) -> int:
    """Get current session number from index.md."""
    if not index_file.is_file():
        return 0

    content = index_file.read_text(encoding="utf-8")
    return _max_session_in_index(content)


def _max_session_in_index(content: str) -> int:
    """Read the `Total Sessions` counter out of an index.md body."""
    for line in content.splitlines():
        if "Total Sessions" in line:
            match = re.search(r":\s*(\d+)", line)
            if match:
                return int(match.group(1))
    return 0


def _max_session_in_journal(content: str) -> int:
    """Highest `## Session N:` heading in a journal body (0 when none)."""
    numbers = [int(m.group(1)) for m in SESSION_HEADING_RE.finditer(content)]
    return max(numbers) if numbers else 0


def _extract_journal_num(filename: str) -> int:
    """Extract journal number from filename for sorting."""
    match = re.search(r"(\d+)", filename)
    return int(match.group(1)) if match else 0


def count_journal_files(dev_dir: Path, active_num: int) -> str:
    """Count journal files and return table rows."""
    active_file = f"{FILE_JOURNAL_PREFIX}{active_num}.md"
    result_lines = []

    files = sorted(
        [f for f in dev_dir.glob(f"{FILE_JOURNAL_PREFIX}*.md") if f.is_file()],
        key=lambda f: _extract_journal_num(f.stem),
        reverse=True
    )

    for f in files:
        filename = f.name
        lines = len(f.read_text(encoding="utf-8").splitlines())
        status = "Active" if filename == active_file else "Archived"
        result_lines.append(f"| `{filename}` | ~{lines} | {status} |")

    return "\n".join(result_lines)


def get_current_git_branch(repo_root: Path) -> str | None:
    """Return the current checkout branch, or None for detached/non-git states."""
    rc, branch_out, _ = run_git(["branch", "--show-current"], cwd=repo_root)
    if rc != 0:
        return None
    detected = branch_out.strip()
    return detected or None


def branch_ref_exists(repo_root: Path, branch: str) -> bool:
    """Return True when branch exists locally or as the local origin ref."""
    for ref in (f"refs/heads/{branch}", f"refs/remotes/origin/{branch}"):
        rc, _, _ = run_git(["show-ref", "--verify", "--quiet", ref], cwd=repo_root)
        if rc == 0:
            return True
    return False


def resolve_session_branch(
    repo_root: Path,
    cli_branch: str | None,
    task_data: TaskInfo | None,
) -> str | None:
    """Resolve journal branch without trusting stale task.json branch fields."""
    if cli_branch:
        return cli_branch

    current_branch = get_current_git_branch(repo_root)
    raw_task_branch = task_data.raw.get("branch") if task_data else None
    task_branch = raw_task_branch.strip() if isinstance(raw_task_branch, str) else ""
    if not task_branch:
        return current_branch

    if branch_ref_exists(repo_root, task_branch):
        return task_branch

    if current_branch:
        print(
            f"Warning: task.json branch '{task_branch}' no longer exists locally or as origin/{task_branch}; using current branch '{current_branch}'.",
            file=sys.stderr,
        )
        return current_branch

    print(
        f"Warning: task.json branch '{task_branch}' no longer exists locally or as origin/{task_branch}; omitting branch.",
        file=sys.stderr,
    )
    return None


def create_new_journal_file(
    dev_dir: Path, num: int, today: str,
) -> Path | None:
    """Create a new journal file. Returns None when the write fails."""
    new_file = dev_dir / f"{FILE_JOURNAL_PREFIX}{num}.md"

    content = f"""# Journal (Part {num})

> AI development session journal
> Started: {today}

---

"""
    if not write_text_atomic(new_file, content):
        return None
    return new_file


# =============================================================================
# Commit evidence (R1) — accurate subjects or nothing
# =============================================================================

def parse_commit_tokens(commit: str) -> tuple[list[str], str | None]:
    """Split --commit into bounded hex OIDs. Returns (tokens, error)."""
    raw = (commit or "").strip()
    if not raw or raw == "-":
        return [], None

    tokens: list[str] = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        if not COMMIT_TOKEN_RE.match(token):
            return [], (
                f"invalid --commit token '{token}': expected a 7-40 character hex "
                "commit OID, or '-' for a planning session with no commits"
            )
        token = token.lower()
        if token not in tokens:
            tokens.append(token)
    return tokens, None


def parse_subject_overrides(values: list[str] | None) -> tuple[dict[str, str], str | None]:
    """Parse `--commit-subject <oid>=<subject>` into a one-to-one mapping."""
    overrides: dict[str, str] = {}
    for raw in values or []:
        if "=" not in raw:
            return {}, (
                f"invalid --commit-subject '{raw}': expected <oid>=<subject>"
            )
        oid_part, subject = raw.split("=", 1)
        oid = oid_part.strip().lower()
        subject = subject.strip()
        if not COMMIT_TOKEN_RE.match(oid):
            return {}, (
                f"invalid --commit-subject key '{oid_part.strip()}': expected a "
                "7-40 character hex commit OID"
            )
        if not subject:
            return {}, f"invalid --commit-subject for '{oid}': subject is empty"
        if len(subject) > MAX_SUBJECT_LEN:
            return {}, (
                f"invalid --commit-subject for '{oid}': subject exceeds "
                f"{MAX_SUBJECT_LEN} characters"
            )
        if oid in overrides:
            return {}, f"duplicate --commit-subject mapping for '{oid}'"
        overrides[oid] = subject
    return overrides, None


def resolve_commit_subject(repo_root: Path, oid: str) -> str | None:
    """Resolve one OID to its subject from the local object database.

    Passed as argv (never interpolated into a shell) and peeled with
    ``^{commit}`` so a hex-looking ref name cannot resolve to a tree or tag.
    Returns None when the object is missing, ambiguous, or has no subject.
    """
    rc, out, _ = run_git(
        ["show", "-s", "--format=%s", f"{oid}^{{commit}}", "--"], cwd=repo_root
    )
    if rc != 0:
        return None
    for line in out.splitlines():
        subject = line.strip()
        if subject:
            return subject[:MAX_SUBJECT_LEN]
    return None


def build_commit_evidence(
    repo_root: Path,
    tokens: list[str],
    overrides: dict[str, str],
) -> tuple[list[tuple[str, str]], str | None]:
    """Pair every commit OID with an accurate subject, or fail.

    There is no placeholder path: an OID that neither resolves locally nor
    carries an explicit mapping stops the command before any mutation.
    """
    evidence: list[tuple[str, str]] = []
    unresolved: list[str] = []

    for oid in tokens:
        if oid in overrides:
            evidence.append((oid, overrides[oid]))
            continue
        subject = resolve_commit_subject(repo_root, oid)
        if subject is None:
            unresolved.append(oid)
            continue
        evidence.append((oid, subject))

    if unresolved:
        return [], (
            "cannot resolve commit evidence for: "
            + ", ".join(unresolved)
            + ". Fetch the objects, correct the OID, or pass the exact subject "
            "with --commit-subject <oid>=<subject>. Nothing was written."
        )

    unused = sorted(oid for oid in overrides if oid not in tokens)
    if unused:
        return [], (
            "--commit-subject supplied for OIDs that are not in --commit: "
            + ", ".join(unused)
            + ". The mapping must be one-to-one. Nothing was written."
        )

    return evidence, None


def escape_markdown_cell(text: str) -> str:
    """Make a commit subject safe inside a Markdown table cell."""
    collapsed = " ".join(text.split())
    return collapsed.replace("\\", "\\\\").replace("|", "\\|")


# =============================================================================
# Record identity (R2)
# =============================================================================

def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").split())


def _fingerprint_payload(
    title: str,
    summary: str,
    package: str | None,
    branch: str | None,
    evidence: list[tuple[str, str]],
    changes: list[str] | None,
    extra_content: str | None,
    tests: list[str] | None,
    next_steps: list[str] | None,
    idempotency_key: str | None,
) -> dict:
    """Normalized semantic inputs of one record, shared by both schemes."""
    return {
        "title": _normalize_text(title),
        "summary": _normalize_text(summary),
        "package": package or "",
        "branch": branch or "",
        "commits": [[oid, _normalize_text(subject)] for oid, subject in evidence],
        "changes": [_normalize_text(c) for c in changes or []],
        "extra": _normalize_text(extra_content),
        "tests": [_normalize_text(t) for t in tests or []],
        "next_steps": [_normalize_text(n) for n in next_steps or []],
        "idempotency_key": idempotency_key or "",
    }


def _hash_payload(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def compute_record_fingerprint(payload: dict) -> str:
    """Stable retry identity; use a new idempotency key for identical new sessions."""
    return _hash_payload(payload)


def render_marker(fingerprint: str) -> str:
    """Machine-readable record marker; renders as nothing in Markdown."""
    return f"{MARKER_PREFIX} v={MARKER_VERSION} fp={fingerprint} -->"


# =============================================================================
# Session numbering (worktree local)
# =============================================================================


def max_local_session(dev_dir: Path, index_file: Path) -> int:
    """Highest session number visible in the working tree."""
    highest = get_current_session(index_file)
    for f in dev_dir.glob(f"{FILE_JOURNAL_PREFIX}*.md"):
        if not f.is_file():
            continue
        try:
            content = f.read_text(encoding="utf-8")
        except OSError:
            continue
        highest = max(highest, _max_session_in_journal(content))
    return highest


def resolve_next_session(dev_dir: Path, index_file: Path) -> int:
    """Allocate the next number from this worktree's local journal only."""
    return max_local_session(dev_dir, index_file) + 1


# =============================================================================
# Pending-record classifier (R3/R4)
# =============================================================================

def find_marker_entries(dev_dir: Path, marker: str) -> list[tuple[Path, int | None]]:
    """Locate every journal entry carrying `marker`.

    Returns (journal_file, session_number); the number is None when the marker
    is not directly under a `## Session N:` heading, which is malformed
    pending evidence and must never be guessed into completion.
    """
    hits: list[tuple[Path, int | None]] = []
    for f in sorted(dev_dir.glob(f"{FILE_JOURNAL_PREFIX}*.md")):
        if not f.is_file():
            continue
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for i, line in enumerate(lines):
            if line.strip() != marker:
                continue
            session_num: int | None = None
            for j in range(i - 1, max(-1, i - 4), -1):
                match = SESSION_HEADING_RE.match(lines[j])
                if match:
                    session_num = int(match.group(1))
                    break
            hits.append((f, session_num))
    return hits


def index_has_session_row(index_file: Path, session_num: int) -> bool:
    """Whether the session-history block already holds this session's row."""
    if not index_file.is_file():
        return False
    try:
        lines = index_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False

    row_re = re.compile(r"^\|\s*%d\s*\|" % session_num)
    in_history = False
    for line in lines:
        if "@@@auto:session-history" in line:
            in_history = True
            continue
        if "@@@/auto:session-history" in line:
            in_history = False
            continue
        if in_history and row_re.match(line):
            return True
    return False


def classify_record(
    dev_dir: Path,
    index_file: Path,
    marker: str,
) -> tuple[str, Path | None, int | None, str | None]:
    """Classify the current state of this exact record.

    Returns (state, journal_file, session_num, error). Only a unique, exact,
    local match is ever adopted; anything ambiguous, malformed or
    partially written comes back as an error so the caller fails safely.
    """
    hits = find_marker_entries(dev_dir, marker)

    if not hits:
        return STATE_ABSENT, None, None, None

    if len(hits) > 1:
        files = ", ".join(sorted({p.name for p, _ in hits}))
        return "", None, None, (
            f"found {len(hits)} journal entries carrying this record's marker "
            f"({files}). Refusing to guess which one to resume — remove the "
            "duplicate entry or pass --idempotency-key to record a new session."
        )

    journal_file, session_num = hits[0]
    if session_num is None:
        return "", None, None, (
            f"{journal_file.name} carries this record's marker without a "
            "'## Session N:' heading above it. The pending record is malformed; "
            "repair it by hand before retrying."
        )

    if index_has_session_row(index_file, session_num):
        return STATE_INDEX_RECORDED, journal_file, session_num, None

    recorded_total = get_current_session(index_file)
    if recorded_total > session_num:
        return "", None, None, (
            f"journal entry for session {session_num} has no index row, but "
            f"index.md already counts {recorded_total} sessions. Repairing the "
            "row would rewrite a later record — resolve index.md by hand."
        )

    return STATE_JOURNAL_RECORDED, journal_file, session_num, None


# =============================================================================
# Rendering
# =============================================================================

def _render_bullet_section(header: str, items: list[str], bullet_prefix: str = "- ") -> str:
    """Render a Markdown section as bullets, or "" when there is no content.

    A section with zero provided values is omitted entirely from the
    rendered entry rather than falling back to a placeholder string.
    """
    if not items:
        return ""
    bullets = "\n".join(f"{bullet_prefix}{item}" for item in items)
    return f"\n\n### {header}\n\n{bullets}"


def _render_main_changes(changes: list[str], extra_content: str | None) -> str:
    """Render the Main Changes section from --change bullets or freeform content."""
    if changes:
        return _render_bullet_section("Main Changes", changes)
    if extra_content:
        return f"\n\n### Main Changes\n\n{extra_content}"
    return ""


def generate_session_content(
    session_num: int,
    title: str,
    evidence: list[tuple[str, str]],
    summary: str,
    today: str,
    marker: str,
    package: str | None = None,
    branch: str | None = None,
    changes: list[str] | None = None,
    extra_content: str | None = None,
    tests: list[str] | None = None,
    next_steps: list[str] | None = None,
) -> str:
    """Generate session content."""
    if evidence:
        commit_table = """| Hash | Message |
|------|---------|"""
        for oid, subject in evidence:
            commit_table += f"\n| `{oid}` | {escape_markdown_cell(subject)} |"
    else:
        commit_table = "(No commits - planning session)"

    package_line = f"\n**Package**: {package}" if package else ""
    branch_line = f"\n**Branch**: `{branch}`" if branch else ""

    main_changes_section = _render_main_changes(changes or [], extra_content)
    testing_section = _render_bullet_section("Testing", tests or [], bullet_prefix="- [OK] ")
    next_steps_section = _render_bullet_section("Next Steps", next_steps or [])

    return f"""

## Session {session_num}: {title}
{marker}

**Date**: {today}
**Task**: {title}{package_line}{branch_line}

### Summary

{summary}{main_changes_section}

### Git Commits

{commit_table}{testing_section}

### Status

[OK] **Completed**{next_steps_section}
"""


def format_commit_display(evidence: list[tuple[str, str]]) -> str:
    """Index-table rendering of the commit OIDs."""
    if not evidence:
        return "-"
    return ", ".join(f"`{oid}`" for oid, _ in evidence)


def update_index(
    index_file: Path,
    dev_dir: Path,
    title: str,
    evidence: list[tuple[str, str]],
    new_session: int,
    active_file: str,
    today: str,
    branch: str | None = None,
) -> bool:
    """Update index.md with new session info."""
    commit_display = format_commit_display(evidence)

    # Get file number from active_file name
    match = re.search(r"(\d+)", active_file)
    active_num = int(match.group(1)) if match else 0
    files_table = count_journal_files(dev_dir, active_num)

    print(f"Updating index.md for session {new_session}...")
    print(f"  Title: {title}")
    print(f"  Commit: {commit_display}")
    print(f"  Active File: {active_file}")
    print()

    content = index_file.read_text(encoding="utf-8")

    if any(f"@@@{prefix}{section}" not in content for section in ("current-status", "active-documents", "session-history") for prefix in ("auto:", "/auto:")):
        print("Error: Markers not found in index.md. Please ensure markers exist.", file=sys.stderr)
        return False

    # Process sections
    lines = content.splitlines()
    new_lines = []

    in_current_status = False
    in_active_documents = False
    in_session_history = False
    header_written = False

    for line in lines:
        if "@@@auto:current-status" in line:
            new_lines.append(line)
            in_current_status = True
            new_lines.append(f"- **Active File**: `{active_file}`")
            new_lines.append(f"- **Total Sessions**: {new_session}")
            new_lines.append(f"- **Last Active**: {today}")
            continue

        if "@@@/auto:current-status" in line:
            in_current_status = False
            new_lines.append(line)
            continue

        if "@@@auto:active-documents" in line:
            new_lines.append(line)
            in_active_documents = True
            new_lines.append("| File | Lines | Status |")
            new_lines.append("|------|-------|--------|")
            new_lines.append(files_table)
            continue

        if "@@@/auto:active-documents" in line:
            in_active_documents = False
            new_lines.append(line)
            continue

        if "@@@auto:session-history" in line:
            new_lines.append(line)
            in_session_history = True
            header_written = False
            continue

        if "@@@/auto:session-history" in line:
            in_session_history = False
            new_lines.append(line)
            continue

        if in_current_status:
            continue

        if in_active_documents:
            continue

        if in_session_history:
            # Migrate old 4/6-column headers to 5-column Branch-only history.
            if re.match(
                r"^\|\s*#\s*\|\s*Date\s*\|\s*Title\s*\|\s*Commits\s*\|\s*Branch\s*\|\s*Base Branch\s*\|\s*$",
                line,
            ):
                new_lines.append("| # | Date | Title | Commits | Branch |")
                continue
            if re.match(r"^\|\s*#\s*\|\s*Date\s*\|\s*Title\s*\|\s*Commits\s*\|\s*Branch\s*\|\s*$", line):
                new_lines.append("| # | Date | Title | Commits | Branch |")
                continue
            if re.match(r"^\|\s*#\s*\|\s*Date\s*\|\s*Title\s*\|\s*Commits\s*\|\s*$", line):
                new_lines.append("| # | Date | Title | Commits | Branch |")
                continue
            if re.match(r"^\|[-| ]+\|\s*$", line) and not header_written:
                new_lines.append("|---|------|-------|---------|--------|")
                new_lines.append(f"| {new_session} | {today} | {title} | {commit_display} | `{branch or '-'}` |")
                header_written = True
                continue
            new_lines.append(line)
            continue

        new_lines.append(line)

    if not header_written:
        print("Error: session history table header is missing", file=sys.stderr)
        return False

    if not write_text_atomic(index_file, "\n".join(new_lines)):
        print(f"Error: failed to write {index_file}", file=sys.stderr)
        return False
    print("[OK] Updated index.md successfully!")
    return True


# =============================================================================
# Main Function
# =============================================================================


def ensure_workspace(workspace: Path) -> bool:
    """Create the personal index on first recording, preserving existing files."""
    try:
        workspace.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"Error: cannot create workspace: {exc}", file=sys.stderr)
        return False
    index = workspace / "index.md"
    if index.exists():
        return True
    content = "# Workspace Index\n\n"
    for section in ("current-status", "active-documents", "session-history"):
        content += f"<!-- @@@auto:{section} -->\n"
        if section == "session-history":
            content += "| # | Date | Title | Commits | Branch |\n|---|------|-------|---------|--------|\n"
        content += f"<!-- @@@/auto:{section} -->\n\n"
    return write_text_atomic(index, content)


def add_session(
    title: str,
    commit: str = "-",
    summary: str = "Session summary was not supplied.",
    changes: list[str] | None = None,
    extra_content: str | None = None,
    tests: list[str] | None = None,
    next_steps: list[str] | None = None,
    package: str | None = None,
    branch: str | None = None,
    commit_subjects: list[str] | None = None,
    idempotency_key: str | None = None,
) -> int:
    """Add a new session, resuming an interrupted one instead of duplicating it."""
    repo_root = get_repo_root()
    dev_dir = get_workspace_dir(repo_root)

    # -------------------------------------------------------------------
    # Preflight — no writes happen until every one of these succeeds.
    # -------------------------------------------------------------------
    if idempotency_key is not None and not IDEMPOTENCY_KEY_RE.match(idempotency_key):
        print(
            f"Error: invalid --idempotency-key '{idempotency_key}': expected 1-64 "
            "characters from [A-Za-z0-9._-]",
            file=sys.stderr,
        )
        return 1

    tokens, token_error = parse_commit_tokens(commit)
    if token_error:
        print(f"Error: {token_error}", file=sys.stderr)
        return 1

    overrides, override_error = parse_subject_overrides(commit_subjects)
    if override_error:
        print(f"Error: {override_error}", file=sys.stderr)
        return 1

    evidence, evidence_error = build_commit_evidence(repo_root, tokens, overrides)
    if evidence_error:
        print(f"Error: {evidence_error}", file=sys.stderr)
        return 1

    max_lines = get_max_journal_lines(repo_root)
    index_file = dev_dir / "index.md"
    today = datetime.now().strftime("%Y-%m-%d")

    payload = _fingerprint_payload(
        title, summary, package, branch, evidence,
        changes, extra_content, tests, next_steps, idempotency_key,
    )
    marker = render_marker(compute_record_fingerprint(payload))

    state, matched_file, matched_num, classify_error = classify_record(
        dev_dir, index_file, marker
    )
    if classify_error:
        print(f"Error: {classify_error}", file=sys.stderr)
        return 1
    if state == STATE_INDEX_RECORDED:
        print(f"[OK] Session {matched_num} is already recorded; nothing to do.", file=sys.stderr)
        return 0
    if not ensure_workspace(dev_dir):
        return 1

    print("========================================", file=sys.stderr)
    print("ADD SESSION", file=sys.stderr)
    print("========================================", file=sys.stderr)
    print("", file=sys.stderr)

    # -------------------------------------------------------------------
    # Absent → journal-recorded
    # -------------------------------------------------------------------
    target_file: Path | None
    target_num: int
    new_session: int

    if state == STATE_ABSENT:
        journal_file, current_num, current_lines = get_latest_journal_info(dev_dir)
        new_session = resolve_next_session(dev_dir, index_file)

        session_content = generate_session_content(
            new_session, title, evidence, summary, today, marker, package, branch,
            changes=changes, extra_content=extra_content, tests=tests,
            next_steps=next_steps,
        )
        content_lines = len(session_content.splitlines())

        print(f"Session: {new_session}", file=sys.stderr)
        print(f"Title: {title}", file=sys.stderr)
        print(f"Commit: {format_commit_display(evidence)}", file=sys.stderr)
        print("", file=sys.stderr)
        print(f"Current journal file: {FILE_JOURNAL_PREFIX}{current_num}.md", file=sys.stderr)
        print(f"Current lines: {current_lines}", file=sys.stderr)
        print(f"New content lines: {content_lines}", file=sys.stderr)
        print(f"Total after append: {current_lines + content_lines}", file=sys.stderr)
        print("", file=sys.stderr)

        target_file = journal_file
        target_num = current_num

        if target_file is None or current_lines + content_lines > max_lines:
            target_num = current_num + 1
            print(f"Creating {FILE_JOURNAL_PREFIX}{target_num}.md", file=sys.stderr)
            target_file = create_new_journal_file(dev_dir, target_num, today)
            if target_file is None:
                print(
                    f"Error: failed to create {FILE_JOURNAL_PREFIX}{target_num}.md; "
                    "nothing was recorded.",
                    file=sys.stderr,
                )
                return 1
            print(f"Created: {target_file}", file=sys.stderr)

        if target_file is None:
            print(
                "Error: no writable journal file found.",
                file=sys.stderr,
            )
            return 1

        try:
            existing = target_file.read_text(encoding="utf-8") if target_file.is_file() else ""
        except OSError as exc:
            print(f"Error: cannot read {target_file}: {exc}", file=sys.stderr)
            return 1

        if not write_text_atomic(target_file, existing + session_content):
            print(
                f"Error: failed to append the session to {target_file.name}; "
                "the previous journal content is intact and nothing was recorded.",
                file=sys.stderr,
            )
            return 1
        print(f"[OK] Appended session to {target_file.name}", file=sys.stderr)
        state = STATE_JOURNAL_RECORDED
    else:
        if matched_file is None or matched_num is None:
            print(
                f"Error: resumed state '{state}' without a matching journal entry.",
                file=sys.stderr,
            )
            return 1
        target_file = matched_file
        new_session = matched_num
        target_num = _extract_journal_num(target_file.stem)
        print(
            f"[RESUME] Session {new_session} is already in {target_file.name} and "
            f"pending; continuing from '{state}' instead of appending again.",
            file=sys.stderr,
        )
        print("", file=sys.stderr)

    print("", file=sys.stderr)

    # -------------------------------------------------------------------
    # Journal-recorded → index-recorded
    # -------------------------------------------------------------------
    active_file = f"{FILE_JOURNAL_PREFIX}{target_num}.md"
    if state == STATE_JOURNAL_RECORDED:
        if not update_index(
            index_file,
            dev_dir,
            title,
            evidence,
            new_session,
            active_file,
            today,
            branch,
        ):
            print(
                f"[BLOCKED] Checkpoint: session {new_session} is in "
                f"{active_file} but index.md was not updated. Fix index.md, then "
                "re-run the identical command to repair the row without adding a "
                "second session.",
                file=sys.stderr,
            )
            return 1
        state = STATE_INDEX_RECORDED
    else:
        print(f"[OK] index.md already records session {new_session}.", file=sys.stderr)

    print("", file=sys.stderr)
    print("========================================", file=sys.stderr)
    print(f"[OK] Session {new_session} added successfully!", file=sys.stderr)
    print("========================================", file=sys.stderr)
    print("", file=sys.stderr)
    print("Files updated:", file=sys.stderr)
    print(f"  - {target_file.name if target_file else 'journal'}", file=sys.stderr)
    print("  - index.md", file=sys.stderr)

    return 0


# =============================================================================
# Main Entry
# =============================================================================

def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Add a new session to journal file and update index.md"
    )
    parser.add_argument("--title", required=True, help="Session title")
    parser.add_argument(
        "--commit",
        default="-",
        help=(
            "Comma-separated commit OIDs (7-40 hex chars each). Each one is "
            "resolved to its real subject before anything is written; an "
            "unresolvable OID fails the command. Use '-' for a planning session."
        ),
    )
    parser.add_argument(
        "--commit-subject",
        action="append",
        metavar="OID=SUBJECT",
        help=(
            "Explicit subject for a commit that cannot be resolved locally "
            "(repeatable). The mapping must be one-to-one with --commit."
        ),
    )
    parser.add_argument("--summary", default="Session summary was not supplied.", help="Brief summary")
    parser.add_argument("--content-file", help="Path to file with detailed content")
    parser.add_argument("--package", help="Package name tag (e.g., cli, docs-site)")
    parser.add_argument("--branch", help="Branch name (auto-detected if omitted)")
    parser.add_argument("--change", action="append", help="Main Changes bullet (repeatable)")
    parser.add_argument("--test", action="append", help="Testing bullet (repeatable)")
    parser.add_argument("--next-step", action="append", help="Next Steps bullet (repeatable)")
    parser.add_argument(
        "--idempotency-key",
        help=(
            "Caller-supplied retry key ([A-Za-z0-9._-], 1-64 chars). Makes an "
            "identical session distinguishable from a previous record."
        ),
    )
    parser.add_argument("--stdin", action="store_true",
                        help="Read extra content from stdin (explicit opt-in)")

    args = parser.parse_args()

    extra_content: str | None = None
    if args.content_file:
        content_path = Path(args.content_file)
        if content_path.is_file():
            extra_content = content_path.read_text(encoding="utf-8")
    elif args.stdin:
        extra_content = sys.stdin.read()

    # Load active task once — shared by package and branch resolution
    repo_root = get_repo_root()
    current = get_current_task(repo_root)
    task_data = load_task(repo_root / current) if current else None

    package = args.package
    if package:
        # CLI source: fail-fast in monorepo, ignore in single-repo
        if not is_monorepo(repo_root):
            print("Warning: --package ignored in single-repo project", file=sys.stderr)
            package = None
        elif not validate_package(package, repo_root):
            packages = get_packages(repo_root)
            available = ", ".join(sorted(packages.keys())) if packages else "(none)"
            print(f"Error: unknown package '{package}'. Available: {available}", file=sys.stderr)
            return 1
    else:
        # Inferred: active task's task.json.package → default_package → None
        task_package = task_data.package if task_data else None
        package = resolve_package(task_package, repo_root)

    branch = resolve_session_branch(repo_root, args.branch, task_data)

    return add_session(
        args.title, args.commit, args.summary,
        changes=args.change, extra_content=extra_content, tests=args.test,
        next_steps=args.next_step,
        package=package,
        branch=branch,
        commit_subjects=args.commit_subject,
        idempotency_key=args.idempotency_key,
    )


if __name__ == "__main__":
    sys.exit(main())

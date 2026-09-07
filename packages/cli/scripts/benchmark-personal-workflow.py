#!/usr/bin/env python3
"""Compare a Git revision with current templates without installing either CLI.

Run from any directory:
  python3 packages/cli/scripts/benchmark-personal-workflow.py --baseline HEAD \
    --output /private/tmp/trellis-personal-benchmark

Requires Python 3.9+, Node and the repository's installed TypeScript dependency.
Measures text only, not provider framing/cache pricing or LLM task success rates.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from unittest.mock import patch

PLATFORMS = ("codex", "claude", "cursor", "pi")
STATES = ("no_task", "planning", "in_progress")
TEMPLATE_PATH = "packages/cli/src/templates"

# Execute the actual Pi extension with a minimal host; no model/tool execution.
PI_HOST = r"""
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [source, compiler, output] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const ts = require(compiler);
writeFileSync(output, ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText);
const extension = (await import(pathToFileURL(output).href)).default;
const handlers = new Map(), tools = [];
extension({ on(name, fn) { handlers.set(name, fn); },
  registerTool(tool) { tools.push(tool.name); }, registerShortcut() {} });
const ctx = { cwd: process.cwd(), hasUI: false,
  sessionManager: { getSessionId() { return 'benchmark'; } } };
await handlers.get('session_start')?.({ session_id: 'benchmark' }, ctx);
const result = await handlers.get('before_agent_start')?.({ systemPrompt: '' }, ctx);
if (!result?.systemPrompt) throw new Error('Pi emitted no startup system prompt');
console.log(JSON.stringify({ ...result, tools, events: [...handlers.keys()] }));
"""


def command(args: list[str], cwd: Path, env: dict[str, str] | None = None,
            stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, env=env, input=stdin, text=True,
                          encoding="utf-8", capture_output=True, timeout=30)


def require_success(result: subprocess.CompletedProcess[str]) -> str:
    if result.returncode:
        raise RuntimeError(f"Command failed: {result.args}\n{result.stderr}\n{result.stdout}")
    return result.stdout


def snapshot(repo: Path, baseline: str, destination: Path) -> None:
    """Extract regular tracked template files; never materialize archive links."""
    data = subprocess.check_output(["git", "archive", baseline, TEMPLATE_PATH], cwd=repo)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive:
            if not member.isfile():
                continue
            rel = Path(member.name).relative_to(TEMPLATE_PATH)
            if rel.is_absolute() or ".." in rel.parts:
                raise ValueError(f"Unsafe archive path: {member.name}")
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"Unreadable archive entry: {member.name}")
            target = destination / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read())


def local_tokenizer():
    """Use cached tokenizer data only; never fetch model assets for this benchmark."""
    try:
        import tiktoken
        # read_file is the uncached fallback; a cached encoding needs no call.
        with patch("tiktoken.load.read_file", side_effect=RuntimeError("No cached encoding")):
            encoding = tiktoken.get_encoding("o200k_base")
        return encoding, "o200k_base text-token estimate; not a platform/model-specific total"
    except (ImportError, RuntimeError, OSError, ValueError) as error:
        return None, f"Unavailable offline ({type(error).__name__}); tokens omitted"


def clean_env() -> dict[str, str]:
    # Parent IDE/session and Git variables must not redirect fixture operations.
    return {key: value for key, value in os.environ.items()
            if not key.startswith(("TRELLIS_", "CLAUDE_", "CODEX_", "CURSOR_", "PI_", "GIT_"))
            and "SESSION" not in key and not key.endswith("PROJECT_DIR")}


def fixture(templates: Path, root: Path, platform: str, state: str, before: bool) -> dict[str, str]:
    shutil.copytree(templates / "trellis/scripts", root / ".trellis/scripts",
                    ignore=shutil.ignore_patterns("__pycache__"))
    trellis = root / ".trellis"
    shutil.copyfile(templates / "trellis/workflow.md", trellis / "workflow.md")
    spec = trellis / "spec/guides/index.md"
    spec.parent.mkdir(parents=True)
    spec.write_text("# Project rules\n\nPreserve user data. Test observable behavior.\n", encoding="utf-8")
    workspace = trellis / "workspace" / ("benchmark" if before else "")
    workspace.mkdir(parents=True)
    (workspace / "journal-1.md").write_text("# Journal\n\nNo earlier sessions.\n", encoding="utf-8")
    if before:
        (trellis / ".developer").write_text("name=benchmark\n", encoding="utf-8")
    key = f"{platform}_benchmark"
    if state != "no_task":
        task = trellis / "tasks/work"
        task.mkdir(parents=True)
        data = {"id": "work", "name": "work", "title": "Example task", "description": "Implement a local change",
                "status": state, "priority": "P2", "createdAt": "2026-01-01", "children": [], "parent": None}
        if before:
            data.update(creator="benchmark", assignee="benchmark")
        (task / "task.json").write_text(json.dumps(data), encoding="utf-8")
        (task / "prd.md").write_text("# Example task\n\nAcceptance: observable behavior passes.\n", encoding="utf-8")
        row = json.dumps({"file": ".trellis/spec/guides/index.md", "reason": "project rules"}) + "\n"
        for name in ("implement.jsonl", "check.jsonl"):
            (task / name).write_text(row if state == "in_progress" else "", encoding="utf-8")
        sessions = trellis / ".runtime/sessions"
        sessions.mkdir(parents=True)
        (sessions / f"{key}.json").write_text(json.dumps({"current_task": ".trellis/tasks/work", "platform": platform}), encoding="utf-8")
    env = clean_env()
    env["TRELLIS_CONTEXT_ID"] = key
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def metrics(text: str, encoding) -> dict[str, int | None]:
    return {"bytes": len(text.encode("utf-8")), "characters": len(text),
            "lines": len(text.splitlines()),
            "estimated_tokens": len(encoding.encode(text)) if encoding else None}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default="HEAD", help="Git revision before optimization")
    parser.add_argument("--output", type=Path, required=True, help="New report directory (must not exist)")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    baseline = require_success(command(["git", "rev-parse", "--verify", args.baseline + "^{commit}"], repo)).strip()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    encoding, tokenizer_note = local_tokenizer()
    compiler = repo / "packages/cli/node_modules/typescript"
    if not compiler.exists():
        raise RuntimeError("Install repository dependencies first: pnpm install")
    report: dict = {"baseline_commit": baseline, "candidate": "working tree snapshot", "tokenizer": tokenizer_note,
                    "measurements": [], "contracts": [], "source_files": {}}

    with tempfile.TemporaryDirectory(prefix="trellis-context-benchmark-") as temp:
        scratch = Path(temp).resolve()
        versions = {"before": scratch / "before", "after": scratch / "after"}
        snapshot(repo, baseline, versions["before"])
        shutil.copytree(repo / TEMPLATE_PATH, versions["after"], ignore=shutil.ignore_patterns("__pycache__"))
        host = scratch / "pi-host.mjs"
        host.write_text(PI_HOST, encoding="utf-8")
        for version, templates in versions.items():
            groups = {
                "workflow_source": [templates / "trellis/workflow.md"],
                "shared_skill_sources": sorted((templates / "common").glob("commands/*.md"))
                    + sorted((templates / "common").glob("skills/*.md"))
                    + sorted((templates / "common/bundled-skills").rglob("*.md")),
            }
            for platform in PLATFORMS:
                groups[f"{platform}_agent_sources"] = sorted((templates / platform / "agents").glob("*"))
            report["source_files"][version] = {}
            for name, files in groups.items():
                text = "\n".join(file.read_text(encoding="utf-8") for file in files if file.is_file())
                report["source_files"][version][name] = {"files": [str(file.relative_to(templates)) for file in files],
                    "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), **metrics(text, encoding)}
            workflow = (templates / "trellis/workflow.md").read_text(encoding="utf-8").lower()
            for name, passed in {
                "authorization_persists_contract": "authorization persists" in workflow and "explicit" in workflow,
                "unfinished_work_not_archived_contract": "never archive unfinished work" in workflow,
                "personal_agent_routing_contract": all(f"trellis-{role}" in workflow for role in ("implement", "research", "check")),
            }.items():
                report["contracts"].append({"version": version, "kind": "text contract (not LLM behavior)", "name": name, "passed": passed})
            for platform in PLATFORMS:
                for state in STATES:
                    root = scratch / f"{version}-{platform}-{state}"
                    env = fixture(templates, root, platform, state, version == "before")
                    outputs = {"get_context": require_success(command([sys.executable, ".trellis/scripts/get_context.py"], root, env)),
                               "phase_context": require_success(command([sys.executable, ".trellis/scripts/get_context.py", "--mode", "phase", "--platform", platform], root, env))}
                    if platform == "pi":
                        raw = require_success(command(["node", str(host), str(templates / "pi/extensions/trellis/index.ts.txt"),
                            str(compiler), str(root / "pi-extension.mjs")], root, env))
                        payload = json.loads(raw)
                        outputs["system_prompt"] = payload["systemPrompt"]
                        outputs["runtime_message"] = (payload.get("message") or {}).get("content", "")
                        outputs["first_turn_context"] = "\n\n".join(text for text in (outputs["system_prompt"], outputs["runtime_message"]) if text)
                        report["contracts"].append({"version": version, "platform": platform, "state": state,
                            "kind": "actual extension, simulated host", "name": "subagent_tool_registered",
                            "passed": "trellis_subagent" in payload["tools"]})
                    else:
                        hook = root / f".{platform}/hooks/session-start.py"
                        hook.parent.mkdir(parents=True)
                        source = templates / ("codex/hooks/session-start.py" if platform == "codex" else "shared-hooks/session-start.py")
                        shutil.copyfile(source, hook)
                        stdin = json.dumps({"cwd": str(root), "session_id": "benchmark", "hook_event_name": "SessionStart"})
                        payload = json.loads(require_success(command([sys.executable, str(hook)], root, env, stdin)))
                        outputs["first_turn_context"] = (payload.get("additional_context") if platform == "cursor" else None) or payload["hookSpecificOutput"]["additionalContext"]
                    for component, text in outputs.items():
                        # Normalize only fixture paths, not content/whitespace differences.
                        text = text.replace(str(root), "<WORKTREE>")
                        artifact = output / version / platform / state / f"{component}.txt"
                        artifact.parent.mkdir(parents=True, exist_ok=True)
                        artifact.write_text(text, encoding="utf-8")
                        report["measurements"].append({"version": version, "platform": platform, "state": state,
                            "component": component, "artifact": str(artifact.relative_to(output)), **metrics(text, encoding)})
                    if state == "planning":
                        # Run after measurement so these probes cannot affect captured context.
                        started = command([sys.executable, ".trellis/scripts/task.py", "start", "work"], root, env)
                        archived = command([sys.executable, ".trellis/scripts/task.py", "archive", "work", "--skip-branch-validation"], root, env)
                        for name, passed, result in [
                            ("starts_with_empty_optional_manifests", started.returncode == 0, started),
                            ("refuses_unfinished_archive", archived.returncode != 0 and (root / ".trellis/tasks/work").exists(), archived),
                        ]:
                            report["contracts"].append({"version": version, "platform": platform, "kind": "real Python CLI",
                                "name": name, "passed": passed, "returncode": result.returncode,
                                "stderr": result.stderr.replace(str(root), "<WORKTREE>")})
    report["limits"] = [
        "No LLM calls: these are context-size measurements and executable/text contracts, not task-success evals.",
        "Pi executes its real transpiled extension against a simulated host; other platforms execute their actual Python hooks.",
        "Baseline is initialized with its required developer identity; candidate uses flat personal workspace. Other fixture inputs match.",
        "Skill/Agent figures measure source corpora loaded on demand, not all injected tokens. Platform-rendered Skill wrappers are not measured.",
        "First-turn text excludes host system prompts, protocol framing and provider cache effects; mirrored hook JSON fields count once.",
        "Token counts, when available offline, use o200k_base as an estimate across all platforms, not each model's exact tokenizer.",
        "No init/update benchmark here; executable coverage lives in packages/cli/test/commands/personal-worktrees.integration.test.ts.",
    ]
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# Personal workflow benchmark", "", f"Baseline: `{baseline}`", "", tokenizer_note, "",
             "| Platform | State | Before chars | After chars | Change |", "|---|---|---:|---:|---:|"]
    for platform in PLATFORMS:
        for state in STATES:
            sizes = {row["version"]: row["characters"] for row in report["measurements"]
                     if row["platform"] == platform and row["state"] == state and row["component"] == "first_turn_context"}
            delta = (sizes["after"] / sizes["before"] - 1) * 100 if sizes["before"] else 0
            lines.append(f"| {platform} | {state} | {sizes['before']} | {sizes['after']} | {delta:+.1f}% |")
    lines += ["", "Source corpora below are on-demand assets, not cumulative injected context.", "",
              "| Source corpus | Before chars | After chars | Change |", "|---|---:|---:|---:|"]
    for name, before in report["source_files"]["before"].items():
        after = report["source_files"]["after"][name]
        delta = (after["characters"] / before["characters"] - 1) * 100 if before["characters"] else 0
        lines.append(f"| {name} | {before['characters']} | {after['characters']} | {delta:+.1f}% |")
    lines += ["", "Candidate contract checks (text/CLI/extension assertions, not LLM success rates):", ""]
    for version in ("before", "after"):
        checks = [item for item in report["contracts"] if item["version"] == version]
        lines.append(f"- {version}: {sum(item['passed'] for item in checks)}/{len(checks)} current-contract predicates satisfied.")
    lines += ["", "Full bytes/Unicode code points/lines/token estimates, source hashes, contracts and raw outputs: report.json and adjacent files.", ""]
    lines += [f"- {limit}" for limit in report["limits"]]
    (output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    failures = [item for item in report["contracts"] if item["version"] == "after" and not item["passed"]]
    if failures:
        print(f"Candidate contract failures: {len(failures)}; see report.json", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertLocalState,
  inheritProjectKnowledge,
  mainCheckout,
  retirePersonalFiles,
} from "../../src/utils/personal-project.js";
import { computeHash, saveHashes } from "../../src/utils/template-hash.js";

const bundle = vi.hoisted(
  () =>
    new Map([
      [
        ".agents/skills/trellis-demo/SKILL.md",
        "---\nname: trellis-demo\n---\nRead references/guide.md\n",
      ],
      [".agents/skills/trellis-demo/references/guide.md", "Personal guide\n"],
    ]),
);
vi.mock("../../src/configurators/pi.js", () => ({
  collectPiTemplates: () => bundle,
}));
const oldSkill = ".pi/skills/trellis-demo/SKILL.md";
const sharedSkill = ".agents/skills/trellis-demo/SKILL.md";
let tmp: string;
let cwd: string;
function write(rel: string, content: string, root = cwd): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function snapshot(root = cwd): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name),
        rel = path.relative(root, target);
      if (entry.isSymbolicLink())
        files[rel] = `link:${fs.readlinkSync(target)}`;
      else if (entry.isDirectory()) {
        files[rel] = "directory";
        walk(target);
      } else files[rel] = fs.readFileSync(target, "utf8");
    }
  };
  walk(root);
  return files;
}
function ownedLegacy(content = bundle.get(sharedSkill) ?? ""): void {
  write(oldSkill, content);
  fs.mkdirSync(path.join(cwd, ".trellis"), { recursive: true });
  saveHashes(cwd, { [oldSkill]: computeHash(bundle.get(sharedSkill) ?? "") });
}
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-personal-"));
  cwd = path.join(tmp, "project");
  fs.mkdirSync(cwd);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("Pi retirement", () => {
  it("retires original config auto-commit guidance while preserving personal settings", () => {
    const original =
      '# Trellis Configuration\n# Project-level settings for the Trellis workflow system\n#\n# All values have sensible defaults. Only override what you need.\n\n#-------------------------------------------------------------------------------\n# Session Recording\n#-------------------------------------------------------------------------------\n\n# Commit message used when auto-committing journal/index changes\n# after running add_session.py\nsession_commit_message: "chore: record journal"\n\n# Maximum lines per journal file before rotating to a new one\nmax_journal_lines: 2000\n\n#-------------------------------------------------------------------------------\n# Session Auto-Commit\n#-------------------------------------------------------------------------------\n\n# Auto-commit behavior for session journal + task archive operations.\n# - true (default): scripts auto-stage and auto-commit journal / task changes\n#   after add_session.py / task.py archive runs.\n# - false: scripts do not touch git. Files (journal-*.md, task archive moves)\n#   are still written to disk; you decide whether to git add / commit.\n#\n# Use `false` if your project\'s .gitignore intentionally excludes `.trellis/`\n# and you want session data kept local-only, or if you prefer to review\n# staged changes manually before each commit.\n#\n# Accepts: true / false / yes / no / 1 / 0 / on / off (case-insensitive).\n#\n# session_auto_commit: true\n\n#-------------------------------------------------------------------------------\n# Task Lifecycle Hooks\n#-------------------------------------------------------------------------------\n\n# Shell commands to run after task lifecycle events.\n# Each hook receives TASK_JSON_PATH environment variable pointing to task.json.\n# Hook failures print a warning but do not block the main operation.\n#\n# hooks:\n#   after_create:\n#     - "echo \'Task created\'"\n#   after_start:\n#     - "echo \'Task started\'"\n#   after_finish:\n#     - "echo \'Task finished\'"\n#   after_archive:\n#     - "echo \'Task archived\'"\n\n#-------------------------------------------------------------------------------\n# Monorepo / Packages\n#-------------------------------------------------------------------------------\n\n# Declare packages for monorepo projects.\n# Trellis auto-detects workspaces during `trellis init`, but you can also\n# configure them manually here.\n#\n# packages:\n#   frontend:\n#     path: packages/frontend\n#   backend:\n#     path: packages/backend\n#   docs:\n#     path: docs-site\n#     type: submodule\n#   # For polyrepo / meta-repo layouts (independent .git in each subdir),\n#   # mark the package with `git: true`. The runtime treats it as an\n#   # independent repository for things like git-context display.\n#   webapp:\n#     path: ./webapp\n#     git: true\n\n# Default package used when --package is not specified.\n# default_package: frontend\n\n#-------------------------------------------------------------------------------\n# Channel worker OOM guard\n#-------------------------------------------------------------------------------\n# Default safeguards for `trellis channel spawn` workers. The guard runs\n# at spawn time (cleans expired idle workers, then enforces the live-worker\n# budget) and inside each supervisor (self-terminates a worker that stays\n# continuously idle past `idle_timeout`).\n#\n# Precedence: CLI flag > env var (TRELLIS_CHANNEL_WORKER_IDLE_TIMEOUT /\n# TRELLIS_CHANNEL_MAX_LIVE_WORKERS) > this config > built-in default.\n#\n# `idle_timeout: 0` disables idle cleanup (workers can sit idle forever\n# unless explicitly killed or given `--timeout`).\n# `max_live_workers: 0` disables the spawn-time budget check.\n#\n# `trusted_context_dirs` extends the `--file`/`--jsonl`/`--agent` containment\n# check beyond the worker cwd \u2014 useful when `.trellis/tasks` or\n# `.trellis/workspace` is a symlink to an external directory. Realpaths under\n# any listed dir are accepted in addition to cwd.\n# `auto_trust_trellis_symlinks: false` disables the narrow auto-trust of\n# `.trellis/tasks` / `.trellis/workspace` when either is itself a top-level\n# symlink (auto-trust is on by default).\n#\nchannel:\n  worker_guard:\n    idle_timeout: 5m\n    max_live_workers: 6\n  # trusted_context_dirs:\n  #   - /work/user/trellis_workspace\n  # auto_trust_trellis_symlinks: false\n\n#-------------------------------------------------------------------------------\n# Codex (dispatch behavior)\n#-------------------------------------------------------------------------------\n# Codex-only knob; other platforms ignore it. Default ("auto") dispatches\n# trellis-implement / trellis-check / trellis-research sub-agents. This does\n# not rely on inherited parent transcripts: `fork_turns` remains\n# caller-controlled, while Codex\'s native SubagentStart hook injects task\n# context when trusted and child-side loading remains the fallback when it is\n# unavailable. Set to "inline" only to keep implementation and checks in the\n# main session. "sub-agent" remains a backwards-compatible alias for "auto".\n# Invalid explicit values safely use inline mode.\n#\n# In "auto" mode, dispatched sub-agents inherit the main session\'s model\n# unless you pin one. To use a cheaper/faster model for implement/check/\n# research sub-agent work, edit `model` / `model_reasoning_effort` directly\n# on the generated `.codex/agents/trellis-*.toml` files (see the commented\n# hint lines in those files) \u2014 there is no config.yaml knob for this,\n# `trellis update` preserves your edits across regeneration.\n#\n# codex:\n#   dispatch_mode: auto  # or "inline"; legacy alias: "sub-agent"\n\n#-------------------------------------------------------------------------------\n# Sub-agent context injection limits\n#-------------------------------------------------------------------------------\n# Caps how much task context (implement.jsonl / check.jsonl referenced files,\n# plus prd.md / design.md / implement.md) gets inlined into a sub-agent\'s\n# first prompt. Oversized files are truncated with a notice; once the total\n# payload cap is reached, remaining files degrade to index lines (path +\n# reason + size) instead of being inlined.\n#\n# All values are byte counts. `0` disables the corresponding limit.\n#\n# context_injection:\n#   max_file_bytes: 32768        # per implement.jsonl / check.jsonl referenced file\n#   max_artifact_bytes: 65536    # per task artifact (prd.md / design.md / implement.md)\n#   max_total_bytes: 131072      # whole injected payload; overflow degrades to index lines\n\n#-------------------------------------------------------------------------------\n# Per-turn prompt injection\n#-------------------------------------------------------------------------------\n# Escape hatch for the per-turn <workflow-state> breadcrumb. When a user\n# prompt contains the skip keyword as a standalone word (case-insensitive,\n# word-boundary match \u2014 "no-trellisfoo" does NOT count), the breadcrumb is\n# skipped for that turn only. Does not affect SessionStart or sub-agent\n# context injection.\n#\n# prompt_injection:\n#   skip_keyword: "no-trellis"   # "" disables the escape hatch entirely\n';
    write(".trellis/config.yaml", original + "\npersonal_setting: keep\n");
    retirePersonalFiles(cwd);
    const updated = fs.readFileSync(
      path.join(cwd, ".trellis/config.yaml"),
      "utf8",
    );
    expect(updated).not.toMatch(
      /Session Auto-Commit|session_auto_commit|session_commit_message|auto-stage|git add|auto-committing/,
    );
    expect(updated).toContain("max_journal_lines: 2000");
    expect(updated).toContain("personal_setting: keep");
    expect(updated).toContain("# Task Lifecycle Hooks");
  });

  it("preserves custom settings placed inside the former auto-commit section", () => {
    write(
      ".trellis/config.yaml",
      "#-------------------------------------------------------------------------------\n# Session Auto-Commit\n#-------------------------------------------------------------------------------\ncustom_setting: keep\nsession_auto_commit: true\n",
    );
    retirePersonalFiles(cwd);
    const updated = fs.readFileSync(
      path.join(cwd, ".trellis/config.yaml"),
      "utf8",
    );
    expect(updated).toContain("custom_setting: keep");
    expect(updated).not.toContain("session_auto_commit:");
  });

  it("installs the full bundle before retiring only the owned entry", () => {
    ownedLegacy();
    write(".pi/skills/trellis-demo/personal.txt", "keep");
    write(".pi/skills/personal/SKILL.md", "user skill");
    retirePersonalFiles(cwd);
    expect(fs.existsSync(path.join(cwd, oldSkill))).toBe(false);
    for (const [rel, content] of bundle)
      expect(fs.readFileSync(path.join(cwd, rel), "utf8")).toBe(content);
    expect(
      fs.readFileSync(
        path.join(cwd, ".pi/skills/trellis-demo/personal.txt"),
        "utf8",
      ),
    ).toBe("keep");
    expect(
      fs.readFileSync(path.join(cwd, ".pi/skills/personal/SKILL.md"), "utf8"),
    ).toBe("user skill");
    const after = snapshot();
    expect(
      Object.entries(after).some(
        ([rel, content]) =>
          rel.includes(".backup-personal-") &&
          rel.endsWith(oldSkill) &&
          content === bundle.get(sharedSkill),
      ),
    ).toBe(true);
    retirePersonalFiles(cwd);
    expect(snapshot()).toEqual(after);
  });
  it("preserves an unowned same-name skill even with force", () => {
    write(oldSkill, "---\nname: trellis-demo\n---\nUser authored\n");
    const before = snapshot();
    retirePersonalFiles(cwd, { force: true });
    expect(snapshot()).toEqual(before);
  });
  it("preflights legacy and shared modifications before any migration writes", () => {
    ownedLegacy("user-edited old skill");
    write(".trellis/config.yaml", "session_auto_commit: true\n");
    let before = snapshot();
    expect(() => retirePersonalFiles(cwd)).toThrow(/Modified legacy/);
    expect(snapshot()).toEqual(before);
    write(oldSkill, bundle.get(sharedSkill) ?? "");
    write(sharedSkill, "user-edited shared skill");
    before = snapshot();
    expect(() => retirePersonalFiles(cwd)).toThrow(/Modified shared/);
    expect(snapshot()).toEqual(before);
    retirePersonalFiles(cwd, { force: true });
    expect(fs.readFileSync(path.join(cwd, sharedSkill), "utf8")).toBe(
      "user-edited shared skill",
    );
  });
  it.each([
    ".pi",
    ".pi/skills/trellis-demo",
    ".agents",
    ".agents/skills/trellis-demo/references",
  ])("rejects linked ancestor %s without writes", (rel) => {
    ownedLegacy();
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside);
    const target = path.join(cwd, rel);
    if (fs.existsSync(target))
      fs.renameSync(target, path.join(outside, "original"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(outside, target, "junction");
    const before = snapshot(tmp);
    expect(() => retirePersonalFiles(cwd, { force: true })).toThrow(
      /linked path/,
    );
    expect(snapshot(tmp)).toEqual(before);
  });
  it("rejects dangling state links", () => {
    fs.mkdirSync(path.join(cwd, ".trellis"));
    fs.symlinkSync(
      path.join(tmp, "absent"),
      path.join(cwd, ".trellis/.developer"),
    );
    const before = snapshot();
    expect(() => assertLocalState(cwd)).toThrow(/linked path/);
    expect(snapshot()).toEqual(before);
  });
  it("keeps the old entry when a shared resource write fails", () => {
    ownedLegacy();
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("guide.md")) throw new Error("disk error");
      rename(from, to);
    });
    expect(() => retirePersonalFiles(cwd)).toThrow("disk error");
    expect(fs.readFileSync(path.join(cwd, oldSkill), "utf8")).toBe(
      bundle.get(sharedSkill),
    );
  });
});

describe("personal data migration", () => {
  it("preserves numbered logs, archived tasks and metadata, with identity backup", () => {
    write(
      ".trellis/.developer",
      "name=alice\ninitialized_at=2026-09-07T10:20:30\n",
    );
    write(".trellis/workspace/index.md", "old team index");
    write(".trellis/workspace/alice/index.md", "journal-7.md index");
    write(".trellis/workspace/alice/journal-7.md", "personal history");
    for (const rel of [
      ".trellis/tasks/09-07-work/task.json",
      ".trellis/tasks/archive/2026-08/task/task.json",
    ])
      write(
        rel,
        JSON.stringify({
          title: "keep",
          creator: "alice",
          assignee: "alice",
          meta: { custom: 1 },
        }),
      );
    write(
      ".trellis/config.yaml",
      "session_auto_commit: true\nsession_commit_message: custom\nregistry:\n  spec:\n    source: gh:test\n  personal: keep\ncodex:\n  mode: auto\n",
    );
    retirePersonalFiles(cwd);
    expect(
      fs.readFileSync(
        path.join(cwd, ".trellis/workspace/journal-7.md"),
        "utf8",
      ),
    ).toBe("personal history");
    expect(
      fs.readFileSync(path.join(cwd, ".trellis/workspace/index.md"), "utf8"),
    ).toBe("journal-7.md index");
    const after = snapshot();
    expect(after[".trellis/tasks/archive/2026-08/task/task.json"]).toContain(
      '"custom": 1',
    );
    expect(after[".trellis/tasks/09-07-work/task.json"]).not.toMatch(
      /creator|assignee/,
    );
    expect(
      after[".trellis/config.yaml"].split("\n").filter(Boolean).join("\n"),
    ).toBe("registry:\n  personal: keep\ncodex:\n  mode: auto");
    expect(
      Object.entries(after).some(
        ([rel, content]) =>
          rel.includes(".backup-personal-") &&
          rel.endsWith(".developer") &&
          content.includes("name=alice"),
      ),
    ).toBe(true);
    expect(
      Object.entries(after).some(
        ([rel, content]) =>
          rel.includes(".backup-personal-") && content === "old team index",
      ),
    ).toBe(true);
    retirePersonalFiles(cwd);
    expect(snapshot()).toEqual(after);
  });
  it.each([
    "second owner",
    "flat journal",
    "malformed identity",
    "malformed task",
    "linked task",
  ])("rejects %s before changing any data", (conflict) => {
    ownedLegacy();
    write(".trellis/.developer", "name=alice\n");
    write(".trellis/workspace/alice/journal-3.md", "history");
    if (conflict === "second owner")
      write(".trellis/workspace/bob/index.md", "other index");
    if (conflict === "flat journal")
      write(".trellis/workspace/journal-1.md", "flat history");
    if (conflict === "malformed identity")
      write(".trellis/.developer", "unrecognized custom data");
    if (conflict === "malformed task")
      write(".trellis/tasks/09-07-bad/task.json", "{broken");
    if (conflict === "linked task") {
      write(".trellis/tasks/09-07-good/task.json", "{}");
      fs.symlinkSync(
        path.join(tmp, "missing"),
        path.join(cwd, ".trellis/tasks/link"),
      );
    }
    const before = snapshot();
    expect(() => retirePersonalFiles(cwd, { force: true })).toThrow();
    expect(snapshot()).toEqual(before);
  });
  it("removes only standalone Linear sync hooks and obsolete refresh settings", () => {
    write(
      ".trellis/config.yaml",
      "hooks:\n  after_archive:\n    - python3 .trellis/scripts/hooks/linear_sync.py archive\n    - echo keep\nregistry:\n  spec:\n    source: gh:test\nmax_journal_lines: 1500\n",
    );
    retirePersonalFiles(cwd);
    const config = fs.readFileSync(
      path.join(cwd, ".trellis/config.yaml"),
      "utf8",
    );
    expect(config).not.toMatch(/linear_sync|registry|source:/);
    expect(config).toContain("    - echo keep");
    expect(config).toContain("max_journal_lines: 1500");
    write(
      ".trellis/config.yaml",
      "hooks:\n  after_archive:\n    - python3 .trellis/scripts/hooks/linear_sync.py archive && echo keep\n",
    );
    const before = snapshot();
    expect(() => retirePersonalFiles(cwd, { force: true })).toThrow(/compound/);
    expect(snapshot()).toEqual(before);
  });
  it("retires hash-owned old platform entries and leaves root ignore rules alone", () => {
    const entries = [
      ".github/prompts/trellis-parallel.prompt.md",
      ".claude/commands/trellis/onboard.md",
      ".pi/skills/trellis-onboard/SKILL.md",
      ".trellis/.gitignore",
      ".trellis/.gitattributes",
      ".trellis/scripts/hooks/linear_sync.py",
    ];
    for (const rel of entries) write(rel, `old template: ${rel}`);
    saveHashes(
      cwd,
      Object.fromEntries(
        entries.map((rel) => [rel, computeHash(`old template: ${rel}`)]),
      ),
    );
    write(".gitignore", "user ignore");
    write(".gitattributes", "user attributes");
    retirePersonalFiles(cwd);
    for (const rel of entries)
      expect(fs.existsSync(path.join(cwd, rel))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8")).toBe(
      "user ignore",
    );
    expect(fs.readFileSync(path.join(cwd, ".gitattributes"), "utf8")).toBe(
      "user attributes",
    );
  });
  it("dry-run never creates bundles or backups and preserves data", () => {
    ownedLegacy();
    write(".trellis/.developer", "name=alice\n");
    write(".trellis/workspace/alice/journal-5.md", "history");
    write(".trellis/tasks/09-07-work/task.json", '{"creator":"alice"}');
    const before = snapshot();
    retirePersonalFiles(cwd, { dryRun: true });
    expect(snapshot()).toEqual(before);
  });
});

describe("knowledge inheritance", () => {
  it("copies portable knowledge without tasks, hooks, absolute paths or duplicate model keys", () => {
    const source = path.join(tmp, "main");
    fs.mkdirSync(source);
    write(".trellis/spec/backend/index.md", "source spec", source);
    write(".trellis/tasks/09-07-work/task.json", "{}", source);
    write(
      ".trellis/config.yaml",
      "packages:\n  service:\n    path: /elsewhere/service\nmax_journal_lines: 1800\nhooks:\n  after_archive:\n    - git add .trellis\ncodex:\n  mode: auto\nchannel:\n  worker_guard:\n    idle_timeout: 9m\n    max_live_workers: 4\n  trusted_context_dirs:\n    - /private/source\n",
      source,
    );
    write(
      ".trellis/config.yaml",
      "packages:\n  local:\n    path: src\nmax_journal_lines: 1000\n",
    );
    const role = ".codex/agents/trellis-check.toml";
    write(
      role,
      'model = "preferred"\nmodel_reasoning_effort = "high"\n',
      source,
    );
    write(role, 'sandbox_mode = "read-only"\n');
    inheritProjectKnowledge(cwd, source, true);
    expect(
      fs.readFileSync(path.join(cwd, ".trellis/spec/backend/index.md"), "utf8"),
    ).toBe("source spec");
    const config = fs.readFileSync(
      path.join(cwd, ".trellis/config.yaml"),
      "utf8",
    );
    expect(config).toContain("max_journal_lines: 1800");
    expect(config).toContain("path: src");
    expect(config).not.toMatch(
      /hooks|git add|elsewhere|trusted_context_dirs|private\/source/,
    );
    expect(config).toContain("max_live_workers: 4");
    expect(config).toContain("idle_timeout: 9m");
    expect(fs.existsSync(path.join(cwd, ".trellis/tasks"))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, role), "utf8")).toContain(
      'model = "preferred"',
    );
    write(".trellis/spec/backend/index.md", "local changes");
    inheritProjectKnowledge(cwd, source, true);
    expect(
      fs.readFileSync(
        path.join(source, ".trellis/spec/backend/index.md"),
        "utf8",
      ),
    ).toBe("source spec");
    expect(
      fs.readFileSync(path.join(cwd, role), "utf8").match(/^model =/gm),
    ).toHaveLength(1);
  });
  it.each(["source link", "target directory"])(
    "preflights spec %s before copying files",
    (conflict) => {
      const source = path.join(tmp, "main");
      write(".trellis/spec/a.md", "safe", source);
      if (conflict === "source link")
        fs.symlinkSync(
          path.join(tmp, "missing"),
          path.join(source, ".trellis/spec/z.md"),
        );
      else {
        write(".trellis/spec/z.md", "source", source);
        fs.mkdirSync(path.join(cwd, ".trellis/spec/z.md"), { recursive: true });
      }
      const before = snapshot();
      expect(() => inheritProjectKnowledge(cwd, source, true)).toThrow();
      expect(snapshot()).toEqual(before);
    },
  );
  it("finds the main checkout and leaves Git index, HEAD and ignore unchanged", () => {
    execFileSync("git", ["init", cwd], { stdio: "ignore" });
    const git = (args: string[]): Buffer =>
      execFileSync("git", ["-C", cwd, ...args], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "test",
    ]);
    const worktree = path.join(tmp, "worktree space");
    git(["worktree", "add", "-b", "work", worktree]);
    write(".gitignore", "custom-ignore\n");
    write(".trellis/.developer", "name=alice\n");
    const before = git(["ls-files", "--stage"]).toString(),
      head = git(["rev-parse", "HEAD"]).toString();
    expect(mainCheckout(worktree)).toBe(fs.realpathSync(cwd));
    expect(mainCheckout(cwd)).toBeUndefined();
    retirePersonalFiles(cwd);
    expect(git(["ls-files", "--stage"]).toString()).toBe(before);
    expect(git(["rev-parse", "HEAD"]).toString()).toBe(head);
    expect(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8")).toBe(
      "custom-ignore\n",
    );
  });
});

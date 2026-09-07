import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scripts = path.resolve(__dirname, "../../src/templates/trellis/scripts");
let root: string;
let repo: string;
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}
function stamp(cwd: string): void {
  fs.cpSync(scripts, path.join(cwd, ".trellis/scripts"), { recursive: true });
}
function run(cwd: string, script: string, ...args: string[]) {
  return spawnSync("python3", [`.trellis/scripts/${script}.py`, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, TRELLIS_CONTEXT_ID: "same-session" },
  });
}
function ok(cwd: string, script: string, ...args: string[]): string {
  const result = run(cwd, script, ...args);
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return result.stdout.trim();
}
function journal(cwd = repo): string {
  return fs.readFileSync(
    path.join(cwd, ".trellis/workspace/journal-1.md"),
    "utf-8",
  );
}
function create(cwd = repo): string {
  return ok(
    cwd,
    "task",
    "create",
    "personal",
    "--description",
    "local work",
    "--no-start",
  );
}
function snapshot(cwd = repo) {
  return {
    head: git(cwd, "rev-parse", "HEAD"),
    index: git(cwd, "ls-files", "--stage"),
    ignore: fs.readFileSync(path.join(cwd, ".gitignore"), "utf-8"),
    exclude: fs.readFileSync(path.join(repo, ".git/info/exclude"), "utf-8"),
  };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-personal-runtime-"));
  repo = path.join(root, "main");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(repo, "business.txt"), "initial\n");
  git(repo, "add", ".gitignore", "business.txt");
  git(repo, "commit", "-q", "-m", "initial business change");
  stamp(repo);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("personal local runtime", () => {
  it("records and archives without identity, Git writes or ignore changes", () => {
    fs.writeFileSync(path.join(repo, "business.txt"), "staged business work\n");
    git(repo, "add", "business.txt");
    const before = snapshot();
    const task = create();
    const data = JSON.parse(
      fs.readFileSync(path.join(repo, task, "task.json"), "utf-8"),
    );
    expect(data).not.toHaveProperty("creator");
    expect(data).not.toHaveProperty("assignee");
    ok(repo, "task", "start", task);
    ok(
      repo,
      "add_session",
      "--title",
      "local session",
      "--commit",
      before.head,
    );
    expect(journal()).toContain("initial business change");
    expect(run(repo, "task", "archive", task).status).toBe(1);
    expect(run(repo, "task", "complete", task, "--reason", "  ").status).toBe(
      1,
    );
    ok(
      repo,
      "task",
      "complete",
      task,
      "--reason",
      "Tests passed; acceptance checked",
    );
    const archived = ok(
      repo,
      "task",
      "archive",
      task,
      "--skip-branch-validation",
    );
    expect(fs.existsSync(path.join(repo, archived, "task.json"))).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(path.join(repo, ".trellis/.developer"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".gitattributes"))).toBe(false);
    const context = JSON.parse(ok(repo, "get_context", "--json"));
    expect(context).not.toHaveProperty("developer");
    expect(context.journal.file).toBe(".trellis/workspace/journal-1.md");
  });

  it("resumes an interrupted index update and deduplicates completed retries", () => {
    ok(repo, "add_session", "--title", "seed");
    const index = path.join(repo, ".trellis/workspace/index.md");
    const original = fs.readFileSync(index, "utf-8");
    fs.writeFileSync(
      index,
      original.replace("@@@auto:session-history", "broken"),
    );
    expect(run(repo, "add_session", "--title", "retry").status).toBe(1);
    fs.writeFileSync(index, original);
    ok(repo, "add_session", "--title", "retry");
    ok(repo, "add_session", "--title", "retry");
    expect(journal().match(/## Session \d+: retry/g)).toHaveLength(1);
    expect(fs.readFileSync(index, "utf-8")).toContain("**Total Sessions**: 2");
    ok(
      repo,
      "add_session",
      "--title",
      "retry",
      "--idempotency-key",
      "separate",
    );
    expect(journal().match(/## Session \d+: retry/g)).toHaveLength(2);
  });

  it("validates commit evidence before creating workspace files", () => {
    for (const args of [
      ["--commit", "HEAD~1"],
      ["--commit", "deadbeef"],
      ["--idempotency-key", "bad key"],
      ["--commit", "deadbeef", "--commit-subject", "cafebabe=wrong"],
    ]) {
      expect(
        run(repo, "add_session", "--title", "invalid", ...args).status,
      ).toBe(1);
      expect(fs.existsSync(path.join(repo, ".trellis/workspace"))).toBe(false);
    }
    ok(
      repo,
      "add_session",
      "--title",
      "mapped",
      "--commit",
      "deadbeef",
      "--commit-subject",
      "deadbeef=pipe | subject",
    );
    expect(journal()).toContain("pipe \\| subject");
  });

  it("isolates same-named tasks, sessions and journal numbers across worktrees", () => {
    const other = path.join(root, "other");
    git(repo, "worktree", "add", "-q", "-b", "other", other);
    stamp(other);
    const firstTask = create(repo);
    const secondTask = create(other);
    expect(firstTask).toBe(secondTask);
    ok(repo, "task", "start", firstTask);
    ok(other, "task", "start", secondTask);
    ok(repo, "add_session", "--title", "main only");
    ok(other, "add_session", "--title", "other only");
    expect(journal()).toContain("## Session 1: main only");
    expect(journal(other)).toContain("## Session 1: other only");
    expect(journal(other)).not.toContain("main only");
    const pointer = ok(other, "task", "current", "--json");
    ok(repo, "task", "complete", firstTask, "--reason", "Local checks passed");
    ok(repo, "task", "archive", firstTask, "--skip-branch-validation");
    expect(ok(other, "task", "current", "--json")).toBe(pointer);
    expect(fs.existsSync(path.join(other, secondTask))).toBe(true);
  });

  it("refuses incomplete children, broken records and paths outside tasks", () => {
    const parent = create();
    const child = ok(
      repo,
      "task",
      "create",
      "child",
      "--description",
      "child work",
      "--parent",
      parent,
      "--no-start",
    );
    expect(
      run(repo, "task", "complete", parent, "--reason", "done").status,
    ).toBe(1);
    ok(repo, "task", "complete", child, "--reason", "Child acceptance passed");
    ok(
      repo,
      "task",
      "complete",
      parent,
      "--reason",
      "Parent acceptance passed",
    );
    fs.writeFileSync(path.join(repo, parent, "task.json"), "broken");
    expect(run(repo, "task", "archive", parent).status).toBe(1);
    expect(run(repo, "task", "archive", "../../business.txt").status).toBe(1);
    expect(
      run(repo, "task", "complete", "../..", "--reason", "done").status,
    ).toBe(1);
  });

  it("keeps journal rollover and non-Git recording available", () => {
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    stamp(plain);
    fs.writeFileSync(
      path.join(plain, ".trellis/config.yaml"),
      "max_journal_lines: 30\n",
    );
    ok(plain, "add_session", "--title", "first");
    ok(plain, "add_session", "--title", "second");
    expect(
      fs.readFileSync(
        path.join(plain, ".trellis/workspace/journal-2.md"),
        "utf-8",
      ),
    ).toContain("## Session 2: second");
  });
});

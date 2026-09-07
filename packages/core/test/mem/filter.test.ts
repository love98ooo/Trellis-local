import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sameProject } from "../../src/mem/filter.js";

let root: string | undefined;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("memory worktree boundaries", () => {
  it("isolates a real nested worktree while retaining package and global queries", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-mem-boundary-"));
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    };
    git("init");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    );
    const worktree = path.join(root, ".worktrees", "feature");
    git("worktree", "add", "--detach", worktree);
    const mainPackage = path.join(root, "packages", "app");
    const worktreePackage = path.join(worktree, "packages", "app");
    fs.mkdirSync(mainPackage, { recursive: true });
    fs.mkdirSync(worktreePackage, { recursive: true });
    expect(sameProject(mainPackage, root)).toBe(true);
    expect(sameProject(worktree, root)).toBe(false);
    expect(sameProject(worktreePackage, root)).toBe(false);
    expect(sameProject(worktreePackage, worktree)).toBe(true);
    expect(sameProject(worktree, worktree)).toBe(true);
    expect(sameProject(worktreePackage, undefined)).toBe(true);
    git("worktree", "remove", "--force", worktree);
    expect(sameProject(worktreePackage, root)).toBe(true);
  });

  it("also respects an embedded repository with a .git directory", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-mem-boundary-"));
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested);
    execFileSync("git", ["init"], { cwd: nested, stdio: "pipe" });
    expect(sameProject(nested, root)).toBe(false);
    expect(sameProject(path.join(nested, "src"), root)).toBe(false);
    expect(sameProject(path.join(nested, "src"), nested)).toBe(true);
  });
});

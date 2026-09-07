import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveChannelRef } from "@mindfoldhq/trellis-core/channel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChannel } from "../../src/commands/channel/create.js";
import { channelList } from "../../src/commands/channel/list.js";
import { channelPrune } from "../../src/commands/channel/rm.js";
import { channelSend } from "../../src/commands/channel/send.js";
import {
  currentProjectKey,
  eventsPath,
  projectKey,
  resolveExistingChannelRef,
} from "../../src/commands/channel/store/paths.js";

// 使用真实 worktree 的 .git 文件，覆盖主 checkout 与 worktree 的根目录识别。
describe("channel worktree isolation", () => {
  let tmp: string;
  let first: string;
  let second: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-channel-worktree-"));
    const main = path.join(tmp, "main");
    first = path.join(tmp, "tree_one");
    second = path.join(tmp, "tree-one");
    root = path.join(tmp, "channels");
    execFileSync("git", ["init", main], { stdio: "ignore" });
    const git = (args: string[]): void => {
      execFileSync("git", ["-C", main, ...args], { stdio: "ignore" });
    };
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
    git(["worktree", "add", "-b", "first", first]);
    git(["worktree", "add", "-b", "second", second]);
    vi.stubEnv("TRELLIS_CHANNEL_ROOT", root);
    vi.spyOn(process, "cwd").mockReturnValue(first);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("normalizes subdirectories and symlinks without merging worktrees", async () => {
    const subdir = path.join(first, "src");
    fs.mkdirSync(subdir);
    const alias = path.join(tmp, "alias");
    fs.symlinkSync(first, alias, "junction");
    expect(projectKey(first)).not.toBe(projectKey(second));
    expect(projectKey(subdir)).toBe(projectKey(first));
    expect(projectKey(alias)).toBe(projectKey(first));
    await createChannel("review", { by: "main" });
    vi.mocked(process.cwd).mockReturnValue(subdir);
    expect(resolveExistingChannelRef("review").project).toBe(projectKey(first));
    expect(resolveChannelRef({ channel: "review" }).project).toBe(
      projectKey(first),
    );
  });

  it("ignores inherited buckets and requires explicit global scope", async () => {
    await createChannel("review", { by: "main" });
    await createChannel("global-only", { by: "main", scope: "global" });
    vi.stubEnv("TRELLIS_CHANNEL_PROJECT", projectKey(first));
    vi.mocked(process.cwd).mockReturnValue(second);
    expect(currentProjectKey()).toBe(projectKey(second));
    await expect(
      channelSend("review", { as: "worker", text: "wrong tree" }),
    ).rejects.toThrow(/not found/);
    expect(() => resolveExistingChannelRef("review")).toThrow(/not found/);
    expect(resolveChannelRef({ channel: "review", cwd: first }).project).toBe(
      projectKey(first),
    );
    await expect(
      channelSend("global-only", { as: "worker", text: "implicit" }),
    ).rejects.toThrow(/not found/);
    await channelSend("global-only", {
      as: "worker",
      text: "explicit",
      scope: "global",
    });
    expect(currentProjectKey()).toBe(projectKey(second));
    await createChannel("review", { by: "main" });
    expect(
      fs.readFileSync(eventsPath("review", projectKey(first)), "utf8"),
    ).not.toContain("wrong tree");
  });

  it("lists and prunes only the current worktree without migrating other data", async () => {
    await createChannel("review", { by: "main" });
    await createChannel("shared", { by: "main", scope: "global" });
    vi.mocked(process.cwd).mockReturnValue(second);
    await createChannel("review", { by: "main" });
    const legacy = path.join(root, "legacy", "events.jsonl");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "old data\n");
    await channelList();
    await channelPrune({ all: true });
    expect(fs.existsSync(eventsPath("review", projectKey(second)))).toBe(true);
    await channelPrune({ all: true, yes: true });
    expect(fs.existsSync(eventsPath("review", projectKey(second)))).toBe(false);
    expect(fs.existsSync(eventsPath("review", projectKey(first)))).toBe(true);
    expect(fs.existsSync(eventsPath("shared", "_global"))).toBe(true);
    expect(fs.readFileSync(legacy, "utf8")).toBe("old data\n");
  });
});

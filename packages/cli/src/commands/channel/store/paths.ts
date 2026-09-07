import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  GLOBAL_PROJECT_KEY,
  type ChannelRef,
  type ChannelScope,
} from "./schema.js";

/** Top-level Trellis channels directory. */
export function channelRoot(): string {
  const env = process.env.TRELLIS_CHANNEL_ROOT;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), ".trellis", "channels");
}

/** 同一 worktree 的子目录和符号链接使用相同 bucket。 */
export function projectKey(cwd: string): string {
  const canonical = fs.realpathSync(path.resolve(cwd));
  let root = canonical;
  for (let dir = canonical; ; dir = path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, ".git")) ||
      fs.existsSync(path.join(dir, ".trellis"))
    ) {
      root = dir;
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  const label = path
    .basename(root)
    .replace(/[^A-Za-z0-9.-]/g, "-")
    .slice(0, 48);
  return `${label}-${createHash("sha256").update(root).digest("hex")}`;
}

/** 默认始终按当前 worktree 定位，忽略继承的 Worker bucket 环境变量。 */
export function currentProjectKey(): string {
  return projectKey(process.cwd());
}

export function projectDir(project: string = currentProjectKey()): string {
  return path.join(channelRoot(), project);
}

/** Marker file that distinguishes a project bucket from a legacy
 *  flat-layout channel. New project buckets touch this on first use. */
const BUCKET_MARKER = ".bucket";

/** Characters allowed in a channel or worker name used as a path segment. */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Whether a channel/worker name is usable as a filesystem segment.
 * Discovery scans use this to skip directories created before name
 * validation existed (spaces, CJK, ...) — they can never be valid
 * channels, and `assertSafeName` throwing mid-scan would kill the scan.
 */
export function isSafeName(name: string): boolean {
  return name !== "." && name !== ".." && SAFE_SEGMENT_RE.test(name);
}

/**
 * Reject names that would escape their bucket when joined into a path.
 * A channel/worker name becomes a filesystem segment; without this guard
 * a name like `../../x` lets `path.join` resolve outside the store and a
 * later `fs.rmSync(recursive)` deletes arbitrary directories.
 */
export function assertSafeName(name: string, kind = "channel"): void {
  if (!isSafeName(name)) {
    throw new Error(
      `Invalid ${kind} name: ${JSON.stringify(name)}. ` +
        `Names may only contain letters, digits, '.', '_' and '-'.`,
    );
  }
}

/**
 * Channel directory inside its project bucket. Defaults to the current
 * project (cwd-derived); pass an explicit project for cross-project
 * addressing.
 */
export function channelDir(
  name: string,
  project: string = currentProjectKey(),
): string {
  assertSafeName(name);
  return path.join(projectDir(project), name);
}

export function eventsPath(
  name: string,
  project: string = currentProjectKey(),
): string {
  return path.join(channelDir(name, project), "events.jsonl");
}

export function lockPath(
  name: string,
  project: string = currentProjectKey(),
): string {
  return path.join(channelDir(name, project), `${name}.lock`);
}

export function workerFile(
  name: string,
  worker: string,
  suffix: string,
  project: string = currentProjectKey(),
): string {
  assertSafeName(worker, "worker");
  return path.join(channelDir(name, project), `${worker}.${suffix}`);
}

export function workerLockPath(
  name: string,
  worker: string,
  project: string = currentProjectKey(),
): string {
  assertSafeName(worker, "worker");
  return path.join(channelDir(name, project), `${worker}.spawnlock`);
}

export function ensureBucketMarker(project: string): void {
  const dir = projectDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, BUCKET_MARKER);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, "");
  }
}

/** Enumerate all project buckets currently on disk (excluding legacy). */
export function listProjects(): string[] {
  const root = channelRoot();
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root)) {
    const dir = path.join(root, entry);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    // A directory is a project bucket if it has the marker OR is
    // _legacy / _default / _global (reserved bucket names).
    if (
      fs.existsSync(path.join(dir, BUCKET_MARKER)) ||
      entry === "_legacy" ||
      entry === "_default" ||
      entry === GLOBAL_PROJECT_KEY
    ) {
      out.push(entry);
    }
  }
  return out;
}

export interface ResolveChannelOptions {
  scope?: ChannelScope;
  cwd?: string;
}

export function resolveChannelProjectForCreate(
  name: string,
  opts: ResolveChannelOptions = {},
): ChannelRef {
  const scope = opts.scope ?? "project";
  const project =
    scope === "global"
      ? GLOBAL_PROJECT_KEY
      : opts.cwd
        ? projectKey(opts.cwd)
        : currentProjectKey();
  return {
    name,
    scope,
    project,
    dir: channelDir(name, project),
  };
}

export function resolveExistingChannelRef(
  name: string,
  opts: ResolveChannelOptions = {},
): ChannelRef {
  const ref = resolveChannelProjectForCreate(name, opts);
  if (!fs.existsSync(eventsPath(name, ref.project))) {
    throw new Error(
      `Channel '${name}' not found in ${ref.scope} scope (${ref.project})`,
    );
  }
  return ref;
}

export function selectExistingChannelProject(name: string): string {
  return resolveExistingChannelRef(name).project;
}

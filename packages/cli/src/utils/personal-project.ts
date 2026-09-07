import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileAtomic } from "./atomic-write.js";
import { computeHash, loadHashes, saveHashes } from "./template-hash.js";
import retired from "./personal-retired.js";
import { collectPiTemplates } from "../configurators/pi.js";
import {
  extractCodexAgentModelKeys,
  applyCodexAgentModelKeys,
} from "../configurators/codex.js";

/** 检查每一级路径，包括失效链接，避免经父目录写入其他 worktree。 */
function localPath(cwd: string, rel: string): string {
  const root = path.resolve(cwd);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path must stay inside this worktree: ${rel}`);
  }
  let current = root;
  for (const part of path
    .relative(root, target)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked path: ${rel}`);
    if (!stat.isDirectory() && (!stat.isFile() || current !== target)) {
      throw new Error(`Expected a local file or directory: ${rel}`);
    }
  }
  return target;
}

function localFiles(cwd: string, rel: string): string[] {
  const target = localPath(cwd, rel);
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [rel];
  return fs
    .readdirSync(target)
    .flatMap((name) => localFiles(cwd, `${rel}/${name}`));
}

/** 状态只属于当前 checkout。 */
export function assertLocalState(cwd: string): void {
  for (const rel of [
    ".trellis",
    ".trellis/tasks",
    ".trellis/workspace",
    ".trellis/.runtime",
    ".trellis/spec",
    ".trellis/.current-task",
    ".trellis/.developer",
    ".trellis/.template-hashes.json",
    ".trellis/config.yaml",
  ]) {
    const target = localPath(cwd, rel);
    if (fs.existsSync(target)) {
      const isDirectory = [
        ".trellis",
        ".trellis/tasks",
        ".trellis/workspace",
        ".trellis/.runtime",
        ".trellis/spec",
      ].includes(rel);
      if (fs.statSync(target).isDirectory() !== isDirectory)
        throw new Error(`Invalid state path type: ${rel}`);
    }
  }
}

/** Git 确定主 checkout，不猜测其他工作中的 worktree。 */
export function mainCheckout(cwd: string): string | undefined {
  try {
    const listing = execFileSync(
      "git",
      ["worktree", "list", "--porcelain", "-z"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const first = listing.split("\0\0")[0];
    if (!first?.startsWith("worktree ") || first.split("\0").includes("bare"))
      return;
    const root = fs.realpathSync(first.split("\0")[0].slice(9));
    if (root !== fs.realpathSync(cwd)) return root;
  } catch {
    /* 非 Git 项目没有共享来源。 */
  }
}

/** 支持项目已有的缩进式配置；不把任意 shell hooks 和路径权限复制过去。 */
function configBlocks(content: string): [string, string][] {
  return [
    ...content.matchAll(
      /^([a-z_]+):[^\n]*(?:\n(?:[ \t]+[^\n]*|[ \t]*(?=\n|$)))*/gm,
    ),
  ].map(([block, key]) => [key, block]);
}

/** 先检查完整规范树和目标路径，再复制知识快照。 */
export function inheritProjectKnowledge(
  cwd: string,
  source: string,
  copySpec: boolean,
): void {
  assertLocalState(cwd);
  assertLocalState(source);
  if (fs.realpathSync(cwd) === fs.realpathSync(source)) return;
  const writes = new Map<string, string | Buffer>();
  if (copySpec) {
    for (const rel of localFiles(source, ".trellis/spec")) {
      const target = localPath(cwd, rel);
      if (fs.existsSync(target) && !fs.statSync(target).isFile())
        throw new Error(`Spec inheritance conflict: ${rel} is not a file.`);
      if (!fs.existsSync(target))
        writes.set(rel, fs.readFileSync(path.join(source, rel)));
    }
  }
  const sourceConfig = localPath(source, ".trellis/config.yaml");
  const targetConfig = localPath(cwd, ".trellis/config.yaml");
  if (fs.existsSync(sourceConfig) && fs.existsSync(targetConfig)) {
    const allowed = new Set([
      "packages",
      "default_package",
      "max_journal_lines",
      "codex",
      "context_injection",
      "prompt_injection",
    ]);
    const original = fs.readFileSync(targetConfig, "utf8");
    let target = original;
    for (const [key, block] of configBlocks(
      fs.readFileSync(sourceConfig, "utf8"),
    )) {
      if (key === "channel") {
        const guardPattern =
          /^ {2}worker_guard:[^\n]*(?:\n(?: {4}[^\n]*|[ \t]*(?=\n|$)))*/m;
        const guard = block.match(guardPattern)?.[0];
        const limits = guard?.match(
          /^ {4}(?:idle_timeout|max_live_workers):[ \t]*\d+(?:ms|s|m|h)?[ \t]*(?:#.*)?$/gm,
        );
        if (!limits?.length) continue;
        const personalGuard = `  worker_guard:\n${limits.join("\n")}`;
        const existing = configBlocks(target).find(
          ([name]) => name === "channel",
        )?.[1];
        if (
          existing !== undefined &&
          !/^channel:[ \t]*(?:#.*)?\n/.test(existing)
        )
          continue;
        const updated =
          existing === undefined
            ? `channel:\n${personalGuard}`
            : guardPattern.test(existing)
              ? existing.replace(guardPattern, () => personalGuard)
              : existing.replace(
                  /^channel:[^\n]*/,
                  (line) => `${line}\n${personalGuard}`,
                );
        target =
          existing === undefined
            ? `${target.trimEnd()}\n\n${updated}\n`
            : target.replace(existing, () => updated);
        continue;
      }
      if (!allowed.has(key)) continue;
      // 复杂 YAML 引用和绝对包路径不能作为可移植的偏好继承。
      if (/[&*!{}]/.test(block)) continue;
      if (
        key === "packages" &&
        [...block.matchAll(/^\s+path:\s*([^\n]+)/gm)].some(([, value]) => {
          const entry = value
            .replace(/\s+#.*$/, "")
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2");
          return (
            path.isAbsolute(entry) ||
            /^[A-Za-z]:[\\/]/.test(entry) ||
            entry.split(/[\\/]/).includes("..")
          );
        })
      )
        continue;
      const existing = configBlocks(target).find(([name]) => name === key)?.[1];
      target =
        existing !== undefined
          ? target.replace(existing, () => block)
          : `${target.trimEnd()}\n\n${block}\n`;
    }
    if (target !== original) writes.set(".trellis/config.yaml", target);
  }
  for (const role of ["implement", "research", "check"]) {
    const rel = `.codex/agents/trellis-${role}.toml`;
    const from = localPath(source, rel),
      to = localPath(cwd, rel);
    if (fs.existsSync(from) && fs.existsSync(to)) {
      const original = fs.readFileSync(to, "utf8");
      const inherited = extractCodexAgentModelKeys(
        fs.readFileSync(from, "utf8"),
      );
      const local = extractCodexAgentModelKeys(original);
      if (local.model) delete inherited.model;
      if (local.model_reasoning_effort) delete inherited.model_reasoning_effort;
      const updated = applyCodexAgentModelKeys(original, inherited);
      if (updated !== original) writes.set(rel, updated);
    }
  }
  for (const [rel, content] of writes) {
    const target = localPath(cwd, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, content);
  }
}

/** 去掉旧自动提交和 registry.spec 刷新配置，保留其余配置及注释。 */
function personalConfig(content: string): string {
  let result = content
    .replace(
      /^#-+\r?\n# Session Auto-Commit\r?\n#-+\r?\n[\s\S]*?(?=^#-+\r?\n# |$(?![\s\S]))/gm,
      (section) =>
        section
          .split(/\r?\n/)
          .every((line) =>
            /^\s*(?:#.*|session_(?:auto_commit|commit_message):.*)?$/.test(
              line,
            ),
          )
          ? ""
          : section,
    )
    .replace(
      /^# Commit message used when auto-committing journal\/index changes\r?\n# after running add_session\.py\r?\n/gm,
      "",
    );
  for (const [key, block] of configBlocks(result)) {
    if (key === "session_auto_commit" || key === "session_commit_message") {
      result = result.replace(block, "");
    }
    if (key === "hooks") {
      const updated = block
        .split("\n")
        .filter((line) => {
          if (
            !/^\s+-\s*['"]?(?:python3?\s+)?(?:\.\/)?\.trellis\/scripts\/hooks\/linear_sync\.py(?:\s|$)/.test(
              line,
            )
          )
            return true;
          if (
            !/^\s+-\s*['"]?(?:python3?\s+)?(?:\.\/)?\.trellis\/scripts\/hooks\/linear_sync\.py(?:\s+(?:create|start|archive|sync))?['"]?\s*(?:#.*)?$/.test(
              line,
            )
          ) {
            throw new Error(
              "Review compound linear_sync lifecycle hook before personal migration.",
            );
          }
          return false;
        })
        .join("\n");
      result = result.replace(block, () => updated);
    }
    if (key === "registry") {
      if (!/^registry:\s*(?:#.*)?\n/.test(block)) {
        throw new Error(
          "Review inline registry configuration before personal migration.",
        );
      }
      const updated = block.replace(
        /^([ \t]+)spec:[^\n]*(?:\n(?:\1[ \t]+[^\n]*|[ \t]*(?=\n|$)))*/m,
        "",
      );
      const replacement = /^registry:\s*(?:#.*)?\s*$/.test(updated)
        ? ""
        : updated;
      result = result.replace(block, () => replacement);
    }
  }
  return result;
}

function planPersonalData(
  cwd: string,
  writes: Map<string, string>,
  moves: Map<string, string>,
  removals: Set<string>,
): void {
  const developer = localPath(cwd, ".trellis/.developer");
  if (fs.existsSync(developer)) {
    const lines = fs.readFileSync(developer, "utf8").trim().split(/\r?\n/);
    if (
      !/^name=[A-Za-z0-9][A-Za-z0-9._-]*$/.test(lines[0] ?? "") ||
      lines.length > 2 ||
      (lines.length === 2 &&
        !/^initialized_at=\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?$/.test(
          lines[1],
        ))
    ) {
      throw new Error(
        "Unrecognized .trellis/.developer format; preserve it for manual review.",
      );
    }
    removals.add(".trellis/.developer");
  }

  const workspace = localPath(cwd, ".trellis/workspace");
  if (fs.existsSync(workspace)) {
    const files = localFiles(cwd, ".trellis/workspace");
    const journals = files.filter((rel) => /\/journal-\d+\.md$/.test(rel));
    const legacy = new Set(
      files
        .filter(
          (rel) =>
            rel.split("/").length === 4 &&
            /\/(?:index|journal-\d+)\.md$/.test(rel),
        )
        .map((rel) => rel.split("/")[2]),
    );
    if (
      legacy.size > 1 ||
      (legacy.size > 0 && journals.some((rel) => rel.split("/").length === 3))
    ) {
      throw new Error(
        "Workspace migration conflict: multiple personal log directories or existing flat journals. No files were migrated.",
      );
    }
    for (const owner of legacy) {
      const prefix = `.trellis/workspace/${owner}/`;
      for (const rel of localFiles(cwd, prefix.slice(0, -1))) {
        const name = rel.slice(prefix.length);
        if (name !== "index.md" && !/^journal-\d+\.md$/.test(name)) continue;
        const target = `.trellis/workspace/${name}`;
        const destination = localPath(cwd, target);
        if (fs.existsSync(destination) && !fs.statSync(destination).isFile())
          throw new Error(
            `Workspace migration conflict: ${target} is not a file.`,
          );
        moves.set(rel, target);
      }
    }
  }
  for (const rel of localFiles(cwd, ".trellis/tasks").filter((entry) =>
    entry.endsWith("/task.json"),
  )) {
    const original = fs.readFileSync(path.join(cwd, rel), "utf8");
    const task: unknown = JSON.parse(original);
    if (task === null || typeof task !== "object" || Array.isArray(task))
      throw new Error(`Invalid task record: ${rel}`);
    const record = task as Record<string, unknown>;
    if (!("creator" in record) && !("assignee" in record)) continue;
    delete record.creator;
    delete record.assignee;
    writes.set(rel, JSON.stringify(record, null, 2) + "\n");
  }
  const config = localPath(cwd, ".trellis/config.yaml");
  if (fs.existsSync(config)) {
    const original = fs.readFileSync(config, "utf8"),
      updated = personalConfig(original);
    if (original !== updated) writes.set(".trellis/config.yaml", updated);
  }
}

/** 先检查归属和全部冲突；备份位于 Skills 扫描目录之外。 */
export function retirePersonalFiles(
  cwd: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): void {
  assertLocalState(cwd);
  const hashes = loadHashes(cwd);
  const candidates = new Map<string, readonly string[]>(
    Object.entries(retired),
  );
  const desired = collectPiTemplates();
  for (const rel of desired.keys()) {
    if (rel.startsWith(".agents/skills/") && rel.endsWith("/SKILL.md")) {
      candidates.set(rel.replace(".agents/skills/", ".pi/skills/"), []);
    }
  }
  const removals = new Set<string>();
  const writes = new Map<string, string>();
  const moves = new Map<string, string>();
  planPersonalData(cwd, writes, moves, removals);
  for (const [rel, historical] of candidates) {
    const file = localPath(cwd, rel);
    if (!fs.existsSync(file)) continue;
    const hash = computeHash(fs.readFileSync(file, "utf8"));
    const canonical = rel.replace(".pi/skills/", ".agents/skills/");
    const shared = desired.get(canonical);
    const known =
      historical.includes(hash) ||
      hash === hashes[rel] ||
      (shared !== undefined && hash === computeHash(shared));
    if (!known && !Object.hasOwn(hashes, rel)) {
      console.log(`Preserved unowned file: ${rel}`);
      continue;
    }
    if (!known && !options.force) {
      throw new Error(
        `Modified legacy Trellis file: ${rel}. Review it before using --force; the original will be backed up outside skill discovery.`,
      );
    }
    if (rel.startsWith(".pi/skills/") && shared !== undefined) {
      const prefix = canonical.slice(0, -"SKILL.md".length);
      for (const [entry, content] of desired) {
        if (!entry.startsWith(prefix)) continue;
        const target = localPath(cwd, entry);
        if (!fs.existsSync(target)) {
          writes.set(entry, content);
          continue;
        }
        const actual = computeHash(fs.readFileSync(target, "utf8"));
        if (
          actual !== computeHash(content) &&
          actual !== hashes[entry] &&
          !options.force
        ) {
          throw new Error(
            `Modified shared skill file: ${entry}. Review before retiring ${rel}.`,
          );
        }
      }
    }
    removals.add(rel);
  }
  if (removals.size + writes.size + moves.size === 0) return;
  if (options.dryRun) {
    for (const rel of [...removals, ...writes.keys(), ...moves.keys()])
      console.log(`Personal migration: ${rel}`);
    return;
  }
  fs.mkdirSync(path.join(cwd, ".trellis"), { recursive: true });
  const backup = fs.mkdtempSync(path.join(cwd, ".trellis/.backup-personal-"));
  for (const rel of new Set([
    ...removals,
    ...writes.keys(),
    ...moves.keys(),
    ...moves.values(),
  ])) {
    const file = localPath(cwd, rel);
    if (!fs.existsSync(file)) continue;
    const target = path.join(backup, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  }
  console.log(`Personal migration backup: ${path.relative(cwd, backup)}`);
  for (const [rel, content] of writes) {
    const target = localPath(cwd, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, content);
    if (desired.has(rel)) hashes[rel] = computeHash(content);
  }
  // 所有共享 bundle 文件落盘后，才移除旧发现入口。
  for (const rel of removals) {
    localPath(cwd, rel);
    fs.unlinkSync(path.join(cwd, rel));
  }
  for (const [from, to] of moves) {
    fs.renameSync(localPath(cwd, from), localPath(cwd, to));
  }
  for (const directory of new Set(
    [...moves.keys()].map((rel) => path.dirname(rel)),
  )) {
    const target = localPath(cwd, directory);
    if (fs.readdirSync(target).length === 0) fs.rmdirSync(target);
  }
  const removed = new Set([...removals, ...moves.keys()]);
  saveHashes(
    cwd,
    Object.fromEntries(
      Object.entries(hashes).filter(([rel]) => !removed.has(rel)),
    ),
  );
}

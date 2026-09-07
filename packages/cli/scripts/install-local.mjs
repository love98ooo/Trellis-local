#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const receiptName = ".trellis-local-install.json";

function assertManagedCommand(command, store) {
  let stat;
  try {
    stat = fs.lstatSync(command);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    const target = path.resolve(
      path.dirname(command),
      fs.readlinkSync(command),
    );
    const relative = path.relative(store, target);
    const release = relative.split(path.sep)[0];
    if (
      release &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      fs.existsSync(path.join(store, release, receiptName))
    )
      return;
  }
  throw new Error(`保留已有命令，请先检查归属：${command}`);
}

/** 只替换此安装器管理的命令；失败时旧版本仍可使用。 */
export function activateInstall(store, release, binDir) {
  const command = path.join(binDir, "trellis-local");
  const cli = path.join(
    release,
    "node_modules/@mindfoldhq/trellis/bin/trellis.js",
  );
  if (!fs.existsSync(path.join(release, receiptName)) || !fs.existsSync(cli)) {
    throw new Error(`构建不完整：${release}`);
  }
  fs.mkdirSync(binDir, { recursive: true });
  assertManagedCommand(command, store);
  const temporary = path.join(binDir, `.trellis-local-${randomUUID()}`);
  try {
    fs.symlinkSync(cli, temporary);
    fs.renameSync(temporary, command);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { command, cli };
}

export function installLocal(home = os.homedir()) {
  const store = path.join(home, ".local/share/trellis-fork");
  const binDir = path.join(home, ".local/bin");
  assertManagedCommand(path.join(binDir, "trellis-local"), store);
  const run = (command, args, cwd = repository) =>
    execFileSync(command, args, { cwd, stdio: "inherit" });
  run("pnpm", ["build"]);
  fs.mkdirSync(store, { recursive: true });
  const staging = fs.mkdtempSync(path.join(store, ".install-"));
  let release;
  try {
    const artifacts = path.join(staging, "artifacts");
    fs.mkdirSync(artifacts);
    const core = path.join(artifacts, "core.tgz");
    const cli = path.join(artifacts, "cli.tgz");
    for (const [name, output] of [
      ["@mindfoldhq/trellis-core", core],
      ["@mindfoldhq/trellis", cli],
    ]) {
      run("pnpm", ["--filter", name, "pack", "--out", output]);
    }
    const digest = createHash("sha256")
      .update(fs.readFileSync(core))
      .update(fs.readFileSync(cli))
      .digest("hex");
    const version = JSON.parse(
      fs.readFileSync(
        path.join(repository, "packages/cli/package.json"),
        "utf8",
      ),
    ).version;
    release = path.join(store, `${version}-${digest.slice(0, 12)}`);
    if (!fs.existsSync(release)) {
      run(
        "npm",
        [
          "install",
          "--prefix",
          staging,
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "./artifacts/core.tgz",
          "./artifacts/cli.tgz",
        ],
        staging,
      );
      const entry = path.join(
        staging,
        "node_modules/@mindfoldhq/trellis/bin/trellis.js",
      );
      const coreEntry = createRequire(entry).resolve(
        "@mindfoldhq/trellis-core/task",
      );
      const expectedCore =
        path.join(staging, "node_modules/@mindfoldhq/trellis-core") + path.sep;
      if (!coreEntry.startsWith(expectedCore))
        throw new Error("CLI 未解析到本次打包的 core，安装已取消。");
      run(process.execPath, [entry, "--version"], staging);
      fs.writeFileSync(
        path.join(staging, receiptName),
        JSON.stringify({ version, sha256: digest }, null, 2) + "\n",
      );
      fs.renameSync(staging, release);
    } else if (
      JSON.parse(fs.readFileSync(path.join(release, receiptName), "utf8"))
        .sha256 !== digest
    ) {
      throw new Error(`已有目录与构建不匹配，未覆盖：${release}`);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const { command, cli } = activateInstall(store, release, binDir);
  console.log(
    `\n已安装：${command}\n固定构建：${cli}\n\n新项目：trellis-local init --yes --codex --claude --cursor --pi\n存量项目：trellis-local update`,
  );
  if (!(process.env.PATH ?? "").split(path.delimiter).includes(binDir)) {
    console.log(`请将 ${binDir} 加入 PATH，或直接使用上面的绝对路径。`);
  }
  return { command, cli };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    installLocal();
  } catch (error) {
    console.error(`安装失败：${error.message}`);
    process.exitCode = 1;
  }
}

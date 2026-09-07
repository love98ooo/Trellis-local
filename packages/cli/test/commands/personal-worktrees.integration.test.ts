import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { init } from "../../src/commands/init.js";
import { update } from "../../src/commands/update.js";
import { loadHashes } from "../../src/utils/template-hash.js";
import { VERSION } from "../../src/constants/version.js";

vi.mock("figlet", () => ({ default: { textSync: () => "Trellis" } }));
const temp: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const p of temp.splice(0))
    fs.rmSync(p, { recursive: true, force: true });
});

it("initializes and updates independent worktrees without touching the Git index or repository policies", async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "trellis-personal-e2e-")),
  );
  temp.push(root);
  const main = path.join(root, "main"),
    a = path.join(root, "work-a"),
    b = path.join(root, "work_a");
  fs.mkdirSync(main);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.name", "Test");
  git(main, "config", "user.email", "test@example.com");
  const excludes = path.join(root, "global-ignore");
  fs.writeFileSync(excludes, ".trellis/\n");
  git(main, "config", "core.excludesFile", excludes);
  fs.writeFileSync(path.join(main, "app.txt"), "base\n");
  fs.writeFileSync(path.join(main, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(main, ".gitattributes"), "*.txt text\n");
  git(main, "add", "app.txt", ".gitignore", ".gitattributes");
  git(main, "commit", "-qm", "base");
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(main);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ version: VERSION }),
      }),
  );
  await init({ yes: true, claude: true, codex: true, cursor: true, pi: true });
  fs.writeFileSync(
    path.join(main, ".trellis/spec/index.md"),
    "# Project conventions\n",
  );
  fs.appendFileSync(
    path.join(main, ".trellis/config.yaml"),
    "\ncodex:\n  dispatch_mode: inline\n",
  );
  git(main, "worktree", "add", "-qb", "feature-a", a);
  git(main, "worktree", "add", "-qb", "feature-b", b);
  for (const tree of [a, b]) {
    cwd.mockReturnValue(tree);
    fs.writeFileSync(path.join(tree, "app.txt"), "staged user work\n");
    git(tree, "add", "app.txt");
    const before = [
      git(tree, "rev-parse", "HEAD"),
      git(tree, "ls-files", "--stage", "-z"),
    ];
    const flags = {
      yes: true,
      claude: true,
      codex: true,
      cursor: true,
      pi: true,
    };
    await init(flags);
    const initialHashes = loadHashes(tree);
    fs.appendFileSync(
      path.join(tree, ".trellis/workspace/index.md"),
      "\nPersonal journal index\n",
    );
    await init({ ...flags, force: true });
    expect(loadHashes(tree)).toEqual(initialHashes);
    expect(
      fs.readFileSync(path.join(tree, ".trellis/workspace/index.md"), "utf8"),
    ).toContain("Personal journal index");
    expect(
      Object.keys(initialHashes).some((p) => p.includes("__pycache__")),
    ).toBe(false);
    expect(fs.readdirSync(path.join(tree, ".trellis/tasks"))).toEqual([]);
    expect(fs.existsSync(path.join(tree, ".trellis/.developer"))).toBe(false);
    expect(
      fs.readFileSync(path.join(tree, ".trellis/spec/index.md"), "utf8"),
    ).toContain("Project conventions");
    expect(
      fs.readFileSync(path.join(tree, ".trellis/config.yaml"), "utf8"),
    ).toContain("dispatch_mode: inline");
    expect(
      fs.existsSync(
        path.join(tree, ".agents/skills/trellis-before-dev/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tree, ".pi/skills/trellis-before-dev/SKILL.md")),
    ).toBe(false);
    await update({ force: true });
    await update({ force: true });
    expect(
      fs.readFileSync(path.join(tree, ".trellis/config.yaml"), "utf8"),
    ).toContain("dispatch_mode: inline");
    expect(fs.readdirSync(path.join(tree, ".trellis/tasks"))).toEqual([]);
    expect([
      git(tree, "rev-parse", "HEAD"),
      git(tree, "ls-files", "--stage", "-z"),
    ]).toEqual(before);
    expect(fs.readFileSync(path.join(tree, ".gitignore"), "utf8")).toBe(
      "node_modules/\n",
    );
    expect(fs.readFileSync(path.join(tree, ".gitattributes"), "utf8")).toBe(
      "*.txt text\n",
    );
    expect(
      fs.existsSync(path.join(tree, ".trellis/scripts/init_developer.py")),
    ).toBe(false);
  }
  fs.writeFileSync(
    path.join(a, ".trellis/spec/index.md"),
    "# Changed only A\n",
  );
  expect(fs.readFileSync(path.join(b, ".trellis/spec/index.md"), "utf8")).toBe(
    "# Project conventions\n",
  );
  expect(
    fs.readFileSync(path.join(main, ".trellis/spec/index.md"), "utf8"),
  ).toBe("# Project conventions\n");
  expect(fs.readFileSync(excludes, "utf8")).toBe(".trellis/\n");
}, 60000);

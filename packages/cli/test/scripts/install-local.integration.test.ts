import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";

const installer = (await import(
  pathToFileURL(
    path.resolve(import.meta.dirname, "../../scripts/install-local.mjs"),
  ).href
)) as {
  activateInstall(
    store: string,
    release: string,
    binDir: string,
  ): { command: string; cli: string };
};
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

it("switches only managed commands and leaves fixed builds intact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-local-install-"));
  directories.push(root);
  const store = path.join(root, "store"),
    bin = path.join(root, "bin");
  const release = (name: string) => {
    const dir = path.join(store, name);
    fs.mkdirSync(path.join(dir, "node_modules/@mindfoldhq/trellis/bin"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, "node_modules/@mindfoldhq/trellis/bin/trellis.js"),
      name,
    );
    fs.writeFileSync(path.join(dir, ".trellis-local-install.json"), "{}");
    return dir;
  };
  const first = release("first"),
    second = release("second");
  const original = installer.activateInstall(store, first, bin);
  const replacement = installer.activateInstall(store, second, bin);
  expect(fs.realpathSync(replacement.command)).toBe(
    fs.realpathSync(replacement.cli),
  );
  expect(fs.readFileSync(original.cli, "utf8")).toBe("first");
  expect(() =>
    installer.activateInstall(store, path.join(store, "missing"), bin),
  ).toThrow("构建不完整");
  expect(fs.realpathSync(replacement.command)).toBe(
    fs.realpathSync(replacement.cli),
  );
  fs.unlinkSync(replacement.command);
  fs.writeFileSync(replacement.command, "user command");
  expect(() => installer.activateInstall(store, first, bin)).toThrow(
    "保留已有命令",
  );
  expect(fs.readFileSync(replacement.command, "utf8")).toBe("user command");
  fs.unlinkSync(replacement.command);
  fs.symlinkSync(path.join(root, "other-command"), replacement.command);
  expect(() => installer.activateInstall(store, first, bin)).toThrow(
    "保留已有命令",
  );
});

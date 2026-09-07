import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("reports task facts without forcing artifacts or another approval", () => {
  const templates = path.resolve(__dirname, "../../src/templates");
  const output = execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util
import json
import pathlib
import tempfile
import types
root = pathlib.Path(${JSON.stringify(templates)})
for name in ('shared-hooks', 'codex/hooks', 'copilot/hooks'):
    spec = importlib.util.spec_from_file_location('hook', root / name / 'session-start.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with tempfile.TemporaryDirectory() as tmp:
        trellis = pathlib.Path(tmp) / '.trellis'
        task = trellis / 'tasks' / 'work'
        task.mkdir(parents=True)
        module._resolve_active_task = lambda *args: types.SimpleNamespace(task_path='.trellis/tasks/work', stale=False)
        for value in ({'title': 'Work', 'status': 'in_progress'}, {'status': 'planning'}, []):
            (task / 'task.json').write_text(json.dumps(value))
            status = module._get_task_status(trellis, {})
            assert 'workflow.md' in status, status
            assert 'must add' not in status and 'consent' not in status and 'user confirms' not in status, status
        (task / 'task.json').write_text('{')
        assert 'UNKNOWN' in module._get_task_status(trellis, {})
        module._resolve_active_task = lambda *args: types.SimpleNamespace(task_path=None, stale=False)
        assert 'NO ACTIVE TASK' in module._get_task_status(trellis, {})
print('ok')
`,
    ],
    { encoding: "utf8" },
  );
  expect(output.trim()).toBe("ok");
});

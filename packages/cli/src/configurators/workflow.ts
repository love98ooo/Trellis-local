import path from "node:path";
import fs from "node:fs";

import { DIR_NAMES, PATHS } from "../constants/paths.js";
import { copyTrellisDir } from "../templates/extract.js";

// Import trellis templates (generic, not project-specific)
import {
  workflowMdTemplate,
  configYamlTemplate,
  getAllAgents,
} from "../templates/trellis/index.js";

// Import markdown templates
import { agentProgressIndexContent } from "../templates/markdown/index.js";

import { writeFile, ensureDir } from "../utils/file-writer.js";
import { replacePythonCommandLiterals } from "./shared.js";
export async function createWorkflowStructure(cwd: string): Promise<void> {
  const workflowMd = workflowMdTemplate;

  // Create base .trellis directory
  ensureDir(path.join(cwd, DIR_NAMES.WORKFLOW));

  // Copy scripts/ directory from templates
  await copyTrellisDir("scripts", path.join(cwd, PATHS.SCRIPTS), {
    executable: true,
  });

  // Copy the canonical personal workflow.
  await writeFile(
    path.join(cwd, PATHS.WORKFLOW_GUIDE_FILE),
    replacePythonCommandLiterals(workflowMd),
  );

  // Personal preferences and journals survive repeated init, including --force.
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  if (!fs.existsSync(configPath))
    await writeFile(configPath, configYamlTemplate);

  // Platform-neutral definitions for personal channel workers.
  ensureDir(path.join(cwd, PATHS.AGENTS));
  for (const [agentFile, content] of getAllAgents()) {
    await writeFile(path.join(cwd, PATHS.AGENTS, agentFile), content);
  }

  // Create workspace/ with index.md
  ensureDir(path.join(cwd, PATHS.WORKSPACE));
  const indexPath = path.join(cwd, PATHS.WORKSPACE, "index.md");
  if (!fs.existsSync(indexPath)) {
    await writeFile(
      indexPath,
      replacePythonCommandLiterals(agentProgressIndexContent),
    );
  }

  // Create tasks/ directory
  ensureDir(path.join(cwd, PATHS.TASKS));

  ensureDir(path.join(cwd, PATHS.SPEC));
}

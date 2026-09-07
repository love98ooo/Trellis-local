# Trellis-local

A lightweight personal, multi-worktree fork of [Trellis](https://github.com/mindfold-ai/Trellis). Use `trellis-local`; internal npm package identifiers are retained to keep upstream merges small. This fork does not publish the upstream npm packages.

<p align="center">
<picture>
<source srcset="assets/trellis.png" media="(prefers-color-scheme: dark)">
<source srcset="assets/trellis.png" media="(prefers-color-scheme: light)">
<img src="assets/trellis.png" alt="Trellis Logo" width="500" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">
</picture>
</p>

<p align="center">
<strong>An out-of-the-box engineering framework for AI coding.</strong><br/>
<sub>AI writes code fast, but every session it starts from scratch — no memory of your project, your conventions, or your requirements. Trellis keeps specs, tasks, and memory locally per worktree, so any coding agent works to your engineering standards.</sub>
</p>

<p align="center">
<a href="./README_CN.md">简体中文</a> •
<a href="https://docs.trytrellis.app/">Docs</a> •
<a href="https://docs.trytrellis.app/start/install-and-first-task">Quick Start</a> •
<a href="https://docs.trytrellis.app/advanced/multi-platform">Supported Platforms</a> •
<a href="https://docs.trytrellis.app/start/real-world-scenarios">Use Cases</a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@mindfoldhq/trellis"><img src="https://img.shields.io/npm/v/@mindfoldhq/trellis.svg?style=flat-square&color=2563eb" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@mindfoldhq/trellis"><img src="https://img.shields.io/npm/dw/@mindfoldhq/trellis?style=flat-square&color=cb3837&label=downloads" alt="npm downloads" /></a>
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
<a href="https://github.com/mindfold-ai/Trellis/stargazers"><img src="https://img.shields.io/github/stars/mindfold-ai/Trellis?style=flat-square&color=eab308" alt="stars" /></a>
<a href="https://docs.trytrellis.app/"><img src="https://img.shields.io/badge/docs-trytrellis.app-0f766e?style=flat-square" alt="docs" /></a>
<a href="https://discord.com/invite/tWcCZ3aRHc"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
<a href="https://github.com/love98ooo/Trellis-local/issues"><img src="https://img.shields.io/github/issues/mindfold-ai/Trellis?style=flat-square&color=e67e22" alt="open issues" /></a>
<a href="https://github.com/love98ooo/Trellis-local/pulls"><img src="https://img.shields.io/github/issues-pr/mindfold-ai/Trellis?style=flat-square&color=9b59b6" alt="open PRs" /></a>
<a href="https://deepwiki.com/mindfold-ai/Trellis"><img src="https://img.shields.io/badge/Ask-DeepWiki-blue?style=flat-square" alt="Ask DeepWiki" /></a>
<a href="https://chatgpt.com/?q=Explain+the+project+mindfold-ai/Trellis+on+GitHub"><img src="https://img.shields.io/badge/Ask-ChatGPT-74aa9c?style=flat-square&logo=openai&logoColor=white" alt="Ask ChatGPT" /></a>
</p>

<p align="center">
<img src="assets/trellis-demo.gif" alt="Trellis workflow demo" width="100%">
</p>

## Personal worktree edition

This fork retains Codex, Claude, Cursor, Pi and personal multi-Agent dispatch. Each worktree owns its task state, session pointers and journals. Generated `.trellis/` stays local: reuse existing global ignore, never alter business-repository ignore rules, and never stage or commit generated state. Fork source and shipped templates remain version controlled.

Requires Node.js >= 18.17, Python >= 3.9 and pnpm. Install once from this fork checkout:

```bash
pnpm local:install
```

The installer builds a separate version and creates `~/.local/bin/trellis-local`, preserving the upstream global `trellis` command:

```bash
trellis-local init --yes --codex --claude --cursor --pi
trellis-local update
```

Use the same initialization command in Paseo without `-u`. To pin one exact build, use the fixed path printed by the installer. Global upstream upgrades do not affect it. Only another `pnpm local:install` switches the local command; previous builds remain available. Existing projects are backed up automatically; review conflicts when reported. A separate dry run is optional.

Small tasks proceed directly. Complex work records only useful plans and design. `.trellis/workflow.md` owns the rules; platform Skills load and route. Authorized work continues through validation. Incomplete work stays active with progress recorded. Business commits, MR, CI, merge and release follow the target repository's requirements.

Journals live in `.trellis/workspace/journal-N.md`; `add_session.py --commit` only references existing business commits. Specifications can be copied from the main checkout as an independent initialization snapshot. Never share the entire `.trellis/`. Invoke `trellis-spec-bootstrap` explicitly when needed.

Codex and Pi share `.agents/skills/`; Pi Agents, extensions and prompts remain available. Init/update migrate old `.pi/skills/trellis-*` entries to avoid duplicate Skill discovery while protecting customized content.

The fork removes personnel identities, personnel assignment, team spec synchronization and state auto-commits. Upstream platform and safety fixes remain reusable; init/update, task schema, workflow and channel isolation changes require deliberate review.

Reproducible context benchmark and workflow contract checks (no model calls or coding-success claims):

```bash
python3 packages/cli/scripts/benchmark-personal-workflow.py --baseline 88f4834449da9b4f607ec05e322408a0aa66f2ce --output /tmp/trellis-personal-benchmark
```

[Upstream documentation](https://docs.trytrellis.app/) describes upstream behavior and differs from this personal edition.

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=mindfold-ai/Trellis&type=Date)](https://star-history.dera.page/#mindfold-ai/Trellis&Date)

## Community & Resources

- [Official Docs](https://docs.trytrellis.app/)
- [GitHub Issues](https://github.com/love98ooo/Trellis-local/issues)
- [Discord](https://discord.com/invite/tWcCZ3aRHc)
- [Tech Blog](https://docs.trytrellis.app/blog)

<p align="center">
<a href="https://github.com/mindfold-ai/Trellis">Official Repository</a> •
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE">AGPL-3.0 License</a> •
Built by <a href="https://github.com/mindfold-ai">Mindfold</a>
</p>

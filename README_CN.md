# Trellis-local

面向个人与多个 worktree 的 [Trellis](https://github.com/mindfold-ai/Trellis) 轻量 fork。使用 `trellis-local`；内部 npm 包标识保留以减少上游合并差异，本项目不发布上游 npm 包。

<p align="center">
<picture>
<source srcset="assets/trellis.png" media="(prefers-color-scheme: dark)">
<source srcset="assets/trellis.png" media="(prefers-color-scheme: light)">
<img src="assets/trellis.png" alt="Trellis Logo" width="500" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">
</picture>
</p>

<p align="center">
<strong>开箱即用的 AI 编码工程化框架</strong><br/>
<sub>AI 写代码很快，但它每次会话都从零开始理解项目，记不住你的规范，也记不住之前的需求。Trellis 在每个 worktree 本地保存规范、任务与记忆，让任意 Coding Agent 都按你的工程标准来实践。</sub>
</p>

<p align="center">
<a href="./README.md">English</a> •
<a href="https://docs.trytrellis.app/zh">文档</a> •
<a href="https://docs.trytrellis.app/zh/start/install-and-first-task">快速开始</a> •
<a href="https://docs.trytrellis.app/zh/advanced/multi-platform">支持平台</a> •
<a href="https://docs.trytrellis.app/zh/start/real-world-scenarios">使用场景</a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@mindfoldhq/trellis"><img src="https://img.shields.io/npm/v/@mindfoldhq/trellis.svg?style=flat-square&color=2563eb" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@mindfoldhq/trellis"><img src="https://img.shields.io/npm/dw/@mindfoldhq/trellis?style=flat-square&color=cb3837&label=downloads" alt="npm downloads" /></a>
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
<a href="https://github.com/mindfold-ai/Trellis/stargazers"><img src="https://img.shields.io/github/stars/mindfold-ai/Trellis?style=flat-square&color=eab308" alt="stars" /></a>
<a href="https://docs.trytrellis.app/zh"><img src="https://img.shields.io/badge/docs-trytrellis.app-0f766e?style=flat-square" alt="docs" /></a>
<a href="https://discord.com/invite/tWcCZ3aRHc"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
<a href="https://github.com/love98ooo/Trellis-local/issues"><img src="https://img.shields.io/github/issues/mindfold-ai/Trellis?style=flat-square&color=e67e22" alt="open issues" /></a>
<a href="https://github.com/love98ooo/Trellis-local/pulls"><img src="https://img.shields.io/github/issues-pr/mindfold-ai/Trellis?style=flat-square&color=9b59b6" alt="open PRs" /></a>
<a href="https://deepwiki.com/mindfold-ai/Trellis"><img src="https://img.shields.io/badge/Ask-DeepWiki-blue?style=flat-square" alt="Ask DeepWiki" /></a>
<a href="https://chatgpt.com/?q=Explain+the+project+mindfold-ai/Trellis+on+GitHub"><img src="https://img.shields.io/badge/Ask-ChatGPT-74aa9c?style=flat-square&logo=openai&logoColor=white" alt="Ask ChatGPT" /></a>
</p>

<p align="center">
<img src="assets/trellis-demo-zh.gif" alt="Trellis 工作流演示" width="100%">
</p>

## 个人多 worktree 版本

保留 Codex、Claude、Cursor、Pi 与个人多 Agent 调度。每个 worktree 拥有独立任务、会话指针和日志；生成的 `.trellis/` 仅本地使用，沿用已有全局 ignore，不修改业务仓库 ignore，也不暂存或提交状态文件。Fork 源码及生成模板正常版本管理。

需要 Node.js >= 18.17、Python >= 3.9 和 pnpm。在本 fork 源码目录执行一次：

```bash
pnpm local:install
```

安装器自动构建、保存独立版本并创建 `~/.local/bin/trellis-local`，保留上游全局 `trellis`。初始化和存量迁移只需：

```bash
trellis-local init --yes --codex --claude --cursor --pi
trellis-local update
```

Paseo 使用同一初始化命令，不再传 `-u`。如需固定到某次构建，使用安装器输出的固定路径；上游全局升级不会影响它。只有再次执行 `pnpm local:install` 才切换本地命令，旧构建保留。存量更新会自动备份，冲突文件需审阅；不必每次先执行 `--dry-run`。

小任务直接开发；复杂任务按需记录计划和设计。工作流规则统一位于 `.trellis/workflow.md`，平台 Skills 只负责加载和路由。已授权工作持续完成验证；未完成任务保留进展，不因会话结束归档。业务提交、MR、CI、合并与发布仍遵守目标仓库规范。

日志位于 `.trellis/workspace/journal-N.md`。`add_session.py --commit` 仅引用已有业务提交，不产生提交。规范可以在初始化时从同仓库主 checkout 复制为独立快照；不共享整个 `.trellis/`。需要规范初始化时明确调用 `trellis-spec-bootstrap`。

Codex 和 Pi 共用 `.agents/skills/`；Pi 的 Agent、extension 和 prompts 仍保留。旧 `.pi/skills/trellis-*` 由 init/update 迁移，避免重复发现同名 Skill；个人自定义内容应先备份和比较。

本 fork 删除人员身份、人员任务分配、团队规范同步及状态自动提交。上游平台适配和安全修复仍可复用；init/update、任务 schema、工作流和 channel 隔离相关更新需逐项复核。

可复跑的 context 基准和流程合同评估（不调用模型、不代表真实编码成功率）：

```bash
python3 packages/cli/scripts/benchmark-personal-workflow.py --baseline 88f4834449da9b4f607ec05e322408a0aa66f2ce --output /tmp/trellis-personal-benchmark
```

[上游文档](https://docs.trytrellis.app/zh) 描述上游行为，与此个人版本存在差异。

## Star 历史

[![Star History Chart](https://star-history.dera.page/svg?repos=mindfold-ai/Trellis&type=Date)](https://star-history.dera.page/#mindfold-ai/Trellis&Date)

## 社区与资源

- [官方文档](https://docs.trytrellis.app/zh)
- [GitHub Issues](https://github.com/love98ooo/Trellis-local/issues)
- [Discord](https://discord.com/invite/tWcCZ3aRHc)
- [技术博客](https://docs.trytrellis.app/zh/blog)

### 联系我们

<p align="center">
<img src="assets/wx_link11.jpg" alt="微信群" width="260" />
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="assets/feishu-group-qr.jpg" alt="飞书话题群" width="260" />
</p>

<p align="center">
<a href="https://github.com/mindfold-ai/Trellis">官方仓库</a> •
<a href="https://github.com/mindfold-ai/Trellis/blob/main/LICENSE">AGPL-3.0 License</a> •
由 <a href="https://github.com/mindfold-ai">Mindfold</a> 构建
</p>

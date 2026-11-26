# Personal Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox syntax.

**Goal:** 上传当前项目到个人 GitHub 仓库，并提供可验证的 Android 更新发布流程。

**Architecture:** 原更新用例与 UI 保持；构建身份决定 GitHub 仓库，具体 HTTP 实现进入既有 adapter；个人发行沿用原构建与质量检查入口。

**Tech Stack:** Rust workspace、Tauri Android、GitHub API、GitHub Actions、pnpm。

**Spec:** `docs/superpowers/specs/2026-11-26-personal-repository.md`

## Global Constraints

- 沿用 `feature/mobile-chat-shell`，上传前保护空暂存区与全部已有修改。仅提交和推送已核对的任务源码。
- 创建私有 `obiyeuy/TauriTavern`，`origin` 指向个人仓库、`upstream` 保留原项目，保留上游历史与许可证；不合并、改写历史或公开仓库。
- APK 包名 `com.tauritavern.personal`，沿用已有签名。凭据不进 Git，不擅自上传签名材料。
- 只保留 `stable` / `canary` 更新语义；不嵌入 GitHub token，不静默隐藏 404。

## Review Focus

- 个人构建只查询其编译时仓库；上游默认仍沿用原身份。
- 仓库私有、没有已发布 Release、Canary 缺失时错误必须带请求上下文。
- 版本、源码 SHA、APK 包名与签名相互一致；未完成的构建不能被发布为可用更新。
- 上传清单和历史不能混入凭据、运行数据或构建产物。
- 工作流不依赖上游账户权限；所有“已启用”或“已验证”的声明有实际 API／命令证据。

### Task 1: 核对并上传当前优化快照

**Files:** 当前源文件清单；已有 settings-refresh 规格、计划与 ledger；`.local/github-publishing-20261126/`。

**Interfaces:**
- Consumes: 已有 Git 工作区、Git credential helper、设置刷新 before 与 canonical 基准。
- Produces: 已审查源码快照提交、私有仓库与真实远端分支，供 Task 2 延续。

- [x] 完成设置实际编辑／搜索输入操作验证，关闭本任务 Chrome 与预览服务器；未等待搜索结果 settle 的采样不作为过滤完成证据。
- [x] 隔离执行原设置 unit、mobile browser 与 API browser 文件，保持原 60000 ms 限制，79/79 通过。
- [x] 执行 `pnpm run check`，保留完整结果；browser 291/291，contracts 460/461，唯一失败为缺少 actool；补跑 UI 191/191，Rust 输入未变化。
- [x] 一次独立审阅 settings-refresh 的精确五文件增量，无待处理问题。
- [x] 检查全部差异、未跟踪文件、忽略规则、源码与历史中的凭据候选；按明确清单暂存当前持续优化源码。
- [x] 创建私有仓库；提交首次优化迁移快照 `6d0d188d`；上传快照 `dev` 与当前任务分支，读取 API 核对提交和可见性。`main` 在 Task 2 最终源码就绪后首次初始化。

### Task 2: 统一个人更新来源与发布流程

**Files:** `tt-adapter-http/src/github/update_repository.rs` 与真实 HTTP integration tests；原 host update repository／composition／build.rs／product；统一版本来源与个人 Android overlay／构建入口；共享签名、APK 验包、发布脚本与行为测试；个人发行与现有质量工作流；更新契约、后端结构、技术栈、开发说明和 `docs/releases/2.4.1.md`。

**Interfaces:**
- Consumes: Task 1 的 `obiyeuy/TauriTavern` 与上传快照；`TAURITAVERN_UPDATE_REPOSITORY=owner/repo`。
- Produces: 原 `UpdateRepository` 实现与可审查的 Android 发布流程，保持原 Stable/Canary DTO。

- [x] 先用真实 HTTP 行为覆盖写出个人仓库渠道读取与 404 诊断的失败案例。
- [x] 迁移 GitHub IO 到 `tt-adapter-http`，删除旧 host 路径及 Apple 工程引用，构建脚本注入唯一更新仓库身份并拒绝非法值。
- [x] 运行 adapter focused tests（20 unit + 4 integration）和 `node scripts/check-rust-crate-boundaries.mjs`；application/host 与完整 harness 的新验证仍在下一步骤中完成。
- [x] 整理个人 Android 包名、2.4.1 / 2004001 版本与发布工作流；复用原 `pnpm run check` 和 Android 构建入口；同步更新契约、架构文档与开发说明。
- [x] 核对工作流语法和原版本／发布行为覆盖；独立审阅发现的首次失败草稿识别问题已复现并通过现有发布行为测试修正。
- [x] 独立审阅此次精确增量，处理一个 Important 草稿发现问题和一个 Minor 稳定发布提升文档问题；未执行合并或第二次整项审阅。
- [ ] 最终完整验证、逐路径自审与 Android 实包验包；记录公开更新与签名 secrets 尚需的授权条件。
- [ ] 提交并推送该实现，以最终源码首次初始化 `main`；读取远端提交与实际工作流状态。
- [ ] 向用户交付仓库、验证结果和可审核的公开发布步骤，明确需要确认的范围与原因。

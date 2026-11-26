# Secret Value Read Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 密钥复制与脚本读取呈现真实失败，保留曝光拒绝、成功值和 quiet 语义。

**Architecture:** `secrets.js::requestSecret` 继续拥有请求和 HTTP 错误边界。nullable 权限拒绝只属于 `find` 查询；复制按钮和 slash 命令拥有各自的通知与返回行为，没有新的状态或请求客户端。

**Tech Stack:** JavaScript、现有 i18n、jQuery/Popup、Node browser harness。

**Spec:** `docs/superpowers/specs/2026-11-26-secret-value-read-errors.md`。

## Global Constraints

- 不修改密钥曝光设置、Rust 权限、保存、路由、DTO 或文件布局。
- `findSecret(key, id?)` 成功返回字符串，HTTP 401/403 返回 null，其他实际失败拒绝。
- `/secret-read`、`/secret-find`、`/secret-get` 失败仍返回空字符串，quiet 抑制通知。
- 读取不标记密钥文档需要刷新，失败不复制值或发布成功。
- 保留既有任务分支和修改，不提交、推送、stash 或新建并行实现。

## Review Focus

- active 元数据仍在但明文已缺失：显示 404 原因，保留列表和剪贴板。
- HTTP/传输失败：一次操作只有一条可归因错误，不提示开启曝光。
- JSON 损坏或 `value` 不是字符串：不得复制 undefined、对象或假定空值。
- HTTP 401/403：保持 null 与原曝光帮助，不标记刷新。
- 剪贴板失败和 quiet 脚本：无复制成功通知，脚本返回和通知行为保持。

### Task 1: 统一密钥值读取与两个消费者的失败路径

**Files:**
- Modify: `src/scripts/secrets.js`。
- Modify: `src/locales/zh-cn.json`。
- Modify: `docs/FrontendGuide.md`、`docs/FrontendHostContract.md`；由 `scripts/builtin-skills/build-tt-docs.mjs` 同步内置文档。
- Test: `tests/browser/api-controls.test.mjs`。

**Interfaces:**
- Consumes: 现有 `requireOkResponse(response, action)`、`requestSecret(action, body, message)`、`copyText(text)`。
- Produces: `findSecret(key, id?) -> Promise<string|null>`，真实失败拒绝；复制与 slash 消费者按自身入口处理。

- [x] 扩展现有 browser 文件：新增实际管理按钮的 404/500/传输/JSON/形状失败、权限拒绝、成功、剪贴板失败，以及 slash aliases 的 quiet/返回行为。断言实际通知、剪贴板与保留元数据。
- [x] 运行 `node --experimental-vm-modules --test --test-name-pattern="secret value" --test-timeout=60000 --test-force-exit tests/browser/api-controls.test.mjs`，确认 RED 为错误原因被吞或失败未被按钮接管。
- [x] 在既有 request boundary 使用 `requireOkResponse`，处理 find 的 nullable 权限拒绝；只对实际 mutation 标记刷新，读取解析拒绝并保留上下文。
- [x] 复制按钮捕获读取与剪贴板失败；slash 回调捕获后按原 quiet 语义提示一次并返回空字符串。补充中文错误说明。
- [x] 同步两个前端文档和内置文档，运行相同 focused 命令确认 GREEN，检查无额外刷新和无假成功。
- [x] 运行 `pnpm run check`；完整读取实际结果，已知 `actool` 环境失败如实记录，继续执行未到达的 UI 检查。
- [x] 核对 incremental diff 与全部消费者，独立审阅；将证据、rulings 和实际结果归档，更新候选并清理本任务临时材料。

实际结果：focused 10/10、Browser 175/175、UI 191/191。完整 `pnpm run check` exit 1，契约 460 pass/1 fail，唯一失败是缺少 Xcode `actool`，xcrun exit 72；后续 UI 单独通过。检查期间 2,755 个输入未变。独立增量审阅 Critical/Important/Minor 均为 0；没有 Rust 改动，未机械重跑此前的完整 Rust 和 Clippy。源码未提交，本轮尚未打包安装。

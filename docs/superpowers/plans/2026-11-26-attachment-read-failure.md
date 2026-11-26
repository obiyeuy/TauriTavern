# Attachment Read Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 附件读取失败不能变成可下载、可上传或可发送的文件内容。

**Architecture:** `getFileAttachment(url): Promise<string>` 在原请求边界传播失败；真实 UI owner 接管通知，命令与生成沿既有错误链传播。向量读取使用同一函数，原恢复边界拥有提示，正文只在读取和检索成功后修改。

**Tech Stack:** JavaScript、现有 Browser Runtime／happy-dom、Data Bank、Popup、slash parser 和向量扩展。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-read-failure.md`

## Global Constraints

- 沿用 `feature/mobile-chat-shell`，保护已有未提交和暂存修改；不提交、推送、操作手机或真实用户文件。
- 成功字符串、文件路径、请求格式、原按钮／弹窗、slash 选项和向量可恢复语义保持；不新增依赖、宿主接口、错误标记、兜底内容或回滚状态。
- 本项不修复尚未确认的引用保存失败，也不合并附件删除和格式转换的独立修复。
- 用户已授权自主实施及例行方案，直接执行；验证和精确增量归档后清理本项临时材料。

## Review Focus

- 原件 HTTP 失败时，移动不得退役它；Task 1 的移动控件和 I/O gate 场景。
- 编辑、查看、下载和消息文件控件不得消费失败结果；Task 1 的真实控件与下载边界场景。
- `/db-get` 和核心请求组装保留拒绝及原通知 owner；Task 1 的 parser／生成场景。
- 向量读取失败不能留下去掉全文的半修改消息；Task 1 的原全局入口与完整正文场景。
- 已有索引的文件无需重新读取，正常空字符串仍是合法内容；Task 1 的原入库按钮及成功重试场景。

### Task 1: 统一读取失败与全部实际消费者

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `src/script.js`
- Modify: `src/scripts/extensions/vectors/index.js`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 `fetch`、`requireOkResponse(response, action)`、Data Bank／消息 UI、`appendFileContent(message, text)`、`/db-get`、`vectors_rearrangeChat(chat, contextSize, abort, type)` 和原入库按钮。
- Produces: 成功返回原 string、失败拒绝的 `getFileAttachment(url)`；实际通知 owner 和未消费失败结果的流程；原空字符串与已有索引成功语义。

- [x] Step 1: 扩展原 fixture，以读取 gate 观察未确认读取期间的原件与状态；通过实际控件、parser、聊天／向量入口编写失败及重试场景，不用源码文本断言。
- [x] Step 2: Run `node --experimental-vm-modules --test tests/browser/data-bank-replacement.test.mjs`。Expected: 真实读取失败仍消费内容、未拒绝或提前修改正文的断言 RED；fixture 错误另记。
- [x] Step 3: 使用 `requireOkResponse` 去掉 getter 的通知与失败缺省结果；迁移真实 UI owner，延迟 `fileLength`／向量消息写入，去掉向量内部吞错；已有索引先确认再按需读取。
- [x] Step 4: Run 同一 focused 命令。Expected: 失败保持原件、引用、正文且一次提示，成功／重试及前三个替换测试通过。
- [x] Step 5: 同步两份 FrontendGuide；run `pnpm run check` 和因已知 actool 失败未到达的现有检查。Expected: 行为、UI、Rust 和边界通过；实际 actool 环境失败单列。
- [x] Step 6: 逐路径自审并进行一次独立精确增量审阅，必要发现 RED→GREEN 修正；归档日志、指纹、增量与决定，清理专用临时材料，保持未提交。

## Final Review Fix

- [x] 实际普通发送按钮的读取失败通知场景 RED（`0 !== 1`）；启动完整应用，不重复注册控件。
- [x] 在原 `GenerateInternal` 的附件组装 `Promise.all` 边界呈现一次非 quiet 失败，继续拒绝以使用原清理；同一测试 GREEN，完整 suite 验证。

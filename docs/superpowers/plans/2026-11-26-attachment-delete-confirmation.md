# Attachment Delete Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实际删除未确认时保留附件引用和可重试状态，确认后的引用清理沿原保存器持久化。

**Architecture:** `chats.js` 的一条私有删除请求保留原事件；公开布尔入口和 Data Bank 的拒绝入口消费同一请求。引用清理只由一个私有函数更新原 bucket 与保存调度，核验已知缺失也使用它。

**Tech Stack:** JavaScript、Browser Runtime／happy-dom、原 Data Bank／slash／Popup、settings 与 chat byte writer。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-delete-confirmation.md`

## Global Constraints

- 延续 `feature/mobile-chat-shell`，精确增量与指纹保护所有此前修改；不提交、推送、操作手机或真实数据。
- 保持 `deleteFileFromServer(url, silent): Promise<boolean>`、成功事件、原字段、routes、neutral no-op 和正常取消。
- 不新增依赖、公开宿主接口、持久状态、事务回退、补偿保存或将未知 404 当成功。
- 各实际控件／原 writer／slash executor 各自拥有失败提示；只在实际操作确认后改变状态。
- 按用户持续授权直接执行。临时材料归档验证证据后清理，actool 环境失败单列。

## Review Focus

- Data Bank DELETE 等待／拒绝保留引用与 disabled，实际控件提示原因一次；Task 1 两种 source 行为。
- character 启用附件成功删除安排保存，重读 settings 不再有旧引用；Task 1 实际命令与 writer。
- 替代引用已确认而退役失败时保留原件与有效新副本，不返回 URL；Task 1 `/db-update`。
- 批量操作等待删除完成、失败保留选择；Task 1 真实 checkbox 与批量按钮。
- 核验明确不存在只清理引用，来源切换不改新位置；Task 1 原核验与确认／I/O gate。

### Task 1: 删除确认后清理实际来源引用

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `src/locales/zh-cn.json`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 `requireOkResponse()`、`getAttachmentSourceIdentity(source)`、`getDataBankAttachmentsForSource(source, true)`、`saveSettingsDebounced()`、`saveMetadataDebounced()`、`saveChatConditional()`、`FILE_ATTACHMENT_DELETED`。
- Produces: 私有 `deleteFileAttachmentFromServer(url): Promise<void>` 与 `removeAttachmentReference(attachment, source): void`；原 `deleteFileFromServer()` 保持 bool；`deleteAttachment(attachment, source, callback, confirm = true, sourceIdentity = getAttachmentSourceIdentity(source)): Promise<void>` 等待真实删除并拒绝失败。

- [x] Step 1: 扩展原 fixture 的受控 DELETE 与实际删除控件。新增最高层用例：UI／slash 失败保留原引用、disabled 与磁盘；character 启用删除实际保存；消息文件消费失败；替换退役失败；批量未完成／拒绝；已知 orphan 清理；确认或 I/O 期间来源切换。消费原 API bool 的公开结果及 silent 文义也保留。
- [x] Step 2: Run `node --experimental-vm-modules --test --test-name-pattern="delete|deletion|orphan" tests/browser/data-bank-replacement.test.mjs`。Expected: 原丢失引用、未安排保存、虚假完成／未等待或错误来源的断言 RED；fixture 失败另记并修正。
- [x] Step 3: 实现共同请求和引用清理；原 bool 入口消费共同请求，Data Bank 等待并传播失败。消息消费 bool 成功后才删引用；来源身份在异步前捕获并核对。原核验对明确 false 调用引用清理。批量使用可等待的原操作并接管一次错误，全部实际调用者迁移。
- [x] Step 4: Run 同一 focused 命令，再运行完整 `tests/browser/data-bank-replacement.test.mjs`。Expected: 原状态、磁盘、一次原因／事件、正确位置、正常取消与成功重试均通过，已有 25 项保持。
- [x] Step 5: 更新指南与镜像、必要中文说明；Run `pnpm run check`，补执行未到达的检查。Expected: 相关行为与边界通过；任何 actool 失败保留实际记录，不跳过或标绿。
- [x] Step 6: 逐路径自审、精确增量审阅和必要修正；更新候选清单并归档清理，仅保留未提交改动。

## Review Fix

- [x] 独立审阅发现消息删除的位置检查在等待期间实际 swipe 移除 `extra.files` 后抛异常。真实删除控件和原 swipe 流程复现了 `TypeError`；happy-dom 缺少动画 API 的初始 fixture 失败单独记录，测试中的最小 API 清单在结束后恢复。
- [x] 将同一个位置检查改为合法缺失文件时返回 false，沿原位置变化／已删除部分结果的提示路径处理；没有新状态、接口或错误标记。
- [x] 运行该场景、完整附件测试与完整 harness，归档一次审阅的修正证据。

最终 focused 37/37，Browser 216/216、UI 191/191、workspace Rust 1274 pass / 0 fail / 1 ignored、Clippy 与边界通过；contracts 460/461，唯一失败为本机缺少 Xcode `actool`（xcrun 72）。完整 `pnpm run check` 仍退出 1，没有跳过或标绿。2773 项验证输入稳定，无关 tracked diff 和暂存区指纹匹配。一次独立审阅的唯一 Important 问题已经用实际删除控件与原 swipe 流程完成 RED→GREEN；精确增量和自审证据在 `output/verification/attachment-delete-result-20261126/`。

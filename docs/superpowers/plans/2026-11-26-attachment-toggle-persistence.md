# Attachment Toggle Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Data Bank 脚本启用／禁用附件和现有界面动作进入同一保存路径，重读设置保持选择。

**Architecture:** 导出并复用 `chats.js` 既有 `enableAttachment(attachment, callback)`／`disableAttachment(attachment, callback)`，在拥有禁用列表的操作中统一 no-op；命令只查找并调用。一个状态来源、原 settings debounce 和原 UI callback。

**Tech Stack:** 现有 JavaScript、原 slash executor、happy-dom 行为 fixture。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-toggle-persistence.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护已有及暂存修改；没有提交、推送、PR、设备或真实 provider 操作。
- 原 URL／source／别名、命令空字符串和找不到附件的 warning 保持。
- 禁用列表仍只有 `extension_settings.disabled_attachments`；修改经原 `saveSettingsDebounced()`，不改变退出 flush 或增加同步 ACK。
- 单条和批量 callback 保持；重复启用／禁用不新增保存或重复引用，不新增 setter、事件、缓存或包装。

## Review Focus

- 命令经原 settings 读取边界确认状态；内存变化不能替代持久化结果。
- 单条和批量按钮仍调用同一原操作，状态变化后 callback 继续刷新。
- 同状态重复操作保持 no-op，启用移除原列表中同 URL 的引用。
- global／character／chat 的原查找与全局禁用列表规则保持；位置、文件引用和文件字节不迁移。
- 原异步保存错误和退出 flush 保持，不把已安排的保存报告为同步磁盘 ACK。

### Task 1: 复用附件启停操作与保存器

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `src/scripts/extensions/attachments/index.js`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 `enableAttachment()`／`disableAttachment()`、`getAttachments()`、canonical 禁用列表、`saveSettingsDebounced()` 和最高层附件 fixture。
- Produces: 原启停行为和 callback；两个命令通过相同列表变更及原保存队列，返回值保持。

- [x] Step 1: 保存精确五文件 before 和其他 Git 差异／暂存指纹；归档已复现的原命令与读回记录。
- [x] Step 2: 添加 `Data Bank db-enable persists its attachment state through the original settings writer` 和 `Data Bank db-disable persists its attachment state through the original settings writer` 两项实际执行器行为覆盖，断言内存与 settings 读回，重复命令不新增保存。Run `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit --test-name-pattern='persists its attachment state' tests/browser/data-bank-replacement.test.mjs`。Expected: 两项在实际 settings 读回仍为旧状态处 RED。
- [x] Step 3: 在 `chats.js` 导出原两个操作，在各自的列表变更处判断是否需要保存，callback 仍执行；迁移两个命令，删除命令自己的列表变更和重复 no-op 规则，同步 Guide 镜像。
- [x] Step 4: Run 相同 focused 命令和本地实际单条／批量控件核对。Expected: 两项 GREEN，成功读回且重复操作不额外保存，原按钮刷新及文件／引用保持。
- [x] Step 5: 冻结输入并 Run `pnpm run check`，补未执行的 UI／Rust／Clippy。Expected: 行为无新增失败，已知 actool 环境失败准确记录，源文件和 Git 差异稳定。
- [x] Step 6: 逐路径自审和一次精确五文件独立审阅；归档证据、更新候选，清理本项临时材料。APK 按实际打包和安装状态报告。

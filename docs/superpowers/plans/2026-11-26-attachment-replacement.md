# Attachment Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 编辑、移动或 /db-update 时，未确认的替换上传不得删除原件。

**Architecture:** 编辑、移动和 /db-update 进入一个共享提交函数，await 原上传路径后才退役旧附件；文件、引用、事件与保存入口沿用原机制。

**Tech Stack:** JavaScript、现有 Browser Runtime／happy-dom、原 Popup 与 Data Bank。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-replacement.md`

## Global Constraints

- 保留已有修改，沿用 feature/mobile-chat-shell；不提交、推送、操作手机或真实用户文件。
- 原公开函数、上传格式、文件路径、metadata／settings 写入入口、取消和无修改退出、成功后的旧文件删除与事件保持。
- 不新增依赖、原生 command、DTO、事务回退、配置开关、队列或状态镜像。
- 这次排序不声称修复原读取失败、退役失败或跨进程／断电持久化。

## Review Focus

- 编辑失败保留原件和禁用状态；Task 1 编辑 HTTP 500 场景。
- 移动失败保留 source，目标不发布替代引用；Task 1 移动传输拒绝场景。
- 上传等待期间不能提前退役原件；两个场景都用 I/O gate 观察。
- 成功的编辑／移动只退役旧文件一次并保留真实目标 bucket；两个成功场景。
- `/db-update` 保留原文件名与返回的新路径，并在等待与失败时保护原件；命令的实际 parser 场景。
- 原取消／无修改、原读取与退役失败边界：源码逐路径审阅，不以本次成功条件扩大原保证。

### Task 1: 收敛附件替换提交顺序

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `src/scripts/extensions/attachments/index.js`
- Create: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 editAttachment／moveAttachment／updateDataBankAttachment，uploadFileAttachmentToServer(file, target) 的路径或缺省失败结果，deleteAttachment(attachment, source, callback, false)。
- Produces: replaceAttachment(attachment, source, file, target, callback): Promise<string | undefined>；两个原界面与原命令共用。

- [x] Step 1: 用真实 manager/edit/move 控件、Popup 和 /db-update parser 编写三个行为测试；每个覆盖上传挂起、失败保留与成功结果，源文件文字为 ORIGINAL FILE CONTENT，编辑文字为 EDITED FILE CONTENT。
- [x] Step 2: Run `node --experimental-vm-modules --test tests/browser/data-bank-replacement.test.mjs`。Expected: 因上传确认前已删除原件而 RED。
- [x] Step 3: 实现私有 replaceAttachment 的上传确认→原退役顺序，迁移编辑与移动，删除两处旧 delete-before-upload 流程。
- [x] Step 4: Run 同一 focused 命令。Expected: 两条实际界面路径通过，原失败原因只呈现一次。
- [x] Step 5: 同步 FrontendGuide 与内置镜像；run `pnpm run check`，完成本次相关未到达检查。Expected: 新行为与相关检查通过；现有 actool 环境失败单列。
- [x] Step 6: 核对实际调用者、契约、职责与精确增量，做一次独立审阅并按需 RED→GREEN 修正，归档与清理；保持未提交。

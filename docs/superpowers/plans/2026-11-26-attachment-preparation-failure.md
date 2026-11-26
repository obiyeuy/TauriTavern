# Attachment Preparation Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 转换、上传或目标确认失败时，不发布错误内容或消息，并保留正确的草稿与已确认结果。

**Architecture:** 复用原请求检查、转换器和编码；消息先准备本次新附件结果再发布，Data Bank 沿原独立上传。当前位置规则由 `script.js` 的事实统一派生，各真实入口拥有失败提示与清理。

**Tech Stack:** JavaScript、Browser Runtime／happy-dom、原 file controls／slash／Popup／scraper、settings 与 chat writer。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-preparation-failure.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护所有已有修改；不提交、推送、操作手机、业务数据或凭据。
- 保持原转换器注册／匹配、编码与成功文件／媒体字段、URL、事件时机、保存队列、neutral no-op、input ID。
- 不新增依赖、转换框架、持久状态、错误标记、事务回滚或自动删除有效副本。
- binary／size 校验仍使用原 bool 与提示；无新路径的调用者停止，不发布抓取成功。
- 源头错误继续拒绝，各真实 UI／Agent／slash 入口呈现一次；新草稿不被旧操作清理。
- 用户授权自主执行，不作例行确认；完整检查实际失败保留记录，精确增量归档后清理本项 scratch。

## Review Focus

- 转换及上传失败不得发布用户消息或请求模型；Task 1 普通按钮、实际 API 与 native upload gate。
- 已有消息失败不修改正文／附件，不发 `MESSAGE_FILE_EMBEDDED`；Task 1 真实嵌入控件及模型候选。
- 上传后切角色不保存到新聊天，Data Bank chat 身份仍保持原语义；Task 1 原 setter、实际 writer 与既有 source 覆盖。
- 嵌入不重置主输入，新文件／文字选择不被旧完成清空；Task 1 两个实际选择器和持有的 upload。
- 一次原因、有效部分副本与媒体／文本成功形状；Task 1 scraper、drop、slash、部分准备和有效重试。

### Task 1: 确认资源和目标后发布附件

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `src/script.js`
- Modify: `src/scripts/group-chats.js`
- Modify: `src/index.html`
- Modify: `src/locales/zh-cn.json`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 `requireOkResponse()`、`getConverter()`、`convertTextToBase64()`、`getBase64Async()`、`saveBase64AsFile()`、source 状态、原 writers、事件、控件和 executor。
- Produces: `getCurrentChatLocationIdentity(): string` 从原事实派生、没有持久状态；`populateFileAttachment(message, inputId = 'file_form_input', locationIdentity = getCurrentChatLocationIdentity(), selectedFiles?): Promise<void>` 在准备／目标确认后发布新附件，原发送与嵌入入口传递先前捕获的选择，省略时从原 input 捕获；原 `uploadFileAttachment(): Promise<string>` 与 Data Bank uploader 拒绝未确认的上传及转换。
- Caller migration: `sendMessageAsUser()` / 原 provider-barrier 入口增加可选同步 `onAttachmentError`，只接管准备失败；普通生成与群聊无激活成员入口使用原附件 presenter，Agent／API／slash 保持各自归属。

- [x] Step 1: 扩展原 fixture 的实际文件选择、embed 和受控上传，新增行为覆盖：普通发送转换／HTTP／receipt 失败保留消息和草稿、纯 API 拒绝、部分副本、Data Bank 控件及 slash 错误、嵌入失败与独立草稿、真实候选／消息／role 变化、成功媒体／文本和新选择保留。复用原 37 项，迁移旧 command 失败的错误 owner 断言。
- [x] Step 2: Run `node --experimental-vm-modules --test --test-name-pattern="preparation|conversion|upload receipt|new file selection" tests/browser/data-bank-replacement.test.mjs`。Expected: 原上传／发布／清理／目标绑定错误的断言 RED；fixture 失败另记，不能当生产证据。
- [x] Step 3: 实现共同位置 getter 和上传拒绝，去掉两个转换失败后继续上传的路径与未使用的 Data Bank base64 读取；消息只暂存本次新结果，确认目标后发布，失败保留原原因及副本路径。
- [x] Step 4: 迁移发送、嵌入、Data Bank、scraper／drop 和 slash 的错误 owner／无路径处理；在发送的发布前失败恢复同一聊天的空文字框；input 拆开所有权并只清理本次选择，事件和原保存时机保持。
- [x] Step 5: Run 同一 focused 命令与完整 `tests/browser/data-bank-replacement.test.mjs`。Expected: 新行为与原 37 项通过，无未接管错误、错误消息、重复提示或错误位置。
- [x] Step 6: 更新文档和镜像、必要中文说明；Run `pnpm run check`，补执行未到达的检查。Expected: 行为／UI／Rust／边界通过，actool 等实际环境失败单列，不跳过或标绿。
- [x] Step 7: 逐路径自审、一次精确增量审阅及必要修正；更新候选清单，归档清理，保持未提交。

最终行为、自审及审阅修正证据见 `output/verification/attachment-conversion-20261126/final-summary.json`。完整检查实际退出 1，唯一失败为缺少 Xcode `actool`；不是完整 harness 通过。审阅修正后 Browser 238/238（附件 59 项）、UI 191/191、Rust 1274／0／1、Clippy 和边界通过。

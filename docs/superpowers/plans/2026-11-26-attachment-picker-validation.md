# Attachment Picker Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧验证不损坏当前选择，消息准备确认允许的文件后才上传，媒体选择避免无用正文读取。

**Architecture:** 一条私有验证结果协议，由原实际 UI／准备入口拥有错误与状态；位置和选择从既有事实捕获。公共 Browser Runtime 修正已确认的文件 reset 默认动作，原格式与事件保持。

**Tech Stack:** JavaScript、Browser Runtime／happy-dom、原 file controls／DataTransfer／File、原上传与保存器。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-picker-validation.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护五文件 before 与无关／staged 指纹；不提交、推送、操作手机、真实 provider 或数据。
- 原 MIME、converter、binary、size limit、字节编码、文件／媒体字段、事件与 raw base64 存储接口保持。
- 私有 validator 返回 Error/null，读取失败拒绝原错误。Data Bank 已知拒绝仍无路径；主输入／嵌入原已知拒绝说明保持，实际读取失败一次呈现。
- 位置与 File 选择由原事实捕获；无缓存、镜像、operation ID、额外验证状态或包装层。welcome 原未绑定草稿保持。
- 媒体／size 用元数据决定，文本准备再次验证以保证 API 与 UI 一致；没有文本性能加速声明。
- 用户授权覆盖自主实施；完整 check 的实际环境失败保留，补跑未到达的 UI／Rust／Clippy。

## Review Focus

- 旧成功／失败、取消／新选择及位置变化不修改当前 file input 或显示旧错误；Task 1 真实 picker/reset/role 控件和确定性 File.text。
- API 准备不得上传待验证的非法文件，原部分副本与草稿处理保持；Task 1 `populateFileAttachment()` 配合实际选择入口。
- 读取失败当前 UI 一次呈现，选择／标签匹配并可重试；Task 1 实际 input change 与失败／成功重试。
- 媒体不作文本读取，已知不支持结果和 Data Bank 无路径／说明保持；Task 1 媒体边界和 Data Bank uploader，原媒体成功覆盖。
- 浏览器 reset 的取消和 welcome 草稿保留，原嵌入／聊天／保存事件保持；Task 1 welcome 与 reset 流程，复用原完整附件覆盖。

### Task 1: 统一文件验证与选择事实

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `tests/browser/runtime.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 File／DataTransfer、`getCurrentChatLocationIdentity()`、`isFileInputUnchanged()`／`clearFileInputIfUnchanged()`、`onFileAttachmentError()`、validator 规则、准备／uploader 与真实控件。
- Produces: 私有 `getFileValidationError(file): Promise<Error|null>`，未知读取失败拒绝；主 form 只由本次仍有效的选择更新；`populateFileAttachment()` 使用同一验证前置条件。没有新公开接口。

- [x] Step 1: 公共 runtime 已补齐观察到的 FileList reset 默认动作，重新实际复现后保留该修正。新增已有最高层覆盖：旧成功／失败、新聊天／welcome、读取失败重试、验证期间 API 准备拒绝、媒体无文本读取、Data Bank 已知拒绝／无路径。
- [x] Step 2: Run `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit --test-name-pattern="file picker|attachment validation" tests/browser/data-bank-replacement.test.mjs`。Expected: 原数据／标签／通知／未验证上传／无用读取 RED，Data Bank 和 welcome 原行为通过；fixture 错误单列。
- [x] Step 3: validator 改为原结果 Error/null，metadata 决策先行；迁移主输入、嵌入、Data Bank 与消息准备的实际消费者，删除旧 validateFile／内部通知。主 form 先显示捕获的真实元数据并绑定 reset，所有等待后的 UI 只属于原选择／位置；准备在读／上传前使用相同规则。
- [x] Step 4: Run 同一 focused 命令。Expected: 所有场景通过，无多余上传、旧 UI 结果或未接管读取错误；原有效重试／拒绝表现保持。
- [x] Step 5: 同条件媒体探针重跑并核对读取计数与耗时；同步 guide 镜像。Run `pnpm run check` 与未到达的补检查。Expected: 前后证据可比较，相关行为／UI／Rust／边界通过，环境失败不标绿。
- [x] Step 6: 逐路径自审，精确五文件增量一次独立审阅和必要修正；候选及 APK 状态更新，归档清理，仍保持未提交。

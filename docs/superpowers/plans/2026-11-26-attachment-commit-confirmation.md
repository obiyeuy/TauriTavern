# Attachment Commit Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 替代引用未经原保存器确认，或位置已经变化时，不退役原附件。

**Architecture:** 共同替换入口等待原 settings／metadata writer；同一个私有身份 getter 在上传发布和退役边界读取真实位置。原 `runChatSave()` 传播拒绝覆盖的 integrity 错误；没有第二份附件状态或事务回退。

**Tech Stack:** JavaScript、原 Browser Runtime／happy-dom、Data Bank、slash parser、Popup 和 settings／byte commit。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-commit-confirmation.md`

## Global Constraints

- 延续 `feature/mobile-chat-shell`，保护所有此前修改；不提交、推送、操作手机或真实用户文件。
- 成功 URL、格式、事件、三个调用者、原队列与正常保存通知 owner 不变；neutral 不产生新磁盘保存保证。
- 不新增依赖、宿主接口、错误类型／标记、持久状态、回滚或自动删除已上传有效内容。
- 旧文件删除结果与旧引用清理的后续保存仍作为独立候选；不声称跨文件原子提交。
- 用户已授权自行实施，无例行确认；日志／精确增量／指纹归档后清理本项 scratch。

## Review Focus

- global／character 设置确认前不能退役原件；Task 1 的编辑、移动与命令 ACK gate。
- chat metadata 失败不产生第二次通知或新 URL；Task 1 的原 byte commit 失败与成功重试。
- integrity 未获覆盖同意不算成功；Task 1 的真实 Popup 拒绝覆盖。
- 上传／保存期间切换位置不发布到新角色或删除原件；Task 1 的原字符 setter 与两个 IO gate。
- neutral no-op、取消／无修改与已有原件／有效新副本保持；Task 1 的 neutral parser，原 UI 条件与副本逐路径自审。

### Task 1: 确认实际位置与替代引用后退役

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `src/script.js`
- Modify: `src/locales/zh-cn.json`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `tests/browser/chat-navigation.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`
- Modify: `docs/CurrentState/ChatPayload.md`

**Interfaces:**
- Consumes: 原 `uploadFileAttachmentToServer(file, target)`、`flushPendingSettingsSave(true): Promise<boolean>`、`saveMetadata(): Promise<void>`、`cancelDebouncedMetadataSave()`、`deleteAttachment()` 和真实 source 状态。
- Produces: 等待正确 target 的原保存结果后才退役的 `replaceAttachment()`；位置改变时拒绝的原 uploader；拒绝覆盖时仍为失败的原 `runChatSave()`。成功／无新路径的替换结果保持。

- [x] Step 1: 扩展原 fixture 的 settings 和原 native metadata finish gate，以实际 writer 读回引用；写编辑／移动／命令保存失败、chat／integrity、上传／ACK 切角色与 neutral 行为场景。
- [x] Step 2: Run `node --experimental-vm-modules --test tests/browser/data-bank-replacement.test.mjs`。Expected: 未确认引用先退役、误发布位置或把拒绝覆盖当成功的断言 RED；测试设置故障另记。
- [x] Step 3: 实现私有位置 identity getter，uploader 在上传与发布边界核对；替换捕获两端、等待原保存器并在退役前核对原引用；原 integrity 拒绝 reload 后 rethrow。
- [x] Step 4: Run 同一 focused 命令。Expected: 原件／磁盘引用可读、正确目标、一次错误／事件和成功重试，既有 13 条行为覆盖保持。
- [x] Step 5: 更新文档及镜像、中文位置说明；run `pnpm run check`，完成因已知 actool 失败未到达的相关检查。Expected: 行为、UI、Rust 和边界通过；actool 实际失败仍单列。
- [x] Step 6: 逐路径自审并做一次独立精确增量审阅；必要修正 RED→GREEN，更新候选清单，归档与清理，保持未提交。

## Caller Migration

- [x] 自审沿全部实际调用者发现原件读取和抓取等待发生在 helper 调用前，拖放丢弃拒绝，抓取捕获后丢失原因；五个真实入口场景 RED 0/5，无 fixture 故障。
- [x] 在操作入口捕获身份并传入同一 helper，在上传前核对原引用；拖放接管拒绝，抓取按钮等待原 Promise 并保留错误。五条场景 GREEN 5/5。
- [x] 完整 focused 25/25 与最终 harness、独立审阅。
- [x] 独立审阅发现 metadata 拒绝覆盖的原聊天导航断言仍把未保存视作成功；已核对原提交失败传播规则并迁移为原 integrity 拒绝，保留 reload、原字节和后续失败断言。

最终联合 focused 51/51，Browser 204/204、UI 191/191、workspace Rust 1274 pass / 0 fail / 1 ignored、Clippy 与边界通过；contracts 460/461，唯一失败为本机缺少 Xcode `actool`（xcrun 72）。完整 `pnpm run check` 因此仍退出 1，没有跳过或标绿。精确增量、指纹、自审和审阅修正证据在 `output/verification/attachment-persistence-confirmation-20261126/`；此前无关 tracked diff 与暂存区指纹一致。

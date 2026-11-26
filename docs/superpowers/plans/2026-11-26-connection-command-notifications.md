# Connection Command Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline.

**Goal:** 连接字段失败由原应用发起者提示一次，普通命令保留原失败返回与默认提示。

**Architecture:** 已有 managed command 传入 quiet，原 callbacks 在拥有失败事实的分支落实该参数；现有应用 helper 继续拥有结果和通知。没有新接口或状态。

**Tech Stack:** JavaScript、原 slash commands／原生控件、现有 Android browser host fixture。

**Spec:** `docs/superpowers/specs/2026-11-26-connection-command-notifications.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护已有差异和暂存区，不提交、推送或发送真实 provider 请求。
- 保持公开参数列表、普通默认提示、空失败、getter、合法 setter、原匹配和所有连接／保存流程。
- 原生只提示一次，失败不发布 LOADED 或发起连接，原密钥与可重试选择保持。
- 已复现的缺失预设返回语义独立整理，未获用户确认不改变。
- 手机识别后直接安装最后已校验包；source、APK 和真机证据分开报告。

## Review Focus

- Custom 与 OpenCode 的验证分支都遵守 managed quiet，原普通 error 保持。
- Proxy 与 Tokenizer 不同时呈现 warning 和应用 error，原普通 warning 保持。
- 无参数 getter 和合法值仍返回原结果；协议与模糊匹配规则不变。
- 私有 callbacks 使用已有内部参数，不扩大公开命令参数列表或按调用者新增错误协议。
- 输入或其他任务已有修改不被覆盖；完整检查失败准确保留，不绕过 actool。

### Task 1: 原失败生产者落实 quiet

**Files:**
- Modify: `src/scripts/slash-commands.js`
- Modify: `src/scripts/openai.js`
- Modify: `tests/browser/connection-manager.test.mjs`
- Modify: `docs/FrontendGuide.md` and `default/skills/tt-docs/references/FrontendGuide.md`
- Modify: `docs/FrontendHostContract.md` and `default/skills/tt-docs/references/FrontendHostContract.md`

**Interfaces:**
- Consumes: 已有 `callback(args,value)`、`isTrueBoolean()`、managed `quiet=true` 和共同应用 Promise。
- Produces: 相同字符串结果和普通提示；managed 失败只由发起者呈现。

- [x] Step 1: 核对当前分支／差异、相关前端文档和命令边界，保存精确 before、其他差异指纹及原生复现。
- [x] Step 2: 扩展既有 fixture 的 warning 记录，增加四项最高层验证。原生 error=1、warning=0、LOADED 与 status request 为空、密钥仍 original；普通对应命令返回空且原默认提示=1；合法结果和格式 getter 保持。
- [x] Step 3: Run `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit tests/browser/connection-manager.test.mjs`。Expected: 四项重复提示处 RED，其余原行为保持。
- [x] Step 4: 在三个原 callbacks 的失败分支用原 `isTrueBoolean(args?.quiet)` 控制通知，保持返回、匹配与成功路径；同步两份文档镜像。
- [x] Step 5: Run 相同 focused 命令。Expected: 全部 GREEN，公开默认提示与实际 setter/getter 结果不变。
- [x] Step 6: 冻结输入并 Run `pnpm run check`，准确核对结果并补执行被 actool 环境失败中断的 UI／Rust／Clippy。Expected: 无新增行为失败，全部源输入与其他差异不变。
- [x] Step 7: 逐路径自审并进行一次精确七文件增量审阅；按最终意见一次校准修正并验证，不重新审阅旧任务。归档缺失预设的具体提案，整理证据及本项临时材料的清理或保留条件。

## 实际验收记录

- 最终 focused：18/18，通过；完整 Browser：291/291，通过。
- `pnpm run check` 实际退出 1：contracts 460/461，唯一失败为本机没有 Xcode `actool`（`xcrun` 退出 72）。未跳过或改写该检查，不计为完整 harness 通过。
- 补执行 UI 191/191、Rust 1274 通过／1 ignored、Clippy 退出 0。
- 完整检查与补执行期间，2786 个源输入及 Git 状态不变；范围外差异指纹、文档镜像和 `git diff --check` 均已核对。
- 一次精确七文件增量审阅未发现 Critical、Important 或 Minor 问题。Tokenizer 场景证明原密钥保持、通知唯一和连接未发起，不额外宣称阻断了待执行的密钥写入。
- 缺失预设的两行提案仍未应用。原始失败、输入指纹和混合修改 before 暂留于 `.local/connection-command-failures-20261126/`；完整环境检查通过且本次 APK 验收后再清理不再需要的临时材料。

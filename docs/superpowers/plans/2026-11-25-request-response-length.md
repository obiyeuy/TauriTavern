# 请求级生成长度 Implementation Plan

> 使用 `superpowers:executing-plans` 顺序实施，按 `maintain-conceptual-integrity` 迁移全部预算读取入口。用户已授权日常修复，无例行方案确认；不暂存、提交、推送或创建 PR。

**Goal:** 修复并发临时生成的长度串扰，保护用户设置和退出保存。

**Architecture:** 请求选项持有 `responseLength`，CC 的设置副本和 TC 的参数构造消费它。宏通过调用级 `system` 和 evaluator 使用同一预算，live 变量继续走原接口；删除全局覆盖与保存补偿。

**Tech Stack:** JavaScript、现有宏 builder/PromptManager、Node Browser Runtime、现有前端和 Android 构建入口。

**Spec:** `docs/superpowers/specs/2026-11-25-request-response-length.md`

## Global Constraints

- 延续 `feature/mobile-chat-shell`，保护所有已有修改；暂存区为空。
- 默认、位置参数、live/context 宏差异及生成事件契约保持。
- Additional Parameters 和 settings-ready 的最终覆盖权保持。
- 重型检查顺序执行，Android 环境沿用 `.local/android-build/env.sh`，`CARGO_BUILD_JOBS=2`。
- 临时诊断与本轮差异基线集中在 `.local/response-budget-20261125/`，验证和交付后清理。

## Review Focus

- 两次 raw 生成交错：HTTP 长度分别 32/64，偏好始终 65535。
- 提示词准备期间保存：flush 完成并持久化用户偏好，无被遗弃的等待。
- quiet/raw、CC/TC：请求长度和宏预算一致，prompt 按当前请求裁剪。
- 取消、请求失败及用户改设置：不恢复旧值，正常错误仍传播；保留事件监听器的原有错误语义。
- 新旧宏引擎、嵌套角色字段、世界书、stop/prefill/模板：live 变量副作用和显式上下文分离保持。

## Task 1: 完整迁移请求预算

**Files:** `src/script.js`、`src/scripts/openai.js`、`src/scripts/PromptManager.js`、`src/scripts/macros/engine/MacroEnvBuilder.js` 及类型、`src/scripts/macros/macro-system.js`、`src/scripts/instruct-mode.js`、`src/scripts/power-user.js`、`src/scripts/group-chats.js`、`src/scripts/world-info.js`、`src/scripts/cfg-scale.js`、各 TC 参数构造；`tests/browser/generation-response-length.test.mjs` 和已有 `agent-macro-capture`。

**Interfaces:** 现有 raw/quiet `responseLength` 进入 `GenerateOptions`/`AdditionalRequestOptions`；`MacroEnvRawContext.system?: Partial<MacroEnvSystem>`；辅助函数可选 `substitute` 使用现有 `substituteParams(text, options)` 签名。PromptManager 的 `preparePrompt`/`getPromptCollection` 接受调用级 evaluator，旧调用不变。

- [x] 写生产流程回归：32/64 交错、保存 flush、quiet 裁剪、CC/TC 宏一致、取消和偏好更新，断言上面列出的可观察结果；请求失败复用已有 API/生命周期覆盖。
- [x] 运行 `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit tests/browser/generation-response-length.test.mjs`，确认因旧全局覆盖而失败。
- [x] 在请求入口解析一次有效长度，传至上下文预算、参数、递归和群聊调用；接入调用级宏环境及所有实际辅助函数。
- [x] 删除全局临时长度、恢复 hook/Promise 和设置等待/重试；核对引用和事件契约。
- [x] 同一回归由红转绿，复跑宏、Agent、API、世界书及生命周期的现有行为覆盖。

## Task 2: 自审、检查和交付

**Files:** `docs/FrontendGuide.md`、`docs/API/Macros.md`、登记的内置文档镜像、本计划及 `output/` 交付记录。

- [x] 更新预算归属与宏说明、登记镜像，逐路径审查职责、状态、错误及调用者；按 review skill 完成独立只读审阅。
- [x] 执行 `pnpm run check`，定位实际失败；若仍是 actool，完成被短路的 UI/Rust/Clippy 并如实记录。
- [x] 在有新交付需要时生成同签名正式 APK，核对版本、输入、发布标志、签名和 16 KiB 对齐；设备缺失不声称安装。
- [x] 清理已失去用途的本轮临时材料，更新候选清单并推进下一项。

## 候选清单

| 优先级 | 候选与证据 | 影响及验证 |
| --- | --- | --- |
| P0 已交付源码与包 | 临时生成长度并发串扰；32/64 交换及偏好污染已修复 | 19 项 focused、122 项浏览器通过；正式包已核验，待真机安装 |
| P1 已复现、下一项 | `getExtensionPrompt()` 用异步谓词调用 `Array.filter()`；同步/异步 false 仍被组装，CC 已知名字忽略 filter | 统一条件扩展提示词规则；保留求值时机、宏副作用与拒绝传播 |
| P1 待设备 | 手机冷启动、图片/API/MVU 重开及最新 IME 包验收 | ADB 当前无设备；按相同数据、设备和扩展测量 |
| P2 待测量 | 聊天注入每次扫描 0..10000 深度、每深度三个角色，即使没有提示词 | 用生产组装流程测量；保留实际深度、动态条件、顺序及公开上限契约 |
| P2 待外部证据 | 公益服务维护状态 | 历史 404 已修复协议，后续 503 为服务响应；不猜当前状态 |

## 执行记录

- 开始：原有 104 个未提交路径和空暂存区已核对；本轮生产代码尚未修改。生产探针记录交错请求和偏好污染。
- 红证据：六个行为和外层组均失败。CC/TC 的 32/64 请求交换；flush 在 prompt gate 中仍等待；raw 宏读到 65535/62465；取消把新 1024 偏好恢复成 65535；quiet/raw 交错发送 32/64，预期为 64/32。
- Ruling：请求开始时读取默认长度，后续调用级预算不随 UI 变动；最终 settings-ready 和 Additional Parameters 的显式覆盖权保留。这样同次提示词、宏、参数和工具后续轮次一致。
- 迁移检查发现 Agent 的空 prompt 标记进入严格 context 求值，已有 `agent-macro-capture` 实际失败。空标记在拥有 prompt 规则的 `PromptManager.preparePrompt()` 中按原有空字符串语义准备；没有放宽独立宏求值的输入校验。
- TC quiet 验证最初误用了 Kobold 的 `results[].text` 响应 fixture，已按现有 Text Completion 的 `choices[].text` 契约修正；未将测试数据形状错误作为产品缺陷。
- 独立审阅发现 Agent capture 在 provider 之后改写 system。真实 SDK `generateOptions.responseLength: 32` 与用户偏好 1024 的用例复现 `{{maxResponse}}/{{budgetSeenFromProvider}}` 为 `32/1024`。捕获入口复用同一个 `system` 输入，在运行 provider 前准备请求事实，删除 capture 后的 system 覆盖；没有重跑 provider 或修补其数据。
- 输出清洗的实际回归复现：请求 stop 为 `stop:32`，`generateRaw()` 留下 `Answerstop:32`；quiet 回复前缀为 `bias:480`，请求预算是 32。现有 `cleanUpMessage`、StreamingProcessor 和多回复清洗继续消费同一 evaluator，保留原有清洗规则和调用时机。两项修复及 Agent capture/宏环境合计 18/18 focused 通过。
- 空 raw 输出的 Minor 已复现：合法空响应仍报 `No message generated`，但提前准备 stop 让 `incvar` 从一次变成两次。API 作为现有清洗入口的输入，stop 在原有空值检查之后按请求 API/evaluator 求值；同一用例由 `stopReads=2` 转为 1，预算/Agent/宏环境合计 19/19 通过。
- 首次完整检查：静态/类型/Lint/边界和浏览器 120/120 通过，契约 458/459，唯一缺 `actool`。被短路的 UI、Rust 和 Clippy 已运行成功；审阅补齐两个预算边界后，继续执行最终完整检查。未改动或跳过环境失败测试。
- 审阅中保留的边界：扩展直接访问全局设置仍读取用户偏好；live 变量继续共享当前存储；最终显式 provider/Additional Parameters/settings-ready 覆盖仍成立。全模型/context 设置的事务快照需要独立使用证据，本轮不扩建。
- 最终独立审阅无未解决的 Critical、Important 或 Minor，结论 `Coherent. Ship.`，`net: -9 paths`。空输出修正后最终完整检查的浏览器为 122/122，契约仍只有缺少 `actool` 的环境失败；补跑 UI 191/191、Rust 1270 passed / 0 failed / 1 ignored 与 workspace Clippy 通过。
- 正式包 `output/TauriTavern-personal-2.4.0-response-budget-fix.apk` 已生成：SHA-256 `36952966114d1511aed100bd08c4c2879a3a7ea5cdd40f390bc74c85b47e305d`。88 个修改构建输入、97 个总输入的内容、模式、删除状态及 Git 基线在构建期间一致；主库与本次 Rust 输出一致。个人版证书、v2/v3、发布标志、AArch64、最低 API 26/目标 API 36、ZIP 和三个 ELF 的 16 KiB 对齐均已核验。
- ADB 再查无设备，未安装新包，未进行真机冷启动或当前真实服务验证。正式交付记录见 `output/apk-response-budget-fix-delivery.md`；本目标继续推进条件扩展提示词问题。
- 已核对并清理本轮 48 个诊断文件、10 个目录及原始重复 release APK；正式包、旧交付包、构建/签名环境和归属其他任务的 debug APK 保留。最终 diff、红绿证据、构建输入与验收日志集中保存于 `output/verification/response-budget-20261125/`，用于维护者核对修复和 `actool` 环境失败；临时源码回退副本不再保留。清理后正式包 SHA 仍一致。

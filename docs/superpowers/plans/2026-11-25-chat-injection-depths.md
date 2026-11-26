# 聊天注入深度性能 Implementation Plan

> 使用 `superpowers:executing-plans` 在当前会话顺序实施，按 `maintain-conceptual-integrity` 共享实际遍历规则。用户已授权日常性能优化，无例行审批；不暂存、提交、推送或创建 PR。

**Goal:** 消除没有匹配注入的固定全深度查询，保持实际生成输出与扩展副作用。

**Architecture:** `extension-prompts.js` 拥有 actual-depth iterator；TC 和 CC 的原插入循环提供 source、允许上限及 CC 的额外 PromptManager 深度/已消费 key。iterator 每次恢复从 source 读取候选，条件仍由原共同文本查询执行。

**Tech Stack:** JavaScript、既有 Browser Runtime/宏/PromptManager、现有 Android 构建入口。

**Spec:** `docs/superpowers/specs/2026-11-25-chat-injection-depths.md`

## Global Constraints

- 延续 `feature/mobile-chat-shell`，保护全部已有修改及空暂存区。
- 公开上限仍为 10000，保留角色/排序/continue/marker/evaluator 和输出。
- 不缓存 source、深度、条件或文本；不改 frozen schema。
- 性能测量使用相同输入、三次预热、十二次采样和同一 tokenizer。
- 重型检查顺序执行，Android 使用 `.local/android-build/env.sh`、`CARGO_BUILD_JOBS=2`。
- 本项临时材料位于 `.local/chat-injection-depths-20261125/`，完成后清理。

## Review Focus

- 深度 0 条件在 await 后新增 10000：后续查询必须看到，输出顺序保持。
- `undefined` depth/role：保留 wildcard 和条件副作用，不静默猜 0/SYSTEM。
- 非整数、负数和上限外深度：不执行本来无法匹配的条件。
- CC PromptManager 的实际深度/角色/order 与接管 key：不丢内容或重复注入。
- TC continue 与请求预算：保持现有插入索引、顺序及 evaluator，既有回归和 before/after 输出核对。

## Task 1: 共享动态候选遍历

**Files:** `src/scripts/extension-prompts.js`、`src/script.js`、`src/scripts/openai.js`、现有 `tests/browser/extension-prompts.test.mjs`；基线/after 测量脚本在本项诊断目录。

**Interfaces:** `getExtensionPromptDepths(source, maxDepth, { additionalDepths?: number[], excludeKeys?: ReadonlySet<string> }): Generator<number>`。调用者继续使用 `getExtensionPromptMaxDepth()`，CC 提供有效 PromptManager 深度及已消费 key。

- [x] 完成 before 测量并保存当前源码 hash：CC 四种常见情况 25.68–30.41 ms，TC 34.44/38.34 ms；wildcard 31.04 ms、10001 次条件。
- [x] 在现有行为集合覆盖 future-depth、wildcard 变化、非法深度和实际 TC 动态新增；运行旧实现确认语义基线。Expected：行为通过；性能基线仍为完整固定扫描开销。
- [x] 实现共同 iterator，按数值整数、位置/角色/值和上限选择下一处深度，恢复时重读 source；TC/CC 全部接入，清理旧固定 for 循环及误导性的未使用计算注释。
- [x] focused 与现有生成/宏/Agent/Session 回归通过。Expected：0 行为失败、无未处理异步错误。
- [x] 用同一 benchmark 再测，逐项比较消息/提示词 hash、条件次数及环境；提供中位数/P90。Expected：常见情况明显减少本地准备时间，所有输出和 wildcard 次数相同。

## Task 2: 自审、验证与正式包

**Files:** `docs/FrontendGuide.md`、`docs/FrontendHostContract.md`、登记镜像、本计划、`output/` 资料和个人 APK。

- [x] 文档写清允许上限与实际候选、动态/wildcard、marker 归属；通过 `pnpm run skills:tt-docs` 同步。
- [x] 逐路径自审并进行一次独立只读审阅，完成必要修正；执行 `pnpm run check`，若仍缺 `actool`，补跑 UI/Rust/Clippy并记录。
- [x] 构建同时包含本项和条件修复的同签名个人 APK，核对输入、版本、发布标志、签名、ZIP/ELF 16 KiB 和资源；ADB 无设备不声称安装。
- [x] 保存必要测量/验收证据并清理本项临时材料，更新前项 APK 交付状态和剩余候选。

## 候选清单

| 优先级 | 证据/状态 | 验证 |
| --- | --- | --- |
| P2 已交付、待设备 | 固定扫描的共同遍历已完成，输出及动态边界一致，常见本地准备减少 20–32 ms | 同条件测量、行为验证、自审、独立审阅及正式 APK 核验已完成；等待真机 |
| P1 待设备 | 条件修复已进入新包；API/图片/MVU/IME 和冷启动仍待真机 | 同签名包已核验，ADB 无设备；同设备/数据/扩展复查 |
| P2 后续已交付、待设备 | 自定义地址预览与后端拒绝规则一致，正常编码路径保持；无效地址日志不再包含误填原文 | 后续源码、行为检查、自审、独立审阅及同签名 APK 核验完成，详见地址预览计划 |
| P2 社区调查完成、待真实 endpoint | 公益服务当前稳定性 | 2026-11-25 站长表示修正统计并调整额度，用户仍有不同反馈；历史 404 协议已修复，不保证当下服务已恢复 |

## 执行记录

- 本项开始时，前项条件修复完整行为/静态/Rust 检查已通过，唯一全量环境失败是 `actool`。准确 diff 与验证资料已保存并清理前项临时基线。
- 性能工作用生产 Browser Runtime，CC 为独立组装、TC 为实际 Generate dry-run；未访问真实 API、凭据或业务数据。两个路径的准备时间均已测量，未把结果解释为 Android 冷启动或 API 首 token 时间。
- 新增的三项非平凡边界在旧实现中确认通过；原固定扫描的性能问题由测量提供证据，没有增加计时阈值或内部扫描次数测试。共同 iterator 后完整 focused 32/32 通过。
- 初版 after 的七组消息/提示词 SHA、条件次数与输入条件均一致；CC 常见情况 5.41–5.89 ms，TC 6.73/6.87 ms。wildcard 的 10001 次条件保持，但初版额外分配使其中位数从 31.04 增至 38.02 ms，因此继续减少候选枚举分配，并在找到最小可能的下一深度后停止无用读取。该规则同时适用于所有候选，不增加 wildcard 专用平行路径或缓存。
- 枚举整理后的行为集合 13/13 通过，继续使用相同七组数据测量最终 after。
- 最终同条件对照：七组输出 SHA、消息数/提示词长度和条件次数全部一致。CC 无注入 25.97→5.84 ms、相对提示词 28.84→5.49、稀疏深度 30.41→5.81、仅 PromptManager 25.68→5.49；TC 无注入 34.44→7.59、稀疏深度 38.34→6.72。原始十二次采样和 P90 保存在 `output/verification/chat-injection-depths-20261125/` 的 `comparison-final.json`、`before-final.json`、`after-reviewed.json`。
- Ruling：wildcard 继续执行 10001 次条件，中位数为 31.04→37.28 ms，额外 6.24 ms 已明确记录，不将全部场景宣称提速。保留一个动态遍历机制，不为此增加条件缓存或另一条专用遍历。简化游标的独立元数据探针只显示约 1 ms 的局部差异，未提供足以替换当前完整流程的额外收益证据；不继续扩大结构。常见场景减少 20–32 ms 本地准备，尚无同条件真机冷启动或网络响应测量。
- 最终完整 `pnpm run check`：Browser 135/135；契约 458/459，唯一失败为本机缺少 Xcode `actool`。检查未修改或跳过；被短路的 UI 191/191、Rust 1270 通过/0 失败/1 忽略、Clippy 分别补跑通过。补跑 UI 的首次调用使用了宿主的受签名限制 Node，无法加载 Rspack 原生依赖；切回项目已配置的 Node v24.22.3 后通过，没有修改依赖或系统签名策略。
- 一次独立只读审阅核对六个基线哈希、最终生产源码和测量输入；6 个明确场景及 80 个确定性动态变更场景的输出与条件顺序均和旧实现一致。Critical/Important/Minor 均无，无待裁决项；没有重复完整 harness 或整组 benchmark。
- 逐路径自审：候选和文本查询使用相同的位置、角色、值与深度语义；条件仍在实际查询执行，动态 source 每个深度后重读。CC 的已准备 ABSOLUTE 深度和接管 key 同时传到候选与文本查询，ATTACH 保持原入口；TC 的 continue、索引、角色顺序及请求 evaluator 保持。两处固定扫描规则收敛为一处共同 generator，无额外状态、缓存或补偿路径：`net: -1 paths`。
- 正式包 `output/TauriTavern-personal-2.4.0-prompt-fix.apk` 已构建核验，包含本项、条件修复及此前请求预算/保存/图片/MVU/输入法改动。90 个修改构建输入、99 个总输入在构建前后完全一致；应用 ID、2.4.0/2004000、原个人版证书、v2/v3、发布标志、ZIP/三个 ELF 的 16 KiB 对齐及登记文档均通过。SHA-256 为 `268dd96ccb9a484f0ee6280a2181fc6cb62d5c65ce93bba1830dc3ba8446c534`。构建后 ADB 仍无设备，新包未安装，手机仍是旧 404 修复版。
- 已核对清理本项 43 个临时文件、7 个目录及原始重复 release APK，正式包清理后 SHA 一致。验收日志、输入哈希、准确 diff、采样和审阅结论保存在 `output/verification/chat-injection-depths-20261125/`，没有临时源码回退副本。测量脚本保留用于审计；重跑 before 需恢复对应输入哈希版本，基线源码副本已清理。两份已有构建核验 helper 移交到下一项专用诊断目录，随下一项完成后清理。

# 条件扩展提示词 Implementation Plan

> 使用 `superpowers:executing-plans` 在当前会话顺序实施，按 `maintain-conceptual-integrity` 完整迁移实际消费者。用户已授权日常修复，无例行方案确认；不暂存、提交、推送或创建 PR。

**Goal:** 修复条件返回 false 仍被注入及不同入口条件语义分裂。

**Architecture:** `extension-prompts.js` 拥有 async 条件和分组文本查询，公开 script 查询、CC 及 frozen capture 消费同一规则。CC 相对提示词准备保留已知名字映射，并让深度提示词只在其实际阶段求值。

**Tech Stack:** JavaScript、既有 PromptManager/宏、Node Browser Runtime、现有前端和 Android 构建入口。

**Spec:** `docs/superpowers/specs/2026-11-25-extension-prompt-conditions.md`

## Global Constraints

- 延续 `feature/mobile-chat-shell`，保护全部已有修改；暂存区为空。
- 保持公开查询签名、字段格式、事件 payload、深度上限、outlet 同步和请求级预算。
- 条件在实际使用阶段执行；不预计算或缓存结果。
- 重型检查顺序执行，沿用 `.local/android-build/env.sh` 和 `CARGO_BUILD_JOBS=2`。
- 诊断材料集中在 `.local/extension-prompt-conditions-20261125/`，完成验证和交付后清理。

## Review Focus

- 匹配条件同步/异步 false：结果均不包含对应文本，也不求值其写宏。
- 主提示词写变量后才允许的 IN_CHAT：同样适用于已知与自定义名字，不提前或重复执行条件。
- 条件在原提示词对象上修改 value：组装/按名/frozen capture 使用完成后的值和 receiver。
- 条件拒绝：直接查询和普通 CC 停止，原错误到达调用者，不返回可发送的部分消息。
- 请求 evaluator 与同步 outlet：预算宏走请求事实；outlet 不变成异步条件入口。

## Task 1: 统一条件查询和实际消费者

**Files:** `src/scripts/extension-prompts.js`、`src/script.js`、`src/scripts/openai.js`、`src/scripts/tauritavern/agent/frozen-run-input-snapshot.js`；新增 `tests/browser/extension-prompts.test.mjs`，复用 `agent-macro-capture`、`agent-session`、`additional-parameters`、`generation-response-length`。

**Interfaces:** `isExtensionPromptEnabled(prompt): Promise<boolean>`；`getExtensionPromptText(source, { position = IN_PROMPT, depth, role, separator = '\n', wrap = true, substitute, excludeKeys? }): Promise<string>`。`substitute(text)` 由现有入口提供；script 公开查询签名保持。CC 准备返回 `prompts` 和本次已由 PromptManager 消费的 key 集合，深度查询排除这些 key。

- [x] 写生产行为失败：同步/异步 false 被排除，排序/包装和 32 的请求预算保持；CC 已知与自定义相对提示词一致；IN_CHAT 在主宏后执行一次条件；普通 CC 条件拒绝向调用者传播。按名/frozen receiver 与值修改、outlet 同步边界作为同一流程的必要覆盖。
- [x] 运行 `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit tests/browser/extension-prompts.test.mjs`，观察旧代码的实际失败。Expected：分组包含隐藏文本、CC 已知名字包含隐藏文本或条件拒绝被吞。
- [x] 实现共同条件和分组文本查询；公开 getter 与 CC 直接接入，请求 evaluator 保持。CC 使用同一相对添加规则和既有已知映射。
- [x] frozen capture 复用条件，保留原捕获顺序和转换；删除无消费者的 `getAllExtensionPrompts()` 与 CC 重复查询；未知 CC 组装错误直接传播。
- [x] focused 由红转绿，并运行上述既有 Agent/宏/请求长度覆盖。Expected：0 个行为失败、无异步遗留错误。

## Task 2: 自审、验证与交付

**Files:** `docs/FrontendGuide.md`、`docs/FrontendHostContract.md`、登记文档镜像、本计划及 `output/` 交付资料。

- [x] 更新条件与时机说明，通过 `pnpm run skills:tt-docs` 同步登记镜像；逐路径核对职责、状态、错误和引用，进行一次独立只读审阅。
- [x] 执行 `pnpm run check`。Expected：全部产品检查通过；若仍缺 `actool`，如实记录并完成被短路的 UI/Rust/Clippy。
- [x] 按交付需要生成同签名正式 APK，核对版本、构建输入、发布标志、签名与 ZIP/ELF 16 KiB 对齐；无设备时标注未安装。
- [x] 清理本项临时材料，保存必要验收证据；更新候选清单并推进下一项。

## 候选清单

| 优先级 | 问题与证据 | 验证 |
| --- | --- | --- |
| P1 当前 | 同步/异步 false 仍被分组注入，CC 已知名字跳过条件 | 生产 getter、CC/Agent 组装与拒绝传播 |
| P1 待设备 | 最新个人 APK 的 API/图片/MVU 重开、输入法和冷启动 | ADB 无设备；同设备、同数据、同扩展验证 |
| P2 待测量 | 无提示词仍扫描 10001 个深度、每深度三个角色 | 在相同生产组装条件下测量，保留动态查询和顺序 |
| P2 待外部状态 | 公益服务维护 | 历史 404 协议已修复；503 是服务响应，当前状态未确认 |

## 执行记录

- 开始：上一项请求长度 APK 已核验交付，117 个未提交路径和空暂存区保留；本项生产代码尚未修改。
- 方案取舍：在现有语义拥有者统一谓词和文本查询；不增加条件缓存。已知 CC 的深度内容不在相对阶段准备未使用副本，保证真实条件只在主提示词宏之后运行。
- 已确认红证据：分组文本为 `|HIDDEN ASYNC|HIDDEN SYNC|FIRST 32|LAST 32|`；五种已知名字的隐藏文本进入普通 CC；已知深度宏执行两次，预期一次；普通 CC 吞掉条件拒绝。首次测试还暴露了 VM 数组的比较方式和宏清理 API 使用错误，修正测试工具用法后再次确认上述四个产品失败。
- 共同查询、相对添加与 frozen 谓词迁移后，原集合 8/8 通过；正常已知插入顺序和固定角色、receiver/value 修改及同步 outlet 均保持。继续核对已有 Agent/宏/请求预算覆盖和直接拒绝/wildcard 边界。
- 初版完整检查：浏览器 130/130，契约 458/459（唯一缺 `actool`）；补跑 UI 191/191、Rust 1270 passed / 0 failed / 1 ignored 和 Clippy 通过。
- 独立审阅发现两个 Important：真实 Generate 先查询 TC anchors，再运行 CC 相对条件，出现 `BASE.X.X`；直接跳过已知 IN_CHAT 则丢失有效 ABSOLUTE/ATTACH marker 与实际内容的关联。生产回归独立确认：条件各执行两次；marker 输出 `user PLACEHOLDER` 和原始 `system MEMORY 32`，预期是有效位置中的实际内容。
- Ruling：同名 marker 的角色/深度/附加覆盖定义一个有效消费位置，源码中的重复原始深度路径予以删除。若有人依赖旧重复输出，应使用两个独立提示词明确表达两处插入；本项保留参数覆盖能力，不把旧分裂实现固化为契约。
- Ruling：保留 frozen capture 既有的主提示词宏前求值时机；真实聊天深度查询仍在主宏之后。固定全深度扫描继续作为独立待测量项。本轮不扩建条件快照或改变 frozen schema。
- 两项审阅修正的单次修复：TC Story String/anchors 只在 TC 路径准备；已知深度提示词在有效 marker 中按一次条件/宏准备，并把实际归属的 key 传给共同深度查询排除。原 source 继续保留，其他未消费 key 的动态更新没有改为静态快照。
- 新回归 10/10 通过：真实 Generate 相对条件各执行一次；ABSOLUTE 输出 `user MEMORY 32`，ATTACH 输出 `Hello\n\nMEMORY 32`；两种覆盖的 false 都不出现源内容或 PLACEHOLDER，源宏不执行。覆盖在主宏后求值；没有恢复未使用的已知副本，也没有添加条件缓存。独立审阅无 Critical/Minor，两项 Important 已通过上述红绿行为关闭，未重复派发审阅。
- 修正后的完整检查：浏览器 132/132，契约 458/459，唯一环境失败仍缺少 `actool`。短路后的 UI 191/191、Rust 1270 passed / 0 failed / 1 ignored、workspace Clippy 通过。既有 Agent/Session/Additional Parameters/请求预算 focused 19/19 通过，`git diff --check` 通过。没有未解决的产品检查失败；未把完整 harness 描述为全绿。
- 本项已与实际注入深度改进一起进入 `output/TauriTavern-personal-2.4.0-prompt-fix.apk`，签名、资源、输入和 ZIP/ELF 对齐已核验。构建后 ADB 无设备，未安装或真机验收不提前标记完成。包与核验资料见 `output/apk-prompt-fix-delivery.md`。
- 已核对清理本项 29 个临时文件、7 个目录；准确 diff、源码输入哈希、裁决及最终红绿/全量检查证据保存于 `output/verification/extension-prompt-conditions-20261125/`。没有保留临时源码回退副本，没有清理其他任务、业务数据、正式 APK 或构建/签名环境。

# 连接配置修改取消旧查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 连接配置实际修改后，旧状态查询不能发布结果或结束后续加载。

**Architecture:** 继续由 `script.js::cancelStatusCheck()` 拥有唯一取消控制器。连接字段在 OpenAI / Text Completion 原写入处触发取消，现有异步查询守卫继续处理失效，不引入配置镜像或结果补偿。

**Tech Stack:** JavaScript、原生 input/change、AbortController、browser behavior harness、现有 Android 构建入口。

**Spec:** [连接配置修改与状态查询寿命](../specs/2026-11-25-connection-setting-cancellation.md)。

## 约束

- 保留当前分支及所有此前修改，暂存区不变；无提交、推送或 PR。
- 原生控件和配置对象继续拥有值，手机页面派发原有事件。
- 只在实际值变化时取消；不增加无条件自动重连，不修改协议或手填模型。
- 每项行为只在最高层覆盖一次；确定性协调不使用 sleep，保留原 60 秒阈值。
- 不操作另一会话使用的手机；检查环境失败和真机未验证部分分别记录。

## Task 1：完成配置修改的查询失效

**Files:** 修改 `src/scripts/openai.js`、`src/scripts/textgen-settings.js`；新增 `tests/browser/api-connection-changes.test.mjs`；同步 `docs/FrontendGuide.md` 与内置文档镜像。

**Interfaces:** 消费 `cancelStatusCheck(reason)` 及原 `abortStatusCheck.signal`；连接、状态及生成公开签名不变。

- [x] 捕获本轮相关输入与已有差异，写入独立 ledger。
- [x] 以原 Custom 地址输入复现旧结果回填，再覆盖其他实际连接字段的准备阶段、Text Completion 地址、请求头和代理预设路径；运行并记录 RED。
- [x] 在原生写入处接入共同取消入口，收敛 Chat Completion 同类字段写入；让代理重连先取消，删除后的代理选择复用已有应用入口。
- [x] 运行 focused GREEN，核对同值输入、新查询控件、手填模型和请求体参数的原行为。6/6、0 失败、0 取消、0 跳过，无异步活动失败。
- [x] 更新前端文档镜像，运行 `pnpm run check`；补跑被环境失败阻断的受影响后续检查。Browser 155/155、UI 191/191，唯一 check 失败为缺少 Xcode `actool` 的图标契约。
- [x] 逐路径自审并独立只读审阅精确增量，处理有证据的发现；更新候选和交付记录，清理任务专属临时材料。Critical/Important/Minor 均为 0，`net: -2 paths`。
- [x] 使用既有入口构建个人 APK，核对输入、签名、CRC、原生库与对齐，保留未安装状态。119 个总输入和 112 个修改输入一致；原个人签名、v2/v3、CRC、SDK、非调试和 ELF/ZIP 16 KiB 对齐通过。

## Review Focus

1. 密钥准备与网络等待都被当前连接的实际字段修改取消；同值 input/change 和其他 provider/server 的记忆字段不取消新查询。
2. 代理输入、选择、保存和删除后的连接选择遵循同一取消与原重连规则。
3. Text Completion 的实际地址绑定和类型选择仍由各自原生事件拥有。
4. 请求头修改使旧状态查询失效，纯请求体参数修改不改变模型列表检查。
5. 没有额外查询版本、配置镜像、下游同步或未经授权的协议更改；全部异步错误按原查询与界面边界传播。

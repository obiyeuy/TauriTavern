# Text Completion 连接前地址校验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 无效地址不启动连接相关 I/O；有效地址的编辑框、保存值与请求值一致。

**Architecture:** `validateTextGenUrl()` 继续拥有当前 type 的 URL 格式和原生控件，返回布尔结果，并通过原 `input` 入口写入规范化值。原连接按钮在捕获取消信号、准备密钥和网络请求前消费结果，不新建验证器或重复状态。

**Tech Stack:** JavaScript、既有 URL formatter、原生 input、现有 browser runtime 与 fetch interceptor。

**Spec:** [Text Completion 连接前地址校验](../specs/2026-11-25-textgen-url-validation.md)。

## 约束

- 延续当前分支，保护所有此前修改和暂存区，不提交、推送或 PR。
- 沿用 `formatTextGenURL()` 的 URL 和 provider 规则；不添加协议或认证限制。
- 规范化使用原生写入入口，让新的连接从头到尾持有同一取消寿命。
- 当前 APK 构建完成和校验前不改生产输入；新用例位于 `tests/`，不影响 APK 输入。
- 验证仍执行 `pnpm run check`，已知环境失败与未完成手机验收如实记录。

## Task 1：完成连接前校验和保存

**Files:** 修改 `src/scripts/textgen-settings.js`、`docs/FrontendGuide.md` 与内置文档镜像；新增 `tests/browser/textgen-url-validation.test.mjs`。

**Interfaces:** `validateTextGenUrl(): boolean`；URL formatter、状态 DTO、连接按钮及原密钥保存函数签名不变。

- [x] 捕获相关输入和精确增量基线，创建 ledger。
- [x] 原生按钮覆盖无效／空地址不读取或写入密钥、不请求状态、保留草稿，以及准备密钥期间规范化状态一致、固定服务不读无关字段；运行并记录 RED。无效输入仍读两次密钥、写一次且清空草稿；准备阶段显示／保存值尚未规范化。固定服务用例保持通过。
- [x] 前一 APK 校验后，在唯一连接调用者的 I/O 前消费校验结果；规范化通过原生 input 保存，移除原准备后的校验调用。
- [x] 运行 focused GREEN，确认无效草稿、规范化和固定服务行为。4/4、0 失败、0 取消、0 跳过；完整 check 核对原取消与密钥失败路径。
- [x] 同步文档镜像，运行完整 check 及被环境失败阻断的相关后续检查。Browser 159/159、UI 191/191；契约 460 通过、1 因缺少 Xcode `actool` 失败。164 个检查输入未变；Rust 与前次完整验证的输入、模式和 HEAD 一致，沿用已记录结果。
- [x] 逐路径自审和独立只读审阅，更新候选和交付记录；构建校验个人 APK，清理专属临时材料。原签名、CRC、release／SDK、原生库及 ELF／ZIP 16 KiB 对齐通过，119 个构建输入及 112 个修改输入未变。正式包与证据见 `output/apk-textgen-url-validation-fix-delivery.md`；尚未安装。

## Review Focus

1. 无效 URL 的错误只在原按钮呈现，停止本次连接，不提交连接中的密钥草稿。
2. 固定地址 provider 没有本地 URL 输入框，校验成功，继续原连接流程。
3. 规范化使旧检查失效后，新连接再捕获信号；密钥准备的取消规则仍有效。
4. 地址的显示、保存和请求值由同一 input 写入规则拥有，没有直接旁路修改。
5. formatter、独立密钥保存与外部协议/DTO 不变；没有平行验证路径。

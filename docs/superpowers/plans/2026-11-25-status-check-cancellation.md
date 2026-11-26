# API 状态查询取消修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消 API 状态查询后，旧请求不覆盖新状态或提前结束新的加载展示，取消时立即恢复连接控件。

**Architecture:** `script.js` 继续拥有唯一的 `abortStatusCheck` 与控件生命周期。OpenAI、Text Completion、NovelAI 和 Horde 查询捕获并遵循同一取消信号，各自保留响应解释。后续 props、模板派生和订阅读取遵循调用者的查询寿命。

**Tech Stack:** 现有 JavaScript、AbortController、fetch interceptor、Node browser behavior harness。

**Spec:** [API 状态查询的取消与收尾](../specs/2026-11-25-status-check-cancellation.md)。

## 约束

- 延续 `feature/mobile-chat-shell`，保留所有已有未提交和未跟踪修改，暂存区保持原状。
- 用户已授权例行修复直接落实，本轮由主代理 inline 执行；不提交、推送或创建 PR。
- 复用原取消信号与最高层行为覆盖，保留现有 fetch 取消实现和未取消查询语义。
- 手机操作仍等待另一会话；检查失败与未完成的真机验证如实记录。

## Task 1：完成取消生命周期的行为修复

- [x] 保存当前相关输入指纹，核对已有目标文件差异。
- [x] 在 `tests/browser/api-controls.test.mjs` 驱动三个原连接入口与共享取消入口，用真实 fetch interceptor 和确定性 I/O 协调复现旧请求覆盖新状态及延迟恢复控件；运行并记录 RED。
- [x] 在 `src/script.js` 让取消入口立即恢复加载控件。在 `src/scripts/openai.js`、`src/scripts/textgen-settings.js`、`src/scripts/nai-settings.js` 遵循各查询捕获的信号，覆盖后续 props、模板与订阅读取，移除失效的取消判断。
- [x] 运行 focused case，确认 GREEN；核对未取消查询和 Text Completion 派生路径。
- [x] 更新 `docs/FrontendGuide.md` 与内置文档镜像，运行 `pnpm run check`，补跑因已知环境失败未被执行的受影响后续检查。Browser 149/149、UI 191/191；完整 check 唯一失败为本机缺少 Xcode `actool`，未跳过该检查。
- [x] 逐路径自审取消来源、发布时机、错误传播、所有调用者和临时材料；更新候选与交付记录。个人 APK 构建、签名、CRC、原生库及 ZIP 16 KiB 对齐通过，119 个构建输入一致；手机操作仍等待另一会话。

## Review Focus

取消开始于原共享入口；旧查询仅因取消失去发布权限。后续查询的状态与控件不得被旧 catch/finalization 改写。Text Completion 的 props/派生与 NovelAI 的图片额度调用者沿用现有错误与返回语义，不凭未知状态发布成功。

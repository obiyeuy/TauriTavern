# SSE Empty Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 流式生成零 payload 时正确失败并保留 HTTP 诊断。

**Architecture:** 由原 SSE accumulator 记录已分发 payload 的事实，共同 response reader 完成原 flush 后核对；应用层沿原 Result 决定 stream fail。迁移现有 test-only tracing collector 供两个真实行为测试使用。

**Tech Stack:** Rust、reqwest、tokio、tracing，现有 Cargo workspace。

**Spec:** `docs/superpowers/specs/2026-11-26-sse-empty-response.md`

## Global Constraints

- 保留已有修改，不提交、推送或操作手机。
- 不新增生产依赖、DTO、logger facade、整段 response 缓冲或状态镜像。
- 有效 SSE 的原 payload、imprecise content type、EOF 尾事件与取消行为保持。
- 诊断记录 HTTP 元数据，不记录额外 raw response 或 query/userinfo。
- 不扩展各 provider 的 terminal/semantic 校验。

## Review Focus

- 实际 SSE 被标记 application/json 时仍成功；公共生成入口的成功场景覆盖。
- unknown JSON-looking field 和 keepalive 后仍逐段输出；公共入口在受控 EOF 前观察第一条消息。
- EOF 无最后空行仍分发尾 payload；公共入口断行场景覆盖。
- 用户取消发生在 first payload 前时不产生 zero-payload failure；用 gate 和 watch 协调。
- body-read 失败在已有 payload 后仍保留 network failure；截断 HTTP body 场景覆盖 status 与 error code。

### Task 1: 修复共同 SSE 读取成功条件

**Files:**
- Modify: `src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/mod.rs`
- Modify: `src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/response_body.rs`（仅迁移测试 collector）
- Create: `src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/test_support.rs`（test-only collector）
- Modify: `docs/CurrentState/NativeApiFormats.md`
- Modify: `docs/CurrentState/LoggingObservability.md`
- Modify: `default/skills/tt-docs/references/CurrentState/LoggingObservability.md`

**Interfaces:**
- Consumes: 原 `ChatCompletionRepository::generate_stream()`、HTTP Response、SSE `dispatch()` 与取消 receiver。
- Produces: 原接口与 payload 保持；零 payload 正常 EOF 返回 Transient `model.upstream_invalid_response`，HTTP metadata 位于普通诊断。

- [x] Step 1: 移动现有 scoped tracing collector 到 test-only utility，两个 tests 模块共用；在原 adapter tests 增加真实本地 HTTP 入口案例 `sse_generation_rejects_responses_without_payload`、`sse_generation_streams_before_eof_and_preserves_tail`、`sse_generation_cancellation_and_body_failures_keep_their_meaning`。
- [x] Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml -p tt-adapter-provider-http sse_generation -- --nocapture`。Expected: JSON/空/HTML/comment-only 的假成功导致 RED；现有取消／有效 SSE 场景保持。
- [x] Step 3: 在 `SseEventAccumulator::dispatch()` 记录已成功分发 payload；`consume_sse_response()` 捕获 status/content type，累计 body_len，完成原 flush 后核对。零 payload 构造 Transient 并记录普通 warn metadata；body-read warn 增加 status。
- [x] Step 4: Run 同一 focused 命令。Expected: 全部通过，错误与取消场景清楚区分。
- [x] Step 5: Run `cargo test --manifest-path src-tauri/Cargo.toml -p tt-adapter-provider-http`、`node scripts/check-rust-crate-boundaries.mjs`、`pnpm run check:logging-boundaries`。Expected: PASS。
- [x] Step 6: 同步文档后运行 `pnpm run check`，并补齐它未到达的必要 workspace Rust/Clippy。Expected: 所有相关行为通过；现有 actool 环境失败明确记录。
- [x] Step 7: 按精确 before/after 指纹自审，做一次独立增量审阅，归档证据、清理本项临时材料并更新候选。保持未提交。

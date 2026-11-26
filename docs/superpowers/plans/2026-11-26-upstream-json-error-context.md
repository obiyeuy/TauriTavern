# Upstream JSON Error Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留成功 HTTP 中 provider error 的状态与响应诊断。

**Architecture:** 在原 `parse_upstream_json_body()` 的 provider error 分支构造原领域错误后记录现有 tracing 事件。HTTP 与领域错误路径保持，文档源及内置镜像同步。

**Tech Stack:** Rust、reqwest、serde_json、tracing，现有 Cargo workspace。

**Spec:** `docs/superpowers/specs/2026-11-26-upstream-json-error-context.md`

## Global Constraints

- 保留已有修改，延续任务分支，不提交、推送或操作手机。
- 不新增生产依赖、DTO、logger facade、状态或另一套 HTTP 读取路径。
- 不记录完整 JSON、原始 error 对象、请求、凭据或额外响应预览。
- 保持原领域错误、成功响应和前端通知契约；只使用 scoped 测试 subscriber。

## Review Focus

- 所有共同 JSON reader 调用者均获得同一诊断；本项不声称覆盖流式 parser。
- `error: null/false` 与正常 JSON 无失败事件，沿现有 parser 场景验证。
- 上下文超限保持分类，在同一错误测试中核对。
- 诊断不记录 error 对象中的额外字段或 envelope，在同一测试放入敏感标记。
- 普通 warn 不产生用户错误通知，测试事件 level 并审阅默认 target 与原 subscriber 消费者。

### Task 1: 补齐共同 JSON 错误诊断

**Files:**
- Modify/Test: `src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/response_body.rs`
- Modify: `docs/CurrentState/LoggingObservability.md`
- Modify: `default/skills/tt-docs/references/CurrentState/LoggingObservability.md`

**Interfaces:**
- Consumes: 原 `parse_upstream_json_body(&str, &str, StatusCode, &str, &[u8]) -> Result<Value, DomainError>`。
- Produces: 原 Result 保持；provider error 产生普通 warn 事件，字段为 provider、operation、status、content_type、body_len、error。

- [x] Step 1: 在原 tests 模块增加 scoped tracing collector 和 `json_provider_error_preserves_http_diagnostics`，以顶层 error、嵌套 detail/error、context overflow 的字面 fixture 核对单个事件、HTTP 字段、原错误与无敏感标记；正常/null/false 响应核对零失败事件。
- [x] Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml -p tt-adapter-provider-http json_provider_error_preserves_http_diagnostics -- --nocapture`。Expected: FAIL，因为 provider error 没有诊断。
- [x] Step 3: 在原 provider error 分支保存原 `context_overflow_or()` 结果，用现有 `tracing::warn!` 记录已知 HTTP 字段和领域错误，再返回该错误。同步日志文档与镜像。
- [x] Step 4: Run 同一 focused 命令。Expected: PASS，错误分类与成功响应保持。
- [x] Step 5: Run `cargo test --manifest-path src-tauri/Cargo.toml -p tt-adapter-provider-http`、`node scripts/check-rust-crate-boundaries.mjs`、`pnpm run check:logging-boundaries`。Expected: PASS。
- [x] Step 6: Run `pnpm run check`。Expected: 完整运行；如环境检查失败记录具体失败，继续完成它未到达的相关 workspace Rust 与 Clippy 检查，不声称全绿。
- [x] Step 7: 自审全部调用者、增量差异和测试价值，派发一次限定本项增量的独立审阅，归档证据并清理已完成的本项临时目录。保持未提交状态。

# 流式响应没有数据时的失败语义

## 问题与目标

共同 `consume_sse_response()` 在 HTTP body 正常结束后，无条件返回成功；SSE parser 会忽略普通 JSON、HTML、注释和其他非 data 字段。因而这些响应没有任何可供聊天处理的 payload，却可能使普通聊天流被标记 Done。应用层已等待 producer Result，再决定 `finish` 或 `fail`，修复应在拥有 HTTP 与 SSE 事实的 provider adapter。

目标是从实际生成入口复现并修复零 payload 的假成功，提供 HTTP 诊断；不把本项视作请求 69 的真实服务根因或恢复证明。

## 方案与约束

- 延续 `feature/mobile-chat-shell`，保留全部已有修改，不提交、推送或操作手机。
- SSE accumulator 自己记录是否成功分发过非空 payload，完成最后 pending event 后由共同 reader 核对。
- 正常 EOF 且零 payload 返回 `DomainError::Transient`，机器分类保持 `model.upstream_invalid_response`；普通诊断记录 provider、operation、HTTP status、content_type、body_len 与脱敏 endpoint。
- 状态与内容类型来自该 Response；body_len 按已读 chunk 累计。body-read 失败的已有 network 分类保持，并记录已知 status。
- 正常事件、原 payload 字节、最后没有空行的 event、错误 content type 下实际仍为 SSE 的数据，以及用户取消语义保持。
- 不根据 content type 猜测成功，不缓冲完整响应、不重解析为另一种成功格式，也不记录额外的原始响应内容。
- 本项验证的是有效 SSE payload 是否存在；各 provider 的 terminal event 和语义校验仍由其原消费者负责。
- 复用现有测试框架与现有 scoped tracing collector，把共享 collector 移入 test-only utility；不新增生产依赖、DTO、logger facade 或状态镜像。
- 先运行 focused Rust 与边界检查，再完整 `pnpm run check`；环境失败如实记录，未到达的相关 Rust/Clippy 单独完成。手机仍未连接，真机验收保留。

## 取舍与验收

以实际分发的 SSE payload 判断结果，保持当前对 imprecise content type 和 unknown fields 的兼容。Content-Type 硬门控会拒绝已有能读取的数据；把所有 response 收集为 JSON 会损害逐段输出且增加内存开销。当前方案在原 decoder 的源头守住成功条件，错误响应通过现有 Result 与 stream session fail 路径传播。

受控 HTTP 的空 body、JSON error、HTML、comment/event-only 响应均失败、没有输出；诊断包含实际 HTTP 信息且不含 body/query 的敏感标记。有效 SSE 在 EOF 前仍逐段输出，原 raw payload 与尾事件保持。受控取消正常返回；HTTP body 截断仍返回已有 network failure。

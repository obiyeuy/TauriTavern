# 上游 JSON 错误的 HTTP 诊断

## 意图与证据

11/26 真机请求 69 返回 `Invalid data: Custom OpenAI: 上游没有返回任何内容，请重试`，该请求的原生记录没有 HTTP 状态或响应正文。追踪发现 `send_checked()` 已分类非成功 HTTP；随后共同 `parse_upstream_json_body()` 识别成功响应中的 `error` 或 `/detail/error` 时，只返回领域错误，丢失已有的 status、content type 和 body length。本项修复这个已确认的诊断缺口；真机请求 69 的实际 HTTP 状态仍未知。

## 约束与方案

- 延续 `feature/mobile-chat-shell`，保留此前所有修改，未经授权不提交、推送或操作手机。
- 在 `tt-adapter-provider-http` 的共同 JSON 解析边界使用现有 `tracing::warn!` 记录 provider、operation、status、content_type、body_len 与已返回的领域错误。
- 仅在已识别的 provider error 分支记录。正常 JSON、`error: null` 和 `error: false` 继续成功；非 JSON 与 body-read 的现有错误链保持。
- 保持 `context_overflow_or()`、`DomainError`、请求与响应形状、前端通知和重试语义。
- 不额外保存完整 JSON、原始 error 对象、请求、凭据或响应预览。诊断中的 error 复用已经返回给调用者的领域错误，其既有消息选择保持；本项不新增错误内容的解析或脱敏路径。
- 不新增生产依赖、DTO、logger facade、状态或另一套 HTTP 读取路径。
- 扩展现有 parser 行为测试；scoped tracing collector 仅属于测试，不安装全局 subscriber。
- 运行 focused tests、crate 与 logging 边界、完整 `pnpm run check`，以及完整检查未到达的相关 Rust 检查。缺少 Xcode `actool` 时如实记录。

## 取舍

推荐在拥有 HTTP 事实和 provider error 判断的共同 adapter 分支记录。修改 host decorator 需要跨 port 传输 HTTP 细节；扩大领域错误或前端文案会改变更广的消费者。当前任务只需补齐普通诊断，因此沿原读取链路完成即可。本方案为维护者已授权日常优化范围内的实现选择。

## 验收

受控顶层及嵌套 JSON error 均返回原领域错误，并产生带有传入 HTTP 状态、内容类型、长度和 provider/operation 的单个普通诊断。上下文超限保持其分类。诊断不含正文中的无关敏感标记，正常响应不产生失败诊断。源码验收不代表真实接口恢复，也不替代 APK 与手机验收。

# 请求级生成长度

## 已确认的问题

生产 `generateRawData()` 的两次调用分别传入 `responseLength: 32` 和 `64`，在异步 `CHAT_COMPLETION_PROMPT_READY` 中受控交错。最终 HTTP 请求分别使用 64 和 32，用户原本的 `openai_max_tokens: 65535` 最终留下 32。证据来自现有 Browser Runtime 和生产请求构造，只有 HTTP 响应为测试数据。

`TempResponseLength` 只有一份原值和恢复 Promise。第二次调用覆盖第一次的恢复状态；设置保存又依赖这个状态等待或重试。源码已确认存在这条依赖，保存等待被遗弃的具体行为继续用实际流程验证。

## 目标与边界

- `generateRawData()`、`generateRaw()` 和 `generateQuietPrompt()` 的现有 `responseLength` 只影响当前生成，默认值、无效覆盖的处理及位置参数入口保持兼容。
- 临时生成不写 `amount_gen` 或 `oai_settings.openai_max_tokens`，不覆盖调用期间用户的新设置。保存和退出 flush 不等待提示词或网络请求。
- 同次生成的请求长度、提示词裁剪和第一方宏中的 `maxResponse`、`maxPrompt` 及其别名一致。提示词、角色字段、世界书、stop、prefill 和 Additional Parameters 沿同一个求值环境使用该预算；回复清洗与流式 stop 缓存使用同一请求 evaluator，避免按用户默认长度处理本次 stop/偏置。
- live 宏仍读写当前 local/global 变量，provider、嵌套求值和角色字段的原有顺序保持；显式 Agent 上下文继续使用独立变量副本。
- 保留已有生成事件的时机、payload 和扩展对最终请求的修改权。扩展直接读取全局设置时读到用户偏好；不再暴露临时覆盖这一内部实现。
- 不新增偏好、协议或 Rust DTO，不改变 API 路由、持久文件格式和 provider 参数覆盖规则。Additional Parameters 和最终 settings-ready 事件仍拥有现有覆盖权。

## 实现决策

沿既有 `responseLength` 选项传递请求预算。Chat Completion 在有效请求设置副本中覆盖 `openai_max_tokens`；PromptManager 和最终参数准备使用该副本的预算。Text Completion 直接把请求长度交给已有参数构造函数。

宏 builder 接受本次求值的 `system` 数据覆盖，保留 live 变量接口与惰性角色字段。提示词辅助函数复用已有 `substitute` 注入约定；PromptManager 接受调用级 evaluator，不临时修改共享实例。显式上下文继续走现有 context 求值入口。

全部调用者迁移后删除 `TempResponseLength`、恢复事件和恢复 Promise，并删除设置保存中专为临时覆盖而存在的等待、重试及强制恢复。

## 验证

使用真实生产 Browser Runtime，在 Promise gate 中交错 raw/quiet 和 CC/TC 请求，检查最终 HTTP 参数、live 设置、宏变量及保存的设置文档。取消和请求失败不能写回旧偏好；事件监听器的原有错误语义保持。复用宏、Agent snapshot、API、世界书、生命周期和正常聊天的现有覆盖。

每轮运行 `pnpm run check`。当前完整检查存在已知的本机 Xcode `actool` 缺失，必须报告原始失败并完成被短路的后续 UI、Rust 和 Clippy，不能绕过测试。

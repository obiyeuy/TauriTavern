# 密钥值读取失败的错误语义

目标：密钥管理的复制按钮应呈现实际读取或剪贴板失败，不把失败解释成密钥未保存或曝光被关闭。用户已授权本目标内的日常修复与完整验证。

证据：原按钮接收 `/api/secrets/find` 的 HTTP 500 后显示“key exposure is disabled”；读取前后的 active 密钥元数据与剪贴板均保留。完整复现见 `output/verification/secret-value-read-20261126/probe.json`。

当前链路：`SecretService::find_secret` 区分 PermissionDenied、NotFound 与仓储失败。宿主将权限拒绝映射为 HTTP 401；上游兼容的曝光拒绝使用 HTTP 403。前端 `findSecret` 将所有失败吞为 null，复制与脚本入口因此丢失原因。

方案：复用 `secrets.js::requestSecret` 的请求和错误边界。`find` 的权限拒绝是明确的 nullable 查询结果；其余 HTTP、传输、JSON 与值形状错误拒绝 Promise。成功值仍为字符串，权限拒绝仍为 null。读取不得标记密钥文档需要刷新。复制按钮接管读取与剪贴板失败；`/secret-read` 及 aliases 保留失败返回空字符串和 quiet 抑制通知的行为。

取舍：只改按钮会让脚本继续吞错；新增结果类型或第二套请求客户端会增加调用者概念。选择在已有请求边界保留这一查询的真实差异，并迁移两个实际消费者。

边界：

- 不改 Rust 权限、保存、字段、路由、DTO、密钥曝光设置或文件布局。
- 不读取用户明文密钥，不写实际剪贴板，不发送模型请求。
- 不刷新、删除或覆盖原 active 密钥元数据；失败不显示复制成功。
- 成功响应必须包含字符串 `value`，包括已有上游可能返回的空字符串；不把未知形状猜成值。
- 保留 HTTP 401/403 对曝光拒绝的 null 返回，404 与仓储失败交给调用者。
- `/secret-read`、`/secret-find`、`/secret-get` 的 quiet 和管道返回行为保持。
- 不提交、推送或清理既有无关修改；现有任务分支和工具链继续使用。

验证：扩展现有 `tests/browser/api-controls.test.mjs`，从实际密钥管理按钮与公开 slash 执行器观察错误、剪贴板与返回值。HTTP、传输与 JSON 失败使用确定性的边界 fixture，真实翻译、模板、控件和调用链保持。运行 focused tests、完整 `pnpm run check`，记录本机 `actool` 环境失败；检查未覆盖到的 UI 单独执行。完成逐入口自审和独立审阅后更新候选，清理本任务临时材料。

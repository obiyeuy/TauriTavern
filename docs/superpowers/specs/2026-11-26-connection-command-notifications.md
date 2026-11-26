# 连接字段失败提示的归属

Android 宿主中的原生选择与原 slash callbacks 已复现：配置保存了无效 Custom／OpenCode 协议时，原格式命令先报错，应用入口再报一次；找不到代理或分词器时，原命令先 warning，应用入口再 error。四项都正确停止后续密钥写入、连接与加载成功事件，问题是已有 managed command 的 `quiet=true` 没有在这些失败生产者落实。

沿原命令边界响应已有内部 named arguments 的 quiet；原生配置发起者继续拥有单条失败提示。格式的两个验证分支、代理与分词器的未命中分支使用现有 `isTrueBoolean()`，不修改匹配、选择、保存、连接或返回值。普通公开命令的默认 error／warning 和失败空字符串、getter、合法 setter 结果保持；不增加公开 named arguments、错误事件、通知过滤器或第二套应用路径。

最高层覆盖四项实际失败：原生应用只提示一次，未发布加载成功或发起连接，原密钥保持；普通公开命令仍提示一次并返回空字符串，合法命令与格式 getter 保持。复用现有 Connection Manager browser fixture，补捕获 warning；不替换业务 callback。

本项是持续目标授权的日常修复，自行 inline 实现，继续当前任务分支，保存本项精确 before 与其他差异指纹，不提交或推送。完成 focused、完整 `pnpm run check`、必要的补充检查、自审和一次精确增量独立审阅；准确记录 actool 环境失败和手机状态。

另已复现不存在的 `/preset` 返回旧名称，导致配置继续切换密钥、连接并发布成功。修正该返回语义会影响公开脚本调用，本项保持该路径，单独提供具体增量与证据，交付时请用户确认；不以 silent fallback 或调用者补偿绕过源头修正。

# Text Completion 连接前地址校验

原生连接流程已复现两处问题：输入 `not-a-url` 后已显示“请输入有效 API 地址”，仍发起一次状态查询；输入 `https://EXAMPLE.test` 后编辑框变为 `https://example.test/`，保存值和实际请求仍使用原值。证据见 `output/verification/connection-setting-cancellation-20261125/textgen-url-validation-probe.log`。

无效地址应由当前连接按钮提示并停止该次连接，保留地址和未提交的密钥草稿。有效地址按既有 `formatTextGenURL()` 规则规范化，编辑框、唯一的 settings 对象和实际请求一致。规范化进入原生 `input` 写入流程；连接在此之后持有本次信号，再准备密钥并读取状态。固定服务地址的 provider 不受其他地址输入框影响。

不修改 URL 格式、协议、请求 DTO、固定 provider 地址或独立密钥保存规则，不增加字段镜像、替代验证器或旁路写入。`validateTextGenUrl()` 保留原导出和 UI 入口，新增布尔校验结果供唯一的原连接调用者消费。

主代理在 `feature/mobile-chat-shell` inline 完成；当前 APK 编译期间先写回归，包校验完成后才改源码，保证前一包构建输入一致。用户已授权日常修复，无需例行方案确认；不操作手机，不提交或发布。

# Horde 密钥提交的取消寿命

已通过原生 Horde 密钥提交按钮复现：密钥读取等待期间切换 API 并启动新查询，旧按钮恢复后仍发送一次 Horde 状态请求，把新状态从 `Status check bypassed` 改成 `Connected`，并结束新查询的加载。证据为 `output/verification/horde-key-preparation-20261125/probe.log`。此前覆盖了 Horde 状态请求本身的取消，却没有覆盖请求之前的密钥准备。

Horde 密钥提交按钮从读取密钥前持有同一 `abortStatusCheck.signal`。密钥读取或写入完成后若已取消，不再进入旧状态查询。已经发起的密钥写入仍按原规则完成；原按钮继续呈现密钥读写失败，避免隐藏用户主动保存的失败。当前提交仍按原规则读取、保存和查询，无效空草稿仍使用原提示。

沿用 `script.js` 的取消信号、`secrets.js` 的保存和错误边界及原 Horde 请求入口。没有新的查询代际、状态快照、包装层、协议或 DTO。前一 Text Completion APK 完成构建输入核验、精确增量归档和校验后才修改生产文件。延续 `feature/mobile-chat-shell`，保护所有既有修改，不提交、不发布、不操作手机。

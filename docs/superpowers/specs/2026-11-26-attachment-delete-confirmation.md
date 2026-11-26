# 附件删除确认与引用清理

实际 `/db-delete` 探针确认：DELETE 返回 500 后，命令正常结束，没有通知；原文件还在，live 和磁盘引用、disabled 却已清空。第二个角色探针确认：启用的 character 附件删除成功后没有安排 settings 保存，磁盘仍引用已删文件。证据在 `output/verification/attachment-delete-result-20261126/`。

在现有功能和契约内修复共同删除链路。`deleteFileFromServer(url, silent): Promise<boolean>` 保持布尔结果，消息文件控件继续消费这个结果；同一个私有删除请求负责 HTTP 检查和原成功事件，Data Bank 删除等待它并传播失败，由已有控件或 slash executor 呈现。删除等待或失败时保留文件引用、disabled 和列表，不返回虚假成功；替换已经确认的新引用保留，原件退役失败仍可重试。消息删除同样在实际删除成功后才移除文件并保存。

引用清理集中在同一个私有函数，维护 global、character、chat 的原状态与保存入口。character 和 disabled 的修改安排原 settings 保存，chat 使用原 metadata debounce。Data Bank 核验明确返回不存在时，只清理已知缺失的引用，不再发 DELETE 404 或伪造文件删除事件；核验读取失败仍停止。没有新的文件事务、状态镜像、补偿保存或 404 成功兜底。

操作在确认和 I/O 前绑定现有来源身份，位置变化时停止新的删除或引用修改，不能把旧控件操作发布到新角色／聊天；已经发生的删除明确报告部分结果。批量按钮等待所选操作，失败由该按钮呈现一次，保留可重试的选择；迁移其异步 `forEach` 调用者，不能在删除还未完成时就刷新。

成功 URL、文件与引用字段、成功事件、原 routes、neutral session/no-op 和正常取消语义保持。用户已授权自主修复，不需要例行确认；不操作手机、真实文件、凭据或 Git 历史。只扩展已有最高层附件测试，验证原件／引用／disabled、持久化、一次原因和事件、命令拒绝、批量完成、位置绑定、已知孤儿及成功重试。完成 focused、`pnpm run check`、自审和审阅；环境失败按实际结果单列。归档精确增量后清理本项临时材料。

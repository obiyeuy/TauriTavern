# Data Bank 启用／禁用状态保存

本地实际 slash executor 已复现：`/db-disable` 改变内存列表后没有 settings 保存，读回仍是启用状态；`/db-enable` 也没有保存，读回仍是禁用状态。两次原保存队列 flush 均没有保存请求，未见其他错误。界面单条和批量按钮已经经 `chats.js` 的 `enableAttachment()`／`disableAttachment()` 安排原 settings debounce，命令却直接修改同一 `extension_settings.disabled_attachments`。

复用这两个既有操作并把重复操作的 no-op 判断放回操作入口，命令不再自行修改列表。启用移除同 URL 的禁用引用，禁用不产生重复引用；只有状态变化才安排原 settings writer，原界面 callback 和批量刷新保持。命令仍返回空字符串，找不到附件的 warning、source／别名／查找规则保持，不新增同步保存 ACK、事件、缓存或另一份状态。原 lifecycle flush 继续负责退出前保存。

这是当前状态写入路径的日常修复。采用原操作入口，避免为现有两种动作另建布尔 setter 或包装层。用户已授权自主修复并明确免除例行方案确认，继续当前分支，保护其他修改，不提交或操作设备、真实 provider 和业务文件。

复用最高层附件 fixture，实际执行两个命令，等待原保存队列并经原 settings 读取边界核对结果；同状态重复命令不新增引用或保存。必要的原单条／批量按钮流程用本地实际控件核对。完整 `pnpm run check` 如实执行，已知 actool 环境失败继续记录，补未执行的 UI／Rust／Clippy 检查；一次精确五文件独立审阅后归档与清理本项临时材料。实际手机重开验证待设备重连。

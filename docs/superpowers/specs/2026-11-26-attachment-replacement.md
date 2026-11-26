# 附件替换先确认新文件

## 证据与目标

实际 Data Bank 编辑按钮、原 notepad 和上传／删除函数的本地探针确认：用户保存修改时先删原文件和引用，随后上传返回 HTTP 500，原文件与引用均已丢失。moveAttachment 和 /db-update 沿同样的顺序。验证数据与服务均为专用合成 fixture，不接触用户文件。

目标是在已有编辑和移动流程中，上传失败或尚未确认时保留原文件、引用和禁用状态；成功上传后再经原删除流程退役旧附件并刷新界面。授权来自持续优化目标，直接执行日常修复，不提交、推送或操作手机。

## Approaches 与取舍

采用一个前端模块间的 replaceAttachment 提交入口供编辑、移动和 /db-update 共用，先 await 原 uploadFileAttachmentToServer 的路径结果，再调用原 deleteAttachment。顺序本身守住原件，不需要失败回滚或第二份附件状态。分别调整各调用者虽能修复当前案例，但会让同一提交规则重复；删除后回滚无法可靠恢复失败时已丢失的文件，不采用。

## 契约与范围

- replaceAttachment(attachment, source, file, target, callback) 返回 Promise<string | undefined>，供原命令保留上传路径结果；它只承担替换上传确认和旧附件退役顺序，不新增 window API。
- 原公开函数、上传格式、文件路径、metadata／settings 写入入口、取消和无修改退出、成功后的旧文件删除与事件保持。
- 上传没有返回路径时不触发旧文件删除、引用／disabled 修改或成功刷新；原上传层继续呈现一次实际原因。
- 编辑仍写入同一 source；移动仍写入用户选择的 target，成功结果继续默认启用，与原行为一致。
- 原文件读取失败、旧文件退役失败、metadata 跨进程或断电持久化不由这次排序修复声称解决，后续按具体证据单独处理。
- 不新增依赖、原生 command、DTO、事务回退、配置开关、队列或状态镜像。

## 验证与自审

使用现有 Browser Runtime、真实委托按钮、原 Popup 和合成文件服务，通过 channel 持有替换上传；在确认前以及 HTTP／传输失败后检查原件、引用、disabled 与删除事件。成功时检查上传在删除之前、替换内容、目标 bucket 和一次旧文件删除。界面不请求手机或真实服务。扩展现有验证入口，不测试源码文本或字面量。

源头职责、自审和一次独立精确增量审阅与现有 workflow 一致。运行 focused Browser 和完整 pnpm run check；actool 环境失败仍如实保留。验证记录、指纹和增量归档后清理专用临时材料。

# 聊天文件读写一致性

**目标：** 同一 JSONL 经旧目录别名、角色查询或全库查询读取时，提交后的 metadata 和消息保持一致；原生追加消息始终修改调用者选择的文件，并在并发追加时保留全部消息。沿用现有完整历史和错误契约。

**分支与边界：** 延续 `feature/mobile-chat-shell`，保护已有修改，不提交或推送。具体 IO 与格式仍归 `tt-adapter-storage-core`；前端 canonical `chat[]`、FileHandle transport、JSONL 格式、原子发布、备份策略和公开响应形状保持既有契约。

**已复现的证据：**

- 物理目录 `Alice` 经全库 typed 查询缓存后，逻辑角色 `Alice#1` 通过旧目录别名提交 metadata。磁盘返回 `after`，typed 全库查询仍返回 `before`。同一行为测试继续核对完整 payload 提交后的消息。
- 请求向 `Alice/session` 追加消息，但 header 显示名是 `Display Alice` 时，旧实现从 typed `Chat` 的显示名重新选择写入目录。API 返回成功，所选文件仍只有 header 和原消息两条记录。
- 两个追加任务通过 Barrier 同时开始，旧实现只在发布时加锁。最终文件只有一条新增消息，另一条被后发布的旧快照覆盖。

- [x] 通过现有 storage-core 仓储 harness 复现上述三个具体缺陷，确认修改前失败和修改后通过；fixture 在断言前完成清理。
- [x] 沿用已有 `read_chat_file()` 与 JSONL reader，完整迁移 typed 读取和写入者；删除完整聊天缓存、逻辑键失效／改名维护与无效 helper，不增加别名特判或新的缓存协调层。
- [x] 原生追加消息先解析调用者选择的物理文件，在路径 mutation lock 内读取、追加并原子发布；只补齐缺省 header 字段，保留原有 header 和消息中的未知 JSON 字段。
- [x] 检查 typed 查询的实际消费者及重复读取成本；手机主聊天 FileHandle transport 已绕过被删除的缓存，本轮不改变它的数据与加载契约。记录 host 上的读取成本，不推断手机提速百分比。
- [x] 扩展最高层现有行为覆盖，运行受影响 crate focused tests、Rust 边界检查和 `pnpm run check`；已知 Xcode `actool` 缺失如实记录，执行被短路的后续 Rust／UI 检查。
- [x] 逐路径自审并独立审阅；更新 ChatPayload 规范文档。该文件不在 `scripts/builtin-skills/build-tt-docs.mjs` 的内置技能清单中，不创建未登记镜像。
- [x] 生成同签名正式 APK，核对源码、签名、版本、非调试和 16 KiB 对齐；手机未连接时不声称已安装。
- [x] 汇总证据并清理本轮专用诊断材料，保留正式包和有用记录。

## 验证与成本

- 最新 focused 验证：`tt-adapter-storage-core --no-default-features`，120 passed / 0 failed；Rust crate 边界检查 clean。
- 完整 `pnpm run check`：平台、前端约束、类型、Lint、日志和 Rust 边界检查通过；浏览器 108 passed / 0 failed，契约 458 passed / 1 failed。唯一失败仍是本机缺少 Xcode `actool` 的 macOS 图标编译测试；未绕过或修改测试。
- 单独补跑因此被短路的检查：UI 190 passed / 0 failed，Rust 全库 1270 passed / 0 failed / 1 ignored，workspace Clippy 通过且 Rust 编译无告警。
- 独立只读审阅：Critical / Important / Minor 均无，`Coherent. Ship.`。核对旧目录全部 typed 读取、请求物理路径、空文件 header、不变量、同路径锁、完整保存 integrity／force、应用层备份通知和文档。跨进程写入与完整快照的替换语义仍是明确的既有边界。
- 新增行为覆盖仅三项：旧目录别名提交后读到最新 metadata／消息，追加保留所选文件与原始 header，并发追加保留全部消息。
- 临时读取探针已从源码移除。host test profile，10 个文件、每个 128 条消息、每条正文 4096 字符，实际单文件 535928 字节：10 个不同文件读取 61.713042 ms，单文件重复读取 20 次 90.480292 ms，全库 10 文件查询 46.185333 ms。这是修改后读取成本，未采集同条件修改前基线，不能作为移动端提速或性能变化百分比。
- 本轮临时日志集中在 `.local/chat-read-consistency-20261124/`，18 个已核对的诊断文件及生成包原始重复副本已清理；正式交付包、manifest、前轮包和构建／签名环境保留。
- 正式包：`output/TauriTavern-personal-2.4.0-chat-read-fix.apk`，SHA-256 `e0fbf01daa6d6f864d395eeb123443b65aeaf177e4285213a4e837fcdab0e6a7`。原个人版证书、v2/v3、非调试、无 Pilot 标记与 APK／三个 ELF 的 16 KiB 对齐均核验；构建期间 52 个已修改输入及删除状态保持一致。ADB 无设备，尚未安装。
- 完整交付记录及校验 manifest 位于 `output/apk-chat-read-fix-delivery.md` 和同名 APK 的 `.manifest.json`。

## 候选清单

| 候选 | 证据状态 | 优先级 | 验证方法 |
| --- | --- | --- | --- |
| 聊天文件读取、追加目标与并发追加 | 三项实际仓储行为均已复现并修复；完整检查的环境限制已核对，后续检查通过，正式包已校验 | 本轮完成：聊天数据正确性 | typed 全库读取 → 别名 metadata/payload 提交 → 原始读取对照；显示名不同的追加；Barrier 并发追加 |
| 世界书原子发布未同步写入句柄 | 后续已在 `2026-11-25-world-info-publication.md` 中隔离复现、修复、验证、自审与打包 | 后续轮已完成：发布确认正确性 | 同一原生同步 EIO 故障下，旧实现成功并替换；新实现明确失败且旧文件字节保持 |
| 进一步手机启动／长聊天性能 | ADB 当前无设备；已有单次测量不构成同条件前后基线 | 待测量 | 下次正常连接手机，分开测量首屏、角色、扩展和服务请求 |

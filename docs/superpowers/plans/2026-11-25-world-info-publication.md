# 世界书发布写回确认 Implementation Plan

> 执行方式：在当前分支逐步实现并验证，使用 `superpowers:executing-plans` 的顺序执行与证据记录，以及 `maintain-conceptual-integrity` 的共同机制审查。用户已授权日常修复，无例行方案确认或 Git 提交。

**Goal：** 世界书保存成功前确认原写入句柄的同步结果；写回失败停止发布，保留旧世界书并传播错误。

**Architecture：** 保留 userdata adapter 的单一 `commit::publish()` 入口，复用 storage-core 已有 `persist_file_blocking(File, stage, target)`。文档同步到已登记的内置技能镜像，不新增发布接口、文件布局或补偿路径。

**Tech Stack：** Rust、Tokio blocking pool、既有原子文件发布 helper；macOS 临时 fsync 故障注入仅用于诊断。

**Spec：** `docs/FrontendHostContract.md` §4.3、`docs/CurrentState/CharacterIdentityContract.md` §10，以及 storage-core `file_system.rs` 的同步后原子发布语义。

## 约束与审查

- 延续 `feature/mobile-chat-shell`；保护现有世界书格式修改和其他工作区内容，暂存区保持原状，不提交、推送或操作历史。
- 普通保存、导入和 byte commit 继续共用现有 document／publish 入口；未知字段、格式转换、命名和绑定契约保持一致。
- 必须传入原写入句柄，不能关闭后重开同步；写入、同步或 rename 错误传播，旧目标在发布前保持原状。
- 暂存清理错误只记录告警，不改写发布结果；失败不降级为覆盖复制。
- 同步确认文件数据，不承诺 rename 后父目录项的断电持久化。
- 不为两行共同 helper 迁移增加永久 fault hook、wrapper 或重复层测试；复用既有最高仓储行为覆盖。

## 证据与执行

**源码证据：** `file_world_info_repository/commit.rs::publish()` 写完后 `drop(file)`，仅调用 rename helper；聊天和 JSON 持久化使用的共同 helper 会先对原句柄 `sync_all()`，同步失败时不执行 rename。尚未把真实用户的世界书丢失归因于此。

- [x] 在隔离的现有世界书仓储 harness 中，临时对测试 fixture 的 `.publish` 句柄注入 fsync EIO，确认旧实现是否误报成功及旧目标是否被替换；不访问业务文件。
- [x] 将 `commit::publish()` 的 rename-only 末尾迁移到 `persist_file_blocking()`，保留同一原写入句柄。
- [x] 重跑相同故障，核对错误传播与旧目标字节；删除临时 Rust 探针，核对该文件 SHA 与插入前完全一致。
- [x] 复用现有 CharacterBook 读／导入／commit、格式错误保留旧文件及命名行为测试；运行 userdata focused tests、Rust 边界与 `pnpm run check`，如实处理已知 actool 环境限制。
- [x] 更新规范与内置技能镜像，逐路径自审，并独立只读审阅同步／发布／清理职责。
- [x] 生成同签名正式 APK，核对构建输入、签名、身份、非调试与 16 KiB 对齐；无设备时不声称安装。
- [x] 汇总故障与正常行为证据，清理本轮专用注入库、探针、日志与重复生成包，保留正式交付记录。

临时材料集中在 `.local/world-info-publish-20261125/`；测试 fixture 由既有 `TestDir` 生命周期清理，已记录的原生故障 fixture 确认不存在。交付后，32 个专用诊断文件、3 个空测试目录及原始重复 APK 已清理，五个正式交付 APK 的哈希再次核对；构建／签名环境和交付记录保留。计划兼作简短执行记录，不创建独立提交或并行状态账本。

**故障证据：** 注入工具的第一版在 cargo 启动时递归，未运行应用测试。改用直接 syscall 后，复核发现 macOS 的 `File::sync_all()` 使用 fcntl 完整同步，初版只拦截 fsync 不足以覆盖实际调用。补齐后，独立探针确认 fsync／完整同步在普通路径返回 0，在指定测试 `.publish` 路径返回 EIO（errno 5）。

在相同原生测试二进制运行方式和同一注入库下，将本轮两行变更暂时还原，旧发布返回 `Ok(())`、磁盘由 `before` 变为 `after`，用例失败；恢复变更并重新编译，新发布实际触发同步 EIO，返回包含 stage、target 与 os error 5 的 `DomainError::InternalError`，磁盘仍逐字节等于 `before`，用例 1 passed / 0 failed。fixture 在断言前清理，正式实现只迁移共同发布调用，不保留故障 hook。这证明同步确认及失败保护，不声称真实手机曾发生同样的底层写回错误。

**正常行为核对：** 移除探针后的 userdata focused tests 112 passed / 0 failed；Rust 边界 clean，发布模块 rustfmt check、内置 tt-docs 镜像检查和 `git diff --check` 均通过。现有完整角色书读／导入／byte commit、校验失败保留旧文件及名称行为覆盖保持有效，未增加永久测试或故障库依赖。

**完整核对：** 本轮 `pnpm run check` 的平台、前端、类型、Lint、日志与 Rust 边界检查通过；浏览器 108/108，契约 458/459。唯一失败仍是本机缺少 Xcode `actool` 的 macOS 图标编译测试，未改动或跳过。单独执行被短路的后续检查：UI 190/190，Rust 全库 1270 passed / 0 failed / 1 ignored，workspace Clippy 通过。

**独立审阅：** 生产实现 `Coherent. Ship.`，Critical / Important 均无。唯一文档 Minor 是候选行仍写验证前状态，已按实际证据更新。审阅确认两个实际发布调用者、原 File 所有权、同步失败时停止 rename、清理保留主结果、crate 边界与镜像。未对已明确排除的 rename 后父目录断电持久化增加机制。

**正式包：** `output/TauriTavern-personal-2.4.0-world-save-fix.apk`，SHA-256 `2054f2dc1263daf6812abc0028b442a53d804ed38b327b5190fece7e2faf4b8e`。同个人版证书、v2/v3、非调试、无 Pilot／故障探针标记、APK 和三个 ELF 的 16 KiB 对齐均核验；53 个已修改构建输入及删除状态不变。ADB 无设备，尚未安装。交付记录与 manifest 位于 `output/apk-world-save-fix-delivery.md` 和同名 APK 的 `.manifest.json`。

## 候选清单

| 候选 | 证据 | 优先级／验证 |
| --- | --- | --- |
| 世界书发布未确认写回 | 已隔离复现、修复、自审和独立审阅；focused／后续全库检查及正式包校验完成，actool 限制已记录 | 本轮完成：写回错误传播和旧文件保护 |
| 手机首屏、长聊天、扩展／图片就绪速度 | 当前 ADB 无设备；历史单次冷启动不足以证明变化 | 后续同条件分项测量，再选择具体瓶颈 |
| 其他用户数据发布路径 | 已核查设置的共同持久化 helper、密钥事务、扩展 store 与立绘 pack；目前没有新的可复现用户缺陷。扩展 store 的原子发布边界明确不承诺断电持久化 | 不把每个 rename-only 调用都当成缺陷，不无据改动 |
| 大记录流式 JSONL 的组装成本 | 实际 reader 已按 line fragments 累计，只在完整记录到达时组装；未发现先前猜测的整行重复拼接路径 | 保留已有有效实现，手机实测后再选瓶颈 |

# Tauri Context 在构建脚本中生成

原个人 Android 构建的探索性观测耗时 436.325 秒，出现两次相同原生库的完整编译；两阶段库字节、fingerprint JSON 和生成 Gradle 输入相同。本轮清理已核实的 host 派生输出后，受控 RED 基线耗时 423.55 秒，仍完整编译两次，后续前后比较使用这次受控基线。当前 CLI 2.12.2 的第一阶段有初始化原生插件的职责，Gradle 阶段还要校验和交付库，两次调用都保留。

已核对发布 tag 与锁定的 cargo-mobile2 0.22.5：两阶段经相同 `cargo build` 路径调用，布尔参数只控制终端颜色。原 host 的 `generate_context!()` 在 rustc 内调用 Tauri codegen，写出压缩资源，再通过 `include_bytes!` 将源文件和新生成的文件纳入编译依赖。受控 RED 中，首轮 1,139 个生成资源全部晚于库编译开始，第二轮没有晚于编译开始的新资源；两阶段库字节、资源和 ACL 元数据相同，123 个记录输入未变，确认生成时机导致二次编译。

确认后，使用 SDK 现有的 `Attributes::codegen(CodegenContext::new())` 在 `build.rs` 的 Tauri 构建入口生成唯一 Context，host 使用 `tauri_build_context!()` 读取它。迁移唯一实际调用者，删除 rustc 内的旧生成入口，所有平台共用一条路径，不引入 Android 特判、缓存镜像、Cargo 包装器或跳过构建。

配置合并、dev/release、自定义协议、原生插件与 ACL、嵌入资源字节及 Host ABI 保持。Rust 锁文件只允许为现有 SDK feature 增加确实需要的依赖关系，不升级版本或覆盖此前修改。错误沿原 `tauri_build::try_build` 和 host build 边界传播。

沿原个人构建入口、相同配置和源数据进行前后测量。只清理本 crate 的已核实派生缓存，保留其他依赖缓存，捕获每阶段的实际编译次数、库、嵌入资源与 ACL 清单。目标是首次 native 调用编译一次，Gradle 的同条件调用使用 Cargo 已确认结果；两次调用及其验证职责均保留。Rust focused tests、crate 边界与完整 `pnpm run check` 仍执行，`actool` 环境失败按实际结果报告。最新包不安装到仍由另一会话使用的手机。

受控 GREEN 已完成：原入口 exit 0，215.684 秒，两次 native 调用只完整编译一次，第二阶段 Cargo 耗时 1.47 秒。相对受控 RED 的 423.55 秒，本次观测减少 207.866 秒（49.08%）；这是构建耗时，手机启动仍需单独测量。1,139 个压缩资源跨两次实现及各阶段完全相同，Context 与生成资源均早于首次库编译，123 个记录输入在各次运行内未变。

默认文件、ACL manifest 和 capability 的规范化 JSON 相同；`allowed-commands.json` 只有三条 speech-synthesis 命令的数组顺序不同。SDK 的 `AllowedCommands.commands` 为 `HashSet<String>`，handler 以成员查询消费；已用原 RED 哈希精确确认仅为排列差异，命令集合和 `has_app_acl: false` 均保持。磁盘不足与观测器读取旧依赖路径的失败尝试单独归档，不计入性能结果。正式个人 APK 的原签名、完整 CRC、新原生库、SDK 和 16 KiB 对齐已验证。

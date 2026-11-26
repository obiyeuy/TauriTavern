# Tauri Context 预生成 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this one inline task.

**Goal:** Context 和压缩资源在 Rust 库编译之前生成，避免同条件 Android 调用重复编译原生库，保留全部现有功能和契约。

**Architecture:** `build.rs` 的原 Tauri 构建入口拥有 Context 生成，host 只读取唯一产物。使用 SDK 已提供的 codegen feature、`Attributes::codegen()` 与 `tauri_build_context!()`；原 CLI、插件初始化、Gradle 和原生库校验链不改动。

**Spec:** [Tauri Context 在构建脚本中生成](../specs/2026-11-25-native-context-generation.md)。

## Task 1：迁移并验证唯一 Context 生成入口

**Files:** `src-tauri/crates/tauritavern/Cargo.toml`、`build.rs`、`src/app/host/mod.rs`，必要的 `src-tauri/Cargo.lock` 与 `docs/BackendStructure.md`。基准和临时材料仅位于本任务目录，正式证据进入 `output/verification/android-native-rebuild-20261125/`。

**Interfaces:** 配置、Context、ACL、原生插件、资源与 Host ABI 不变；Rust 库读取构建阶段的同一 Context。全部实际 `generate_context!()` 调用者迁移，不保留平行入口。

- [x] 捕获本轮生产文件的精确 before 和模式、工作区／暂存状态、ledger。核对当前没有使用本 crate 缓存的编译进程。
- [x] 记录允许重建的 Cargo 缓存范围，运行原个人构建 RED。原入口 exit 0、423.55 秒，两次完整编译；首轮 1,139 个生成依赖晚于库编译开始，第二轮没有。库字节、资源和 ACL 相同，123 个输入未变；性能期望 1 次，基准退出 1。
- [x] 根因确认后启用现有 SDK codegen feature，在原 attributes 接入 Context 生成，迁移唯一 host 调用者；锁文件只增加 `tauri-build` 对 `quote` 与 `tauri-codegen` 的两条关系，版本未变，架构说明已同步。受影响 host focused tests 117/117，crate 边界通过。
- [x] 受影响 host focused tests 117/117、crate 边界通过；完整 `pnpm run check` 的 Browser 165/165、契约 460 pass / 1 fail，唯一失败为缺少 Xcode `actool`（exit 72）。被该环境失败阻断的后续入口已独立运行：UI 191/191、workspace Rust 1270 pass / 1 ignored、Clippy 通过；173 个后续检查输入未变。完整检查期只有本计划复选框更新，源码／配置输入未变，另有精确记录。
- [x] 同入口、配置、源数据、host 派生输出冷缓存且依赖缓存保留的 GREEN 完成：215.684 秒，原入口 exit 0，两次调用／一次完整编译；比受控 RED 减少 207.866 秒（本次观测 49.08%）。1,139 个资源完全相同，Context 与资源早于库编译，123 个运行内输入未变；ACL 的唯一差异为已确认的 HashSet 序列化顺序。正式个人 APK 的完整 CRC、原签名、新原生库、SDK 与 16 KiB 对齐通过，尚未安装。
- [x] 逐路径自审、独立只读审阅，归档精确增量和交付说明，更新候选清单，清理本任务 before、下载源和临时基准材料。

## 验证准入

本问题用实际原生构建和时间戳证明，不添加源码文本断言或让常规 CI 强依赖本机 Android SDK 的测试。复用现有 Rust／浏览器／契约覆盖，并记录实际性能 RED→GREEN。资源和 ACL 比较使用两次实际构建的产物，不用待测实现生成预期值。

## Review Focus

核对 codegen 是否进入原 Tauri build attributes、host 是否只读唯一生成产物；比较 config/dev/custom-protocol、插件／capability、资源与错误边界；检查锁文件和全部实际调用者；确认测量保留两次原调用及其职责，首次新资源已经早于库编译开始，第二次不重新编译。不能用额外 wrapper、跳过步骤或重复状态换取时间数字。

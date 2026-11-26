# Scripts

这个目录存放仓库内的开发、构建、迁移导出与 CI 辅助脚本。

## 个人 Android 构建与发行

`pnpm run android:build:personal` 调用 `build-personal-android.mjs`，复用现有 Tauri Android 构建路径并设置个人包名与更新来源。共享签名、验包与 Release 发布脚本位于 `ci/`。

SDK、签名与发布步骤见[个人开发与发布](../docs/PersonalDevelopment.md)。

## Linux 源码构建

本 fork 的 Linux 源码构建使用自己的 Nix flake：

```sh
nix build github:obiyeuy/TauriTavern#tauritavern
```

也可在已克隆的源码中查看 Nix 安装计划：

```sh
sh scripts/install-linux.sh --method nix --dry-run
```

`install-linux.sh` 中保留的 APT/RPM 模式服务于上游发行基础设施；本个人 fork 未提供这些软件源。Nix 模式使用本 fork 的源码与系统已有的 cache 配置，不新增上游缓存信任。详见 [Linux 源码构建](../docs/CurrentState/LinuxRepository.md)。

## SillyTavern 迁移导出

这两个脚本会交互式生成一个可直接导入 TauriTavern `data-migration` 扩展的 zip：

- 自动检测当前目录是否为 SillyTavern 根目录
- 可选是否导出 `data/default-user/backups`
- 自动将 `public/scripts/extensions/third-party` 映射到 `data/extensions/third-party`
- 提供明显的压缩进度提示

### 本地执行

Unix / macOS / Linux / Termux:

```sh
sh scripts/export-sillytavern-migration.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-sillytavern-migration.ps1
```

## 目录说明

Flatpak 构建配方位于 `packaging/flatpak/`，软件源发布工具位于
`distribution/`。

- `install-linux.sh`
  Nix 模式构建本 fork；保留的 APT/RPM 模式属于上游基础设施。
- `build-personal-android.mjs`
  个人 Android 包的构建入口，对应 `pnpm run android:build:personal`。
- `export-sillytavern-migration.sh`
  面向 Unix/macOS/Linux/Termux 的 SillyTavern 迁移导出脚本。
- `export-sillytavern-migration.ps1`
  面向 Windows PowerShell 的 SillyTavern 迁移导出脚本。
- `build-portable.mjs`
  构建 Tauri portable 二进制，并将产物复制到指定输出目录。对应 `pnpm run tauri:build:portable`。
- `tauri-before-build.mjs`
  统一生成 Tauri 打包所需的前端 bundle；pnpm 启动入口也复用它以覆盖移动端 IDE 构建。
- `macos/actool`
  为 Tauri npm CLI 调用的图标编译器提供空 stdin，避免 Icon Composer 图标编译崩溃；由 `tauri-app.mjs` 自动接入。
- `tauri-dev-server.mjs`
  为 `tauri dev` 提供轻量静态前端服务器和页面刷新通道，并注入[开发资源桥](../docs/CurrentState/ThirdPartyExtensions.md)引导脚本；端口取自 `tauri.conf.json` 的 `devUrl`。静态文件通过 `@parcel/watcher` 的原生事件监听，Rspack 依赖在成功重编译后刷新。
- `check-frontend-guardrails.mjs`
  校验前端宿主层文件规模和依赖边界，避免 Host Kernel 持续膨胀。对应 `pnpm run check:frontend`。
- `tauri-ios-xcode-script.sh`
  包装 `tauri ios xcode-script`，补齐 Xcode GUI 构建环境中的 PATH / Node / pnpm，并在构建后处理 iOS 图标。
- `generate-ios-app-icon-variants.swift`
  从 `src-tauri/crates/tauritavern/icons/icon.png` 生成 iOS `Any` / `Dark` / `Tinted` 三个 1024px App Icon 源图。
- `ios-policy.mjs`
  iOS Dev/Build 包装脚本：为构建过程注入 `TAURITAVERN_IOS_POLICY_PROFILE`，并在 `ios_internal_full` / `ios_external_beta` 构建时自动使用 `--export-method app-store-connect`。
- `ios-opaque-app-icons.swift`
  校验 iOS App Icon appearance 变体，并只将基础 `Any` 图标展平为不透明背景，供 `tauri-ios-xcode-script.sh` 调用。
- `ci/setup-macos-signing.sh`
  GitHub Actions / CI 中的 macOS 签名初始化脚本，用于导入证书、创建 keychain 与写入 Apple API Key 路径。
- `ci/verify-release-version.mjs`
  校验 Stable Release tag 与前端、Cargo、Tauri、Cargo lock 和 Nix 包版本一致。
- `ci/collect-release-assets.mjs`
  校验必需的跨平台构建产物，并按 Stable 与 Canary 共用的用户可见命名契约收集 Release 资产。实验性的鸿蒙 HAP 是可选产物，存在时才收集。
- `ci/setup-android-signing.mjs`、`ci/verify-personal-apk.py`、`ci/publish-personal-release.mjs`
  个人发行的签名初始化、APK 身份核验与 GitHub Release 发布。
- `ci/distribute-testflight.mjs`
  等待 App Store Connect 处理指定 iOS 构建，写入 `What to Test`，关联公开外测组，并按当前状态提交 Beta App Review。
- `ohos/`
  鸿蒙实验构建：`prepare.py` 在一次性 checkout 中准备钉住的框架栈，`env.sh` 设置交叉编译环境，`validate-hap.py` 校验 HAP。流程见 `docs/OpenHarmonyDevelopment.md` §3。
- `guardrails/frontend-lines-baseline.json`
  `check-frontend-guardrails.mjs` 使用的基线数据文件，文件行数硬性限制指标。

## 维护约定

- 面向最终用户的一次性脚本，优先保持交互友好、依赖少、失败直出。
- 面向仓库内部的脚本，优先通过 `pnpm` script 或 CI 调用，不额外扩散入口。
- 如果修改迁移导出脚本涉及归档结构，请同步确认它仍符合当前 `data-migration` 导入器的 `data/...` 契约。

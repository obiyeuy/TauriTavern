# Linux 源码构建与发行边界

本 fork 当前只开发、验证和发布 Android ARM64 APK。本页保留 Linux 源码构建资料，相关发行 workflow 在个人仓库保持禁用。

## 现有源码入口

- `flake.nix`：提供 `tauritavern`、`canary` 和默认 package / app。
- `nix/package.nix`：使用 Node.js 24、pnpm 11 与 Rust 构建前端和 Tauri host。
- `scripts/install-linux.sh`：Nix 模式选择本 fork 的源码；保留的 APT/RPM 模式属于上游发行基础设施。
- `packaging/flatpak/`、`distribution/`：保留的跨平台打包与软件源工具。个人仓库的相关发行 workflow 保持禁用。

当前 Nix package 支持 `x86_64-linux` 与 `aarch64-linux`。构建输出的 Linux 应用标识仍沿用 `com.tauritavern.client`；个人 Android 包使用独立的 `com.tauritavern.personal`。

## 本地构建

在有访问权限的本地克隆中执行：

```sh
nix build .#tauritavern
nix run .#tauritavern
```

Canary 源码构建：

```sh
nix build .#canary
```

仓库公开后，也可以使用本 fork 的 GitHub flake 地址：

```sh
nix build github:obiyeuy/TauriTavern#tauritavern
nix run github:obiyeuy/TauriTavern#tauritavern
```

按具体提交或已存在的发行 tag 构建：

```sh
nix build github:obiyeuy/TauriTavern/<commit-sha>#tauritavern
nix build github:obiyeuy/TauriTavern/<release-tag>#tauritavern
```

`tauritavern` 的构建分支身份为 `main`，`canary` 为 `dev`；提交身份由 flake 的源码 revision 提供。应用的默认更新仓库是 `obiyeuy/TauriTavern`，渠道比较沿用[更新渠道契约](UpdateChannels.md)。

本 fork 的 flake 使用系统已经配置的 Nix cache，不声明或信任上游项目的专用 cache。没有命中缓存的构建会在本地执行。

## Nix 安装脚本

在克隆的源码中先查看计划：

```sh
sh scripts/install-linux.sh --method nix --dry-run
```

确认系统和源码目标后安装到当前用户的 Nix profile：

```sh
sh scripts/install-linux.sh --method nix
```

Canary 选项使用本仓库的 `Canary` tag，该 tag 需要已经发布：

```sh
sh scripts/install-linux.sh --method nix --channel canary --dry-run
```

Nix 模式不配置 APT/RPM 软件源，不使用 sudo，不修改 `/etc/nix/nix.conf`。

## 软件源与发布

本个人 fork 尚未运营 APT、RPM、Flatpak、Homebrew、Scoop、WinGet 或专用 Nix cache。保留的上游安装与软件源代码可作为移植参考；其中的 native APT/RPM 模式仍指向上游基础设施，不能用来安装本 fork 的个人版。

若之后需要发行 Linux 软件包，应先确定个人的软件源地址、签名与托管权限，再配置和验证现有发布工具。当前个人 Android 更新流程见[个人开发与发布](../PersonalDevelopment.md)。

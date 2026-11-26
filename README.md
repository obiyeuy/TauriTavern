<div align="center">

<img src="docs/images/tauritavern-readme-hero.webp" alt="TauriTavern Personal" width="720">

# TauriTavern Personal

**由 obiyeuy 维护的 TauriTavern fork，专注 Android 聊天体验与数据可靠性。**

**简体中文** · [English](README.en.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

[版本与下载](https://github.com/obiyeuy/TauriTavern/releases) · [开发文档](docs/PersonalDevelopment.md) · [报告问题](https://github.com/obiyeuy/TauriTavern/issues) · [构建与检查](https://github.com/obiyeuy/TauriTavern/actions)

[![Android](https://img.shields.io/badge/Android-8.0%2B-3DDC84?style=flat-square&logo=android&logoColor=white)](#安装与更新)
[![Architecture](https://img.shields.io/badge/APK-ARM64-1f9d96?style=flat-square)](#安装与更新)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)

</div>

## 项目定位

这是独立维护的个人 fork，源码、问题反馈、构建与版本发行统一放在 [`obiyeuy/TauriTavern`](https://github.com/obiyeuy/TauriTavern)。

本项目延续 TauriTavern 的 Rust 后端与 SillyTavern 前端生态，当前改进重点是：

- **手机操作**：聊天列表、聊天页与设置页的导航、布局、输入框和加载反馈。
- **API 配置**：地址与协议填写说明、模型选择、密钥保存、连接测试和具体错误提示。
- **聊天与附件**：保留 SillyTavern 数据格式，明确文件、设置与聊天写入的确认和失败结果。
- **扩展兼容**：沿真实角色卡、iframe 与扩展调用路径排查问题。
- **启动与性能**：分阶段加载、聊天虚拟化，以及有前后测量证据的局部优化。
- **个人更新**：使用本仓库的 Stable / Canary Releases，关联源码提交、APK 身份与 SHA256。

TauriTavern Personal 是独立开源客户端。使用第三方 API 时，服务地址、模型和访问权限由对应提供商决定。

## 安装与更新

个人 Android 包使用 `com.tauritavern.personal`，要求 Android 8.0 或更高版本；当前个人发行目标是 ARM64。

下载统一通过[本仓库 Releases](https://github.com/obiyeuy/TauriTavern/releases)。首次正式发行仍在准备中，只有 Release 中实际出现的 APK 才是已经发布的版本。发行流程与签名要求见[个人开发与发布](docs/PersonalDevelopment.md#github-更新发布)。

安装与升级时：

1. 选择个人 Release 中的 Android ARM64 APK。
2. 已安装个人版时使用同包名、同签名的覆盖升级，保留现有数据。
3. 在应用的“关于”中查看版本和更新渠道。

| 渠道 | 源码分支 | 发布方式 |
| --- | --- | --- |
| Stable | `main` | 与源码版本一致的固定版本 tag |
| Canary | `dev` | 通过验证后更新 `Canary` tag |

应用内更新需要本仓库公开且对应渠道已有正式 Release。源码上传、Actions 检查和正式发布是各自独立的步骤。

本 fork 当前只开发、验证和发布 Android ARM64 APK。仓库中保留的其他平台代码属于上游继承的源码资料。

## 首次使用

1. 导入已有角色卡、聊天、预设或世界书，也可以从应用内新建角色。
2. 在 API 设置中选择提供商或自定义协议。
3. 将服务地址、API 密钥、模型 ID 分别填入对应字段；模型 ID 以提供商文档为准。
4. 保存配置，再运行连接测试。自定义 OpenAI 兼容服务通常填写 API 基地址，例如 `https://api.example.com/v1`。
5. 选择角色并开始聊天。

连接错误需要结合最终请求地址、协议、模型和服务端响应判断。报告 404、MVU 或图片加载问题时，请说明复现步骤、应用版本和相关错误信息；截图与日志中的 API 密钥应遮挡。

## 开发与构建

前置环境：**Node.js 24 LTS、pnpm 11、Rust stable**。Android 构建还需要 **JDK 21、Android SDK 36、NDK r29** 与个人签名配置。

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

| 命令 | 用途 |
| --- | --- |
| `pnpm run check` | 前端边界、类型、Lint、浏览器与契约测试、UI、Rust 测试和 Clippy |
| `pnpm run web:build` | 构建前端资源 |
| `pnpm run android:dev` | Android 开发 |
| `pnpm run android:build:personal` | 构建个人 Android 包 |

开发与 CI 统一使用 Node.js 24。浏览器测试保留单个用例的 60 秒超时；完整测试文件可包含多个独立用例。

日常改动在任务分支开发，经审阅进入 `dev`；Stable 发行从经过审阅的 `main` 基线构建。版本、签名、发布与验证步骤见[开发流程](docs/PersonalDevelopment.md)。

## 架构与文档

Rust 后端采用 Clean Architecture 的 Cargo workspace：

- `tauritavern`：Tauri host、命令层、平台集成与组合根。
- `tt-application`、`tt-ports`、`tt-domain`、`tt-contracts`：用例、端口、领域模型与 DTO。
- `tt-adapter-*`：存储、HTTP、媒体、同步、扩展、分词等具体实现。

前端使用 SillyTavern 与模块化 Tauri 注入层，通过既有宿主契约访问原生能力。

- [个人开发与发布](docs/PersonalDevelopment.md)
- [Android 开发](docs/AndroidDevelopment.md)
- [后端结构](docs/BackendStructure.md)
- [前端指南](docs/FrontendGuide.md)
- [宿主契约](docs/FrontendHostContract.md)
- [更新渠道](docs/CurrentState/UpdateChannels.md)
- [当前模块状态](docs/CurrentState/README.md)

## 反馈与贡献

请在[本仓库 Issues](https://github.com/obiyeuy/TauriTavern/issues) 提交问题。包含应用版本、设备与系统版本、复现步骤，以及能够说明问题的截图或脱敏日志。

提交 PR 前阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与[个人开发流程](docs/PersonalDevelopment.md)。提交信息采用 `type(scope): 中文描述`，一个提交对应一个主要目的。使用 AI 辅助时，请用自己的话说明对变更的理解。

## 来源与许可

本 fork 基于 [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern)，保留原有 Git 历史、许可证与贡献署名。TauriTavern 基于 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 和 [Tauri](https://tauri.app/) 构建。

感谢上游维护者、扩展作者和贡献者，以及为 TauriTavern 设计 Logo 的 [@shiyue137](https://github.com/shiyue137)。

源码按 [AGPL-3.0](LICENSE) 发布。

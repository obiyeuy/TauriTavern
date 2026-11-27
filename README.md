# TauriTavern Personal · Android

在安卓手机上使用角色卡进行 AI 对话。由 **obiyeuy** 维护，围绕聊天操作、API 配置、数据保存和扩展兼容持续改进。

**简体中文** · [English](README.en.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

[下载与版本](https://github.com/obiyeuy/TauriTavern/releases) · [反馈问题](https://github.com/obiyeuy/TauriTavern/issues) · [安卓构建与检查](https://github.com/obiyeuy/TauriTavern/actions) · [开发文档](docs/PersonalDevelopment.md)

## 这个项目做什么

个人版面向 **Android 8.0 及以上、ARM64** 手机。聊天和设置由应用本地管理，模型服务由用户配置的 API 提供。

- **角色聊天**：导入角色卡、聊天记录、世界书与预设，使用熟悉的 SillyTavern 数据格式。
- **手机界面**：优化聊天列表、输入、设置导航、窄屏布局与加载反馈。
- **API 连接**：配置服务地址、协议、密钥和模型，使用连接测试与请求信息定位错误。
- **可靠保存**：改进配置、聊天和附件写入的确认、失败提示与重试。
- **扩展兼容**：沿真实扩展、角色卡脚本和媒体加载流程修复问题。
- **性能与维护**：测量启动、资源加载与聊天显示，复用现有机制，减少重复状态与无效工作。

兼容范围以实际实现与验证为准。具体角色卡、扩展和模型服务的问题通过本仓库反馈与追踪。

## 下载与手机更新

安装包统一在[本仓库 Releases](https://github.com/obiyeuy/TauriTavern/releases) 发布，文件名包含 `android-arm64-v8a.apk`。

**仓库已公开；首个公开 APK Release 和在线更新仍在准备中。** 本地构建与真机安装成功不等于已经线上发布，Releases 中实际可下载的附件才是发行版。

发布就绪后的使用流程：

1. 首次从本仓库下载 APK，按安卓提示允许安装。
2. 后续在应用的版本／关于设置中检查更新。
3. 打开该版本的 Release，下载 APK，由安卓安装器确认覆盖安装。

后续更新可以直接在手机完成，无需 USB。覆盖升级必须使用同包名、同签名的个人版；升级保留现有应用数据。

| 项目 | 个人版约定 |
| --- | --- |
| 包名 | `com.tauritavern.personal` |
| 平台 | Android 8.0+，ARM64 |
| Stable | 固定版本发布，从 `main` 构建 |
| Canary | 测试发布，从 `dev` 构建，更新 `Canary` tag |
| 版本来源 | 本仓库已完成验证的 Releases |

发布流程、签名和质量检查见[个人开发与发布](docs/PersonalDevelopment.md#github-更新发布)。

## 开始聊天

1. 导入或新建角色。
2. 进入 API 设置，选择提供商或自定义协议。
3. 分别填写服务基地址、API 密钥与模型 ID。
4. 保存配置并运行连接测试。
5. 打开角色，开始对话。

| 字段 | 填写内容 |
| --- | --- |
| 服务地址 | 提供商给出的 API 基地址，例如 `https://api.example.com/v1` |
| API 密钥 | 提供商签发的访问密钥 |
| 模型 | 提供商支持的模型 ID，与显示名称可能不同 |
| 协议 | 与服务接口匹配的 API 格式 |

遇到 404 时，核对最终请求地址、协议、模型及服务端响应。提交问题时提供应用版本、手机型号、系统版本和复现步骤；截图和日志中的密钥需遮挡。

## 开发

推荐本地使用 **Node.js 24、pnpm 11 与 Rust stable**。Android 构建需要 **JDK 21、Android SDK 36、NDK r29**；个人发行还需要原签名配置。

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

日常修改在任务分支开发，经过审阅与安卓质量检查后进入 `dev`。Stable 使用经过审核的 `main` 基线，APK 的版本、签名、源码提交和 SHA256 一起验证。

## 文档与反馈

- [个人开发与发布](docs/PersonalDevelopment.md)
- [Android 开发与调试](docs/AndroidDevelopment.md)
- [前端指南](docs/FrontendGuide.md)与[宿主契约](docs/FrontendHostContract.md)
- [后端架构](docs/BackendStructure.md)
- [更新渠道](docs/CurrentState/UpdateChannels.md)
- [当前模块实现](docs/CurrentState/README.md)

问题提交到[本仓库 Issues](https://github.com/obiyeuy/TauriTavern/issues)。贡献前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；使用 AI 辅助时，请用自己的话说明修改内容和理解。

## 来源与许可证

基于 [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern)，使用 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 与 [Tauri](https://tauri.app/)。保留上游历史、作者与贡献者署名；原标识设计来自 [@shiyue137](https://github.com/shiyue137)。

源码采用 [AGPL-3.0](LICENSE)。

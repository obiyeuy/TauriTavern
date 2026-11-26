# 个人开发与发布

个人源码仓库为 [`obiyeuy/TauriTavern`](https://github.com/obiyeuy/TauriTavern)，上游为 [`Darkatse/TauriTavern`](https://github.com/Darkatse/TauriTavern)。保留上游 Git 历史、AGPL-3.0 许可证与贡献说明。

## 分支与提交

- `origin` 指向个人仓库，`upstream` 用于读取上游。
- `dev` 是日常集成分支，`main` 是稳定发行基线。初始导入后，两者从同一已核对的源码开始；后续功能、修复和重构使用任务分支，经 PR 进入 `dev`。
- 分支沿用 `feature/`、`fix/`、`refactor/`、`docs/`、`chore/`，提交采用 `type(scope): 中文描述`。一个提交对应一个主要目的。
- 提交前检查工作区、暂存区与未跟踪文件，明确暂存清单。提交不自动代表推送，推送不自动代表合并或发布。
- 不暂存缓存、APK、运行数据、API 凭据、Android keystore 或临时材料。首次上传的优化快照单独保留；其后的发布改动独立提交。

常规稳定发布先将改动集成到 `dev`，再创建 `dev` → `main` 的发布提升 PR，审阅本次包含的变更与质量检查结果。只有获得明确的合并授权后才推进 `main`，随后从该稳定基线运行发布流程；发布工作流不自动合并分支。初始导入的 `main` 与 `dev` 从同一已核对提交建立，不属于后续发布提升。

这是个人仓库对稳定发布的分支流程补充。日常贡献仍以 `dev` 为目标；直接修复 `main` 的紧急情况遵循 `CONTRIBUTING.md` 的审阅要求，向上游贡献则完整遵循上游分支政策。

本地更新上游只获取对象与远端引用：

```sh
git fetch upstream
```

是否将上游变更引入任务分支，需要按实际差异决定，不把自动合并、rebase 或重置作为同步步骤。

## 验证

沿用项目的完整入口：

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Rust 改动先运行受影响 crate 的 focused tests 和 `node scripts/check-rust-crate-boundaries.mjs`。性能改动保存同条件的前后测量，并说明测量范围。设备验证至少记录安装包身份、覆盖安装结果、启动状态，以及所修改流程的实际结果。

`PR quality gate` 同时支持 PR、手动执行和发布工作流调用，复用同一套桌面与移动检查。API 响应或本机缺失工具造成失败时，应报告具体原因；不以跳过项目检查代替通过。当前开发 Mac 缺少 Xcode 的 `actool` 时，图标检查会失败，GitHub macOS runner 可提供独立的完整编译环境；是否通过以 Actions 的实际结果为准。

私有仓库的分支保护能力取决于 GitHub 账户套餐。没有生效的保护不能称为已配置；本地授权与 PR 审阅要求仍需遵守。

## Android 构建与安装

准备项目支持的 Node、Rust、JDK 21、Android SDK 36 与 NDK r29，以及原个人签名材料后，使用同一构建入口：

```sh
pnpm run android:build:personal
```

该入口使用 `com.tauritavern.personal`，与上游应用分开保存数据。版本继承项目的 `package.json`、Tauri 与 Cargo 版本，不在个人 overlay 再维护副本。原有本地代理、SDK 路径和签名文件继续保存在本机专用位置。

安装使用覆盖安装：

```sh
adb install -r <已验包的APK路径>
```

安装前必须核对签名和包名；签名不一致时停止，不通过卸载或清数据绕开。已安装 2.4.0 的个人版可升级到 2.4.1 / versionCode 2004001。具体第三方 API、角色卡图片与 MVU 兼容仍按实际设备响应验收。

## GitHub 更新发布

更新检查从公开 GitHub Releases 读取版本和提交。私有源码仓库中的匿名查询会得到 404，因此源码上传成功不表示应用更新已启用。

正式启用前，由用户确认公开 `obiyeuy/TauriTavern` 及已有源码历史，并确认将原 Android 签名配置存入 `personal-android-release` 环境：

| Secret | 用途 |
| --- | --- |
| `ANDROID_KEY_BASE64` | 原个人 keystore 的 base64 |
| `ANDROID_KEY_ALIAS` | 原签名 alias |
| `ANDROID_KEY_PASSWORD` | 原 keystore 和 key 密码 |

这些值仅供发行 job 使用，不进入 Git、Release 附件、日志或应用。现有个人证书的 SHA256 指纹是 `bf70926990809b5983eae24be032109ece7d7f5346945c5747a5ce9ba4be5383`；工作流必须验证它，不能自动创建另一把签名密钥。签名临时文件在 job 收尾删除。

发布前确保工作区变更已审阅、验证并提交。进入 GitHub Actions 的 **Personal Android Release**：

1. Stable 先完成上述经过授权和审阅的发布提升，再选择 `main`、`stable`，填写与源码一致的 tag，例如 `v2.4.1`。同时更新项目的所有版本来源，并准备 `docs/releases/<version>.md`。Stable Release 不覆盖已有版本。
2. Canary 选择 `dev`、`canary`，tag 留空。流水线按实际 Git 变更生成说明，完整产物通过验证后才推进固定 `Canary` tag。
3. 工作流先复用完整质量检查，再构建、签名并验包。只发布对应源码提交的 APK、验包记录和 SHA256。生成源码提交与上传的产物一起追溯。
4. 发布成功后，用匿名请求核对相应 Release 和 tag，再验证手机的启动提示、下载地址及覆盖安装。确认过程不需要在 APK 填写 GitHub token。

个人 Canary tag 是滚动渠道，只有经过授权的发布操作才移动它；它不是源码开发分支。流水线只在成功发布后清理自己命名范围内的旧 Canary 产物，Stable 历史保留。上传失败时保留 draft 和已有可用发布。发布入口通过有权限的 Release 列表统一识别已发布版本与草稿；同 tag 的未完成草稿会阻止重试继续创建或上传，需先核对失败阶段和保留产物后处理。不把失败包作为新版本提示给手机。

上游全平台发行、定时 Canary、TestFlight、软件源、WinGet、Nix 和 app-use npm 发布工作流在个人仓库保持禁用，避免因缺少上游账户、签名或服务器权限而触发错误流程。

## PR 说明

说明问题、最终改动、实际验证、兼容影响，以及是否需要迁移或额外配置。使用 AI 辅助时，请至少用自己的话写一句对变更的理解，不能让工具伪造维护者已审阅的结论。维护者通过行为与架构审阅后才完成收尾。

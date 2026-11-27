# 个人开发与发布

个人源码仓库为 [`obiyeuy/TauriTavern`](https://github.com/obiyeuy/TauriTavern)，上游为 [`Darkatse/TauriTavern`](https://github.com/Darkatse/TauriTavern)。保留上游 Git 历史、AGPL-3.0 许可证与贡献说明。

## 分支与提交

- `origin` 指向个人仓库，`upstream` 用于读取上游。
- `dev` 是日常集成分支，`main` 是稳定发行基线。初始导入后，两者从同一已核对的源码开始；后续功能、修复和重构使用任务分支，经 PR 进入 `dev`。
- 分支沿用 `feature/`、`fix/`、`refactor/`、`docs/`、`chore/`，提交采用 `type(scope): 中文描述`。一个提交对应一个主要目的。
- 提交前检查工作区、暂存区与未跟踪文件，明确暂存清单。提交不自动代表推送，推送不自动代表合并或发布。
- 不暂存缓存、APK、运行数据、API 凭据、Android keystore 或临时材料。首次上传的优化快照单独保留；其后的发布改动独立提交。

常规稳定发布先将改动集成到 `dev`，再创建 `dev` → `main` 的发布提升 PR。仓库所有者核对范围后，将本仓库 PR 设为非草稿，表示同意在必需检查通过后合并；自动合并流程随后推进对应目标分支。稳定发布继续从 `main` 运行独立的发布流程，提升完成后通过 `main` → `dev` PR 同步稳定基线。初始导入的 `main` 与 `dev` 从同一已核对提交建立，不属于后续发布提升。

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

`PR quality gate` 同时支持 PR、手动执行和发布工作流调用，复用同一套完整项目检查与 Android Rust 目标检查。个人仓库只维护 Android 质量门控，使用 Node 24 和 Linux runner，不运行 iOS 构建。API 响应或本机缺失工具造成失败时，应报告具体原因；是否通过以对应源码提交的 Actions 实际结果为准。

## 自动合并

`PR auto-merge` 从默认分支监听 `PR quality gate` 的成功结果，通过 GitHub 查询被检查提交关联的 PR，并核对 PR 的最新状态。以下 PR 会自动请求合并：

- 作者是仓库所有者，来源是本仓库分支。
- PR 已打开、处于非草稿状态，目标为 `dev` 或 `main`。
- PR 当前提交与刚通过质量门控的提交完全一致。

任务分支采用 squash，保留一个可独立回滚的变更提交；`dev` → `main` 发布提升与 `main` → `dev` 同步采用 merge commit，保留两个长期分支的共同祖先，使后续同步与分支最新检查能够正常工作。

草稿用于未完成开发与方案讨论；切换为非草稿会运行质量门控。外部 fork 和其他作者的 PR 保留维护者审阅及合并流程。自动合并任务只调用 GitHub API，不检出 PR 源码、不下载构建产物，使用仅有源码和 PR 写权限的工作流 token。

`main` 和 `dev` 的分支保护要求 PR、分支与目标保持最新，并要求 GitHub Actions 提供的 `check-target`、`checks-android`、`cargo-check-android` 全部通过；管理员同样受检查约束。个人仓库不额外要求第二位审核者。检查失败、目标分支更新或有合并冲突时，GitHub 保留 PR，修复并更新任务分支后继续按相同条件合并。工作流对最终操作再次核对源码提交，不会用旧检查结果合并新提交。

启用时在仓库设置中打开 **Allow auto-merge**、**Allow squash merging** 与 **Allow merge commits**，并为两个分支配置上述必需检查。新增自动合并工作流首次进入默认分支前，对它自身的 PR 开启一次 GitHub 原生自动合并；后续 PR 由工作流处理。分支保护只有在 GitHub 设置中实际生效才成立，不能仅依赖 YAML 或文档声明。

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

说明问题、最终改动、实际验证、兼容影响，以及是否需要迁移或额外配置。说明以最终实现为准，并随着检查结果更新。维护者通过行为与架构审阅后才完成收尾。

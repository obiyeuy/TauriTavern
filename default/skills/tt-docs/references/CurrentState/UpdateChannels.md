# 更新渠道当前契约

TauriTavern 只维护 `stable` 与 `canary` 两个更新渠道。更新功能只负责检测和引导下载，不在应用内安装更新。

启动更新检查由版本扩展在 `APP_READY` 后异步发起。更新提示来自客户端主动查询 GitHub Releases，不是服务器向手机发送推送消息；上传源码也不会直接产生可安装的更新。已展示的 Release 使用 `release_token` 去重，用户可稍后下载或手动检查。

Linux 系统软件源默认使用 `stable`，并提供独立的 `canary` 套件。APT/DNF/Zypper 根据系统的软件包数据库安装更新，与应用内 Stable/Canary 偏好相互独立；软件源地址、签名身份和安装方式见 `docs/CurrentState/LinuxRepository.md`。

## 更新仓库归属

`TAURITAVERN_UPDATE_REPOSITORY` 是构建时的 `owner/repository` 输入。构建脚本拒绝非法路径格式，将它编译为产品身份；host composition 把唯一的 repository API root 交给 `tt-adapter-http::GitHubUpdateRepository`。未设置时沿用 `Darkatse/TauriTavern`。运行中的 API 密钥、settings 与第三方扩展不决定应用更新仓库。

个人 Android 构建统一通过 `pnpm run android:build:personal`。该入口保留 `com.tauritavern.personal` 和个人产品名称，并使用显式的 `TAURITAVERN_UPDATE_REPOSITORY`、CI 的 `GITHUB_REPOSITORY` 或本地个人仓库 `obiyeuy/TauriTavern`。它仍调用项目原 Android 构建入口，没有另一套更新比较或安装逻辑。

更新查询不携带 GitHub token。源码仓库可先保持私有，但供应用读取的 Releases 必须公开，且目标渠道已有发布。私有仓库、缺失 Release 或缺失 Canary tag 都可能返回 404；adapter 将请求地址、HTTP 状态和公开访问条件一起传播，不能将其解释为“没有更新”。网络、响应体读取和 JSON 解析失败也保留请求上下文。

## 身份与默认渠道

- 面向用户：Stable 显示版本号；Canary 显示中国标准日期，例如 `Canary Release 2026.06.14`。
- 面向程序：Stable 按 SemVer 比较；Canary 把当前构建与远端 Git 提交都规范化为 12 位短哈希后精确比较。
- 构建分支为精确的 `main` 时默认 `stable`，其他已知分支默认 `canary`；缺失分支信息时保守默认为 `stable`。
- 用户可在版本扩展设置中覆盖默认渠道。该选择进入现有 settings 持久化链路。

构建身份由 `TAURITAVERN_BUILD_BRANCH` 和 `TAURITAVERN_BUILD_REVISION` 注入；未显式提供时，构建脚本依次读取 GitHub Actions 环境和本地 Git。Canary 构建缺失或包含非法 revision 时必须明确失败，不能退回版本号比较。

## 检测链路

前端把有效渠道传给 `check_for_update` command，application service 决定比较语义，GitHub adapter 只负责读取渠道对应的数据：

- Stable：`GET /repos/<owner>/<repository>/releases/latest`
- Canary：`GET /repos/<owner>/<repository>/releases/tags/Canary` 与 `GET /repos/<owner>/<repository>/commits/Canary`

Canary Release 必须是 prerelease；Stable latest 不能是 prerelease。返回给前端的 `release_token` 是机器去重键：Stable 使用 tag，Canary 使用 `sha12`。弹窗主要展示 Release name，因此 Canary 的时间格式由发布流水线统一产生。

## Canary 发布链路

Windows 与 macOS 的 Stable、Canary debug 包均启用 Tauri Pilot；常规 release 构建默认不启用。

`.github/workflows/canary-release.yml` 从 `dev` 的同一提交构建桌面端与移动端，必需产物校验通过后才更新固定的 `Canary` Release 和 tag。实验性的鸿蒙 HAP 在 Stable 与 Canary 中都是可选产物：鸿蒙构建失败时照常发布其他平台，只缺少该 HAP，失败体现在本次运行的鸿蒙 job 上。Stable 与 Canary 共用面向用户的产物命名契约：

```text
TauriTavern-<release-id>-<platform>-<arch>[-<variant>][.<ext>]
```

Stable 的 `release-id` 是版本号；Canary 使用 `<YYYYMMDD>-canary`，日期以 `Asia/Shanghai` 计算。平台统一使用 `windows`、`macos`、`linux`、`android`、`ios`、`ohos`，桌面架构统一使用 `x64` / `arm64`，Android 与鸿蒙使用标准 ABI 名称。扩展名已经能区分包格式时不重复添加 kind，只有 `setup`、`portable`、`TestFlight` 等必要变体保留后缀；Linux portable 是无扩展名的原生可执行文件。Release 标题使用 `Canary Release <YYYY.MM.DD>`。tag 最后移动到已发布提交，因此客户端不会先看到尚未完成的构建。

Release notes 先由 Git 历史生成确定性上下文和回退正文。独立的只读 Codex job 使用 `CANARY_CODEX_API_KEY`、`CANARY_CODEX_RESPONSES_ENDPOINT`、`CANARY_CODEX_MODEL` 与 `CANARY_CODEX_EFFORT` secrets 检查实际 diff，再通过项目专用 Skill 撰写中英双语正文。Skill 源文件保存在不会被本地 Codex 自动发现的 `.github/codex/skills/`，CI 只把它们复制到 runner 临时 `CODEX_HOME`。Codex 调用失败或输出不符合结构时直接使用确定性正文，不影响构建和发布。

## Public TestFlight

Stable 与 Canary 原有的自签 iOS IPA 保持原构建参数和 Release 文件名。iOS job 在普通 IPA 完成后，复用已生成的前端资源额外构建 `ios_external_beta` + App Store Connect 版本，并以 `-TestFlight.ipa` 后缀作为独立产物。完整 GitHub Release 产物发布成功后，共享的 `.github/workflows/public-testflight.yml` 才上传并分发该专用 IPA；成功进入 TestFlight 流程后，再从 GitHub Release 删除临时的 `-TestFlight.ipa`，普通自签 IPA 始终保留。

Stable 的专用 IPA 只进入 `TauriTavern Beta Test`，Canary 的专用 IPA 只进入 `TauriTavern Canary Test`；流水线会校验目标确实是当前 App 的公开外测组。每次 TestFlight 构建使用按时间单调变化的 `CFBundleVersion`，避免两个渠道共用营销版本时发生构建号冲突。

上传前，隔离且只读的 Codex job 检查实际提交范围与 `ios_external_beta` capability 边界，只生成公开包中可见、值得测试的英文 `What to Test` 内容。AI 不参与构建、版本、分组或审核决策；调用失败或正文非法时使用确定性的通用测试提示，因此 AI 不会阻塞上传。IPA 上传前先按 App、营销版本与构建号检查 App Store Connect；重跑遇到已上传的同一构建时跳过重复上传。随后由确定性脚本等待 Apple 完成处理、写入 `en-US` build localization、开启自动通知、关联唯一目标组，并在需要时提交 Beta App Review。Apple 审核是异步外部状态：提交被接受即结束 CI，不等待审核通过。

## 维护约束

1. 不要用显示时间判断更新；时间只服务用户认知，提交 SHA 才是 Canary 身份。
2. 不要让桌面与移动端各自推进 Canary tag；一个 Release 必须对应一个源码提交。
3. 不要让 AI 决定版本、产物、发布条件或 tag；AI 只能改写已经生成的事实。
4. 修改渠道 DTO、settings 或 command 时，保持 Rust serde 名称与前端字符串 `stable` / `canary` 一致。
5. Public TestFlight 始终使用 `ios_external_beta`；不要把 GitHub Release 的完整更新日志直接复制成 `What to Test`。

## 个人 Android 发布

个人仓库使用 `.github/workflows/personal-android-release.yml`，保留上述 Stable/Canary 语义，产物范围为一个已签名 ARM64 APK、JSON 验包记录和 SHA256 文件。Stable 从 `main` 发布 `vMAJOR.MINOR.PATCH`；Canary 从 `dev` 发布固定 `Canary` tag。个人 Canary 的 `release-id` 使用 `<YYYYMMDD>-canary-<sha12>`，让同日不同构建的完整产物可以先上传，避免覆盖当前 Canary 的下载文件。标题日期来自同一构建身份，跨午夜构建不会改变标题与文件日期的对应关系。

该工作流复用现有完整质量检查，再使用个人构建入口生成 APK。验包检查原包名和签名、源码提交、更新仓库、版本、ARM64、release 标志、ZIP 校验以及 ZIP/ELF 16 KiB 对齐。版本沿用 Tauri 的 `major * 1000000 + minor * 1000 + patch` 规则；Stable 发布须升版，Canary 可使用同一版本覆盖安装。发布入口读取现有两个渠道的验包记录，拒绝让新的 versionCode 低于已发布版本。

首次 Release 以 draft 上传完整产物后才公开；后续 Canary 先上传新的完整产物，再更新正文，最后推进固定 tag。GitHub Release 与 Git ref 不是一个原子事务；错误时停止发布并保留具体阶段，不能宣称 tag 已推进。只在新 Canary 发布成功后清理该流水线命名范围内的旧 Canary 产物，未知附件和 Stable 历史不在清理范围内。发布入口通过有权限的 Release 列表统一发现已发布版本与草稿，同 tag 的失败草稿会在任何发布变更前阻止重试，需要核对保留产物后处理。

个人仓库不执行上游的全平台发布、软件源、TestFlight、WinGet 或定时 Canary 工作流。签名仅从 `personal-android-release` 环境的 Actions secrets 注入，Git 仓库与 APK 均不包含 GitHub token 或签名私钥。公开仓库和转移现有签名到该环境需要用户明确确认；本地源码准备和验包可以先完成。操作步骤见[个人开发与发布](../PersonalDevelopment.md)。

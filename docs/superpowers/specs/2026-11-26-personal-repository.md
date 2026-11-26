# 个人仓库与 Android 更新发布

用户要求建立 GitHub 仓库、上传当前项目，并建立规范的开发与更新流程。该请求授权初始化仓库以及上传所必需的提交和推送；不授权合并、改写历史或公开此前私有的内容。

## 现状与目标

- 当前分支为 `feature/mobile-chat-shell`，上传前 HEAD 为 `b43ab68abff72a6c57d748b43c59399c74482e5a`，暂存区为空。当前修改是持续优化任务的积累，首次上传作为明确说明的迁移快照。
- 上游远程为 `https://github.com/Darkatse/TauriTavern.git`，默认分支 `main`。现有 Stable/Canary 更新查询硬编码到上游 Releases，因此个人 APK 仍可能提示上游更新。
- 已认证的个人 GitHub 账号为 `obiyeuy`。先创建私有 `obiyeuy/TauriTavern`；`origin` 指向个人仓库，`upstream` 指向原项目，保留上游历史与许可证。首次优化快照 `6d0d188d` 已上传到 `dev` 与 `feature/mobile-chat-shell`。
- 个人应用的既有 Android 包名为 `com.tauritavern.personal`。后续更新必须使用相同包名与已有签名，版本号与 Android versionCode 必须一致并单调增长。

## 选择的方案

复用现有更新 command、application service、Stable/Canary 比较规则和前端提示。只把 GitHub 仓库归属作为构建身份输入 `TAURITAVERN_UPDATE_REPOSITORY`，个人发布设置为 `obiyeuy/TauriTavern`。用户后续明确要求完整 fork 化，因此未指定时也使用个人仓库，并迁移 README、关于页、欢迎页与发行元数据的实际入口。源仓库不会成为运行时可编辑的用户设置，也不在 APK 中嵌入 GitHub 凭据。

GitHub 更新 HTTP repository 迁到已有 `tt-adapter-http`，host 只装配并提供构建身份。404 继续作为错误传播，并说明请求地址、公开访问与发布渠道条件；不得猜测为“没有更新”。

保留上游全平台发布工作流的源文件，个人仓库禁用需要上游账户、签名或外部服务的发行工作流。个人 Android 发布使用独立的发布身份与产物集合，沿用项目原 Android 构建入口和现有版本校验规则。质量检查复用 `pnpm run check`，不创建弱化的替代检查；PR 目标检查只返回检查结果，不自动评论或关闭 PR。

用户最新明确将开发与交付限定为 Android ARM64 APK。质量门控使用 Linux runner 执行完整公共检查，并单独检查 Android Rust 编译目标；移除当前门控中的 iOS、macOS 和 Windows job，以及 Flatpak 分发准备步骤。其他平台的继承源码与已禁用的上游发行工作流保留为资料。

## 开发与发布

- 先上传当前快照到 `dev` 与任务分支；个人更新实现就绪后，以最终已核对源码初始化新仓库的 `main`，并同步初始化 `dev` 基线。后续普通改动经任务分支与 PR 进入 `dev`，发布另行确认。
- 首次迁移快照与此次更新发布实现分别提交，使用 Conventional Commits 和中文描述。检查上传清单，排除缓存、APK、运行数据、临时材料、私钥和凭据。
- PR 检查保留完整公共质量门控并支持手动执行；源码上传后在 GitHub Linux runner 验证完整检查和 Android Rust 目标。分支保护以账号实际支持的能力为准，不宣称未生效的保护。
- 当前版本统一为 `2.4.1` / Android versionCode `2004001`，个人 overlay 只维护产品名称。`pnpm run android:build:personal` 复用原 Tauri Android 入口，并注入个人包名与更新仓库。
- 发布产物包含已签名 ARM64 APK、JSON 验包记录、SHA256 与可追溯的源码提交。验包核对原个人签名、版本、更新仓库、fresh native library、ARM64 与 ZIP/ELF 16 KiB 对齐。签名材料仅通过 GitHub Actions secrets 提供，启用云端签名前需明确该凭据的授权范围。
- Stable 从 `main` 发布不可覆盖的版本 tag；Canary 从 `dev` 发布固定 `Canary` tag，附件身份包含日期与 `sha12`。完整附件先上传，再更新 Release 正文和 tag；失败按实际阶段报错。发布时读取两个渠道的既有验包记录，禁止 versionCode 降级；只在新 Canary 成功后清理本流水线命名的旧 Canary 附件。
- 当前发布按 tag 从有权限的 Release 列表发现，覆盖未完成的 pending draft；发现同 tag 草稿后在任何变更前停止，交给维护者核对并处理。常规 Stable 基线先通过明确授权且审阅通过的 `dev` → `main` 发布提升 PR 推进，发布工作流不自动合并。
- APK 发布先形成可审核结果。私有 GitHub Releases 对匿名应用返回 404；完成源码上传与实现后，公开发布范围由用户确认，确认前不把未开放的更新地址安装到手机并声称可用。

## 验证

完成正在进行的设置刷新优化的实际编辑与现有行为覆盖，保留相同条件的 Chrome 性能结果。新更新 adapter 用真实本地 HTTP 响应验证渠道、版本与 404 诊断；不新增源码文本或字面量测试。运行受影响 Rust focused tests、crate 边界检查和完整 `pnpm run check`，记录所有失败；最终安卓门控以 GitHub Linux runner 的完整结果和 Android 目标检查为准。用现有 Android 构建和验包入口核对安装身份。

上传后读取远端仓库、分支提交、Actions 状态与隐私设置，确认源码提交真实存在。临时清单和扫描材料集中在 `.local/github-publishing-20261126/`，验证完成后清理不再需要的副本。

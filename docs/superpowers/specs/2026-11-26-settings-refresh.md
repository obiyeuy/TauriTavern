# 设置页重复刷新优化

用户已授权在现有功能和契约内自主实施有证据的性能优化，不需要例行方案确认。本项由实现者选择方案，不改变预设返回值或其他公开契约。

## 证据与目标

现有本地预览通过真实 Chrome 加载应用源码、Android Web Host 身份与原 ST 内存 fixture。初次 67 行用户设置，在原生状态不变时一次 `shell.refresh()` 产生 81 次无效设置 DOM 更新：16 次相同文本替换，65 次相同属性写入。设置行去重后，壳层仍有 27 次相同属性／文本／图标更新。原始数据在 `output/playwright/settings-refresh-20261126/`。

初次浏览器在启动后才调整到 375×812，重载却从该尺寸初始化，导致原生页面宽度从 50／可编辑变为 100／禁用。该前后耗时不构成同条件提速证据；最终比较须让原始和当前源码都从 375×812 启动。

目标是在原壳层和设置行的投影入口中避免相同写入，降低设置刷新成本。首屏、Rust IO 和手机实测不由该基准证明。

## 方案与边界

原 `mobile-chat-shell.js` 和 `mobile-settings-page.js` 共用 `mobile-chat-dom.js` 的 `syncText`、`syncAttribute`、`syncBooleanProperty`：比较当前 DOM 与本次读取的原状态，只在不同的时候写入。文本保留 DOM 的 nullish 清空语义；属性值为 null 时移除；布尔值继续使用原属性 setter，包括旧 WebView 的 inert 属性行为。搜索图标与同一控件既有展开属性一起更新，不另存图标状态。迁移原七类设置行和壳层刷新写入，保持 range value、事件、保存、选择、busy、约束和样式计算规则。

考虑过缓存原控件快照和延后／合并刷新；前者增加第二份状态和失效规则，后者改变更新时机。本项选择直接按 DOM 当前值判断，原控件仍是唯一数据来源，不加缓存、observer 或新调度。

普通初始化仍构造原结构；动态行分组、URL 校验、输入法、密钥隐藏、失败重试、搜索、导航与焦点保持。同步当前移动布局说明与镜像。schema、宿主和后端保持。

## 验证与收尾

复用现有 `tests/mobile-chat-shell.test.mjs`、`tests/browser/mobile-chat-shell.test.mjs` 和 `tests/browser/api-controls.test.mjs` 的原生值、约束、busy、保存、选择与焦点覆盖。用户禁止为实现细节堆积测试，所以不新增钉住 DOM 写入次数的单测；真实浏览器前后基准证明这项性能效果，已有行为验证证明契约保持。

同一浏览器、fixture、初始视口、四倍 CPU 限速和同一 40 样本脚本重测；原始版本通过本任务精确 before 的两个源码响应呈现，当前版本使用当前文件；每一版都重新加载，不修改生产文件来切换实验。记录相同原生宽度／禁用状态、DOM 内容、无效更新与耗时变化。完成 Chrome 比较和实际编辑后关闭本任务浏览器，再隔离复验超时的 API 文件，并运行原 `pnpm run check`；不提高时间限制，不绕过 actool。Rust 源码未变时不机械重复上一轮已通过的 Rust／Clippy；本轮需要补跑因环境失败中断的 UI 验证。

保护 `feature/mobile-chat-shell` 上的全部已有修改和空暂存区，不提交、推送、PR、stash 或重置。逐路径自审，再由一位独立 reviewer 审阅本项精确增量；Android APK 验包后等待设备验收。本任务临时材料集中在 `.local/settings-refresh-20261126/`，成功验收后清理。

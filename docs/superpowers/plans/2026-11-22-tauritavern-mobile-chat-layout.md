# 手机聊天布局实施计划

> 使用 executing-plans 连续执行；不提交、不推送。用户后续要求直接改造 App 源码，全部文件放在本项目；手机暂不连接。

本文件记录初始实施阶段。后续首页、返回栈与最终验证以 [手机聊天流程与动效优化](2026-11-22-mobile-chat-flow-polish.md) 为准；用户随后授权将本轮改造提交一次。

**Goal:** 手机以 Telegram 式会话栏、导航抽屉、聊天气泡和底部输入框完成日常使用。

**Architecture:** 共享导航负责界面状态、错误恢复和返回；原生角色管理、历史、设置继续拥有数据和实际操作。仅移动宿主启用，不增加角色扫描或第三方书架。

**Spec:** `docs/superpowers/specs/2026-11-22-mobile-chat-shell-design.md`

## 约束与审阅重点

- 不更改角色正文、世界书、聊天、API 凭据和正式备份。
- 生成或保存中禁止角色/历史跳转；打开失败可重试并可返回聊天。
- 后续新卡沿原生列表显示；成功切卡回到聊天。
- 界面返回和 Android 返回一致，弹窗先关闭；输入区、键盘和安全区不遮挡。
- 触控目标至少 48px，沿用既有主题和中文翻译；保留导入、导出、扩展和应用设置。

## Task 1：共享手机导航

Files: `src/scripts/mobile-chat-shell.js`, `tests/mobile-chat-shell.test.mjs`。

- [x] 角色跳转、忙碌保护、更多/返回、错误和卸载测试观察红灯。
- [x] 实现导航 UI 和异步操作保护，测试转绿。

## Task 2：原生接入和布局

Files: `src/scripts/mobile-chat-shell-runtime.js`, `src/tauri/main/bootstrap.js`, `src/css/mobile-chat-shell.css`, `src/index.html`, `tests/browser/mobile-chat-shell.test.mjs`。

- [x] APP_READY 后仅为 mobile host 安装，复用抽屉事件、历史开关和返回栈。
- [x] 实际点击角色、历史和高级入口，验证返回、忙碌和失败。
- [x] 检查小屏、横屏、文字放大、减少动态效果和键盘布局。

## Task 3：构建与交付

- [x] 运行 focused tests、web build、pnpm run check，区分既有失败与新增失败。
- [x] 准备 Android 环境并生成个人 APK；保留正式签名密钥，覆盖安装需手机验证。
- [x] 审阅完整 diff，记录实际验证和手机待验项目。
- [x] 清理已验证且不再需要的临时下载；手机回退包保留到新版真机验收。

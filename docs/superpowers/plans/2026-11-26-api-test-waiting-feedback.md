# API Test Waiting Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 原 API 测试和手机设置行在耗时请求期间显示同一等待状态，并准确恢复。

**Architecture:** 原生 test button 持有 disabled/busy 状态，替代原私有 pending 标志。手机 renderer 在原控件的 change 时刷新并读取它，不复制请求状态。

**Tech Stack:** 原生 DOM、现有 jQuery/i18n、Node browser runtime。

**Spec:** `docs/superpowers/specs/2026-11-26-api-test-waiting-feedback.md`。

## Global Constraints

- 按钮保留 ID `test_api_button`，type 为 button，原 handler 与生成参数保持。
- 保留 64 token 短请求、当前 source/format 与原 prompt-ready/停止事件。
- 原控件持有等待状态，删除 `apiConnectionTestPending`，手机行只派生。
- 完成通知仍由原 handler 负责，finally 恢复状态；settings page dispose 删除订阅。
- 不增加 observer、轮询、网络路径、配置或 UI 依赖。
- 不提交或推送，不操作已拔出的手机。

## Review Focus

- 扩展准备发生在网络请求之前：必须已经显示等待。
- 实际请求晚于全部短期刷新定时器：仍保持 busy，结束后立即恢复。
- 页面在请求内关闭并重开：读取同一原控件状态，旧页面不接收完成更新。
- 正常回复、HTTP 失败和停止：只结束本次操作，原标签与可用状态恢复。
- 直接和手机点击：阻止重复请求，原短测试与一次错误行为保持。

### Task 1: 原控件等待状态与手机设置行同步

**Files:**
- Modify: `src/index.html`、`src/scripts/openai.js`、`src/scripts/mobile-settings-page.js`、`src/locales/zh-cn.json`。
- Modify: `docs/FrontendGuide.md`、`docs/FrontendAccessibility.md`；用原生成器同步内置 FrontendGuide。
- Test: `tests/browser/api-controls.test.mjs`。

**Interfaces:**
- Consumes: 原 test click 与 `generateRawData`、原 DOM `change`、renderer 的 refresh/dispose。
- Produces: 原 test button 的 disabled/aria-busy 与等待文案；手机 action row 的派生等待状态。

- [x] 新增实际 API/button/page 行为覆盖：挂起 prompt-ready 和实际请求，排空本次页面安排的短期 refresh；关闭重开，分别以成功、HTTP 失败和生成停止结束，断言立即恢复、一次请求与一次结果。
- [x] 运行 `node --experimental-vm-modules --test --test-name-pattern="API test controls" --test-timeout=60000 --test-force-exit tests/browser/api-controls.test.mjs`，确认 RED 为缺少等待或完成状态未同步。
- [x] 按钮改原生 type=button；原 handler 使用原 disabled guard、等待文案与 aria-busy，在开始和 finally 发布 change。
- [x] 手机 action row 使用已有 disabled 判断并派生原 busy/文案；renderer 监听原控件 change 进行刷新，dispose 清理订阅。
- [x] 同步中文与文档，运行 focused GREEN，并核对原 API 测试参数／错误覆盖。
- [x] 运行 `pnpm run check`，如实记录完整结果；若被已知 actool 环境失败截断，单独运行未到达的 UI 检查。
- [x] 核对增量及全部状态写入者，独立审阅；归档、更新候选并清理本轮临时材料。

实际结果：focused RED 4/4 失败，GREEN 4/4 通过；完整 Browser 179/179、UI 191/191。完整 `pnpm run check` exit 1，契约 460 pass/1 fail，唯一失败为本机缺少 Xcode `actool`（exit 72）；原 API 测试参数与一次错误覆盖通过。检查期间 2,757 个输入未变。独立增量审阅无 Critical/Important/Minor；没有 Rust 改动。源码未提交，手机已拔出，本轮尚未打包安装。

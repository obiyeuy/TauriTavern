# Settings Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox syntax.

**Goal:** 原状态不变时减少手机壳层与设置页无效 DOM 更新，保持现有交互。

**Architecture:** 壳层和设置行通过同一移动 DOM 投影模块按值写入；原导航／聊天状态与控件仍拥有值和副作用。

**Tech Stack:** JavaScript、原生 DOM、既有 Chrome Web Host 预览与行为覆盖。

**Spec:** `docs/superpowers/specs/2026-11-26-settings-refresh.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护已有修改和暂存区，不提交、推送、PR、stash 或重置。
- 不改变公开契约、range value 规则、原事件、保存、选择、busy、约束、样式与原生状态来源；缺失预设提案不应用。
- 不加缓存、observer、调度、导出 API 或实现细节单测；以现有行为覆盖和相同条件基准验证。
- Rust 源码不变时沿用已核对的上一轮 Rust／Clippy 证据，不将其称为本轮执行。

## Review Focus

- 值与约束实际变化后仍读取原控件并更新；移除 min/max/step 仍移除原投影属性。
- 文本、空白模板、敏感值摘要与选项选择保持，不能跳过实际变化。
- busy、disabled、ARIA 与 persona 选择仍正确投影，保存／重试继续原链路。
- 原 range value 赋值与样式计算、分组、编辑焦点、输入法与事件时机保持。
- 搜索的展开状态与图标同步；导航／隐藏／inert、空聊天信息和动态标题仍正确更新。
- 基准只证明本地 Chrome 设置刷新，不能推广为手机冷启动、404 或落盘验收。

### Task 1: 原设置行按值同步

**Files:**
- Modify: `src/scripts/mobile-settings-page.js`
- Modify: `src/scripts/mobile-chat-shell.js`
- Create: `src/scripts/mobile-chat-dom.js`
- Modify: `docs/CurrentState/MobileStyleAdaptation.md`
- Modify: `default/skills/tt-docs/references/CurrentState/MobileStyleAdaptation.md`
- Reuse: `tests/mobile-chat-shell.test.mjs`
- Reuse: `tests/browser/mobile-chat-shell.test.mjs`
- Reuse: `tests/browser/api-controls.test.mjs`
- Evidence: `output/playwright/settings-refresh-20261126/`

**Interfaces:**
- Consumes: 原 `row.sync()`、原 DOM 控件值与属性、原 `shell.refresh()`。
- Produces: 相同可见值、ARIA、禁用状态、事件与保存结果；无重复状态。

- [x] Step 1: 记录原调用链、基准、精确 before 和其他差异指纹。Expected: 原状态不变、67 行、81 次无效更新；原生状态来源不变。
- [x] Step 2: 原壳层与设置行共用 `mobile-chat-dom.js` 的文本、nullable 属性和布尔 property 写入；迁移七类行和壳层刷新，同步文档镜像。Expected: 不同的投影才写入，原 range value、样式、事件、导航和保存逻辑保持。
- [ ] Step 3: Run `node --test --test-timeout=60000 --test-force-exit tests/mobile-chat-shell.test.mjs`。Expected: 原控件、最新约束、敏感摘要、选择、焦点、保存／重试等全部通过。
- [ ] Step 4: 完成 Chrome 比较后关闭本任务浏览器，按文件 Run `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit tests/browser/mobile-chat-shell.test.mjs` 和同参数 `tests/browser/api-controls.test.mjs`。Expected: 原生参数／模板、busy、导航、搜索与持久化确认全部通过；保留第一次并发运行的 Windows API 组超时记录，不提高限制。
- [ ] Step 5: 原始和当前源码都从 375×812 启动，通过原界面打开相同用户设置，运行同一 canonical 40 样本脚本并验证实际编辑。Expected: 67 行、相同原生页面宽度／禁用状态与 DOM 内容，无效更新减少、同条件耗时下降，实际变化、搜索图标与保存仍成立。
- [ ] Step 6: 冻结输入并 Run `pnpm run check`；如因 actool 缺失中断，保留失败并补 Run `pnpm run test:ui`。Expected: 本项行为无新增失败，输入与其他差异保持；全套未通过时如实记录。
- [ ] Step 7: 逐路径自审并进行一次本项精确增量审阅；根据实际意见校准，必要时修正验证。Expected: 无未处理的重要行为／结构问题，原通知与预设待确认路径不混入。
- [ ] Step 8: Android 构建、验包、更新候选清单并整理临时材料。Expected: 原包名、版本、签名与安装兼容性保持，明确真实设备验收结果或缺失条件。

# 手机填写与操作细节优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 继续优化已安装个人 APK 的填写、阅读、搜索、返回和等待体验，修复审查中可复现的问题并交付同签名正式包。

**Architecture:** 延续既有手机聊天壳层。原生控件拥有参数和事件，手机编辑器派发相同编辑事件并等待共同保存入口；导航拥有页面展示，异步准备不展示上一页的可编辑内容。

**Tech Stack:** JavaScript、原生 DOM/CSS、现有 SillyTavern 控件与事件、Tauri Android。

**Spec:** `docs/superpowers/specs/2026-11-22-mobile-chat-shell-design.md`、`docs/CurrentState/MobileStyleAdaptation.md`，以及本会话中“继续详细优化各种细节”的授权。

## Global Constraints

- 延续 `feature/mobile-chat-shell`，保护已有修改；不暂存、提交、推送或改写历史。
- 原生参数、预设和设置保存仍是唯一数据路径，保留用户已保存的数值和选择。
- API 协议由用户与服务说明决定；不按模型名更改连接，也不替外部公益站保证可用性。
- 最低 Android API 26；个人版 application ID `com.tauritavern.personal` 和签名不变。
- 手机已拔出：完成本机浏览器、自动检查和正式构建；不宣称已经安装新一轮 APK。
- 只对稳定交互或已经复现的缺陷加行为覆盖，文案和普通样式用实际页面核对。

## Review Focus

- 模型更新最大值后，手机滑块、精确输入和原生控件采用同一数值范围。
- 很短的内容视口和长说明下，编辑器仍能看到当前字段与保存/关闭操作。
- 选项搜索为空、当前选项被筛掉及键盘返回时，用户能理解结果并回到正确控件。
- 纯换行/空白模板的摘要可读，编辑和保存保留原始字符。
- 设置页准备较慢或被新导航取消时，旧页面不能以新标题继续接受编辑。

---

### Task 1: 参数精确填写与共同约束

**Files:** `src/scripts/mobile-settings-page.js`、`tests/mobile-chat-shell.test.mjs`、`tests/browser/mobile-chat-shell.test.mjs`。

**Interfaces:** `renderSettingsPage()` 的滑块行读取原生 range 与已有数字 counter；精确编辑复用 `openEdit()` 和 `saveEditing()`，不另设参数状态。

- [x] 复现并覆盖原生 range 改变 `min/max/step` 后手机 range 不同步的问题。
- [x] 数值按钮打开数字编辑器，复制原生 range 约束；输入实际数值、触发原生事件、确认共同保存。
- [x] 用实际 OpenAI 生成参数事件读回值，验证低于最小值和超出最大值的输入不写入。

### Task 2: 设置弹窗、选项搜索与文本摘要

**Files:** `src/scripts/mobile-settings-page.js`、`src/css/mobile-chat-shell.css`、`src/locales/zh-cn.json`、`tests/mobile-chat-shell.test.mjs`。

**Interfaces:** 继续使用同一个设置 sheet；`closeSheet()` 拥有返回和焦点恢复，保存失败由当前 editor 显示。

- [x] 覆盖 Escape、Tab 与保存中返回的行为；弹窗标题有名称，错误提示可聚焦。
- [x] 搜索没有选项时显示结果说明，保持原生选中值；提供可见的关闭操作。
- [x] 纯空白文本摘要显示转义预览，编辑器仍使用原始文本。
- [x] 短视口使用弹窗内部滚动，标题与操作可见；触控区、焦点和减少动态效果符合现有样式规则。

### Task 3: 页面切换与填写说明

**Files:** `src/scripts/mobile-chat-shell.js`、`src/scripts/mobile-settings-schema.js`、`src/scripts/power-user.js`、`src/locales/zh-cn.json`、`tests/mobile-chat-shell.test.mjs`、`tests/browser/mobile-chat-shell.test.mjs`。

**Interfaces:** `showSettingsPage(id, signal)` 准备数据；`present()` 管理当前页面与取消令牌；schema 只组织原生字段。

- [x] 覆盖慢准备和取消时的旧页展示；进入新页前移除旧编辑器，取消的准备不发布页面。
- [x] 原生 source 不变时，按参数用途增加默认值、上下文/回复预算、格式和高级选项说明；高级组采用现有折叠机制。
- [x] 修复可见 label/icon 所代理的隐藏 checkbox 被误排除：指令/系统提示词启用及模板关联仍使用原生 checkbox 与事件，不复制启用状态。
- [x] 修复原生启动值回填：两个模板派生开关同步 checkbox 与图标；快速模仿读取自己的保存值，验证第一次关闭和实际落盘。
- [x] 用浏览器核对侧栏当前页、返回路径、原生编辑入口与空搜索状态。

### Task 4: 验证、审阅与交付

**Files:** 相关 CurrentState 文档、`output/` 正式 APK、manifest 和交付记录。

- [x] 运行 focused 行为测试与 Rust crate 边界检查，再运行 `pnpm run check`；如仍缺 Xcode `actool`，如实记录并继续执行被短路的后续检查。
- [x] 真实浏览器验证 320/375px、横屏与键盘缩短视口、夜间模式、放大字体及减少动态效果。
- [x] 按 `requesting-code-review` 进行独立审阅并处理实质问题。
- [x] 用原 Android 构建入口生成正式包，核对签名、application ID、非调试和 16 KiB 对齐。
- [x] 清理本任务临时诊断材料和浏览器会话；保留正式 APK、交付记录、用户数据和旧恢复包。

## 实施记录

- 审查阶段：原生 `openai.js` 在模型切换时更新 range 的最大值并发出 input；手机行只在创建时复制约束，因此刷新时仍采用旧范围。
- 审查阶段：range counter 在原生页面支持直接填写，但手机 schema 去掉重复 counter 后仅留下滑块，精确输入能力同时丢失。
- 审查阶段：文本摘要用真值判断是否为空，纯换行因此被当成已有内容，但单行摘要不显示任何可见字符。
- 审查阶段：新设置页等待 `preparePage()` 期间，旧设置页尚未释放，页面标题已经变化。
- 取舍：恢复这些已有能力并完善共同交互；不新增配置存储、模板系统或导航模式。
- 后续审查：`instruct_enabled`、`sysprompt_enabled`、`context_derived`、`instruct_derived` 的原生 checkbox 使用 `display:none`，实际可见交互由包裹的 label 和图标提供。手机筛选把 input 本身是否绘制当成了该控件是否可用，导致这些开关缺失；整体隐藏的 label 或分组仍应排除。
- 独立审阅发现并复核：编辑器提交时重读最新数值范围；动态分组重建后按原生控件 ID 恢复焦点；手机概览与原生编辑入口使用同一个侧栏当前页。修复后的两次独立只读审阅均无未解决问题。
- 浏览器最终核对：375px 夜间模式、字体比例 1.5 下，设置行实际字体为 22.5px，页面宽度与 scrollWidth 均为 375px；三个模板自动选择/关联开关采用短而明确的名称。
- 浏览器最终核对：259 字符的合法测试 URL 在 320×240、大字体下可编辑和保存，读回与输入逐字一致；`\n\n` 模板打开和保存后仍为两个实际换行。短屏内输入正文可以滚动，标题和操作保持可见。
- 减少动态效果分别核对应用开关和系统偏好；应用开关关闭、系统 `prefers-reduced-motion: reduce` 开启时，编辑器 transitionDuration 为 `0s`。
- 初始化补查前的完整 harness：浏览器 106/106；契约 458/459，唯一失败为本机缺少 Xcode `actool` 的 macOS Icon Composer 测试。未绕过或修改该测试。单独执行被短路的检查：UI 190/190；Rust 1267 通过、0 失败、1 忽略；workspace Clippy 通过。本轮无新增 Rust 产品修改。
- 初始化补查：启动前向内存仓储保存 `context_derived=true`、`instruct_derived=true`、`quick_continue=false`、`quick_impersonate=true`。原代码确实读到了保存值，但派生复选框没有回填，快速模仿复选框读取了快速继续的值。两个行为用例均先失败；共同初始化入口三处修正后，该集成组 7/7 通过，独立审阅亦复跑 7/7 通过，无未解决问题。
- 浏览器初始化核对：使用专用模拟预览的启动配置恢复上述保存值，原生派生开关和手机 switch 均显示开启。未修改用户配置或向真实 API 发请求。构建曾为加入这项最后发现的修复而中止，最终包已在全部修改完成后重新构建。
- 最终完整 harness 已覆盖初始化修复：浏览器 108/108，契约 458/459；唯一失败仍为缺少 Xcode `actool`。正式 Android 构建成功，沿用原个人证书，v2/v3 签名、非调试标志、APK 和三个原生库的 16 KiB 对齐均通过。45 个构建输入及删除状态在构建期间未变。
- 正式交付：`output/TauriTavern-personal-2.4.0-detail-polish.apk`，101.4 MiB，SHA-256 `4b126b0eff8b40e0ca872402a3650d1c43861340b0849a33a77cc1eefb4db648`。校验记录与 `output/apk-detail-polish-delivery.md` 已保存；本轮尚未安装到手机。
- 生命周期收尾：专用诊断目录已删除，浏览器会话和预览进程已关闭，已确认的临时界面转储、过渡截图和生成包重复副本已清理；保留九张验收截图、正式包、旧恢复包、构建工具链和签名。旧设备 XML 等下次正常连接时清理。

## 下一批候选核查

| 候选 | 已核对证据和影响 | 当前结论 | 下一步验证 |
| --- | --- | --- | --- |
| 模板派生与快捷按钮的启动值 | 最高层实际启动流程复现保存值与控件值不一致；第一次点击无法关闭原本开启的项 | 已在共同原生初始化入口修复，集成组与独立审阅均 7/7 通过，完整浏览器 108/108，正式包已交付 | 下次连手机复查实际保存状态 |
| Vertex 服务账户 JSON 的敏感标记 | `SECRET_KEYS`、`INPUT_MAP` 与 `initSecrets()` 共同标记 `data-tt-sensitive`，手机编辑器读取该标记；现有浏览器验证覆盖 JSON 验证和等待保存 | 未发现绕过敏感显示的问题，不增加 ID 特判 | 若出现实际泄露或保存失败，再按同一凭据路径复现 |
| 进一步冷启动和长聊天性能 | 上一轮真机已记录 11.374 秒冷启动；缺少同条件的前后基线。当前 ADB 无设备，模拟预览不能替代用户手机的 IO、扩展和 WebView 负载 | 暂无证据支持新的性能改动或提速百分比 | 下次正常连手机时，对现有包和本轮包进行同条件测量，再按瓶颈选择改动 |
| 图片和 MVU 重开 | 上一轮真实聊天的图片、变量与 schema 已完成冷启动读回；本轮完整浏览器回归通过，没有新的具体失败记录 | 保留已验证的数据与事件路径，不再重复改写 | 本轮包覆盖安装后复查同一批真实聊天 |
| 公益 API 维护 | 已修复协议错配造成的 `/responses` 404；后续真实响应为站点维护 503，类脑多位用户反馈一致 | 维护属于外部服务可用性，不能用重复改协议解决 | 服务恢复后验证 Chat Completions；不自动改模型、地址或密钥 |

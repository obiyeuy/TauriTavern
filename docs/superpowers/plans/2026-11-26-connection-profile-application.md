# Connection Profile Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 配置失败停止后续重放，脚本和界面只发布属于本次实际成功应用的结果。

**Architecture:** 沿原 managed command helper、application queue 和版本归属，收敛选择／reload／`/profile` 的应用入口。脚本等待实际操作 Promise，原生和后台入口接管其错误；不新增失败事件、pending 状态或补偿回滚。

**Tech Stack:** 现有 JavaScript、jQuery 原生控件、slash executor、happy-dom 与 Web Host fixture。

**Spec:** `docs/superpowers/specs/2026-11-26-connection-profile-application.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护已有差异和空暂存区，不提交、推送、PR 或发送真实 provider 请求。
- 原 Profile／Model Target 事件名称及字符串参数、`<None>`、未找到配置、timeout 和 `await=false` 的返回约定保持。
- `ALLOW_EMPTY` 的输入约定、原合法空结果（含 prompt-post-processing none）、force 和 CC 的第二次 api 保持；`/secret-id` 的 quiet 和失败空字符串契约保持。
- 选择引用仍是用户所选对象；失败保留可供重试的选择和详情，不回滚独立写入或引入跨设置事务。
- 手机连接恢复时优先安装已校验 APK；设备安装与本项源码检查分开报告。

## Review Focus

- 非空失败结果与实际抛出原因：停止后续连接，保留命令上下文或原原因，重试成功。
- 两个原允许空字段：实际重放清空值，不能在密钥步骤之前误报失败。
- 原生选择／reload 与 Model Target：拒绝由发起者呈现一次，不出现未处理拒绝或成功提示。
- 无关 LOADED 与 `<None>`：本次等待只属于实际操作，旧操作结束不连接或发布旧成功。
- `await=false` 与详情渲染：及时返回原名称，后台失败可见；详情等待不延后版本归属。

### Task 1: 统一配置应用的结果与归属

**Files:**
- Modify: `src/scripts/extensions/connection-manager/index.js`
- Modify: `src/scripts/slash-commands.js`（独立审阅后的原 API quiet 边界修正，保留此前修改）
- Create: `tests/browser/connection-manager.test.mjs`
- Modify: `src/locales/zh-cn.json`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`
- Modify: `docs/FrontendHostContract.md`
- Modify: `default/skills/tt-docs/references/FrontendHostContract.md`

**Interfaces:**
- Consumes: 原 managed command callbacks、ALLOW_EMPTY、application queue／version、原生 select 与 reload、Profile／Model Target 事件和原 slash executor。
- Produces: 内部 `applySelectedConnectionItem(): Promise<string>` 统一选择、详情准备、重放队列／版本和成功事件；两种字段重放接受同一 `applyCommand(command:string,value?:string,args?:object): Promise<string>`，不再各自拥有队列或 spinner。队列只等待准备／重放，不等待通知，以允许订阅者再应用一项。

- [x] Step 1: 保存精确七文件 before、其他 Git 差异及暂存指纹，归档原失败与排序探针，核对当前分支和相关文档。
- [x] Step 2: 添加实际执行器与原生控件覆盖：密钥激活失败和重试；抛出格式错误；选择／reload 的失败提示；无关加载事件；None 在密钥成功／失败后的取消；非等待模式。用已保存 Model Target 数据核对相同原生错误入口，不替换应用函数或命令 callback。
- [x] Step 3: Run `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit tests/browser/connection-manager.test.mjs`。Expected: 原错误被误报成功、等待提前结束、None 后旧成功及缺失提示处 RED，测试启动只有一个原生选择框。
- [x] Step 4: 扩展既有 require helper 的原允许空语义，Profile 重放复用它并移除吞错继续；队列与 spinner 收敛到 `applySelectedConnectionItem()`，版本在共同选择 setter 推进，覆盖捕获／创建／删除；同一 applyCommand 在执行前后核对现有版本，删除被版本替代的 spinner abort 镜像。统一选择／reload／命令的结果入口和错误 owner，移除 generic event wait，同步中文错误标题和两份文档镜像。
- [x] Step 5: Run 相同 focused 命令及本地原控件流程核对。Expected: 全部 GREEN；合法空字段、重试、当前模式、原事件参数及独立保存保持，取消不发布旧成功。
- [ ] Step 6: 冻结输入，Run `pnpm run check`，补执行被已知 actool 环境失败阻止的 UI／Rust／Clippy。Expected: 行为无新增失败，环境失败准确记录，源码和其他 Git 差异稳定。
- [ ] Step 7: 逐路径自审并做一次精确七文件独立审阅，归档证据、更新候选与交付说明，验证结束后清理本项临时材料。没有 Git 提交步骤，APK 和设备状态按事实更新。

### 最终审阅修正

唯一独立审阅已返回 With fixes，两项 P2。按 receiving-code-review 核对事实后，空选择不等待旧 I/O、清理 spinner 并沿共同通知出口完成，但保留原队列；原 `/api` 的无效输入遵守已有 quiet，普通公开调用仍提示并返回空字符串。补入该文件的精确 before 与扩大后的其他差异指纹，按一次最终反馈修正，不再派审阅或反复重新审阅。最高层 RED 已复现四个受影响行为；逐项修正后运行 focused 与完整 harness，APK 和设备验证单独记录。

Android 模板等待复核再次 RED：旧 IPC 结果在空选择完成后覆盖“无配置”。详情渲染使用同一选择 version，并收敛两种对象的模板读取／发布，不另设状态。实际 IPC 行为覆盖与原生流程复核通过后冻结完整检查输入。

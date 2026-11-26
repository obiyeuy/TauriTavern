# 请求失败呈现归属实施计划

> **For agentic workers:** 使用 `superpowers:executing-plans` 在本会话逐项实施；用户不授权提交、推送或例行方案确认。

**Goal:** 让一次内置 API 测试失败只由发起者展示一条通知，保留诊断、错误传播与显式后台错误。

**Architecture:** `map_command_error()` 只映射返回错误并记录 command 诊断；`log_user_visible_error()` 与原后端事件桥继续承担显式后台产品事件。`sendOpenAIRequest()` 从已有请求 type 派生 quiet 解析选项，不增添去重缓存、请求状态或另一条通知链路。

**Tech Stack:** Rust / tracing、现有 JavaScript / toastr、生产 Browser Runtime、同签名 Android release。

**Spec:** `docs/superpowers/specs/2026-11-25-request-error-presentation.md`

## 全局约束

- 分支 `feature/mobile-chat-shell`；保留原有未提交修改与空暂存区。
- 不修改 URL／模型／密钥、返回错误结构、请求参数或 TLS／VPN 设置。
- 修改前保留本项准确基线，审阅只比较本项增量；临时材料统一放在本任务专用目录，验收通过后清理。
- 使用已有最高层行为覆盖；不做源码文本断言，不因静态文案增加测试。

## 审阅重点

- quiet 请求的 HTTP 错误和成功 HTTP 响应内的 error 都向发起者拒绝，通知仅一条。
- 正常聊天、流错误和公开 `tryParseStreamingError(..., { quiet })` 的既有语义保持。
- CommandError 的分类、结构和上下文保留；诊断记录仍存在。
- 取消、限流和冲突继续使用既有 warning；显式后台和部分成功通知仍保留。
- 真机网络失败不能因删掉重复 toast 被描述为修复；真实 API 成功与重开验收分别记录。

## Task 1：统一返回错误的呈现归属

**Files:** `src/scripts/openai.js`、`src-tauri/crates/tauritavern/src/presentation/commands/helpers.rs`，以及仍手工广播返回错误的 `preset_commands.rs::preset_type_from_api_id()`；最高层覆盖使用 `tests/browser/api-controls.test.mjs` 和 `src-tauri/crates/tauritavern/src/infrastructure/logging/tracing_runtime.rs` 的现有日志事件测试。文档更新 `docs/CurrentState/LoggingObservability.md` 与 `docs/FrontendGuide.md` 及相应镜像。

- [x] 保存本项准确基线；完成真实调用链与其余显式 user-visible 使用点核对。
- [x] 扩展实际 API 按钮的行为覆盖：两种错误响应都只出现一条错误通知，生成预算保持；扩展现有日志事件覆盖：返回错误只进入 command 诊断，显式后台事件仍进入 UI 消费通道。
- [x] 运行 focused Browser 与受影响 Rust focused，确认失败来自实际重复通知和错误广播。
- [x] 在共同 mapper 与原请求解析选项中修复；保留原返回值和公开接口。
- [x] 运行 focused GREEN、Rust crate 边界和完整 `pnpm run check`；最终 Browser 145/145，契约 460/461，唯一环境失败为缺少 Xcode `actool`；补跑 UI 191/191、Rust 1270 通过／0 失败／1 忽略及 Clippy 退出 0。
- [x] 同步文档、逐路径自审和一次独立只读审阅；31 文件准确增量中无无关改动，Critical／Important／Minor 均为 0，`net: -9 paths`。
- [x] 构建并覆盖安装同签名正式包。2026-11-25 17:01:24 安装成功，读回安装文件 SHA 与正式 APK 一致；没有卸载或清空数据。
- [ ] 手机空闲后复查一次错误通知、原有配置／图片／MVU／输入法及加载指标；记录当前服务的实际结果。
- [ ] 整理验收资料，恢复临时手机设置，清理本项材料和重复构建产物；更新候选。

## Task 2：迁移依赖隐式通知的操作发起者

- [x] 核实审阅指出的 Quick Reply 保存／删除、背景上传、群组删除和表达图像删除，并审计第一方实际请求消费者；区分检查结果已有调用者、后台诊断与用户操作失败。
- [x] 在现有完整 Web Host 会话覆盖中复现失败仍被当作成功、状态先变更或失败没有界面说明的行为，保留相关数据不变的断言。
- [x] 复用 command error 工具检查失败 HTTP 响应，由界面发起者通知；供 API／脚本调用的入口拒绝，不恢复全局 backend toast。
- [x] 对已确认的失败路径完成调用者迁移、focused GREEN、完整 harness 和独立复审，正式包已构建并覆盖安装。

## 执行记录

- Ruling：本项自行在当前分支实施，不运行会自动提交的 skill 脚本，也不重新隔离或审阅此前已验证的全部分支改动。用户未授权 Git 提交，当前工作区含大量既有增量，本项用文件基线和准确差异保护它们。
- 真机 RED：内置短测试一次、回复预算 64，约 7.553 秒后观察到三条错误。两条本地化 TLS 提示和一条后端英文提示描述同一次 `/v1/chat/completions` 失败。该耗时含 UI Automator 观察开销，不作为服务响应性能基线。
- 网络核对：手机系统时间正常、系统 HTTP proxy 为 `:0`；状态栏 VPN 开启。手机 Chrome 显示 `ERR_CONNECTION_CLOSED`。桌面经配置代理和不使用 HTTP proxy 的请求均完成 TLS 校验并收到未认证的 401。具体手机网络原因仍未确认，未改变 VPN 或 TLS 校验。
- Browser RED：真实 API 按钮返回 HTTP 502 时，错误通知为 2 条而要求 1 条；此前行为均通过。Rust RED：原日志事件测试额外收到同一个返回的 TLS 错误，退出码 101；是实际广播重复，不是编译失败。初次直接调用 cargo 因本机 PATH 不含工具而未执行，随后使用已有 Android/Rust 环境完成 focused 复现。
- 已核对其余显式 user-visible 使用点：后台启动、部分角色／预设操作及读取跳过错误继续原通知。`preset_type_from_api_id()` 原先手工广播一个随后返回的 BadRequest，也已迁入共同 mapper；头像裁剪的提示属于继续上传时的部分结果，本项保持。
- 补跑完成：UI 191/191、Rust workspace 和 Clippy 均退出 0；完整 harness 唯一失败仍是本机缺 Xcode `actool` 的 macOS 图标校验，未跳过。审阅发现调用者迁移遗漏，因此这些通过结果尚不代表本项可交付。
- 首屏基线：同一已安装参数帮助 release 包冷启动，角色列表在 5.626 秒的观察中尚未就绪，8.342 秒观察时可用。UI Automator 开销包含在内；这不测量内部 APP_READY 或扩展完成，也不能与不同条件下的旧包比较。
- 调用者审计：检查实际命令路由与第一方请求发起者，额外确认扩展删除、角色扩展单项／批量写入、资源下载／删除／列表、图库加载和备份列表的遗漏。统计本地缓存、未实现插件探针和保留的旧 provider 入口不依赖本次 mapper；预设删除的布尔结果已有界面 warning。正则和图片提示词界面接管其角色字段写入的拒绝，脚本路径保留拒绝。
- 五个最高层 RED：用核验过 SHA 的本项源文件基线重放新会话覆盖，Quick Reply、群组、背景、表达图像及角色扩展字段五种失败均复现（5 failed / 0 cancelled），没有切换或覆盖工作区。最初的表达图像测试没有初始化默认禁用的扩展而超时；已按生产 `init()` 初始化，并用通知／刷新结果确定性协调，未加入 sleep。
- 设备保护：后续观察到手机前台为 `com.limelight` 串流界面，因此暂停实际 UI 触控，继续独立源码和构建工作。当前没有新的接口成功或 MVU 完整生成验收结果。
- 第二轮独立复审给出六项 Important 和一项 Minor，均沿实际调用者核对：Quick Reply 发布顺序和覆盖、普通头像及 LAN 配对错误接管、正则失败状态、预设重复通知、表情读取假空结果、角色与群组组合刷新，以及图库建议不可用的说明。源码按共同写入／发布边界迁移，同名 Quick Reply 保留现有引用，默认预设恢复不先删除。
- 新增最高层 RED 已确认 Quick Reply 未保存即发布、头像失败无提示、组合刷新失败仍发布角色，以及预设错误文本丢失。进一步的三个 RED 分别复现表达删除失败无提示、预设实际错误丢失与正则脚本未等待完整应用；3 failed / 0 cancelled。没有覆盖工作区或改动历史，使用核验后的本项基线重放。
- 修复表情读取传播后，focused 验证发现扩展初始化的后台调用没有接管拒绝。调度入口已中止失败更新并记录诊断，显式设置操作继续由界面通知；未恢复假空缓存。正则保存／应用的状态确认收敛到各自成功路径，取消新建不产生虚假的已应用 ID。
- 手机重新连接后，`stay_on_while_plugged_in` 已恢复原值 `0` 并读回确认，恢复记录不再 pending。之后 ADB 曾短暂断开并重新在线；前台再次为 `com.limelight`，因此继续构建工作，暂不切走串流界面。
- 第三轮独立复审：Critical 0、Important 2、Minor 0。上轮具体问题已修，剩余为高级格式主导入、聊天转群组、复制角色后的刷新、fallback UI，以及 VN 后台／显式刷新调用者。四个最高层 RED 分别确认无提示、未接管拒绝和复制后刷新拒绝；4 failed / 0 cancelled。已按操作阶段迁移；后台 VN debounce 与周期刷新使用同一诊断处理。
- 最新完整 harness 首次运行的 Browser 部分为 129 通过、0 断言失败、11 超时取消，退出 1，后续集合被短路。不能沿用前轮“仅缺 actool”的结论；先用相同集合及 60 秒阈值降低文件并发复核，再决定是否需要调整测试调度。
- 相同集合、相同 60 秒阈值改为文件并发 2 后全部通过；原 Browser 入口仅调整调度，没有删测试或放宽超时。最终完整检查与补跑结果见 `output/verification/request-error-presentation-20261125/final-verification.json`。
- 正式包为 `output/TauriTavern-personal-2.4.0-request-errors-fix.apk`，SHA-256 为 `e63bcf7e5c420d74b365b736459bcae91393a76ad1554a8040543d5832a7dcd2`。120 个修改输入和 127 个总输入构建前后相同；签名、非调试、AArch64、16 KiB 对齐、主库及无 Pilot socket 标记均通过。安装核对见同目录下 `installation.json`。
- 本轮临时插电亮屏设置已在 17:13:17 恢复原值 `0` 并读回。手机前台随后继续为 Moonlight Noir 的设置／文件选择流程；没有把前台切走后的空快照计为 APK 白屏，也没有把包安装成功计为 API、图片或 MVU 验收成功。

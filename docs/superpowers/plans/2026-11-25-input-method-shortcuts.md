# 输入法合成与快捷键一致性 Implementation Plan

> 使用 `superpowers:executing-plans` 顺序执行，按 `maintain-conceptual-integrity` 收敛共同规则。用户已授权日常修复，无例行方案确认或 Git 提交。

**Goal：** 中文等输入法正在选字或标记为已处理的按键，不触发应用的保存、发送、关闭、菜单移动或搜索失焦；普通快捷键保持原有行为。

**Architecture：** 在 `src/scripts/util/keyboard-event.js` 提供无状态的共同输入法判断，读取原生事件或 jQuery 包装的原始事件，以及已有的 229 兼容标记；React 回调直接传 `nativeEvent`。各键盘行为拥有者调用同一规则，不全局拦截事件、不新增合成状态。`keyboard.js` 是控制初始化入口并依赖 legacy-controls，不把基础谓词放入它来引入循环或额外初始化依赖。

**Tech Stack：** JavaScript、DOM KeyboardEvent、现有手机页面与原生键盘控制；Happy DOM／真实 Chromium 行为验证。

**Spec：** 本会话的持续细节优化授权，`docs/FrontendGuide.md`、`docs/FrontendHostContract.md`，以及 `RossAscends-mods.js`、Popup 和 DOM counter 中已经使用的原生合成／229 规则。

## 边界与证据

- 延续 `feature/mobile-chat-shell`，保护已有未提交修改；不暂存、提交、推送或改写历史。
- 原生字段及保存入口仍是唯一参数来源。输入法按键不应用草稿；正常确认后仍经原生 input/change 和共同保存入口。
- 保留普通 Enter、Escape、Tab、箭头和 Mod-Enter 的现有绑定，不增加偏好或改动输入法本身。
- 已在独立 DOM 诊断中复现两种事件：`isComposing=true`，以及 `isComposing=false/keyCode=229`。设置 Enter 各触发一次保存并写入“尚在选字”；Escape 关闭 sheet；顶栏 Enter 失焦、Escape 清空查询。
- 原生 Popup／主聊天热键已保护这两种事件；手机层未保护，legacy 控件和全屏聊天编辑器仅保护 isComposing。先验证真实行为，再迁移全部实际判断入口。
- UI 技能检索两次仅匹配通用键盘导航／输入类型，没有专门 IME 规则；具体判断依据当前项目行为与原生事件语义。
- 独立审阅指出第一方 Agent 重命名仍只判断 `isComposing`。扩展现有 UI 流程复现 false/229 取消标题草稿，合成箭头误开模型菜单、误写时间线高度；共同规则接入 History、ComposerMenu、AssistantApp 和 RunTimelineApp，普通确认、导航与分层 Escape 均由同一流程核对。
- 完整搜索覆盖第一方扩展，补查 keypress 与所有显式键盘动作。参数 JSON、模型 ID、展开编辑器 Tab、命令补全已有真实行为失败；对应配置、文本编辑、Quick Reply、TTS、菜单及宿主快捷动作迁移共同规则。纯 input／keyup 内容观察、Quick Reply 的 Shift 释放清理和 CodeMirror 内部键映射保留原责任。

## 执行步骤

- [x] 核对设备、分支与暂存区，查明现有键盘事件路径和共同保护规则。ADB 当前无设备。
- [x] 使用任务专用 DOM 诊断复现手机保存／关闭和搜索失焦／清空，记录原始事件标志及结果。
- [x] 扩展现有手机原生保存集成与搜索／菜单行为覆盖、legacy 控件合成用例，确认修复前失败。
- [x] 实现共同 `isComposingKeyboardEvent(event)`，迁移手机 settings／shell、主聊天快捷键、Popup／菜单、range counter、legacy activation 与全屏聊天编辑器；删除被替代的分散判断。
- [x] 补查全部第一方 JS／TSX／keypress 入口，将 Agent、参数／模型填写、命令补全、文本编辑、Quick Reply、TTS 和宿主显式快捷动作迁移到共同判断；内容观察和修饰键释放清理保持原语义。
- [x] 同一行为用例由红转绿；核对普通确认仍写入真正的原生设置。用真实 Chromium 核对输入法标志、编辑框、搜索和必要的发送／退出路径。
- [x] 更新规范及登记的内置文档镜像，逐路径自审，按 review skill 进行独立只读审阅。
- [x] 执行 focused 前端检查和完整 `pnpm run check`；actool 环境限制如实记录，完成被短路的后续检查。
- [x] 生成同签名正式 APK，核对源码、版本、非调试、故障／Pilot 标记与 16 KiB 对齐；手机未连接时不声称安装。
- [x] 汇总行为证据、更新候选清单，清理本轮专用诊断／浏览器会话／重复生成包，保留交付记录。

临时材料集中在 `.local/input-method-shortcuts-20261125/`；真实浏览器验收资料放在 `output/playwright/` 的本轮专用目录。无用户数据或真实 API 请求。

**红绿证据：** focused 旧实现运行有四项行为失败（外层集成组同时标为失败）：设置草稿 1536 被写入原生／存储，预期仍为 128000；旧控件点击计数 3，预期 1；搜索与菜单各失去原本焦点。共同规则迁移后，手机组件、旧控件、真实原生保存集成、Popup 和 API controls 的同一 focused 集合 72 passed / 0 failed。

**真实 Chromium 基线：** 使用同一生产全屏输入控制器、CSS 和模拟发送依赖，输入“尚未确认的中文草稿”，构造 WebKit 的 `isComposing=false/keyCode=229` Mod-Enter。旧实现 `defaultPrevented=true`、dialog 关闭、模拟发送计数 1，源字段已被更新；输入法处理过的键错误触发了发送。基线只用于行为验证，未访问真实聊天或服务。

**Agent 红绿证据：** 同两份现有 AssistantApp／RunTimelineApp UI 测试从 19 passed / 3 failed 转为 22 passed / 0 failed。旧实现让标题输入框消失、模型菜单误打开、时间线高度从未设置改为 160px；新实现保留草稿、菜单和尺寸，普通 Enter 重命名、箭头导航、Escape 关闭正确层级仍有效。独立审阅复跑 22/22 通过，Important 已关闭。

**填写与文本编辑红证据：** 原生 API／Popup 行为集合 20 passed / 6 failed（四个行为及两个外层组）。合成 Mod-Enter 把原生 `temp_openai` 从 0.8 改为 0.37；模型 ID 被加入列表且字段提前清空；展开编辑器插入 Tab；命令补全从“选项一”移到“选项二”。无真实 API 请求或用户数据。

**整轮检查：** 手机、legacy、原生保存、Popup、API 和桌面 F11 的 focused 集合 76 passed / 0 failed。完整 `pnpm run check` 的平台、前端、类型、Lint、日志和 Rust 边界检查通过，浏览器 112/112；契约 458/459，唯一失败为本机缺少 Xcode `actool` 的 macOS 图标编译。未跳过或修改该测试。单独完成被短路的 UI 191/191、Rust 全库 1270 passed / 0 failed / 1 ignored 和 workspace Clippy。新增时间线用例曾触发 max-lines，移除不必要的几何 fixture 与重复按键组合后，Lint 和两份 UI 的 22/22 均重新通过。

**自审与独立审阅：** native、jQuery 和 React 均在动作之前读共同谓词；父子 Escape 按原 `defaultPrevented` 协作，内容输入与修饰键释放保留原路径。新接入的 API／Popup／F11 集合独立复跑 27/27，通过差异检查和文档镜像比较，无未解决的 Critical、Important 或 Minor。12 处既有独立输入法判断收敛为一处，不新增状态或全局拦截。

**真实 Chromium 验收：** 393×851 下，编辑页 4、搜索 4、实际操作菜单 8、全屏输入 4 个原生合成标记事件均未触发应用快捷动作。普通 Enter 保存一次，搜索 Enter 收起输入焦点、Escape 清空原生查询并返回搜索按钮；菜单 ArrowDown 移到文件导入项，Escape 关闭并返回 Create；普通 Mod-Enter 发送一次。使用生产控制器与 CSS，保存／发送为模拟依赖，CodeMirror 为无操作测试依赖。设置 fixture 补齐实际宿主 body class，菜单探针改用实际操作菜单，未把诊断定位错误当成产品缺陷。三张最终截图保留在 `output/playwright/input-method-20261125/`；真实手机和 Rich Editor 的完整集成待验证。

**正式交付：** `output/TauriTavern-personal-2.4.0-ime-fix.apk`，101.39 MiB，SHA-256 `0948d7f71fffca3c7948dc9bb56980cfdc983d39116c5afd66c82bf4bf3fa7ad`。原个人证书、v2/v3、发布标志、三个原生库及 APK 的 16 KiB 对齐通过；主库与新 Rust 输出一致，helper 资源路径已入包。80 个构建输入、文件模式与删除状态在构建期间未变；世界书生产输入与上一正式包一致。ADB 当前无设备，本版未安装。说明及校验记录位于 `output/apk-ime-fix-delivery.md` 和匹配 manifest。

**清理：** 已关闭本轮 `apk-ime` 浏览器与专用预览服务。核对完整目录归属、常规文件类型、符号链接及挂载边界后，清理诊断目录的 41 个文件／2 个目录、19 个明确归属本轮的 Playwright 临时文件，以及与正式包 SHA 完全一致的原始重复 APK；清理后正式包 SHA 再次一致。正式包、旧恢复包、三张有效验收截图和 Android 构建／签名环境保留。手机旧 XML 待下次连接确认后清理，目标仍未标记完成。

## 候选清单

| 候选 | 证据与影响 | 当前选择／验证 |
| --- | --- | --- |
| 输入法合成与应用快捷键冲突（含 229） | 手机设置／搜索、Agent 草稿／菜单／尺寸、原生参数／模型和文本编辑已复现；真实 Chromium 已复现全屏误发送 | P0 已实现、验证、审阅并交付正式包；新版真机验收待设备 |
| 手机性能与新版冷启动 | 当前无 ADB，已有 11.374 秒单次就绪记录不足以支持提速百分比 | P1 待同一手机、数据与扩展下分项测量首屏、角色、图片／扩展和服务耗时 |
| 最新包的 API／图片／MVU 重开 | 旧轮真机曾读回正确状态，离线行为与存储覆盖继续通过；新包尚未覆盖安装 | P1 待安装后复查同一批真实聊天；不重复改写已经有效的路径 |
| 公益站当前可用性 | 旧 404 已通过正确协议解决，后续真实响应为维护 503；本轮无新服务请求 | P2 在服务可用时复查生成，按新响应定位，保留用户选择的模型、地址与密钥 |

# TauriTavern 前端指南

本文档描述 TauriTavern 当前前端（基于 SillyTavern 1.19.0）在 Tauri 环境下的集成架构与开发方式。

宿主层对外契约清单见：`docs/FrontendHostContract.md`（重构时优先保障其不回归）。

共同控件与无障碍约定见 [FrontendAccessibility](FrontendAccessibility.md)。

## 1. 目标与原则

- **最小侵入**：尽量保持上游 SillyTavern 前端行为不变。
- **模块化**：将 Tauri 注入逻辑拆分为独立模块，避免单文件膨胀。
- **低耦合**：路由注册、请求拦截、业务上下文分离。
- **入口收敛**：统一走 `init.js -> tauri-main.js -> tauri/main/*`，减少重复入口。

## 2. 启动链路

当前前端启动顺序如下（宿主身份在页面脚本运行前已写入，见 2.1）：

1. `src/init.js` 等待[可选的开发资源桥就绪信号](FrontendHostContract.md#22-就绪信号publicproject)，随后动态导入：`lib.js` -> `tauri-main.js` -> `script.js`
2. `src/lib.js` 静态导入 `src/dist/lib.core.bundle.js`，统一提供 ESM 导出；`highlight.js` 通过 `getHljs()` 按需加载
3. `src/tauri-main.js` 仅调用 `bootstrapTauriMain()`（薄入口）
4. `src/tauri/main/bootstrap.js` 负责：
   - 创建运行上下文（`context`）
   - 注册前端路由（`router + routes/*`）
   - 安装请求拦截器（`fetch` 与 `jQuery.ajax`）
   - 安装平台 ABI：`window.__TAURITAVERN__`（小而稳定的宿主对外接口）
   - 安装同源窗口下载桥（所有宿主的浏览器式导出 → 原生交付）
   - 安装 Tauri mobile 兼容层（runtime polyfills，仅移动端）
   - 为宿主接管的路由响应注入追踪 header：`x-tauritavern-trace-id`
   - 安装后端错误桥并等待 `BackendReadiness`
   - Tauri 就绪后安装窗口快照与窗口背景发布（仅移动端）

核心应用的 `APP_READY` 允许列表和设置先显示。该事件的监听器执行完成后，`extensions.js` 发布 deferred third-party 激活任务；聊天选择、加载和生成共同等待它，激活失败时传播同一错误。桌面恢复上次聊天也在激活后进行，tokenizer/scraper 初始化独立执行。`APP_READY` 启动钩子可以调用聊天 API，所以任务发布前的调用保持原有语义，避免等待自身事件完成。具体顺序见[第三方扩展](CurrentState/ThirdPartyExtensions.md#21-发现与激活)。

### 2.1 宿主身份

宿主身份 `{ platform, kind }` 由 Rust 按编译目标生成（契约见 `docs/FrontendHostContract.md` §2.2）。前端只通过 `src/scripts/util/host-identity.js` 读取：`hostPlatform()` 返回平台，`isMobileHost()` / `isDesktopHost()` 返回宿主类别。测试由 harness 安装身份。

与平台有关的判断，先分清在问什么：

| 问题 | 依据 | 例子 |
| --- | --- | --- |
| 宿主属于哪一类外壳 | `isMobileHost()` / `isDesktopHost()` | 移动端兼容层、F11 全屏、数据目录选择、软键盘相关的自动聚焦 |
| 选用哪个平台的实现，或某个平台独有的问题 | `hostPlatform()` | Windows 托盘、Android WebView 的剪贴板与 IME |
| 可选能力是否存在 | 插件、原生桥或 DOM API 本身 | 扫码插件、Android 原生桥 |
| 屏幕与交互形态 | 上游 Bowser `isMobile()`、CSS 媒体查询 | select2、MovingUI、`{{isMobile}}` |

约束：

- 不用 UA、`navigator.platform` 或 `maxTouchPoints` 推断宿主：iPadOS 报告为 Macintosh，OpenHarmony 的 UA 不含 Android。
- 用正向条件表达类别，不用 `!android && !ios` 代表桌面。为每个平台选择实现时，`switch` 列出全部平台，`default` 抛错；某个平台独有的处理用正向判断即可。
- 上游 Bowser `isMobile()` 与 CSS 媒体查询属于上游布局语义，保持不变。规则同时取决于宿主类别与窗口方向时（如聊天宽度），组合 `isMobileHost()` 与 `util/window-layout.js` 的 `isWindowPortrait()`。

`pnpm run check:platform`（已接入 `pnpm run check`）检查以上约束，报错指向本节。

### 2.2 原生能力

TT 前端总是运行在宿主之上，代码中不判断“是否在 Tauri 中”。应用模块只通过 `tauri-bridge.js` 使用原生能力，能力缺失时由 bridge 在调用处报错。可选插件由对应 service 判断是否可用，例如扫码的 `canScanQrCode()`。唯一例外是 Rust 在 document-start 注入的 Android 语音脚本，见[系统 TTS](CurrentState/TTS.md#接入位置)。`__TAURI_RUNNING__` 只是对外标记，内部不读取。`check:frontend` 检查这条边界。

## 3. 目录结构（前端集成相关）

```text
src/
├── tauri-bridge.js            # 低层 bridge：invoke/listen/convertFileSrc
├── tauri-main.js              # 新入口：只做 bootstrap
├── tauri/
│   └── main/
│       ├── bootstrap.js       # 组合根（composition root）
│       ├── context.js         # 兼容 shim（re-export `context/index`）
│       ├── context/           # Host Kernel facade + types（对外契约保持稳定）
│       ├── kernel/            # 纯逻辑（策略/计算/键生成/追踪等）
│       ├── services/          # 有状态能力（assets/thumbnails/characters/android…）
│       ├── adapters/          # 触碰 window/DOM/上游 ST 的适配层
│       ├── download-bridge.js # 同源窗口下载桥接
│       ├── http-utils.js      # URL/Body/Response 工具
│       ├── interceptors.js    # fetch/jQuery 注入
│       ├── router.js          # 轻量路由注册与分发
│       └── routes/
│           ├── system-routes.js
│           ├── settings-routes.js
│           ├── extensions-routes.js
│           ├── resource-routes.js
│           ├── character-routes.js
│           ├── chat-routes.js
│           └── ai-routes.js
└── scripts/
    ├── extensions/runtime/      # 第三方插件运行时（资源解析/模块重写/加载器）
    └── ...                    # 上游 SillyTavern 功能模块
```

## 4. 核心模块职责

第一方输入与键盘行为继续使用原生控件的数据和事件。`src/scripts/util/keyboard-event.js` 统一识别原生／jQuery 键盘事件的输入法合成状态，以及 WebKit 在合成结束后仍可能给出的 229 标记；React 回调传入 `event.nativeEvent`。应用的显式保存、发送、关闭、菜单移动、搜索和文本编辑快捷动作共用该规则，包括手机页面、主聊天、原生弹窗、参数／模型管理、命令补全、Quick Reply 和 Agent 界面。这些按键不触发应用快捷动作，正常 input/change、修饰键释放和明确确认仍走原有入口，不维护额外的合成状态。CodeMirror 内部键绑定由编辑器处理自己的输入法语义。

### 4.1 `bootstrap.js`

- 组装模块依赖并执行初始化。
- 确保只 bootstrap 一次。
- 在后端就绪后再次尝试 patch 运行时补丁（处理加载时序问题）。
- 维护对第三方可见的宿主 ABI（`window.__TAURITAVERN__`）与请求追踪 header。

### 4.2 `context.js`

- `context.js` 仅作为兼容入口（避免外部 import 路径变化）。
- 真实实现位于 `src/tauri/main/context/index.js`：作为 Host Kernel facade 组装 `kernel + services + adapters`。
- `safeInvoke` 具备可配置的 invoke 策略（dedupe / write-behind / TTL cache），集中在 `src/tauri/main/kernel/invokes/invoke-policies.js`。
- Host 侧已知的 Rust 命令名收敛为类型：`src/tauri/main/kernel/invokes/tauri-commands.js`（`TauriInvokeCommand`）。
- 与第三方直接交互的全局符号（如缩略图 helpers）属于 Public Contract（见 `docs/FrontendHostContract.md`）。

命令失败的 `CommandError` 继续通过 invoke 拒绝传给调用者，command 诊断本身不广播界面通知。调用者拥有用途、语言与恢复操作；无法通过返回错误表达的后台或部分成功问题仍使用显式 user-visible 事件。Chat Completion 的 quiet 请求在 HTTP／响应解析失败时拒绝，由原发起者决定呈现；正常聊天和公开错误 parser 的既有选项保持，避免同一 API 测试同时收到解析层和按钮的重复提示。

第一方兼容请求使用 `scripts/util/command-error-utils.js::requireOkResponse()` 检查失败 HTTP 响应并保留错误文本，由操作发起者决定呈现。Quick Reply 的 `performSave()` / `delete()` 和 `quickReplyApi` 的显式保存／删除拒绝失败；延迟界面保存的原 debounce 回调呈现一次失败，`save()` 返回是否成功。新建、导入和复制在写入成功后使用 `publishSaved()` 发布；同名更新保留已有对象和配置引用，不先删除旧数据。

密钥值查询复用 `secrets.js` 的共同请求边界。`findSecret()` 仅将曝光权限拒绝（宿主 401／上游 403）返回为 null；缺失、仓储、传输和响应解析失败继续拒绝，不推断为曝光关闭。查询不标记密钥元数据需要刷新。原复制按钮接管读取与剪贴板失败，成功写入剪贴板后才通知；slash 读取命令按原 quiet 规则呈现一次错误并保留失败的空字符串返回。

内置 API 短测试由原 `test_api_button` 原生按钮持有 disabled 与 aria-busy，替代私有 pending 标志；开始前显示等待文案，finally 恢复原标签，并通过 change 发布状态变化。手机设置行在原控件 change 时刷新，读取同一 busy 与禁用状态；关闭重开继续从原控件派生，dispose 删除订阅。短期 settle 仍用于控件的异步派生，不用于判断请求已结束。原测试参数、prompt-ready／停止事件和结果呈现保持。

API 状态查询共用 `script.js` 的 `abortStatusCheck` 与加载控件入口。取消时立即恢复控件；OpenAI、Text Completion、NovelAI 和 Horde 从连接或密钥提交按钮准备密钥起持有同一信号，状态查询继续使用它，取消后不启动旧查询、发布结果、改写新状态或结束新的加载展示。已经发起的独立密钥操作继续按原保存规则完成，失败仍由按钮提示，不触碰后续查询控件。Text Completion 的后续 props 与模板派生属于同一次查询；NovelAI 订阅读取也在发布数据前检查信号。反向代理验证只验证调用者传入的地址并传播拒绝，状态处理器负责取消感知的错误与收尾，生成参数调用者沿原错误链传播。fetch 及响应体取消沿用 Host interceptor。

当前连接的地址、协议、部署、区域、账户、认证方式或请求头实际修改后，原生字段写入者经同一入口取消旧检查。同值输入、另一个 API/provider/server 的记忆字段，以及只用于生成的请求体参数不取消当前模型列表检查。字段先写入原配置对象，再发布取消状态，监听器读取新配置；没有第二份连接快照。代理预设的选择、保存和删除后的选择共用应用入口，重连先取消旧检查；删除最后一个预设不制造新预设。用户手填模型保留，新查询仍按原连接或预设重连规则发起。

Text Completion 连接按钮先校验当前类型的地址输入，无效时提示并停止本次连接，保留地址和连接中的密钥草稿。有效地址沿原 formatter 规范化，经同一 `input` 写入 settings，再捕获查询信号、准备密钥并请求状态；编辑框、保存值和请求值一致。没有地址字段的固定服务继续原流程，独立密钥提交仍走原保存规则。

群组、表达图像和扩展删除在 HTTP 成功后才继续删除状态或发布成功事件；角色扩展字段在写入成功后才更新内存与卡片 JSON，失败不返回空的批量成功结果。角色与群组的组合刷新先完成两份读取，再一起发布角色数组和重绘；单角色刷新失败继续拒绝。已创建／已保存／已复制内容的刷新失败由界面明确说明部分结果；复制保留已确认的新 avatar。聊天转群组由按钮接管错误，已创建群组后的转换失败保留原错误并说明阶段。普通头像、背景、资源、图库与备份界面拥有各自的失败提示；图库目录建议不可用时保留主体，并显示可继续使用的说明。表情图片读取失败不进入空缓存，周期与 VN debounce 后台刷新使用共同诊断处理，显式界面和脚本操作分别呈现或拒绝。

`PresetManager.savePreset()` 保留原始失败并拒绝，由更新、新建、重命名、导入、高级格式主导入和恢复的实际界面入口呈现；文件导入在 finally 重置输入以允许重试。预设删除保持原布尔结果，在确认成功后才修改列表；恢复默认值直接覆盖保存。预设扩展字段先保存暂存的内容，失败不发布未保存的字段。正则预设的列表调整也使用暂存内容，完整应用后才发布 `isSelected` 和已应用状态；界面失败恢复最后成功的选择，并明确未能完整应用，`/regex-preset` 等待同一应用函数并传播失败。

Connection Manager 的原生选择、reload 和 `/profile` 共用内部 `applySelectedConnectionItem()`。选择写入者统一推进原 version，创建／捕获／删除和应用都经同一 setter；应用入口在异步详情渲染前取得原 application queue／version，详情准备失败不开始字段重放；两种保存对象仅保留各自的字段规则。Profile 重放复用原 managed command helper；可记录的空输入和合法空结果分开声明，两个 ALLOW_EMPTY 字段仍可清空，prompt-post-processing 的 none 成功空结果与 CC 的第二次 api 保持。命令明确失败或拒绝即停止重放和连接，当前成功后才发布原 LOADED；队列在通知前释放，订阅者可应用另一项。`/profile await=true` 等待本次实际 Promise 并传播拒绝，原生选择／reload 和 `await=false` 的后台结果由发起者提示一次；`/api` 的无效输入也遵守原 quiet 参数，公开失败空字符串保持。None 立即使旧重放失效、清理 spinner 并发布原空选择事件，不等待旧写入；保留原 replay queue，使后续真实应用仍等待尚未完成的独立密钥写入。共同错误边界将旧操作的后续失败仍作为取消传播，当前失败保留原原因；版本是唯一取消事实来源；独立密钥写入不回滚，选择引用仍用于详情和重试，不代表所有字段已成功应用。

异步配置详情也核对同一选择 version；Profile／Model Target 只提供模板参数，共用模板读取与结果发布，晚到的旧模板不会覆盖当前选择或 None 的详情。

Custom／OpenCode 格式、代理与分词器的原命令 callbacks 在验证失败时遵守 managed command 已传入的 quiet。配置应用只由原发起者提示一次；普通公开命令仍使用原默认 error／warning 和失败空字符串，getter、合法 setter、匹配规则及公开参数列表保持。

Data Bank 的编辑、移动和 `/db-update` 共用 `chats.js` 的附件替换入口。上传成功后先核对两端位置和原引用，global／character 目标经原 `flushPendingSettingsSave(true)` 确认，chat 目标取消同一 metadata debounce 并等待原保存队列；再次核对后才退役旧附件并刷新列表。上传或保存等待／失败时，原文件、原引用和禁用状态保持，未确认时不返回替代 URL。编辑与命令仍使用原 source，移动使用用户选择的 target；原保存器拥有其失败提示和 integrity 确认，拒绝覆盖仍 reload 并传播原错误。已上传的有效副本保留，避免丢弃唯一编辑内容。neutral 保留原 session／metadata no-op，不计为磁盘 ACK。旧引用在实际删除成功后清理并安排其原保存器，仍不提供跨文件与 settings 的原子事务。

Data Bank 的单条／批量按钮和 `/db-enable`／`/db-disable` 共用 `chats.js` 的 `enableAttachment()`／`disableAttachment()`。两者只修改 canonical `extension_settings.disabled_attachments`，状态变化时安排原 `saveSettingsDebounced()`；同状态重复操作保留 no-op，原界面 callback 仍刷新。启用移除该 URL 的禁用引用，禁用仅加入尚不存在的 URL；原文件和附件引用保持。命令维持原 source／别名／查找、warning 和空字符串结果，磁盘保存仍由原 writer 和 lifecycle flush 完成。

当前聊天位置由 `script.js` 的 `getCurrentChatLocationIdentity()` 从所属角色／群组、聊天名和 integrity 派生，群组不依赖当前发言成员。`chats.js` 的私有 source identity getter 对 chat 委托这条规则，global 独立于当前角色，character 使用 avatar。编辑在原件读取前、移动在源操作和所选目标读取前、抓取在采集前、拖放在确认目标后捕获，并作为同一 uploader／替换函数的可选操作输入传递，省略时在调用处捕获。uploader 在发起上传与发布引用时核对，替换在上传及保存前后核对两端和原引用。位置改变时拒绝本次发布或退役，已上传但未发布的副本通过错误中的实际 URL 提供恢复信息。拖放回调接管拒绝，抓取控件等待原 Promise 并保留原错误原因；没有位置缓存、状态镜像或新宿主接口。

`uploadFileAttachment()` 复用 `requireOkResponse()`，HTTP、传输、正文解析或缺少有效路径时拒绝，本身不通知。注册转换器拒绝就停止，消息与 Data Bank 都不再上传未转换的原内容；成功编码和文件／媒体字段保持原格式。`populateFileAttachment()` 只暂存本次新上传结果，全部准备完成且聊天位置、原消息成员关系与候选仍有效后，才加入原 `message.extra`。失败不发布部分消息附件，已上传副本保留，错误保留原原因和实际路径。Data Bank 仍按文件独立发布，抓取和拖放在后续失败时刷新已确认结果，无新路径时停止，不报告抓取成功。

选择器、嵌入、Data Bank uploader 与消息准备共用私有 `getFileValidationError()`。它保留原 MIME、350 MiB 非媒体限制、binary 与 converter 规则；已知不支持返回 Error，允许返回 null，实际读取失败拒绝原错误。超限先按元数据判断，媒体与已注册 converter 的格式不为无效的 binary 判定读取正文；未知格式读取后仍使用当前 converter 注册结果决定是否允许。准备在本次文件读／上传前再次校验并核对目标，API 不依赖选择器的验证进度；媒体和普通文件继续原 Data URL 字节路径，已注册的转换格式仅由实际 converter 读取并编码转换结果，不再预读随后被替换的 Base64。未知格式的原始读取结束后仍查看当前注册表，保留等待期间新增 converter 的行为。原字节编码与上传格式保持，实际转换／读取失败沿原错误 owner 拒绝。主输入／嵌入拥有原 error 加 warning 的已知拒绝提示，Data Bank 确认 source 后呈现单条说明并保持无路径返回。

主文件 form 在验证等待前从捕获的 File 数组显示名字、数量和大小，绑定活动聊天位置；只保留当前选择的一个 `CHAT_CHANGED` 订阅，同一聊天的 reload 保留该订阅，实际位置变化后清理。新选择立即通过原 emitter 解除旧订阅；reset 默认动作结束后，实际输入为空才隐藏文件行并解除订阅，取消 reset 保留原选择、文件行和订阅。已经进入事件派发队列的旧回调也核对当前订阅引用，不能清空后来选择的文件。所有等待后的提示和清理仅作用于仍匹配该选择／位置的输入，旧验证结果不会覆盖新标签或清空新草稿。当前读取失败由控件提示一次，保留真实选择与文件行以供重试／清理；欢迎页的未绑定草稿仍可随首次打开的聊天继续。嵌入在验证成功或拒绝后先核对原消息、候选与文件选择，再处理结果。

`sendMessageAsUser()` 在 token 读取等异步前捕获聊天位置和文件选择，作为同一准备函数的操作输入，避免计数等待后发送后来选择的文件；仅附件准备失败且同一聊天的文字框为空时恢复 regex 改写前的原消息参数。可选的 `onAttachmentError` 只由普通生成和群聊实际入口传入，接管准备失败；Agent 沿原外层入口通知，API／slash 默认只拒绝，保存失败仍由原 writer 呈现。嵌入在打开选择器前绑定原消息和候选，校验后核对并传递原文件选择，避免旧校验读取另一条消息的新选择；完成时从 canonical chat 重新取得事件楼层编号。主附件 form 与隐藏 embed input 分别拥有清理范围，只清理仍与本次选择一致的输入，失败保留选择，新文字和文件草稿保持。

普通与无激活成员的群聊发送都在等待用户消息准备前消费原文字输入；群聊不在成功返回后再清空，以保留等待期间写下的新草稿。失败恢复继续使用同一准备边界。

文件删除请求共用 `chats.js` 的私有 `deleteFileAttachmentFromServer()`，HTTP 检查与成功的 `FILE_ATTACHMENT_DELETED` 事件只有一处。原 `deleteFileFromServer(url, silent)` 保持布尔结果，`silent` 适用于 HTTP 和传输失败；消息文件控件消费成功结果后才移除引用并保存。Data Bank 删除、替换退役和 slash 等待同一请求并传播失败，原控件或 executor 呈现一次原因，失败保留引用与 disabled。单项和批量确认前捕获来源，删除后再次核对；位置变化时停止新的引用修改，已经删除的文件明确给出路径和部分结果。批量按钮等待操作、按实际结果重绘，保留剩余已选项以便重试。私有 `removeAttachmentReference()` 同时维护原 bucket、disabled 和保存调度，character 删除也安排 settings 保存；核验明确不存在只调用这处引用清理，不再发 DELETE 404 或伪造删除事件。

`getFileAttachment()` 成功返回原文件字符串（包括空字符串），HTTP、传输和响应体读取失败沿 `requireOkResponse()`／原 fetch 拒绝，不弹通知或返回缺省内容。Data Bank 的查看、编辑、下载、移动和消息文件控件接管一次提示；`/db-get` 与核心聊天组装沿原错误链传播。发送、继续、再生成和模拟共用附件组装边界呈现一次失败，quiet 请求交由原调用者呈现。附件全文组装完成后才修改 `fileLength`；向量检索也在单条消息的必要读取和检索成功后才替换正文，失败由原 `rearrangeChat()` 提示跳过。显式全部文件入库按钮接管读取失败，已有索引先确认后跳过读取。

Vector 扩展的私有 `vectorizeFile()` 成功确认入库、失败传播原错误／cause，进度由 `finally` 清理，没有 false 或内部失败通知。消息和 Data Bank 不查询未确认的入库结果；生成由原 `rearrangeChat()` 提示跳过并保留该消息全文，`/db-ingest` 和 `/db-search` 经原 executor 错误链拒绝。全部文件按钮保留普通单文件失败后的继续与部分失败提示，原 source abort 仍停止后续文件。成功检索时，工作消息的 `mes` 和新 `extra.fileLength` 同时使用实际 chunks 前缀（含两个换行），不回写共享 canonical extra；后续查询沿原 `getQueryText()` 截取，用户问题不会被旧长度裁掉，空命中保持两个换行的前缀。

#### 4.2.1 `window.__TAURITAVERN__.api.chat`（扩展/记忆类插件 API）

> 这是 TauriTavern 独有 API 的**唯一入口**（刻意不做 alias），为扩展提供有界历史读取、后端定位、检索与持久化能力；它增强上游完整 `chat[]` 契约，不替代该契约。

- 安装位置：`src/tauri/main/api/chat.js`（在 `src/tauri/main/bootstrap.js` 中安装到 `window.__TAURITAVERN__.api.chat`）。
- 类型声明：`src/types.d.ts`（便于扩展作者用 TS/JSDoc 一键上手）。
- 详细 API 文档与适配指南：`docs/API/`。

### 4.3 `interceptors.js`

- 代理 `window.fetch`。
- 代理 `$.ajax` 并保持 Deferred/jqXHR 行为兼容。
- 接管整个 `/api/*` 命名空间与其他已注册路由，其余请求透传原生实现（见 `FrontendHostContract.md` §4.2）。

### 4.4 `download-bridge.js`

- 处理所有宿主同源窗口中的浏览器式下载（如 `blob:` / `data:` / 同源 URL + `a[download]`）。
- Android 上为同源窗口中的 `<img>` 补上 `contextmenu` 默认行为（保存图片）：用户确认后，图片进入同一条导出链路。
- 页面可读的内容交给 `deliverBlob()`；远程图片交给 `deliverRemoteFile()`，由宿主下载。两者都先暂存再交付，见[文件传输](CurrentState/FileTransfer.md)。
- 不参与 API 路由判断，避免与请求拦截职责混合。

### 4.5 `router.js` + `routes/*`

- `router.js` 提供简洁注册接口：`get/post/all`。
- `routes/*` 按业务域组织，降低文件复杂度与改动冲突。

## 5. 请求注入流程

1. 前端发起 `fetch('/api/...')` 或 `$.ajax('/api/...')`
2. 拦截器通过 `router.canHandle(method, path)` 判断是否由本地路由接管
3. 命中后交给路由分发到 `routes/*`
4. 路由通过 `context.safeInvoke(...)` 调用 Rust 命令
5. 返回标准 `Response` 给前端调用方

补充：

- `/csrf-token` 在 `system-routes.js` 中返回固定 token，用于通过前端初始化流程中的 CSRF 依赖检查。
- 所有宿主接管的路由响应都会附带 `x-tauritavern-trace-id`，用于将 DevTools Network 与 console/perf-hud 关联定位问题（header 名也可从 `window.__TAURITAVERN__?.traceHeader` 获取）。

## 6. 路由分域说明

| 文件 | 负责范围 |
|------|----------|
| `system-routes.js` | ping/version/csrf 等系统基础接口 |
| `settings-routes.js` | 设置、快照、密钥、预设 |
| `extensions-routes.js` | 扩展发现、安装、更新、删除等 |
| `resource-routes.js` | 头像、背景、主题、群组等资源接口 |
| `character-routes.js` | 角色列表、创建、编辑、导入导出、重命名 |
| `chat-routes.js` | 聊天读写、搜索、最近记录、导出 |
| `ai-routes.js` | Chat Completion（OpenAI / Claude / Gemini / OpenCode） |
| `tokenizer-routes.js` | tokenizer count/encode/decode/bias 与上游本地 tokenizer 兼容路由 |

## 6.1 聊天 payload 与 DOM 边界

- 上游接管点：`src/script.js`（character chat）与 `src/scripts/group-chats.js`（group chat）。
- 统一入口：上游只 import `src/scripts/chat-payload-transport.js`，不要直接依赖 `src/scripts/tauri/chat/*`。
- 第一方加载全部楼层，可选[历史滑动按需加载](CurrentState/ChatPayload.md#21-历史滑动按需加载)。header 与消息数组分离，generation、扩展和保存共享完整、有序的 canonical `chat[]`。
- `chat_truncation` 只限制初始 DOM。Show More 从完整 `chat[]` 补挂楼层，不发起分页 I/O，不改变消息绝对索引。
- 当前聊天完整保存与 metadata 保存共用 `enqueueChatSave()` 和 transport 提交会话；transport 自身不重复入队。提交捕获独立快照并原子发布，保存期间的修改不混入本次提交。
- `saveMetadata()` 只保存 header 的 `chat_metadata`，不保存消息，也不取消待执行的完整保存。修改消息的扩展必须显式调用完整保存。
- tail/before/beforePages 只属于 `api.chat.history` 与 Agent 的显式只读查询，不参与前端当前聊天状态。
- 聊天格式遵循 [ChatPayload §1.1](CurrentState/ChatPayload.md#11-统一格式底线)；解析失败必须传播，不能提交部分历史。

保存规则与职责见 [ChatPayload](CurrentState/ChatPayload.md)；兼容 get/save 路由及事件契约见 [FrontendHostContract §4.3](FrontendHostContract.md#43-路由表public)。

## 6.2 ChatSurface 所有权与 participant

- `chat[]` 仍是完整、唯一的数据事实源；ChatSurface 只拥有 `#chat > .mes` 的当前视图投影。
- `installChatSurfaceRuntime()` 是 `script.js` 唯一的 concrete composition seam；结构/投影位于 kernel，生命周期协调位于 services，真实 DOM/scroll 写入位于 adapters。
- 外部 renderer 通过 `window.__TAURITAVERN__.api.chatSurface.registerParticipant()` 接入，不直接控制投影，也不依赖伪造消息事件。
- 异步模板通过独立的 `registerContentProcessor()` 准备显示 HTML；`content-preparation.js` 保存消息内容结果，滚动重挂载不重复求值。manifest `hooks.chatSurface` 在首次投影前完成注册，内容结果通过既有同步事务交给 participant。
- 同步与批量格式化共用一条链路，对外只交付最终 HTML；正文与 reasoning 共用 ChatSurface 内容刷新。核心通过 `finalizeMessageContent()` 等待内容提交后发送消息事件，`commitContent()` 只提交已准备内容。
- renderer 在入口只调用一次 `isManagedOwnershipRequired()`：`true` 时只启用 participant owner，`false` 时只启用原 static owner；API 是否存在和当前 DOM 形状都不能替代该决策。
- 结构 reconcile 与纯 range projection 分离：前者只在 canonical `chat[]` 结构改变时 O(N) 执行，后者携带 epoch/revision token 并保持 O(M)。
- mount lease 与 content lease 分离；streaming 中间帧只提交内容，最终帧才恢复 decorator/runtime。
- `chat_virtualization_enabled=false` 是默认值并保持上游 Show More 语义；TauriTavern Settings 的“聊天 DOM 虚拟化”开关直接绑定这个布尔值并在保存后 reload。用户显式开启后，experimental bounded 使用 TanStack 几何提交 `V ∪ T`，true tail 常驻且 `.mes` 上界为 `32 + 1`。
- TanStack symbols 由 `lib.js` vendor facade 在 composition root 注入单一 adapter；原生 ESM 源码不直接解析 bare package。virtualizer 的 `scrollToFn` 也注入既有 ChatScrollAdapter，因此 `#chat` 的物理滚动写入仍只有一个 owner。
- bounded 的 runtime candidate 由独立 grant lease 管理；viewport 滚动可以 revoke/re-grant，而不会伪造 content commit 或消息业务事件。
- runtime demand 只按 visible 与 overscan 排序；常驻 true tail 不额外预留 runtime 名额。真实全局 reflow 会保持独立 follow-tail 意图，或以稳定消息 key + clamp 后的楼内 offset 恢复锚点；普通 settings save 与 IME height-only resize 不再清空全部历史测量。
- 可由 `chat[mesid]` 推导的楼层状态由 materializer 负责；bounded DOM commit 后，私有 `syncMountedChatViewState()` 在最终测量前幂等重放 swipe/delete 等临时核心 UI。该 seam 不发送 SillyTavern 业务事件。
- 旧扩展直接删除消息 root 时，兼容桥只负责释放相应 root 的 lease；它不会接管第三方的内容写入或重编号。bounded policy 必须先通过 participant capability gate。
- Project raw API 见 `docs/API/ChatSurface.md`。

## 6.3 Theme 作用域与所有权

- `power_user.theme` 始终表示当前实际生效的命名 Theme；主题 CRUD、斜杠命令与扩展上下文继续遵循这一上游语义。
- `power_user.theme_fallback` 保存无局部绑定时的全局 Theme；系统动态主题只更新该 fallback，不覆盖当前聊天、角色或群组绑定。
- Theme 解析顺序固定为 `chat_metadata.theme -> character/group binding -> theme_fallback`。角色绑定以未经转换的 avatar filename 为键，群组绑定以 group id 为键。
- Theme 文件只保存可移植的外观快照，不包含本机角色或聊天身份。聊天绑定随 JSONL header metadata 持久化；角色与群组绑定随 settings 持久化。
- 所有生效切换必须经 `src/scripts/power-user.js` 的统一入口；Tauri appearance adapter 不模拟 `#themes` 的 DOM change 事件。

## 6.4 Chat Completion 参数管理

实现位于 `src/scripts/tauri/generation-params/`，在 `APP_READY` 后导入并挂载。参数发现、渠道支持与值的读写沿用上游设置和控件。

- 移除请求参数表示本次生成不启用该参数，保留原值；移除开关表示关闭；隐藏本地区块不改变其内容或行为。旧预设缺少 Fast Mode 字段时明确关闭。
- 请求参数的移除状态保存在预设 `extensions.tauritavern.omit_params`，本地区块显隐仅保存在设备上。旧预设保持原行为，移除范围限于可选参数，不能删除 `messages`、`model` 等结构字段。
- Prompt 组装和生成判断使用本次生效设置，`createGenerationParameters()` 出口统一省略字段；用户显式配置的 Additional Parameters 仍拥有最终覆盖权。
- JSON 视图只编辑当前格式可用的参数，非法输入整体不应用；它不是最终请求预览，后续仍遵循渠道与模型的转换规则。

### 6.5 请求级生成长度

`generateRawData()`、`generateRaw()` 和 `generateQuietPrompt()` 的 `responseLength` 沿本次请求传递。省略或传入无效覆盖时，使用请求开始时的用户设置；临时生成不修改 `amount_gen` 或 `oai_settings.openai_max_tokens`。群聊和同次工具递归继续使用该请求的预算，新的独立生成重新读取用户设置。

Chat Completion 的 prompt 裁剪与最终参数准备消费有效设置副本；Text Completion 的参数构造直接消费请求长度。第一方提示词、角色字段、世界书、指令、stop、prefill 和 Additional Parameters 使用同一请求预算的宏环境，流式 stop 缓存、回复及多回复清洗继续使用该 evaluator；live 变量的读写保持原语义。PromptManager 接受调用级 evaluator，不临时替换共享实例的设置或函数。

保存和退出 flush 只等待自己的持久化任务，不等待临时生成恢复全局设置。现有生成事件及扩展修改最终参数的入口保持；Additional Parameters 和 settings-ready 仍可以按原规则覆盖最终请求。

### 6.6 条件扩展提示词

`extension-prompts.js` 拥有条件谓词和分组文本查询；script.js 的公开按名/分组 getter、CC 与 frozen Run capture 使用同一 async 条件规则。查询先选择位置、非空值、深度和角色，再在原对象上调用并等待 `prompt.filter()`，最后按 key 排序组装、trim/wrap 并使用请求 evaluator 展开宏。按名与冻结捕获仍在值转换前执行条件；同步 `{{outlet}}` 只读取文本。

CC 的已知名字映射、相对插入顺序和 vectors/ChromaDB 相对提示词的 system 角色由 `KNOWN_EXTENSION_PROMPTS` 统一表达。真实 Generate 只为 TC 准备 Story String 与 anchors；CC 相对阶段只准备 BEFORE_PROMPT/IN_PROMPT。IN_CHAT 在主提示词宏完成后执行条件：同名 PromptManager 条目具有有效 ABSOLUTE/ATTACH 位置时，保留其角色、深度、顺序及附加覆盖，内容只由该条目承载；其余提示词走实际深度查询。本次交给 PromptManager 的 key 随准备结果传给查询，排除重复路径，不保存或缓存条件结果。

NONE 不加入生成。条件 false 不求值该提示词的宏，条件拒绝与其他未知组装错误传播给调用者，不发送部分提示词。frozen Run capture 保留既有捕获点的主提示词宏前条件求值，保存后的输入直接使用该结果。

### 6.7 注入深度遍历

`getExtensionPromptMaxDepth()` 是允许上限，仍返回 10000。TC 和 CC 使用 `extension-prompts.js` 的 `getExtensionPromptDepths()` 遍历实际可匹配的深度，保留原插入索引、角色顺序、order bucket、continue 和请求 evaluator。CC 从已准备的 PromptManager 条目提供额外深度，并排除其已经承载的扩展 key。

iterator 在每个实际深度后重新读取原 source，不预计算固定列表，也不缓存条件。位置、非空值、角色和整数深度决定候选；`undefined` 深度保留逐层 wildcard，`undefined` 角色保留原匹配语义。条件仍由实际文本查询执行，因此条件新增未来深度或改变自己的深度时，后续遍历能看到变化。性能数据和输出核对见 `docs/superpowers/plans/2026-11-25-chat-injection-depths.md`；本地准备测量不代表 Android 冷启动或网络延迟。

### 6.8 自定义 API 地址预览

`tauritavern/custom-endpoint.js` 拥有协议后缀与预览。非空基础地址只接受后端已有的 HTTP/HTTPS、无账号密码、无查询或片段规则；使用 URL 的序列化结果展示实际主机、端口和路径，保留版本路径、已编码的路径字符及 Gemini 模型/流式后缀。空字段仍显示设置占位符，不支持的输入返回 `url: null`，唯一显示入口 `updateCustomEndpointPreview()` 呈现本地化填写说明，不能删除非法部分再显示成可用端点。

这是填写反馈，不是连接成功证明。用户设置、实际网络校验与生成继续由原入口及后端拥有，没有新增端点切换、重试或保存机制。Custom/Azure 校验失败的诊断只记录来源及无效状态，不输出原始输入，避免误填密钥进入日志。回归覆盖空 `?`/`#` 和编码后的路径分隔字符，避免把 URL getter 的空字符串误当作没有查询或片段。

附加参数窗口沿用 `customEndpointAdditionalParameters.html` 和所选 source bucket 的原生 input／保存入口。三个字段都有关联标签和持续可见的格式说明；中文版示例保留 YAML 的 ASCII 语法。小屏使用 Popup 现有的纵向滚动，不维护另一份字段或校验状态，YAML／JSON 解析、覆盖顺序和持久化契约保持。

## 7. 插件系统前端适配

### 7.1 设计目标

- 保持上游 `scripts/extensions.js` 的调用语义不变（manifest 结构、启用逻辑、依赖检查）。
- 将 Tauri 专属逻辑限制在独立 runtime 子模块，减少与上游同步冲突。
- 支持第三方插件从用户数据目录加载 JS/CSS/静态资源，不依赖 Node.js 后端。

### 7.2 模块分层

- `src/scripts/extensions.js`：插件激活编排层（发现、排序、依赖/版本检查、触发加载）。
- `src/scripts/browser-fixes.js`：上游浏览器补丁（保持与 SillyTavern 同步）。
- `src/tauri/main/compat/mobile/mobile-runtime-compat.js`：Tauri mobile 运行时 polyfills（补齐旧 WebView 缺失 JS API）。
- `src/scripts/util/window-layout.js`：移动端原生窗口快照；`src/scripts/window-backdrop.js`：第一方背景唯一写入与条带发布入口。
- `src/scripts/extensions/runtime/resource-paths.js`：扩展资源路径规范化与 third-party 判定。
- `src/scripts/extensions/runtime/third-party-runtime.js`：第三方扩展样式兼容层（legacy WebView 下为样式 URL 附加 `ttCompat=layer`，触发 Rust 端点做 `@layer` 展平；不再走前端预取/Blob 注入）。
- `src/scripts/extensions/runtime/asset-loader.js`：脚本与样式注入、超时保护、重复注入幂等控制。

### 7.3 端到端加载链路

1. 启动 core 阶段确认宿主就绪后，才开始扩展发现。
2. 前端通过 `/api/extensions/discover` 获取扩展列表与类型，读取 manifest 并进入 `activateExtensions()`。
3. 对每个扩展执行 `addExtensionLocale()` + `addExtensionScript()` + `addExtensionStyle()`。
4. 当扩展为 `third-party/*` 时：
   - JS 入口脚本直接从 `/scripts/extensions/third-party/*` 加载（真实同源静态资源端点）。
   - CSS 仅在旧 WebView 不支持 `@layer` 时由 runtime 附加 `ttCompat=layer` query；由 Rust 端点返回展平后的 CSS bytes（否则仍走原始 URL）。
5. `/scripts/extensions/third-party/*` 由 Rust 协议层端点提供（WebView `on_web_resource_request` hook），统一返回 bytes + `Content-Type` + 404 语义。

### 7.3.1 当前实现结论

- 当前实现已经从“前端模拟静态文件服务”收敛为“前端只负责编排，Rust 负责 third-party 资源端点”。
- `src/scripts/extensions/runtime/third-party-runtime.js` 不再承担 JS 源码重写或伪服务器职责，主要只保留第三方样式兼容修复。
- 面向持续开发的现状说明见 `docs/CurrentState/ThirdPartyExtensions.md`；涉及实现边界或改动前，先读该文档，再决定是改前端 runtime 还是改后端资源端点。

### 7.3.2 First-party React extension

TauriTavern 自有的状态型 UI 作为 SillyTavern first-party extension 挂载 React client island。当前 Agent、MCP 与 Settings owned scope 均遵循这一基线：

- manifest、locale 和 SmartTheme CSS 仍遵循现有扩展资源契约；不引入 Next.js、独立页面 shell 或第二套路由。
- `src/index.tsx` 只负责等待 Host ABI、解析 concrete actions、创建 extension container 与 `createRoot()`。
- React presentation 只接收 strict typed initial state、actions 与 translator；不得直接 `invoke()`、操作 jQuery 或读取 Rust command 名。
- 跨窗口和长期数据继续由 Rust/Host service 拥有；局部 React state 只表示当前视图，不能成为平台事实源或持久 cache。
- 样式必须使用 `--SmartTheme*`、字体、动画与边框变量，保留 SillyTavern vanilla 视觉和用户主题覆盖能力。
- `tsconfig.ui.json`、React Hooks/TypeScript lint 与 Rstest/Testing Library 显式覆盖 Agent、MCP 和 `src/scripts/tauri/setting` 三个 owned scope；`pnpm check` 是统一验收入口。
- production 与 development 共用 `createRspackConfigs(mode)`。标准 Tauri dev server 在首次 development 编译成功后才监听，并只在成功重编译后 reload。
- `scripts/check-first-party-ui-guardrails.mjs` 为自有扩展架构限定为 React + Strict TypeScript。
当前工程基线、冻结 handle 与 bundle 数据见 `docs/CurrentState/FirstPartyUI.md`。

### 7.4 契约与约束

- third-party 扩展命名约定为 `third-party/<folder>`，前后端均按该约定解析。
- 扩展命令参数统一使用 camelCase（如 `extensionName`），避免 invoke 参数缺失。
- 客户端版本检查仍遵循上游格式：`SillyTavern:<version>:TauriTavern`，用于 `minimum_client_version` 判断。
- 拦截器是否接管请求由 `router.canHandle(method, path)` 决定，不再维护分散的路径白名单。
- `/api/extensions/branches` 返回远端 branch 的 `{ name, commit, current, label }`；`label` 当前有意为空，前端仅在非空时显示。
- `/api/extensions/switch` 接受 branch 短名并在成功时返回空 `204`；现有 reload/settings 时序保持不变，不新增 switch hook或借机触发 update hook。

### 7.5 常见问题定位

- `Extension module is not JavaScript`：
  - 通常表示拿到了 HTML 回包而非模块文件。
  - 优先检查 `/scripts/extensions/third-party/*` 是否被协议层端点正确响应（应返回 404 或 JS bytes，而不是 `index.html`）。
- `missing required key extensionName`：
  - 表示 invoke 参数命名不匹配，检查路由 body -> 命令参数映射。
- legacy WebView 样式 `@layer` 仍不生效：
  - 检查样式请求是否带 `?ttCompat=layer`；并验证 `/scripts/extensions/third-party/*` 端点返回的是 `text/css` bytes（非 404/HTML）。

### 7.6 后续开发规则

- 新增插件加载能力时，优先扩展 `src/scripts/extensions/runtime/*`，不要把 Tauri 细节回灌到 `extensions.js`。
- 新增插件 API 时，优先在 `src/tauri/main/routes/extensions-routes.js` 封装，再通过 `context.safeInvoke()` 调 Rust 命令。
- 若调整 third-party 静态资源路径约定，必须同时更新 `resource-paths.js` 与 Rust 协议层端点的前缀解析逻辑。

### 7.7 移动端插件兼容（新增）

#### 7.7.1 JS 运行时兼容（Android 旧 WebView）

- 实现位置：`src/tauri/main/compat/mobile/mobile-runtime-compat.js`。
- 入口：`src/tauri/main/bootstrap.js` 中安装（仅 Tauri mobile）。
- 行为：基础 API 仅在缺失时补齐；Android 的 Web Clipboard 写入统一映射到原生写入器；整体只执行一次。
- 当前按需补齐：
  - `Array.prototype.at`
  - `String.prototype.at`
  - `Array.prototype.findLast`
  - `Array.prototype.findLastIndex`
  - `Array.prototype.toSorted`
  - `Array.prototype.toReversed`
  - `Object.hasOwn`
  - `navigator.clipboard.writeText`（仅 Android；保留 Clipboard 对象上的其他方法）

该策略用于修复移动端第三方插件在初始化阶段出现的 `TypeError: *.at is not a function`，以及 Android WebView 拒绝 Web Clipboard 写入的问题。TauriTavern 第一方代码在所有平台直接使用 `src/tauri-bridge.js` 的原生写入器；宿主只授予 `clipboard-manager:allow-write-text`，不授予剪贴板读取能力，也不需要申请操作系统运行时权限。

#### 7.7.2 CSS `@layer` 降级（Android 旧 WebView）

- 实现位置：`src/scripts/extensions/runtime/third-party-runtime.js`（样式加载链路）。
- 触发条件：
  - 样式内容包含 `@layer`；
  - 当前 WebView 不支持 CSS Cascade Layers。
- 处理方式：
  - runtime 将样式 URL 改写为 `...?ttCompat=layer`；
  - Rust 协议层端点识别该 query 并移除 `@layer` 包裹（展平层级），返回可被旧 WebView 直接应用的 CSS。

该策略用于修复移动端插件面板（如 `TH-custom-tailwind`）样式大面积失效导致的布局错乱。

#### 7.7.3 原生内容视口与窗口背景

原生宿主拥有主 WebView 的矩形，系统栏、刘海和停靠键盘在原生层消费一次，网页按普通视口排版。前端只做两件事：`util/window-layout.js` 接收窗口快照并设置 `#bg1` 的窗口矩形；`window-backdrop.js` 的 `applyWindowBackdrop()` 是第一方背景的唯一写入点，新增背景来源接入它。只有高度变化的 resize 不触发与宽度相关的工作。

细节见 [CurrentState/MobileStyleAdaptation.md](CurrentState/MobileStyleAdaptation.md)，扩展可见的契约见 [API/Layout.md](API/Layout.md)。

#### 7.7.4 调试建议

- 若看到 `*.at is not a function`：
  - 检查是否为 Tauri mobile 会话，并确认 `window.__TAURITAVERN_MOBILE_RUNTIME_COMPAT__ === true`。
- 若 Android 复制失败：
  - 检查 `plugin:clipboard-manager|write_text` invoke 的拒绝原因；该链路不会静默回退到 Web Clipboard。
- 若插件样式错乱但 CSS 已成功请求：
  - 优先检查是否命中 `@layer` 降级分支；
  - 关注 `resolveStylesheetUrl()` 是否返回带 `ttCompat=layer` 的 URL。
- 若脚本弹窗贴顶到状态栏：
  - 所有内容一起偏移时，检查原生 WebView 矩形是否与政策避让一致；
  - 只有某个面板溢出时，检查其硬编码尺寸、负坐标或内部滚动边界。

### 7.8 嵌入式运行时（Embedded Runtime，消息内 iframe）

> 架构状态：仅保留为 static compatibility。它不是 ChatSurface bounded 路线的 runtime owner；新虚拟化开发不得继续扩展 parking/ghost/slot 体系。

该旧机制把消息内 iframe 包装成带预算、park/hydrate 与自愈的 slot，并在 static 消息重渲染时尽量避免 iframe teardown。bounded 启动会跳过该 chat owner；renderer 必须通过唯一 ChatSurface participant 接入，两套 owner 不得并存。

当前落地点（代码）：

- 安装入口：`src/tauri/main/services/embedded-runtime/install.js`
  - `bootstrap.js` 在 main ready 后按 bootstrap mirror 决定是否加载；在 `APP_READY` 后安装 chat adapters。
- Manager 与 profiles：`src/tauri/main/services/embedded-runtime/*`
  - 全局调试入口：`globalThis.__TAURITAVERN_EMBEDDED_RUNTIME__`
  - 配置来源：`tauritavern-settings.embedded_runtime_profile`
  - bootstrap mirror：`localStorage tt:embeddedRuntimeProfile = 'off' | 'auto' | 'compat' | 'mobile-safe'`
  - 旧版 `localStorage tt:runtimeProfile` 仅用于迁移
- DOM detectors：`src/tauri/main/adapters/embedded-runtime/*-runtime-adapter.js`
  - 已支持：JS-Slash-Runner（`.TH-render`）与 LittleWhiteBox（`.xiaobaix-iframe-wrapper`）。
- 消息写入 facade：`src/scripts/tauri/message/mes-text-write.js`
  - 上游调用点统一依赖 facade；`off` 时直接恢复普通 `.mes_text` HTML 写入语义。
- 渲染事务：`src/tauri/main/adapters/embedded-runtime/message-render-transaction.js`
  - 作为 facade 在 ER 开启时的底层实现，避免把 iframe runtime 当成普通 DOM 反复销毁重建。

当前边界说明：

- 已纳入管控：**消息内 iframe runtime**（JSR/LWB）。
- 暂不纳入：面板类 runtime 的 park（目前依赖浏览器本身回收即可）。
- 上述边界只描述 legacy profile 的当前事实，不是后续 bounded 架构的扩展清单。

更多“当前如何工作/哪些契约不能破坏/回归点”见：`docs/CurrentState/EmbeddedRuntime.md`。

## 8. 兼容层策略

- `src/tauri-main.js`：新主入口（推荐）。
- 新开发统一集中在 `src/tauri/main/*`，避免重复实现与多处注入链路并存。

## 9. 如何新增一个 Tauri 注入接口

1. 在 Rust 后端新增/确认命令（`src-tauri/crates/tauritavern/src/presentation/commands/*`）。
2. 若宿主层会调用该命令，将命令名加入 `src/tauri/main/kernel/invokes/tauri-commands.js`（`TauriInvokeCommand`，避免字符串拼写漂移）。
3. 若该命令为高频/可合并写入的调用，按需在 `src/tauri/main/kernel/invokes/invoke-policies.js` 增加/调整策略（dedupe / write-behind）。
4. 在 `src/tauri/main/routes/` 对应业务域中新增路由：路由层禁止直接引用 `window`，需要浏览器能力时下沉到 `adapters/` 或 `services/`。
5. 路由内只做参数校验、DTO 组装、`context.safeInvoke` 调用；错误直接暴露（避免 silent fallback）。
6. 保持返回结构稳定（状态码 + JSON 结构），避免破坏上游前端调用假设。
7. 跑 `pnpm run check`，确保完整工程门禁通过。

## 10. 调试与验证

建议最小验证流程：

1. `pnpm run check`
2. `pnpm run dev`
3. 启动后确认：
   - 首屏加载正常
   - 不再出现 CSRF 初始化错误
   - 角色/聊天/设置等核心接口可用

如需快速定位问题：

- 查看 DevTools 中请求是否命中本地注入路径。
- 查看控制台 `invoke` 报错信息与路由返回状态码。
- 检查对应 `routes/*` 是否遗漏请求字段映射。

### 10.1 轻量性能仪表（Perf HUD）

用于快速定位移动端/低端机型的主线程卡顿、DOM 膨胀、以及 invoke 热点。

- 默认关闭。
- 启用（需 reload 才能抓启动打点）：
  - 控制台：`localStorage.setItem('tt:perf','1'); location.reload();`
  - 或 URL：`?ttPerf=1`
- 启用后等待就绪：`await window.__TAURITAVERN_PERF_READY__`
- 常用导出命令：
  - `window.__TAURITAVERN_PERF__.downloadReport()` 下载 JSON（便于交给 AI 分析）
  - `window.__TAURITAVERN_PERF__.exportJson({ includeResources: true })` 直接拿到 JSON 字符串
  - `await window.__TAURITAVERN_PERF__.copyReport()` 通过原生写入器复制到剪贴板
- HUD 操作：拖动标题栏移动（位置持久化），点击标题栏展开/收起；桌面端可用 `Ctrl+Alt+P` 切换开关。

## 11. 工程守护（Guardrails + 类型检查）

目标：把宿主层（`src/tauri/main/*`）限制在**可长期维护**的规模与依赖形态，避免再次回到单文件膨胀与隐式耦合。

- 一键检查：`pnpm run check`（宿主边界、类型、架构边界、全部测试与 Clippy）。
- Guardrails（`scripts/check-frontend-guardrails.mjs`）：
  - 行数预算：默认单文件 `<= 500` 行；关键聚合文件受 `scripts/guardrails/frontend-lines-baseline.json` 的基线约束。
  - 依赖边界：`kernel/ports` 不得 import `services/routes/adapters`；`services` 不得 import `routes`。
  - 路由契约：`src/tauri/main/routes/*` 禁止直接引用 `window`（需要触碰浏览器/DOM/上游 ST 时，新增 `adapters/*`）。
- 类型检查（`tsc -p tsconfig.host.json`）：
  - `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` 等强约束。
  - JS 文件默认不强制检查；需要在文件头加 `// @ts-check` 并配合 JSDoc（Host Kernel 目录已按此标准化）。

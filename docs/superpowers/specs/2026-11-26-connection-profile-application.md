# 连接配置应用的错误与完成归属

实际 APP_READY、原 `/profile-create`／`/profile` 执行器、原生选择框和密钥 HTTP 边界已复现三项问题：密钥激活返回 500、原密钥仍 active，配置却正常返回名称并发布加载事件；挂起密钥激活时，其他配置的加载事件提前结束本次命令；选择 `<None>` 后，旧操作仍继续并发布原配置加载成功。排序探针等待 EXTENSION_SETTINGS_LOADED，确认只有一个原生选择框，排除了未完成启动时重复初始化的探针干扰。

采用原有 managed command helper 和 application queue。Profile 与 Model Target 在同一 helper 检查原命令的返回约定；可记录的空输入与合法空结果分开，prompt-post-processing 的 none 成功空结果保持；`stop-strings` 和 `start-reply-with` 按已有 ALLOW_EMPTY 接受空结果，保留 force 参数。命令明确失败或拒绝时停止后续重放和连接，不发布 LOADED 或 reload success。`/secret-id` 的既有 quiet 和失败空字符串契约保持，Profile 从失败结果提供命令上下文；已经抛出的原因继续传播。

所有选择写入共用原 setter 推进版本，捕获／创建／删除也使旧应用失效。选择和重新加载共用一个实际应用入口，`/profile` 等待该入口自己的 Promise，移除对任意 LOADED 事件的等待。原生 change 仍是界面入口，脚本直接调用同一应用操作；仓库中该选择框的实际行为消费者只有 Connection Manager 本身，公开的 Profile／Model Target 事件继续保留原名称和字符串参数。应用在异步详情渲染之前取得现有队列和版本归属；结束时再次核对版本，旧操作以 AbortError 结束。`<None>` 同步使旧重放失效，不撤销已经发起的独立密钥保存。

原生选择、reload 和 `await=false` 的后台应用由界面呈现一次错误；`await=true` 的拒绝交给原 slash executor。成功、未找到配置、`<None>`、超时与 `await=false` 的原返回约定保持。选择引用仍表示用户选择的对象，失败时可检查详情和重试；已经应用的字段和独立保存不回滚，不增加状态镜像或跨设置事务。中文错误标题明确说明未能完整应用。

只改应用结果和归属，不重新设计 provider、预设匹配、连接状态检查或资料格式。仅补回值检查无法解决错误关联，额外 pending 状态或新的失败事件会形成第二条完成路径，因此沿原队列返回实际 Promise。这是已授权的日常修复，用户已免除例行方案确认；继续当前任务分支，保护其他差异，不提交、推送或操作真实 provider。

最高层浏览器覆盖实际失败、原生错误 owner、无关事件、None 取消、非等待模式、原空字段与重试。按原入口执行完整检查并准确记录现存 actool 环境限制，完成逐路径自审和一次精确增量独立审阅。APK 构建、安装和真机结果分别报告。

独立审阅确认两项 P2：空选择等待旧写入，以及无效 API 忽略 quiet 导致重复提示。空选择在同一应用入口立即完成详情、spinner 和原事件，但不替换仍在等待旧写入的重放队列；下一真实应用继续串行等待。在原 `/api` callback 的无效输入边界响应既有 quiet 参数，保留默认提示和失败空字符串。该文件的此前差异已另存精确 before，纳入本项修正和工作区保护范围。扩展同一最高层测试核对及时返回、后续写入不并行、单条提示及公开命令的默认／quiet 行为。

关联的 Android 模板等待复核实际复现旧详情覆盖空选择。共同详情渲染也从同一选择 version 判断结果归属；Profile／Model Target 只构造各自模板参数，模板读取与有条件发布共用一处。过期的渲染结果不覆盖当前详情，不增加渲染计数器或状态镜像。原公开错误与事件保持，最高层测试经真实 `read_frontend_extension_template` IPC 核对该缺陷。

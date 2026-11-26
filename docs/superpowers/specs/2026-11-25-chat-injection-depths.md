# 聊天注入的实际深度遍历

本项在现有生成和扩展契约内降低提示词准备开销，不改变功能或参数。用户已授权日常性能优化和必要重构，无例行方案确认，不提交、推送或创建 PR。

## 证据与目标

TC `doChatInject()` 和 CC `populationInjectionPrompts()` 每次都遍历 0..10000、每个深度三个角色；没有注入时也查询 30003 次。`getExtensionPromptMaxDepth()` 的公开返回值是允许上限，不是当前数据实际使用的深度。

在 Apple M1、Node v24.22.3、生产 Browser Runtime 中，100 条历史、模拟确定性 tokenizer、三次预热/十二次采样的 CC 中位数为：无注入 25.97 ms、仅相对提示词 28.84 ms、稀疏深度 30.41 ms、仅 PromptManager 深度 25.68 ms。真实 TC `Generate('quiet', ..., true)` 的二十条历史中位数为：无注入 34.44 ms、稀疏深度 38.34 ms。原始数据、输入哈希、基线差异和测量脚本保存于 `output/verification/chat-injection-depths-20261125/`；临时基线源码副本在验收后清理，重跑 before 需恢复对应哈希版本。这些数据衡量本地准备，不代表真机冷启动或服务响应。

## 方案与取舍

在现有 `extension-prompts.js` 中实现一个实际深度 iterator，TC/CC 在原插入循环中消费它。每次恢复遍历时从原 source 读取位置、值、角色和深度，只选择下一处可能产生查询结果的整数深度。CC 额外提供已准备 PromptManager 的实际深度，并继续排除已经由 PromptManager 承载的 key。

只缩小到最大深度仍会扫过稀疏提示词之间的空层；预计算固定深度列表则会漏掉 async 条件新增的后续提示词。选择每个实际深度后重新读取 source，不缓存深度、条件或文本。

## 保留的契约

- `getExtensionPromptMaxDepth()` 仍返回 10000；内部 iterator 由调用者提供此上限。
- 原角色顺序、order bucket、插入索引、continue 的深度 0 行为、文本排序/包装和请求 evaluator 保持。
- source 的 position 使用现有数值比较语义；depth 只匹配整数数值，非法、负数、非整数和超出上限的深度不查询。
- `undefined` depth 保留 wildcard，必要时仍逐层查询；不改为 0。`undefined` role 继续匹配三个角色。
- 条件仍只在实际文本查询时执行。一个条件新增未来深度、改变自身深度或清空值后，后续遍历读取更新后的 source。
- PromptManager 的 ABSOLUTE 深度和已接管扩展 key 保持；附加方式继续在其原阶段处理，不进入深度遍历。
- CC/TC 输出逐字保持，不扩建 frozen schema、宏事务快照或新的持久化状态。

## 验证与交付

先扩展现有最高层行为覆盖，验证未来 10000 深度新增、wildcard 改变为实际深度、范围外不执行条件，以及真实 TC 动态新增。已有条件、marker、请求预算、Agent/Session 流程继续覆盖其余语义。

性能使用同一脚本、数据、tokenizer、预热和采样数前后比较，核对每个结果的消息/提示词 SHA 及 wildcard 条件次数相同。不加入计时阈值测试，不以源码文本或内部扫描次数写回归断言；测量是本项性能缺陷与修复效果的证据。

每轮实现后运行 `pnpm run check`，保留 `actool` 环境失败并补跑被短路的后续检查。进行一次独立只读审阅和逐路径自审。把本项和已验证的条件修复一起生成同签名正式 APK，设备缺失不声称安装。

分支 `feature/mobile-chat-shell`，保护全部已有修改和空暂存区。诊断/差异基线集中在 `.local/chat-injection-depths-20261125/`，交付后清理，保留有用的验收证据及正式 APK。

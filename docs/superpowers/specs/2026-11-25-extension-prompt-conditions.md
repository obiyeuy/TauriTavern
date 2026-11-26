# 条件扩展提示词

用户已授权在现有功能与契约范围内自主修复稳定性和兼容问题。本项修复恢复 `setExtensionPrompt(..., filter)` 已表达的语义：只有条件允许的提示词才能加入生成，条件失败不能变成成功的部分提示词。使用现有 JavaScript、宏和提示词组装入口。

## 证据与目标

- 生产 `getExtensionPrompt()` 把 async 谓词传给 `Array.filter()`。同步、异步 false 的提示词都进入结果，按名查询却正确返回空文本。
- 生产 CC 组装中 `1_memory` 的 false 条件被忽略，同条件的自定义名字被排除。
- CC 已有的深度查询能正确 await，但复制分组、排序、包装和宏求值规则；冻结 Run 的条件判断也独立实现。
- 条件读取同一份提示词对象；`prompt.filter()` 的 receiver 和它对 `value` 的修改属于现有可观察行为。

目标是统一条件语义和实际文本查询，保留同步/异步条件、排序、位置/深度/角色选择、trim/wrap/substitute、请求级预算、live/context 宏，以及 frozen capture 的字段格式。

## 方案与取舍

在现有语义拥有者 `src/scripts/extension-prompts.js` 中实现一个 async 条件谓词 `isExtensionPromptEnabled(prompt)` 和一个文本查询 `getExtensionPromptText(source, options)`。已有 script.js 的公开按名/分组入口转入它们，CC 直接提供来源及请求 evaluator；冻结输入只共享谓词，仍拥有字段捕获。

CC 的相对提示词通过同一添加规则处理已知名字和自定义名字。已知标识符、相对插入顺序以及 vectors/ChromaDB 相对提示词的既有 system 角色保持。真实 Generate 的 Story String 和 anchors 只供 Text Completion 准备，CC 只经过自己的实际组装。

IN_CHAT 不准备未使用副本；同名 PromptManager 条目具有有效 ABSOLUTE/ATTACH 位置时，它是实际消费者，保留角色、深度、顺序与附加方式的覆盖。在主提示词宏完成后执行一次条件和内容求值，把对应 key 路由至该条目，从原始深度查询中排除。覆盖决定一个有效位置；旧实现同时输出原始深度副本是分裂路径，不作为额外插入功能保留。其他 IN_CHAT 条件仍在实际深度查询中求值，NONE 不进行生成查询。

逐入口加补丁会继续留下重复规则；启动时预计算所有条件会改变深度条件与宏变量的时序。因此选择在实际查询时求值，不缓存条件或增加第二份状态。

## 保留的边界

- 公开 `getExtensionPrompt()` 的位置参数与 `getExtensionPromptByName()` 的调用方式保持，请求 `substitute` 继续贯穿共同查询。
- 查询先按位置、非空值、深度和角色选择，再执行条件。`undefined` 深度/角色保留 wildcard；按名和 frozen capture 的条件仍在值转换前执行。
- 分组查询按 key 排序，匹配条件并发等待，随后按原顺序组装；不串行化既有并发查询。
- 条件通过 `prompt.filter()` 调用，保留 receiver；错误保留原拒绝原因。CC 未知组装错误向调用方传播，已有 token budget/invalid-name 的显式处理维持。
- 同步 `{{outlet}}` 只读文本，不执行 async 条件。
- frozen capture 继续在既有捕获点、主提示词宏之前求值条件并保存结果；本项不重设计捕获时机。
- 删除无实际消费者的私有 `getAllExtensionPrompts()` 和 CC 重复文本查询，核对全部调用者。
- 不改扩展注册、事件 payload、冻结输入 schema、生成参数或深度上限。本项不优化固定全深度扫描，后者需单独测量。

## 验证与交付

使用生产 Browser Runtime 验证分组 false、按名、排序/包装/预算 evaluator、已知/自定义 CC 条件、真实 Generate 的一次相对求值、深度条件的主宏时机、有效 ABSOLUTE/ATTACH marker 覆盖、frozen capture 和失败传播。HTTP/tokenizer 采用现有可控 fixture，不访问真实服务或凭据。只有这些已复现行为与非平凡边界增加覆盖，不用源码文本断言。

实现后运行 focused、现有 Agent/宏/生成覆盖和完整 `pnpm run check`。本机缺少 Xcode `actool` 的环境失败保留原样；被短路的后续检查分别完成。逐路径自审并进行一次独立只读审阅。设备缺失不阻止源码工作，也不声称真机验收。

延续 `feature/mobile-chat-shell`，保护已有修改，不暂存、提交、推送或创建 PR。本项临时差异基线和诊断集中在 `.local/extension-prompt-conditions-20261125/`，交付后清理；正式 APK 和验收证据按交付需要保留。

# 文件向量入库结果与查询正文

原 `vectors_rearrangeChat` 和实际 slash 入口探针已确认：`/api/vector/insert` 返回 500 后，`vectorizeFile()` 弹错误并返回 false，但消息和 Data Bank 调用者仍查询未确认的索引。消息附件全文被替换为空结果，`/db-ingest` 和 `/db-search` 正常返回。成功检索第一条附件消息后，第二次查询按旧 `fileLength` 截取已缩短的正文，丢掉第一条消息的问题。证据在 `output/verification/vector-file-ingestion-20261126/probe-results.json`。

沿原文件向量链路修复，不改变宿主路由、embedding provider、batch、集合命名、持久化布局、查询排序、设置或事件。`vectorizeFile()` 成功只完成入库，失败传播原错误和 cause，进度提示在 `finally` 清理；删除 false 和内部最终失败通知。`processFiles()` 及 Data Bank ingestion 等待同一拒绝协议，不能查询失败的工作单元或发布替换正文。Data Bank 只在已有索引确认或本次入库成功后收集 ID；任一必要步骤失败就交给原调用者，不新增部分成功对象或事务。

原 `rearrangeChat()` 继续提示跳过向量检索并允许生成。失败的当前消息保留完整附件和正文；其他已完成消息保留实际成功的结果，没有跨聊天回滚或新的降级路径。纯 slash 拒绝、不在源头通知，由原 executor 决定呈现。全部文件入库按钮仍处理多个文件：普通单文件入库失败由按钮记录一次原因并继续其他文件，结束时保留原部分失败提示；现有 source abort cause 仍中止后续工作，由外层按钮呈现一次。读取错误和已保存索引跳过读取的原行为不变。

成功替换附件时，先取得原正文后缀，使用实际 chunks 加两个换行构成附件前缀，再一起更新该消息的 `mes` 和 `extra.fileLength`。生成消息的 `extra` 原本可能共享 canonical 消息对象；新前缀长度属于新正文，因此只替换工作消息的 extra，保留其他字段及 canonical 原长度。后续文件／聊天／世界书查询沿原 `getQueryText()` 取得相同的用户问题，不引入查询缓存或第二条截取规则。成功的空命中仍是有效结果，前缀仅为原两个换行。

复用已有最高层附件 Browser fixture 和真实向量入口／按钮／slash，提供确定性 insertion gate。验证入库失败和重试、两条附件查询与 canonical 数据、两个 Data Bank 命令、全部文件按钮的普通部分失败和 source abort。既有读取失败、保存索引、准备／删除等场景继续覆盖；不在各层新增重复测试，不改 Rust 或真实用户数据。

继续 `feature/mobile-chat-shell`，四文件 before 快照保护此前未提交修改。用户已授权自主实施，工程方案由执行者选择，不作例行确认；不提交、推送或操作手机。运行 focused 与完整 `pnpm run check`，实际环境失败保留并补跑未到达检查；一次精确增量审阅和必要修正后归档、清理本项 scratch，目标继续 active。

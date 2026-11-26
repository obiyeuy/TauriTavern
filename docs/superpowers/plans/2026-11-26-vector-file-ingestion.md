# Vector File Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未确认入库不继续查询或替换附件正文，成功的文件检索保持完整用户查询及正确前缀长度。

**Architecture:** `vectorizeFile(): Promise<void>` 沿原错误链拒绝，实际生成／按钮／命令入口接管通知；成功的投影正文同时拥有其派生长度。复用原 provider、索引、查询及最高层附件覆盖。

**Tech Stack:** JavaScript、Browser Runtime／happy-dom、原向量拦截器与 slash／文件按钮。

**Spec:** `docs/superpowers/specs/2026-11-26-vector-file-ingestion.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护四文件 before 及无关／staged 指纹；不提交、推送、操作手机或真实数据。
- 保留原 `/api/vector/*`、provider、batch、collection、格式、设置、事件、canonical chat 与查询排序；不新增依赖、状态缓存或包装层。
- 生成仍由 `rearrangeChat()` 提示跳过；纯命令拒绝，UI 批量普通失败继续、source abort 停止。读取失败和已保存索引行为保持。
- 前缀仍使用 chunks 和两个换行；派生的工作消息 extra 不回写 canonical 的长度。
- 原用户授权覆盖实现方案，不例行确认；`pnpm run check` 实际失败单列，补跑未到达的 UI／Rust／Clippy。

## Review Focus

- 入库普通失败不查询未确认索引或移除附件全文；Task 1 实际拦截器及确定性 insertion failure/retry。
- 两条附件在前一条变短或空命中后查询问题仍完整，canonical metadata 保持；Task 1 真实 `appendFileContent()` 输入和拦截器 query 请求。
- Data Bank 命令不吞错，原 cause／纯 executor 通知归属保持；Task 1 `/db-ingest` 和 `/db-search`。
- 全部文件按钮的部分成功与 source abort 保持原行为；Task 1 实际按钮和两个独立文件。
- 已保存索引跳过读取、读取失败不替换正文，进度失败后结束；Task 1 复用已有向量读取／保存索引覆盖并核对实际 toast 状态。

### Task 1: 在文件向量源头确认结果和正文

**Files:**
- Modify: `src/scripts/extensions/vectors/index.js`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 `insertVectorItems()`、`getSavedHashes()`、`getFileAttachment()`、`getQueryText()`、`VECTOR_SOURCE_ABORT_CAUSES`、原实际按钮与 slash、`rearrangeChat()` recovery。
- Produces: 私有 `vectorizeFile(fileText, fileName, collectionId, chunkSize, overlapPercent): Promise<void>` 成功确认／失败原拒绝；`processFiles()` 成功投影的 `extra.fileLength` 描述同一正文。没有新公开接口。

- [x] Step 1: 扩展现有 fixture 的确定性 vector insertion gate；加入实际拦截器入库失败保留全文／一次恢复通知／重试，两条文件消息（普通 chunks／空命中）的查询问题与 canonical 长度，两个 Data Bank 命令的原失败和重试，以及 UI 普通部分失败／fatal source abort。复用原读取和已保存索引覆盖。
- [x] Step 2: Run `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit --test-name-pattern="vector file ingestion|vector file queries|Data Bank vector command|vectorize-all preserves" tests/browser/data-bank-replacement.test.mjs`。Expected: 原缺陷 RED；UI 既有行为是保留契约，应在原实现通过；夹具错误另记。
- [x] Step 3: 源头删除 false／内部失败通知并在 `finally` 清理进度，迁移 UI 普通失败 catch 和原 source abort；Data Bank ID 在确认后收集。工作消息成功时同时更新前缀正文和其 extra 长度，保留 canonical 数据。
- [x] Step 4: Run 同一 focused 命令。Expected: 原缺陷和 UI 保留契约全部通过，cause／通知／全文／查询正确。
- [x] Step 5: 更新 guide 与镜像；Run `pnpm run check`，补执行未到达检查。Expected: 受影响行为、UI、Rust／边界通过，actool 等环境失败明确保留。
- [x] Step 6: 逐入口自审，按四文件 before→最终增量进行一次独立审阅和必要 RED／GREEN 修正；更新候选清单，归档清理，保留未提交修改。

最终证据见 `output/verification/vector-file-ingestion-20261126/final-summary.json`。一次独立审阅无问题；Browser 245/245、UI 191/191、Rust 1274／0／1、Clippy／边界通过。完整 check 仍因缺少 Xcode actool 退出 1，未跳过或标绿。fixture toast 的物理删除超时与原 executor cause 包装的断言修正已记入 ledger，不计为生产缺陷。

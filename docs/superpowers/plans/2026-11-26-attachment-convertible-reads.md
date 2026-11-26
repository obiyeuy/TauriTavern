# Convertible Attachment Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 已支持转换的格式不因未使用的正文读取而变慢或失败，实际转换与存储契约保持。

**Architecture:** 原私有文件政策从 MIME／size 决定哪些类型需要 binary IO，原准备入口按实际输出格式选择唯一必要读取。无缓存、额外状态或新接口。

**Spec:** `docs/superpowers/specs/2026-11-26-attachment-convertible-reads.md`

## Global Constraints

- 继续 `feature/mobile-chat-shell`，保护此前全部修改与暂存区；没有提交、推送、设备、真实 provider 或业务数据操作。
- 保持原 MIME／converter 匹配、非媒体 350 MiB 限制、动态注册、binary、字节编码、字段、事件、位置和原错误 owner。
- 保留 metadata-only 媒体校验；未知类型读错误仍拒绝；已知 converter 的实际读取／解析失败仍由转换器传播。
- 只消除实际不影响输出的 File.text／Data URL 读取，不引入缓存、包装入口、开关或回退。

## Review Focus

- 已注册 converter 的实际选择／消息准备不触发未使用读取，最终上传确实是转换后的文本。
- Data Bank 使用同一规则，实际转换读与错误仍可观察，不上传原二进制回退。
- 普通文本与媒体原字节路径、非媒体大小限制、动态注册以及失败／重试／位置规则保持。
- 性能数据相同控件、相同 File 与转换器，读取次数及输出一致，原生手机和完整解码边界明确。

### Task 1: 统一已支持格式的必要读取

**Files:**
- Modify: `src/scripts/chats.js`
- Modify: `tests/browser/data-bank-replacement.test.mjs`
- Modify: `docs/FrontendGuide.md`
- Modify: `default/skills/tt-docs/references/FrontendGuide.md`

**Interfaces:**
- Consumes: 原 `getFileValidationError()`、`isConvertible()`／`getConverter()`、Data URL、`convertTextToBase64()`、位置捕获与已有附件 fixture。
- Produces: 原接口和输出；已知格式仅进行实际转换需要的文件读取。

- [x] Step 1: 捕获四文件 before／Git 指纹并刷新性能基线。扩展最高层 fixture，覆盖已注册 converter 的实际 picker／preparation／Data Bank 输出和未使用读取；保留真实读取拒绝。
- [x] Step 2: Run `node --experimental-vm-modules --test --test-timeout=60000 --test-force-exit --test-name-pattern="convertible attachment reads" tests/browser/data-bank-replacement.test.mjs`。Expected: 原选择 text 读取、准备 Data URL 与重复读取的 RED，原转换失败的稳定行为通过。
- [x] Step 3: 媒体／converter 元数据先行，未知类型保留原动态 binary 决策；准备按实际输出分支读取，删除转换路径无用的 Data URL。同步 guide 镜像。
- [x] Step 4: Run 同一 focused 命令。Expected: 必要读取与正确输出全部通过，失败不发布或上传错误内容。
- [x] Step 5: 同条件后测，冻结输入并 Run `pnpm run check`，补未到达检查。Expected: 行为与验证稳定，读取减少、输出相同，完整检查的真实环境失败不标绿。
- [x] Step 6: 逐路径自审、精确四文件增量一次独立审阅，归档与候选更新，清理本项临时材料；APK 状态按实际更新。

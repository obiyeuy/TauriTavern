# Horde 密钥提交取消寿命 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this one inline task.

**Goal:** Horde 密钥提交不在取消后重启旧状态查询，也不改变后续连接的状态或加载。

**Architecture:** 原按钮在密钥 I/O 前捕获已有信号，在读取和写入完成后消费取消状态。保存、查询及按钮错误归属不变，不新增机制。

**Spec:** [Horde 密钥提交的取消寿命](../specs/2026-11-25-horde-key-preparation.md)。

## Task 1：完成原按钮的取消寿命

**Files:** `src/scripts/horde.js`、`docs/FrontendGuide.md` 及原生成器的内置镜像；新增 `tests/browser/horde-key-preparation.test.mjs`。

**Interfaces:** 原按钮、`getStatusHorde()`、密钥函数和请求 DTO 签名不变。

- [x] 捕获本轮三个生产文件的精确 before 基线和模式，记录 ledger；前一包交付前不改生产输入。
- [x] 通过原生按钮、真实 interceptor 和确定性密钥读写边界，记录 RED：6 项、3 通过、3 失败、0 取消。读取与写入成功后的旧查询都重启并覆盖新状态／加载；两类密钥失败和当前提交保持通过。
- [x] 前一包完成校验后，实现信号捕获与取消消费，移除遗漏的无寿命准备路径；focused GREEN 6/6、0 失败、0 取消、0 跳过，四个输入未变。
- [x] 同步文档镜像，运行 `pnpm run check`，补跑确实被环境失败阻断的 UI。Browser 165/165、UI 191/191；契约 460 通过、1 因缺少 Xcode `actool` 失败。167 个检查输入未变；35 个 Rust 输入、33 个修改路径及额外宿主配置、模式和 HEAD 与前次证据一致，未机械重跑。
- [x] 逐路径自审和独立只读审阅，更新候选与最终增量，构建并校验个人 APK，清理本轮专属探测与 before 基线。原签名、CRC、release／SDK、原生库及 ELF／ZIP 16 KiB 对齐通过，119 个构建输入和 112 个修改输入未变；包与证据见 `output/apk-horde-key-preparation-fix-delivery.md`，尚未安装。

## 取舍

原 `api-controls.test.mjs` 已覆盖四类状态查询和三个连接按钮的密钥准备；本轮覆盖遗漏的 Horde 密钥按钮。其外层已接近部分机器的 60 秒上限，因此使用独立的同层行为文件，不增加生产 hook，不复制其他 provider 的覆盖。

## Review Focus

核对按钮从密钥准备起持有原信号；读取和写入的取消检查均在进入后续动作前；保存失败仍可见，已发起的写入不被伪装成取消成功；Horde 的正常提交与状态 getter 外部契约不变；没有重复状态或跨 provider 特判。

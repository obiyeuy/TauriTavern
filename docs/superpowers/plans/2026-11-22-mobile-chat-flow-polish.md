# TauriTavern 手机聊天流程与动效优化

## 目标

让手机端遵循 Telegram 式的两层聊天结构：角色/会话列表是首页，点一行进入聊天详情，返回回到列表。历史、设置和原生管理面板继续复用现有数据与事件，不复制角色卡、聊天或世界书。

## 设计决定

- `roles` 是手机 shell 的首页；`chat` 是当前角色的详情页。
- 首页显示菜单按钮，详情页显示返回按钮；系统返回与顶部返回使用同一状态机。
- 原生角色列表仍是事实来源，shell 只负责页面标题、路由和视觉呈现。
- 页面进入/退出只使用 opacity + transform，动效可中断，`prefers-reduced-motion` 下关闭。
- 角色行、搜索、筛选、分页和空白状态采用 Telegram 联系人列表节奏；不改变桌面端和原生数据契约。

## 实施步骤

1. 在移动 shell 中把角色列表设为初始入口，收敛返回、抽屉、历史、设置和角色选择后的路由状态。
2. 调整顶栏语义：列表显示菜单，聊天显示返回；统一标题、副标题和当前会话入口。
3. 更新角色、历史、设置、抽屉和聊天页面的视觉层级与可中断动效。
4. 扩展已有手机导航行为测试，验证初始列表、角色选择、详情返回、系统返回、历史和设置路径。
5. 在预览中验证 375/390 手机、横屏、大字号、Night 和 reduced-motion，再重建 APK。

## 验收

- 应用进入手机壳后首先显示角色列表，不自动落入某个聊天详情。
- 点角色后进入聊天；顶部返回和 Android 返回回到列表；再次点角色仍能进入同一聊天。
- 历史和设置页均可从列表/抽屉进入并正确返回；生成中继续阻止切换。
- 无横向溢出，触控目标至少 48px，动画不依赖 `animationend` 才能完成状态切换。


## Implementation notes

- Mobile startup keeps the native character list as the first page and defers materializing the previous chat until selection. The list uses the existing recent-chat index for one summary request, with text-only previews and no parallel chat cache.
- Settings and native panels share one navigation stack. Composer history, Android Back, toolbar Back, action menus, and native drawer shortcuts all enter or unwind that stack in the same order.
- Final browser checks cover 375/390 portrait, landscape, reduced motion, Night, large text, menu dismissal, failed-panel retry, history ingress, and management pagination.

## Verification record

- `pnpm run test:browser`: 79/79 passed.
- `node --test tests/mobile-chat-shell.test.mjs`: 8/8 passed.
- Focused browser startup/session/navigation: 7/7 passed.
- UI tests: 190/190 passed; Rust tests: 1262 passed, 1 pre-existing ignored.
- Contract tests: 439/440; the only contract failure is the host missing Xcode `actool`; Clippy separately reports the existing `client_asset_paths.rs:180` needless_bool warning.
- APK rebuilt and signed with v2/v3; phone verification remains false because the phone was disconnected.

## Final review

- Independent read-only review found four P2 navigation/lifecycle issues: transient menu Back priority, management pagination lifetime, retry history, and composer history ingress. All four were fixed and covered by focused browser/unit assertions.
- No Critical findings remained. The reviewer found no data ownership split, script execution in previews, or message-action clipping regression.

- Real-browser QA also found and fixed Escape leaking from the shell menu into the legacy drawer shortcut. Overlay keys now take priority during capture; the behavior was verified RED→GREEN and exercised in the browser.
- Recent previews preserve the native sort selection. Final screenshots and 17 layout measurements are retained with the output.

# ChatGPT Project Badges

<p align="center">
  <strong>Display clickable Project badges with native icons and colors in the ChatGPT Recent sidebar.</strong>
</p>

<p align="center">
  <a href="https://github.com/YelloooBlue/chatgpt-sidebar-badges/raw/main/chatgpt-project-badges.user.js">Install Userscript</a>
  ·
  <a href="#english">English</a>
  ·
  <a href="#中文">中文</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>

---

## English

### Overview

In the ChatGPT web app, conversations inside the **Recent** sidebar do not indicate which **Project** they belong to. **ChatGPT Project Badges** is a lightweight Tampermonkey / Violentmonkey userscript that resolves each conversation's project membership and renders a compact, clickable badge with the project's native icon and color.

### Features

- **Native Icons & Live Color Sync**: Clones the project's sidebar SVG icon and extracts custom `color` / `fill` / `stroke` values (supporting hex, `rgb`, `hsl`, `oklch`, CSS variables, and preset names) to theme each badge.
- **Click-to-Open Project**: Clicking any badge intercepts navigation in the capture phase and opens the corresponding Project via ChatGPT's native SPA router (with a direct URL fallback if the Projects section is collapsed).
- **Instant Cache-First Rendering**: Persists project metadata and an LRU cache (up to 400 conversations) via `GM_getValue` / `GM_setValue` for 0ms rendering on page load.
- **Scoped Sidebar Observer**: Anchors `MutationObserver` strictly to the sidebar `<nav>` / `<aside>` container and ignores self-injected `.cgpt-project-badge` mutations, avoiding overhead while ChatGPT streams responses.
- **Batched Read/Write Updates**: Reads project visuals once per project before mutating badge DOM nodes to prevent forced synchronous layout (layout thrashing).
- **Persistent 429 Exponential Backoff**: Respects `Retry-After` headers and persists exponential cooldowns (`60s`–`600s`) across reloads to avoid rate-limit storms.
- **CSP-Safe DOM Construction**: Builds all fallback SVG icons with `document.createElementNS` without `innerHTML`.

### Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. **One-click install**: Open the [raw script URL](https://github.com/YelloooBlue/chatgpt-sidebar-badges/raw/main/chatgpt-project-badges.user.js) and confirm installation.
   - *Or manually*: Create a new userscript, paste the contents of [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js), and save (`Ctrl+S` / `Cmd+S`).
3. Reload `https://chatgpt.com/`.

### Menu Commands

Click the userscript manager icon in your browser toolbar to access:

| Command | Description |
| :--- | :--- |
| **Sync Projects & Conversations Now** | Trigger an immediate background sync |
| **Show Cache & Rate-Limit Status** | Inspect cached project/conversation counts and cooldown state |
| **Clear Local Cache** | Clear stored mappings and run a fresh sync |
| **Toggle Debug Logging** | Enable/disable `[Project Badges]` verbose logs in DevTools Console |

### How It Works

1. **Cached Render**: On load, badges render immediately from `GM_getValue` caches.
2. **Staggered Sync**: After 3.5s (and every 90s while the tab is visible), the script fetches `/backend-api/gizmos/snorlax/sidebar` and `/backend-api/conversations` sequentially using the current session token.
3. **On-Demand Pagination**: If unmapped conversations remain visible in the sidebar, up to 2 extra pages are fetched with polite delays.

### Privacy & Permissions

- Runs **only** on `https://chatgpt.com/*` and `https://chat.openai.com/*` (`@noframes`).
- Communicates **only** with ChatGPT's own same-origin `/api/auth/session` and `/backend-api/*` endpoints.
- Uses no external servers, analytics, or telemetry.

---

## 中文

### 简介

ChatGPT 网页版左侧 **Recent（最近对话）** 列表默认不会显示对话所属的 **Project（项目）**。**ChatGPT Project Badges** 是一个轻量级油猴（Tampermonkey / Violentmonkey）脚本，用于在每条最近对话旁渲染带有项目原生图标与配色的可点击徽章。

### 主要特性

- **原生图标与颜色同步**：自动提取侧边栏项目的原生 SVG 图标与自定义颜色（支持 `color` / `fill` / `stroke`、hex / `rgb` / `hsl` / `oklch` / CSS 变量及预设色），实时同步到徽章边框、背景与文字颜色。
- **点击徽章直达项目**：在事件捕获阶段拦截徽章点击，优先触发 ChatGPT 原生 SPA 路由无刷新跳转到对应 Project 页面（项目列表未展开时兜底 URL 跳转），不会误打开原对话。
- **秒级缓存渲染**：通过 `GM_getValue` / `GM_setValue` 持久化项目信息与会话映射（LRU 上限 400 条），页面刷新 0 延迟展示。
- **局部侧边栏监听**：`MutationObserver` 精准绑定在包含会话链接的 `<nav>` / `<aside>` 容器内，并忽略自身 `.cgpt-project-badge` 变更，彻底隔离主对话区流式输出时的性能开销。
- **读写分离批量更新**：渲染前按项目统一读取并缓存视觉模板与样式，再批量更新 DOM，消除强制重排（Layout Thrashing）。
- **持久化 429 指数退避**：遵循 `Retry-After` 响应头并跨刷新持久化冷却时间（`60s`–`600s`），避免触发风控。
- **CSP 安全**：纯 DOM API / `createElementNS` 构造回退图标，不使用 `innerHTML`。

### 安装方法

1. 在浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. **一键安装**：点击打开 [Raw 脚本链接](https://github.com/YelloooBlue/chatgpt-sidebar-badges/raw/main/chatgpt-project-badges.user.js) 并确认安装。
   - *或手动安装*：新建脚本，完整粘贴 [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js) 内容并保存（`Ctrl+S` / `Cmd+S`）。
3. 刷新 `https://chatgpt.com/` 即可生效。

### 菜单命令

点击浏览器工具栏的油猴扩展图标，可使用以下调试与管理命令：

| 菜单项 | 说明 |
| :--- | :--- |
| **Sync Projects & Conversations Now** | 立即手动同步项目与最近会话 |
| **Show Cache & Rate-Limit Status** | 查看已缓存的项目数、会话映射数与限流冷却状态 |
| **Clear Local Cache** | 清空本地缓存并重新拉取 |
| **Toggle Debug Logging** | 开启/关闭 DevTools Console 中的 `[Project Badges]` 调试日志 |

### 隐私与权限

- 仅匹配 `https://chatgpt.com/*` 与 `https://chat.openai.com/*`（已启用 `@noframes`）。
- 仅访问 ChatGPT 同源接口（`/api/auth/session` 与 `/backend-api/*`），不向任何第三方服务器发送数据。

## License

[MIT](LICENSE)

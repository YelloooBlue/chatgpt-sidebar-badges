# ChatGPT Project Badges (Pro)

[English](#english) | [中文](#中文)

---

## English

A lightweight Tampermonkey userscript that displays **Project** badges with native icons and colors next to conversations in the ChatGPT **Recent** sidebar.

### Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey) in your browser.
2. Open the extension menu -> **Create a new script** (or open [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js) as Raw to install).
3. Copy the full contents of [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js), paste it into the editor, and save (`Ctrl+S` / `Cmd+S`).
4. Reload `https://chatgpt.com/`.

### Features & Optimizations

- **Instant Cache-First Rendering**: Persists project metadata and conversation-to-project mappings via `GM_getValue` / `GM_setValue` (LRU capped at 400 conversations) for 0ms rendering on page load.
- **Scoped Sidebar Observer**: Anchors `MutationObserver` strictly to the sidebar `<nav>` / `<aside>` container containing conversation links and ignores self-injected `.cgpt-project-badge` mutations, eliminating overhead during ChatGPT response streaming.
- **Batched Read/Write DOM Updates**: Collects project visual templates and `getComputedStyle` colors once per project before mutating the DOM, preventing forced synchronous layout (layout thrashing).
- **Accurate Project Icon Matching**: Excludes `/c/` conversation links when resolving native sidebar project icons so `/g/<projectId>/c/<convId>` links are never misidentified.
- **Persistent 429 Exponential Backoff**: Stores rate-limit cooldown state across page reloads with exponential backoff (60s up to 600s).
- **CSP-Safe SVG Rendering**: Builds all fallback SVG icons via `document.createElementNS` without `innerHTML`.

### Menu Commands & Debugging

Click the Tampermonkey icon in your browser toolbar to access:

- **Sync Projects & Conversations Now**: Trigger an immediate manual sync.
- **Show Cache & Rate-Limit Status**: View cached project/conversation counts and remaining cooldown time.
- **Clear Local Cache**: Reset cached data and trigger a fresh sync.
- **Toggle Debug Logging**: Enable verbose `[Project Badges]` logs in the browser DevTools Console.

---

## 中文

一个轻量级 Tampermonkey（油猴）脚本，在 ChatGPT 左侧边栏的 **Recent（最近对话）** 列表中为属于某个 **Project（项目）** 的会话自动显示项目徽章（支持原生图标、颜色、本地缓存与 429 限流退避）。

### 安装方法

1. 在浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）扩展。
2. 点击扩展图标 -> **添加新脚本**（或打开 [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js) 点击 Raw 安装）。
3. 将 [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js) 的内容完整粘贴进去并保存（`Ctrl+S` / `Cmd+S`）。
4. 刷新 `https://chatgpt.com/` 页面即可生效。

### 主要特性与优化点

- **秒级缓存渲染**：使用 `GM_getValue` / `GM_setValue` 持久化项目与会话映射（LRU 上限 400 条），刷新页面 0 延迟显示徽章。
- **局部侧边栏监听**：`MutationObserver` 精准绑定在包含会话链接的 `<nav>` / `<aside>` 容器上，并自动忽略自身 `.cgpt-project-badge` DOM 变更，彻底消除 ChatGPT 流式输出时的卡顿。
- **读写分离批量更新**：渲染前按项目一次性读取原生 SVG 与 `getComputedStyle` 颜色并缓存，再统一更新 DOM，避免强制重排（Layout Thrashing）。
- **精准项目图标匹配**：查找侧边栏原生项目图标时排除 `/c/` 对话链接，避免误匹配到 `/g/<projectId>/c/<convId>`。
- **持久化 429 指数退避**：跨刷新持久化限流冷却状态，遇到 429/403 时按 `60s ~ 600s` 指数退避。
- **CSP 安全**：纯 DOM API / `createElementNS` 构造 SVG，不使用 `innerHTML`。

### 调试与菜单命令

点击浏览器工具栏的 Tampermonkey 图标，可在脚本菜单中使用：

- **Sync Projects & Conversations Now**：手动触发一次同步。
- **Show Cache & Rate-Limit Status**：查看已缓存的项目数、会话映射数与冷却剩余时间。
- **Clear Local Cache**：清空本地缓存并重新同步。
- **Toggle Debug Logging**：开启/关闭 DevTools Console 中的 `[Project Badges]` 调试日志。

# ChatGPT Project Badges (Pro)

一个轻量级 Tampermonkey（油猴）脚本，在 ChatGPT 左侧边栏的 **Recent（最近对话）** 列表中为属于某个 **Project（项目）** 的会话自动显示项目徽章（支持原生图标、颜色、本地缓存与 429 限流退避）。

## 安装方法

1. 在浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）扩展。
2. 点击扩展图标 -> **添加新脚本**（或直接打开 [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js) 点击 Raw 安装）。
3. 将 [`chatgpt-project-badges.user.js`](chatgpt-project-badges.user.js) 的内容完整粘贴进去并保存（`Ctrl+S` / `Cmd+S`）。
4. 刷新 `https://chatgpt.com/` 页面即可生效。

## 主要特性与优化点

- **秒级缓存渲染**：使用 `GM_getValue` / `GM_setValue` 持久化项目与会话映射（LRU 上限 400 条），刷新页面零延迟显示徽章。
- **精准侧边栏匹配**：仅作用于 `nav` / `aside` 内的会话链接，避免误伤聊天正文中的链接；获取项目原生图标时排除 `/c/` 对话链接，防止误匹配。
- **高性能 DOM 监听**：`MutationObserver` 过滤非侧边栏变更，避免 ChatGPT 流式输出时高频触发重绘。
- **持久化 429 指数退避**：遇到 429/403 限流时记录冷却时间并指数退避（60s ~ 600s），刷新页面也不会重复触发风控。
- **新会话自动补全与分页**：发现未映射的新会话或滚动加载更多历史会话时，自动防抖补抓（最多额外 2 页）。
- **CSP 安全**：纯 DOM API / `createElementNS` 构造 SVG，不使用 `innerHTML`。

## 调试与菜单命令

点击浏览器工具栏的 Tampermonkey 图标，可在脚本菜单中使用：

- `🔄 立即同步项目与会话`：手动触发一次同步（若处于 429 冷却期会在控制台提示剩余秒数）。
- `📊 查看当前状态`：查看已缓存的项目数、会话映射数与冷却状态。
- `🗑️ 清除本地缓存`：清空本地缓存并重新拉取。
- `🐛 开启/关闭调试日志`：开启后可在浏览器 DevTools Console 中查看 `[Project Badges]` 详细日志。

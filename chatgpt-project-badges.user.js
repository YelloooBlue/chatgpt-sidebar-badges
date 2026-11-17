// ==UserScript==
// @name         ChatGPT Project Badges (Pro)
// @namespace    chatgpt-project-badges
// @version      2.3.0
// @description  Show Project badges with native icons & colors in ChatGPT Recent sidebar (with cache, smart DOM observation & 429 backoff)
// @license      MIT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         https://chatgpt.com/favicon.ico
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const API = `${location.origin}/backend-api`;
  const CACHE_KEY_PROJECTS = 'cgpt_pb_projects_v1';
  const CACHE_KEY_CONVS = 'cgpt_pb_convs_v1';
  const CACHE_KEY_RATE_LIMIT = 'cgpt_pb_rate_limit_v1';
  const CACHE_KEY_DEBUG = 'cgpt_pb_debug_v1';

  const MAX_CACHED_CONVS = 400;
  const PAGE_SIZE = 28;
  const MAX_EXTRA_CONV_PAGES = 2; // 最多额外补抓 2 页（共 84 条）以覆盖侧边栏滚动
  const SYNC_INTERVAL_MS = 90 * 1000;
  const INITIAL_DELAY_MS = 3500;
  const NEW_CHAT_SYNC_DEBOUNCE_MS = 2500;
  const MIN_SYNC_GAP_MS = 15 * 1000;

  // 从本地缓存秒级恢复状态，刷新页面立即显示，不惧 429 限流
  const projectsMap = new Map(Object.entries(GM_getValue(CACHE_KEY_PROJECTS, {})));
  const conversationProjects = new Map(Object.entries(GM_getValue(CACHE_KEY_CONVS, {})));

  let rateLimitState = GM_getValue(CACHE_KEY_RATE_LIMIT, { until: 0, backoffCount: 0 });
  if (!rateLimitState || typeof rateLimitState !== 'object') {
    rateLimitState = { until: 0, backoffCount: 0 };
  }

  let debugEnabled = Boolean(GM_getValue(CACHE_KEY_DEBUG, false));
  let accessToken = null;
  let scanning = false;
  let rafPending = false;
  let lastSyncAt = 0;
  let debouncedSyncTimer = null;

  const COLOR_PRESETS = {
    blue: '#3b82f6',
    green: '#10b981',
    yellow: '#eab308',
    orange: '#f97316',
    red: '#ef4444',
    pink: '#ec4899',
    purple: '#8b5cf6',
    indigo: '#6366f1',
    teal: '#14b8a6',
    gray: '#6b7280',
  };

  // 纯几何路径数据，配合 createElementNS 构造，彻底兼容严格 CSP
  const ICON_SHAPES = {
    default: [['path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }]],
    code: [
      ['polyline', { points: '16 18 22 12 16 6' }],
      ['polyline', { points: '8 6 2 12 8 18' }],
    ],
    terminal: [
      ['polyline', { points: '4 17 10 11 4 5' }],
      ['line', { x1: '12', y1: '19', x2: '20', y2: '19' }],
    ],
    book: [
      ['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }],
      ['path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }],
    ],
    globe: [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['line', { x1: '2', y1: '12', x2: '22', y2: '12' }],
      ['path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }],
    ],
    sparkles: [
      ['path', { d: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z' }],
    ],
    briefcase: [
      ['rect', { x: '2', y: '7', width: '20', height: '14', rx: '2', ry: '2' }],
      ['path', { d: 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16' }],
    ],
  };

  GM_addStyle(`
    .cgpt-project-badge {
      --badge-color: var(--text-secondary, #888);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      max-width: 96px;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 5px;
      background: var(--sidebar-surface-secondary, rgba(128, 128, 128, 0.14));
      background: color-mix(in srgb, var(--badge-color) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--badge-color) 28%, transparent);
      color: var(--badge-color);
      font-size: 10.5px;
      font-weight: 500;
      line-height: 16px;
      white-space: nowrap;
      vertical-align: middle;
      pointer-events: none;
    }
    .cgpt-project-badge-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 11px;
      height: 11px;
      flex-shrink: 0;
    }
    .cgpt-project-badge-icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .cgpt-project-badge-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `);

  function logDebug(...args) {
    if (debugEnabled) {
      console.debug('[Project Badges]', ...args);
    }
  }

  function logInfo(...args) {
    console.info('[Project Badges]', ...args);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isRateLimited() {
    return Date.now() < (rateLimitState.until || 0);
  }

  function setRateLimit(waitMs) {
    const nextCount = (rateLimitState.backoffCount || 0) + 1;
    const expMs = Math.min(60 * 1000 * Math.pow(2, nextCount - 1), 600 * 1000);
    const finalMs = Math.max(waitMs, expMs);
    rateLimitState = {
      until: Date.now() + finalMs,
      backoffCount: nextCount,
    };
    GM_setValue(CACHE_KEY_RATE_LIMIT, rateLimitState);
    return finalMs;
  }

  function resetRateLimit() {
    if (rateLimitState.until !== 0 || rateLimitState.backoffCount !== 0) {
      rateLimitState = { until: 0, backoffCount: 0 };
      GM_setValue(CACHE_KEY_RATE_LIMIT, rateLimitState);
    }
  }

  function setConvProjectLRU(convId, gizmoId) {
    const prev = conversationProjects.get(convId);
    if (gizmoId) {
      if (prev === gizmoId) {
        // 刷新 LRU 顺序
        conversationProjects.delete(convId);
        conversationProjects.set(convId, gizmoId);
        return false;
      }
      conversationProjects.delete(convId);
      conversationProjects.set(convId, gizmoId);
      return true;
    }
    if (prev !== undefined) {
      conversationProjects.delete(convId);
      return true;
    }
    return false;
  }

  function saveCaches() {
    GM_setValue(CACHE_KEY_PROJECTS, Object.fromEntries(projectsMap));
    if (conversationProjects.size > MAX_CACHED_CONVS) {
      const entries = Array.from(conversationProjects.entries()).slice(-MAX_CACHED_CONVS);
      conversationProjects.clear();
      for (const [k, v] of entries) conversationProjects.set(k, v);
    }
    GM_setValue(CACHE_KEY_CONVS, Object.fromEntries(conversationProjects));
  }

  function normalizeColor(rawColor) {
    if (!rawColor || typeof rawColor !== 'string') return null;
    const trimmed = rawColor.trim().toLowerCase();
    if (COLOR_PRESETS[trimmed]) return COLOR_PRESETS[trimmed];
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) || trimmed.startsWith('rgb')) {
      return rawColor.trim();
    }
    return null;
  }

  function resolveIconKey(rawIcon) {
    if (!rawIcon || typeof rawIcon !== 'string') return 'default';
    const key = rawIcon.toLowerCase();
    for (const name of Object.keys(ICON_SHAPES)) {
      if (key.includes(name)) return name;
    }
    return 'default';
  }

  function extractProjectInfo(item) {
    const gizmo = item?.gizmo?.gizmo || item?.gizmo || item;
    const id = gizmo?.id;
    if (!id || !String(id).startsWith('g-p-')) return null;

    const display = gizmo?.display || {};
    return {
      id,
      name: display.name || gizmo?.name || 'Project',
      color: normalizeColor(
        display.color || display.theme_color || display.icon_color || gizmo?.color || null
      ),
      icon: display.icon || display.icon_name || display.emoji || null,
    };
  }

  async function getToken(forceRefresh = false) {
    if (accessToken && !forceRefresh) return accessToken;
    if (isRateLimited()) {
      throw new Error('处于限流冷却期，跳过 Session 请求');
    }

    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (res.status === 429) {
      const waitMs = setRateLimit(60 * 1000);
      throw new Error(`Session 接口触发 429 限流，已暂停 ${Math.round(waitMs / 1000)} 秒`);
    }
    if (!res.ok) throw new Error(`无法获取 ChatGPT 登录状态 (HTTP ${res.status})`);
    const session = await res.json();
    if (!session.accessToken) throw new Error('Access token 不存在');
    accessToken = session.accessToken;
    return accessToken;
  }

  async function getJSON(url) {
    if (isRateLimited()) {
      throw new Error('处于 429 冷却期，跳过请求');
    }

    const token = await getToken();
    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });

    if (res.status === 401) {
      const newToken = await getToken(true);
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${newToken}` },
        credentials: 'include',
      });
    }

    if (res.status === 429) {
      const retryAfterSec = parseInt(res.headers.get('Retry-After') || '60', 10);
      const baseMs = (Number.isFinite(retryAfterSec) ? Math.max(retryAfterSec, 30) : 60) * 1000;
      const waitMs = setRateLimit(baseMs);
      throw new Error(`HTTP 429 限流，冷却 ${Math.round(waitMs / 1000)} 秒`);
    }

    if (res.status === 403) {
      const waitMs = setRateLimit(60 * 1000);
      throw new Error(`HTTP 403 拒绝访问，冷却 ${Math.round(waitMs / 1000)} 秒`);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json();
  }

  async function fetchProjects() {
    let cursor = null;
    const seen = new Set();
    const freshProjects = new Map();

    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({
        owned_only: 'true',
        conversations_per_gizmo: '0',
      });
      if (cursor !== null) params.set('cursor', String(cursor));

      const data = await getJSON(`${API}/gizmos/snorlax/sidebar?${params}`);

      for (const item of data.items || []) {
        const project = extractProjectInfo(item);
        if (project) {
          freshProjects.set(project.id, project);
        }
      }

      const next = data.cursor ?? null;
      if (!next || seen.has(String(next))) break;
      seen.add(String(next));
      cursor = next;
      await sleep(600);
    }

    // 全部页拉取成功后，同步更新并清理已删除的项目
    projectsMap.clear();
    for (const [id, proj] of freshProjects) {
      projectsMap.set(id, proj);
    }
    logDebug(`同步项目完成，共 ${projectsMap.size} 个项目`);
  }

  function getSidebarLinks() {
    const navLinks = document.querySelectorAll('nav a[href*="/c/"]');
    if (navLinks.length > 0) return navLinks;
    return document.querySelectorAll('aside a[href*="/c/"]');
  }

  function hasUnmappedVisibleConversations() {
    const links = getSidebarLinks();
    for (const link of links) {
      const match = link.getAttribute('href')?.match(/\/c\/([^/?#]+)/);
      if (match && !conversationProjects.has(match[1])) {
        return true;
      }
    }
    return false;
  }

  async function fetchRecentConversations() {
    let offset = 0;
    let totalFetched = 0;

    for (let page = 0; page <= MAX_EXTRA_CONV_PAGES; page++) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(PAGE_SIZE),
        order: 'updated',
        is_archived: 'false',
      });

      const data = await getJSON(`${API}/conversations?${params}`);
      const items = data.items || [];
      totalFetched += items.length;

      for (const chat of items) {
        if (!chat?.id) continue;
        setConvProjectLRU(chat.id, chat.gizmo_id || null);
      }

      if (items.length < PAGE_SIZE) break;
      if (!hasUnmappedVisibleConversations()) break;

      offset += PAGE_SIZE;
      await sleep(800);
    }

    logDebug(`同步会话完成，本次拉取 ${totalFetched} 条，缓存共 ${conversationProjects.size} 条`);
  }

  function getSidebarProjectVisual(projectId) {
    const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(projectId) : projectId;
    // 排除包含 /c/ 的对话链接，避免误匹配到项目内的对话项
    const selector = `nav a[href*="/g/${escapedId}"]:not([href*="/c/"]), a[href*="/g/${escapedId}"]:not([href*="/c/"])`;
    const sidebarLink = document.querySelector(selector);
    if (!sidebarLink) return null;

    const svg = sidebarLink.querySelector('svg');
    let color = null;
    let svgNode = null;
    if (svg) {
      const inlineColor = svg.style.color || svg.getAttribute('color');
      const computedColor = getComputedStyle(svg).color;
      color = normalizeColor(inlineColor) || computedColor;

      svgNode = svg.cloneNode(true);
      svgNode.removeAttribute('width');
      svgNode.removeAttribute('height');
      svgNode.setAttribute('aria-hidden', 'true');
    }

    return { svgNode, color };
  }

  // 使用纯 DOM API 构造图标节点，避免 innerHTML 触发 CSP / TrustedHTML 限制
  function createIconElement(nativeVisual, iconKey) {
    const wrapper = document.createElement('span');
    wrapper.className = 'cgpt-project-badge-icon';

    if (nativeVisual?.svgNode) {
      wrapper.appendChild(nativeVisual.svgNode);
      return wrapper;
    }

    if (iconKey && /\p{Emoji}/u.test(iconKey) && iconKey.length <= 4) {
      wrapper.textContent = iconKey;
      return wrapper;
    }

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const shapes = ICON_SHAPES[resolveIconKey(iconKey)] || ICON_SHAPES.default;
    for (const [tag, attrs] of shapes) {
      const el = document.createElementNS(svgNS, tag);
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
      }
      svg.appendChild(el);
    }

    wrapper.appendChild(svg);
    return wrapper;
  }

  function updateBadges() {
    rafPending = false;
    const links = getSidebarLinks();
    if (links.length === 0) return;

    let hasUnknownConv = false;

    for (const link of links) {
      const match = link.getAttribute('href')?.match(/\/c\/([^/?#]+)/);
      if (!match) continue;

      const conversationId = match[1];
      const projectId = conversationProjects.get(conversationId);
      let badge = link.querySelector('.cgpt-project-badge');

      if (!projectId) {
        hasUnknownConv = true;
        if (badge) badge.remove();
        continue;
      }

      const project = projectsMap.get(projectId);
      if (!project) {
        if (badge) badge.remove();
        continue;
      }

      const nativeVisual = getSidebarProjectVisual(projectId);
      const finalColor = project.color || nativeVisual?.color || '';
      const hasNativeSvg = nativeVisual?.svgNode ? '1' : '0';
      const renderSignature = `${projectId}|${project.name}|${finalColor}|${project.icon || ''}|${hasNativeSvg}`;

      if (badge && badge.dataset.sig === renderSignature) {
        continue;
      }

      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cgpt-project-badge';
        badge.setAttribute('aria-hidden', 'true');
        link.appendChild(badge);
      }

      badge.dataset.sig = renderSignature;
      badge.title = project.name;

      if (finalColor) {
        badge.style.setProperty('--badge-color', finalColor);
      } else {
        badge.style.removeProperty('--badge-color');
      }

      const textNode = document.createElement('span');
      textNode.className = 'cgpt-project-badge-text';
      textNode.textContent = project.name;

      badge.replaceChildren(
        createIconElement(nativeVisual, project.icon),
        textNode
      );
    }

    // 发现新出现的未映射会话（如新建或刚移入项目的对话）时，温和触发一次防抖同步
    if (hasUnknownConv && !scanning && !isRateLimited() && Date.now() - lastSyncAt > MIN_SYNC_GAP_MS) {
      scheduleDebouncedSync();
    }
  }

  function scheduleUpdateBadges() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(updateBadges);
  }

  function scheduleDebouncedSync() {
    if (debouncedSyncTimer) return;
    debouncedSyncTimer = setTimeout(() => {
      debouncedSyncTimer = null;
      scan();
    }, NEW_CHAT_SYNC_DEBOUNCE_MS);
  }

  async function scan(force = false) {
    if (scanning) return;
    if (!force && document.hidden) return;
    if (isRateLimited()) {
      const remainSec = Math.ceil((rateLimitState.until - Date.now()) / 1000);
      logDebug(`处于 429 冷却期，剩余 ${remainSec} 秒`);
      return;
    }

    scanning = true;
    try {
      await fetchProjects();
      await sleep(800);
      await fetchRecentConversations();
      resetRateLimit();
      lastSyncAt = Date.now();
      saveCaches();
      scheduleUpdateBadges();
    } catch (err) {
      logInfo(err.message || err);
    } finally {
      scanning = false;
    }
  }

  function isSidebarRelevantMutation(mutations) {
    for (const m of mutations) {
      const target = m.target;
      if (target instanceof Element) {
        if (target.closest('nav, aside')) return true;
      }
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (
          node.matches('nav, aside, a[href*="/c/"], a[href*="/g/"]') ||
          node.querySelector('nav, aside, a[href*="/c/"], a[href*="/g/"]')
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('🔄 立即同步项目与会话', () => {
      logInfo('手动触发同步...');
      scan(true);
    });

    GM_registerMenuCommand('📊 查看当前状态', () => {
      const remainSec = isRateLimited()
        ? Math.ceil((rateLimitState.until - Date.now()) / 1000)
        : 0;
      const statusMsg = [
        `已缓存项目: ${projectsMap.size}`,
        `已缓存会话映射: ${conversationProjects.size}`,
        `429 冷却剩余: ${remainSec}s`,
        `调试日志: ${debugEnabled ? '开启' : '关闭'}`,
      ].join('\n');
      logInfo(statusMsg.replace(/\n/g, ' | '));
      alert(`[ChatGPT Project Badges]\n${statusMsg}`);
    });

    GM_registerMenuCommand('🗑️ 清除本地缓存', () => {
      projectsMap.clear();
      conversationProjects.clear();
      resetRateLimit();
      saveCaches();
      scheduleUpdateBadges();
      logInfo('本地缓存已清除，准备重新同步...');
      scan(true);
    });

    GM_registerMenuCommand(`🐛 ${debugEnabled ? '关闭' : '开启'}调试日志`, () => {
      debugEnabled = !debugEnabled;
      GM_setValue(CACHE_KEY_DEBUG, debugEnabled);
      logInfo(`调试日志已${debugEnabled ? '开启' : '关闭'}（刷新页面生效菜单文案）`);
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (isSidebarRelevantMutation(mutations)) {
      scheduleUpdateBadges();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      scheduleUpdateBadges();
      if (Date.now() - lastSyncAt > SYNC_INTERVAL_MS) {
        scan();
      }
    }
  });

  registerMenuCommands();

  // 1. 立即用本地缓存渲染一次（0 延迟、0 请求）
  scheduleUpdateBadges();

  // 2. 延迟 3.5 秒错峰执行首次后台同步，避开页面加载时的接口拥堵
  setTimeout(() => scan(), INITIAL_DELAY_MS);

  // 3. 每 90 秒低频同步一次
  setInterval(() => scan(), SYNC_INTERVAL_MS);
})();

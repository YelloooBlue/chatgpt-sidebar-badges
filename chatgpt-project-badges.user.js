// ==UserScript==
// @name         ChatGPT Project Badges
// @namespace    chatgpt-project-badges
// @version      2.5.0
// @description  Show clickable Project badges with native icons & colors in ChatGPT Recent sidebar (with cache, scoped observer & 429 backoff)
// @license      MIT
// @homepageURL  https://github.com/YelloooBlue/chatgpt-sidebar-badges
// @supportURL   https://github.com/YelloooBlue/chatgpt-sidebar-badges/issues
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
  const MAX_EXTRA_CONV_PAGES = 2; // Fetch up to 2 extra pages (84 chats total) for scrolled sidebars
  const SYNC_INTERVAL_MS = 90 * 1000;
  const INITIAL_DELAY_MS = 3500;
  const NEW_CHAT_SYNC_DEBOUNCE_MS = 2500;
  const MIN_SYNC_GAP_MS = 15 * 1000;

  // Restore cached state immediately on load for instant rendering without waiting on network requests
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
  let navObserver = null;
  let parentObserver = null;
  let rootObserver = null;
  let observedNav = null;

  const COLOR_PRESETS = {
    blue: '#3b82f6',
    sky: '#0ea5e9',
    cyan: '#06b6d4',
    teal: '#14b8a6',
    emerald: '#10b981',
    green: '#10b981',
    lime: '#84cc16',
    yellow: '#eab308',
    amber: '#f59e0b',
    orange: '#f97316',
    red: '#ef4444',
    rose: '#f43f5e',
    pink: '#ec4899',
    fuchsia: '#d946ef',
    purple: '#8b5cf6',
    violet: '#8b5cf6',
    indigo: '#6366f1',
    brown: '#a16207',
    slate: '#64748b',
    gray: '#6b7280',
  };

  // Pure SVG geometry definitions built via createElementNS to comply with strict CSP / TrustedHTML
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
      pointer-events: auto;
      cursor: pointer;
      transition: filter 0.15s ease, background-color 0.15s ease;
    }
    .cgpt-project-badge:hover {
      filter: brightness(1.15);
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
        // Refresh insertion order for LRU eviction
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
    const trimmed = rawColor.trim();
    const lower = trimmed.toLowerCase();
    if (
      !lower ||
      lower === 'none' ||
      lower === 'transparent' ||
      lower === 'currentcolor' ||
      lower === 'inherit' ||
      lower === 'initial' ||
      lower === 'unset'
    ) {
      return null;
    }
    if (COLOR_PRESETS[lower]) return COLOR_PRESETS[lower];
    if (
      /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(lower) ||
      /^(rgba?|hsla?|oklch|oklab|color)\(/i.test(lower) ||
      lower.startsWith('var(--')
    ) {
      return trimmed;
    }
    return null;
  }

  function isNonNeutralColor(cssColor) {
    if (!cssColor) return false;
    const rgbMatch = cssColor.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i);
    if (rgbMatch) {
      const r = Number(rgbMatch[1]);
      const g = Number(rgbMatch[2]);
      const b = Number(rgbMatch[3]);
      const a = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
      if (a === 0) return false;
      return Math.max(r, g, b) - Math.min(r, g, b) >= 12;
    }
    // Non-rgb formats (hex, hsl, oklch, var) that survived normalizeColor are treated as explicit colors
    return true;
  }

  function extractSvgColor(svg) {
    if (!svg) return { color: null, isCustomColor: false };

    const shape = svg.querySelector('path, circle, rect, polygon, polyline, line');
    const explicitCandidates = [
      svg.style?.color,
      svg.getAttribute('color'),
      svg.getAttribute('fill'),
      svg.getAttribute('stroke'),
      shape?.style?.color,
      shape?.style?.fill,
      shape?.style?.stroke,
      shape?.getAttribute('fill'),
      shape?.getAttribute('stroke'),
    ];

    for (const raw of explicitCandidates) {
      const norm = normalizeColor(raw);
      if (norm && isNonNeutralColor(norm)) {
        return { color: norm, isCustomColor: true };
      }
    }

    const svgStyle = getComputedStyle(svg);
    const shapeStyle = shape ? getComputedStyle(shape) : null;
    const computedCandidates = [
      svgStyle.color,
      svgStyle.fill,
      svgStyle.stroke,
      shapeStyle?.fill,
      shapeStyle?.stroke,
      shapeStyle?.color,
    ];

    for (const raw of computedCandidates) {
      const norm = normalizeColor(raw);
      if (norm && isNonNeutralColor(norm)) {
        return { color: norm, isCustomColor: true };
      }
    }

    return { color: normalizeColor(svgStyle.color), isCustomColor: false };
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
        display.color ||
          display.theme_color ||
          display.icon_color ||
          display.accent_color ||
          display.theme ||
          gizmo?.color ||
          null
      ),
      icon: display.icon || display.icon_name || display.emoji || null,
    };
  }

  async function getToken(forceRefresh = false) {
    if (accessToken && !forceRefresh) return accessToken;
    if (isRateLimited()) {
      throw new Error('Rate-limit cooldown active, skipping session fetch');
    }

    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (res.status === 429) {
      const waitMs = setRateLimit(60 * 1000);
      throw new Error(`Session endpoint hit 429, paused for ${Math.round(waitMs / 1000)}s`);
    }
    if (!res.ok) throw new Error(`Failed to fetch ChatGPT session (HTTP ${res.status})`);
    const session = await res.json();
    if (!session.accessToken) throw new Error('Access token missing in session');
    accessToken = session.accessToken;
    return accessToken;
  }

  async function getJSON(url) {
    if (isRateLimited()) {
      throw new Error('Rate-limit cooldown active, skipping request');
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
      throw new Error(`HTTP 429 rate-limited, cooling down for ${Math.round(waitMs / 1000)}s`);
    }

    if (res.status === 403) {
      const waitMs = setRateLimit(60 * 1000);
      throw new Error(`HTTP 403 forbidden, cooling down for ${Math.round(waitMs / 1000)}s`);
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

    // Replace cache only after all pages succeed so deleted/renamed projects are pruned
    projectsMap.clear();
    for (const [id, proj] of freshProjects) {
      projectsMap.set(id, proj);
    }
    logDebug(`Synced ${projectsMap.size} projects`);
  }

  function getSidebarNav() {
    const link = document.querySelector(
      'nav a[href*="/c/"], nav a[href*="/g/"], aside a[href*="/c/"], aside a[href*="/g/"]'
    );
    return link ? link.closest('nav, aside') : null;
  }

  function getSidebarLinks(navRoot = getSidebarNav()) {
    if (!navRoot) return [];
    return navRoot.querySelectorAll('a[href*="/c/"]');
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

    logDebug(`Fetched ${totalFetched} conversations (cached: ${conversationProjects.size})`);
  }

  function findSidebarProjectLink(projectId, navRoot = null) {
    const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(projectId) : projectId;
    // Exclude /c/ links so project conversation URLs (/g/<id>/c/<conv>) are not matched
    const selector = `a[href*="/g/${escapedId}"]:not([href*="/c/"])`;
    return (
      (navRoot && navRoot.querySelector(selector)) ||
      document.querySelector(`nav ${selector}, aside ${selector}, ${selector}`)
    );
  }

  function getSidebarProjectVisual(navRoot, projectId, visualCache) {
    if (visualCache.has(projectId)) return visualCache.get(projectId);

    const sidebarLink = findSidebarProjectLink(projectId, navRoot);

    let result = null;
    if (sidebarLink) {
      const svg = sidebarLink.querySelector('svg');
      let color = null;
      let isCustomColor = false;
      let svgTemplate = null;
      if (svg) {
        const extracted = extractSvgColor(svg);
        color = extracted.color;
        isCustomColor = extracted.isCustomColor;

        svgTemplate = svg.cloneNode(true);
        svgTemplate.removeAttribute('width');
        svgTemplate.removeAttribute('height');
        svgTemplate.setAttribute('aria-hidden', 'true');
      }
      result = { svgTemplate, color, isCustomColor };
    }

    visualCache.set(projectId, result);
    return result;
  }

  // Build icon DOM nodes without innerHTML to satisfy CSP / TrustedHTML
  function createIconElement(nativeVisual, iconKey) {
    const wrapper = document.createElement('span');
    wrapper.className = 'cgpt-project-badge-icon';

    if (nativeVisual?.svgTemplate) {
      wrapper.appendChild(nativeVisual.svgTemplate.cloneNode(true));
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
    const navRoot = getSidebarNav();
    const links = getSidebarLinks(navRoot);
    if (links.length === 0) return;

    let hasUnknownConv = false;
    // Phase 1 (Read): collect styles and templates once per project to avoid layout thrashing
    const visualCache = new Map();
    const pendingUpdates = [];

    for (const link of links) {
      const match = link.getAttribute('href')?.match(/\/c\/([^/?#]+)/);
      if (!match) continue;

      const conversationId = match[1];
      const projectId = conversationProjects.get(conversationId);
      const badge = link.querySelector('.cgpt-project-badge');

      if (!projectId) {
        hasUnknownConv = true;
        if (badge) pendingUpdates.push({ type: 'remove', badge });
        continue;
      }

      const project = projectsMap.get(projectId);
      if (!project) {
        if (badge) pendingUpdates.push({ type: 'remove', badge });
        continue;
      }

      const nativeVisual = getSidebarProjectVisual(navRoot, projectId, visualCache);
      const finalColor = nativeVisual?.isCustomColor
        ? nativeVisual.color
        : project.color || nativeVisual?.color || '';
      const hasNativeSvg = nativeVisual?.svgTemplate ? '1' : '0';
      const renderSignature = `${projectId}|${project.name}|${finalColor}|${project.icon || ''}|${hasNativeSvg}`;

      if (badge && badge.dataset.sig === renderSignature) {
        continue;
      }

      pendingUpdates.push({
        type: 'upsert',
        link,
        badge,
        project,
        nativeVisual,
        finalColor,
        renderSignature,
      });
    }

    // Phase 2 (Write): apply all DOM mutations in a single batch
    for (const item of pendingUpdates) {
      if (item.type === 'remove') {
        item.badge.remove();
        continue;
      }

      let badge = item.badge;
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cgpt-project-badge';
        badge.setAttribute('role', 'button');
        item.link.appendChild(badge);
      }

      badge.dataset.sig = item.renderSignature;
      badge.dataset.projectId = item.project.id;
      badge.title = `${item.project.name} (Click to open project)`;

      if (item.finalColor) {
        badge.style.setProperty('--badge-color', item.finalColor);
      } else {
        badge.style.removeProperty('--badge-color');
      }

      const textNode = document.createElement('span');
      textNode.className = 'cgpt-project-badge-text';
      textNode.textContent = item.project.name;

      badge.replaceChildren(
        createIconElement(item.nativeVisual, item.project.icon),
        textNode
      );
    }

    // Trigger a debounced sync when newly created or moved conversations appear in the sidebar
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
      logDebug(`Rate-limit cooldown active (${remainSec}s remaining)`);
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

  function isSelfBadgeMutation(mutations) {
    for (const m of mutations) {
      if (m.target instanceof Element && m.target.closest('.cgpt-project-badge')) {
        continue;
      }
      let onlySelfBadges = true;
      for (const n of m.addedNodes) {
        if (!(n instanceof Element) || !n.classList.contains('cgpt-project-badge')) {
          onlySelfBadges = false;
          break;
        }
      }
      if (!onlySelfBadges) return false;
      for (const n of m.removedNodes) {
        if (!(n instanceof Element) || !n.classList.contains('cgpt-project-badge')) {
          onlySelfBadges = false;
          break;
        }
      }
      if (!onlySelfBadges) return false;
    }
    return true;
  }

  function watchForNavMount() {
    if (!document.body || rootObserver) return;
    rootObserver = new MutationObserver(() => {
      const nav = getSidebarNav();
      if (nav) {
        rootObserver.disconnect();
        rootObserver = null;
        attachNavObserver();
      }
    });
    rootObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Scope MutationObserver to the sidebar nav container to avoid overhead during chat streaming
  function attachNavObserver() {
    const nav = getSidebarNav();
    if (!nav) {
      watchForNavMount();
      return;
    }
    if (nav === observedNav && nav.isConnected) return;

    if (navObserver) navObserver.disconnect();
    if (parentObserver) parentObserver.disconnect();
    observedNav = nav;

    navObserver = new MutationObserver((mutations) => {
      if (!isSelfBadgeMutation(mutations)) {
        scheduleUpdateBadges();
      }
    });

    navObserver.observe(nav, {
      childList: true,
      subtree: true,
    });

    if (nav.parentElement) {
      parentObserver = new MutationObserver(() => {
        if (!observedNav || !observedNav.isConnected) {
          observedNav = null;
          if (navObserver) navObserver.disconnect();
          if (parentObserver) parentObserver.disconnect();
          attachNavObserver();
        }
      });
      parentObserver.observe(nav.parentElement, {
        childList: true,
        subtree: false,
      });
    }

    logDebug('Attached scoped MutationObserver to sidebar nav');
    scheduleUpdateBadges();
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('Sync Projects & Conversations Now', () => {
      logInfo('Manual sync triggered');
      scan(true);
    });

    GM_registerMenuCommand('Show Cache & Rate-Limit Status', () => {
      const remainSec = isRateLimited()
        ? Math.ceil((rateLimitState.until - Date.now()) / 1000)
        : 0;
      const statusMsg = [
        `Cached projects: ${projectsMap.size}`,
        `Cached conversations: ${conversationProjects.size}`,
        `429 cooldown remaining: ${remainSec}s`,
        `Debug logging: ${debugEnabled ? 'ON' : 'OFF'}`,
      ].join('\n');
      logInfo(statusMsg.replace(/\n/g, ' | '));
      alert(`[ChatGPT Project Badges]\n${statusMsg}`);
    });

    GM_registerMenuCommand('Clear Local Cache', () => {
      projectsMap.clear();
      conversationProjects.clear();
      resetRateLimit();
      saveCaches();
      scheduleUpdateBadges();
      logInfo('Local cache cleared, resyncing...');
      scan(true);
    });

    GM_registerMenuCommand(`Toggle Debug Logging (${debugEnabled ? 'ON' : 'OFF'})`, () => {
      debugEnabled = !debugEnabled;
      GM_setValue(CACHE_KEY_DEBUG, debugEnabled);
      logInfo(`Debug logging ${debugEnabled ? 'enabled' : 'disabled'} (reload page to update menu label)`);
    });
  }

  function navigateToProject(projectId) {
    const nativeLink = findSidebarProjectLink(projectId);

    if (nativeLink) {
      // Trigger ChatGPT's native SPA router without a full page reload
      nativeLink.click();
      return;
    }

    location.assign(`${location.origin}/g/${encodeURIComponent(projectId)}/project`);
  }

  // Capture-phase delegation intercepts badge clicks before the parent conversation <a> navigates
  document.addEventListener(
    'click',
    (e) => {
      const badge = e.target instanceof Element ? e.target.closest('.cgpt-project-badge') : null;
      if (!badge) return;

      const projectId = badge.dataset.projectId;
      if (!projectId) return;

      e.preventDefault();
      e.stopPropagation();
      navigateToProject(projectId);
    },
    true
  );

  attachNavObserver();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      scheduleUpdateBadges();
      if (Date.now() - lastSyncAt > SYNC_INTERVAL_MS) {
        scan();
      }
    }
  });

  registerMenuCommands();

  // 1. Render immediately from local cache (0ms delay, 0 requests)
  scheduleUpdateBadges();

  // 2. Stagger initial background sync to avoid page-load API congestion
  setTimeout(() => scan(), INITIAL_DELAY_MS);

  // 3. Low-frequency background sync every 90s
  setInterval(() => scan(), SYNC_INTERVAL_MS);
})();

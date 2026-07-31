"use strict";

const DEFAULTS = {
  server: "",
  apiKey: "",
  enabled: true,
  matchByTitle: true,
  concurrency: 4,
  cacheMinutes: 10
};

const resultCache = new Map();
const inFlight = new Map();
const workQueue = [];
let activeChecks = 0;
const settingsReady = migrateSettingsToLocal();

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.server || changes.apiKey)) {
    resultCache.clear();
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === "checkGalleries") {
    checkGalleries(request.urls || [], request.items || [])
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request?.type === "testConnection") {
    testConnection(request.server, request.apiKey)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function getSettings() {
  await settingsReady;
  return chrome.storage.local.get(DEFAULTS);
}

async function migrateSettingsToLocal() {
  const local = await chrome.storage.local.get(DEFAULTS);
  if (local.server || local.apiKey) return;

  const legacy = await chrome.storage.sync.get(DEFAULTS);
  if (!legacy.server && !legacy.apiKey) return;

  await chrome.storage.local.set(legacy);
  await chrome.storage.sync.remove(Object.keys(DEFAULTS));
}

async function checkGalleries(urls, items = []) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { ok: true, disabled: true, results: {} };
  }
  if (!settings.server.trim()) {
    return { ok: false, needsSetup: true, error: "LANraragi server is not configured." };
  }

  const requestedItems = items.length
    ? items
    : urls.map((url) => ({ url, title: "" }));
  const normalizedItems = new Map();

  for (const item of requestedItems) {
    const url = normalizeSourceUrl(item.url);
    if (url && !normalizedItems.has(url)) {
      normalizedItems.set(url, {
        url,
        title: typeof item.title === "string" ? item.title.trim() : ""
      });
    }
  }

  const entries = await Promise.all([...normalizedItems.values()].map(async ({ url, title }) => {
    try {
      const result = await enqueueCheck(url, title, settings);
      return [url, result];
    } catch (error) {
      return [url, { exists: false, error: error.message }];
    }
  }));

  return { ok: true, results: Object.fromEntries(entries) };
}

function enqueueCheck(url, title, settings) {
  const cacheKey = `${url}\n${settings.matchByTitle ? normalizeTitle(title) : ""}`;
  const cached = resultCache.get(cacheKey);
  const maxAge = Math.max(1, Number(settings.cacheMinutes) || DEFAULTS.cacheMinutes) * 60_000;
  if (cached && Date.now() - cached.timestamp < maxAge) {
    return Promise.resolve(cached.value);
  }
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const promise = new Promise((resolve, reject) => {
    workQueue.push({ url, title, cacheKey, settings, resolve, reject });
    drainQueue();
  }).finally(() => inFlight.delete(cacheKey));

  inFlight.set(cacheKey, promise);
  return promise;
}

function drainQueue() {
  if (!workQueue.length) return;
  const limit = Math.max(1, Math.min(10, Number(workQueue[0].settings.concurrency) || DEFAULTS.concurrency));

  while (activeChecks < limit && workQueue.length) {
    const job = workQueue.shift();
    activeChecks += 1;
    checkUrlVariants(job.url, job.title, job.settings)
      .then((value) => {
        resultCache.set(job.cacheKey, { timestamp: Date.now(), value });
        job.resolve(value);
      })
      .catch(job.reject)
      .finally(() => {
        activeChecks -= 1;
        drainQueue();
      });
  }
}

async function checkUrlVariants(url, title, settings) {
  for (const candidate of sourceUrlVariants(url)) {
    const result = await useUrlFinder(candidate, settings);
    if (result.exists) return result;
  }

  if (settings.matchByTitle && normalizeTitle(title).length >= 6) {
    const titleResult = await searchExactTitle(title, settings);
    if (titleResult.exists) return titleResult;
  }

  return { exists: false };
}

async function useUrlFinder(galleryUrl, settings) {
  const endpoint = `${cleanServerUrl(settings.server)}/api/plugins/use?plugin=urlfinder&arg=${encodeURIComponent(galleryUrl)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(settings.apiKey)
  });

  if (!response.ok) {
    throw new Error(`LANraragi returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (data.success === 1 && data.data?.id) {
    return { exists: true, archiveId: data.data.id, matchedUrl: galleryUrl };
  }
  return { exists: false };
}

async function searchExactTitle(title, settings) {
  const normalized = normalizeTitle(title);
  const safePhrase = title.replaceAll("\\", " ").replaceAll('"', " ").replace(/\s+/g, " ").trim();
  if (!safePhrase) return { exists: false };

  const params = new URLSearchParams({
    filter: `"${safePhrase}"`,
    start: "-1",
    groupby_tanks: "false"
  });
  const response = await fetch(`${cleanServerUrl(settings.server)}/api/search?${params}`, {
    headers: authHeaders(settings.apiKey)
  });

  if (!response.ok) {
    throw new Error(`LANraragi title search returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const archives = Array.isArray(payload.data) ? payload.data : [];
  const match = archives.find((archive) => normalizeTitle(archive.title) === normalized);
  return match
    ? { exists: true, archiveId: match.arcid || match.id, matchType: "title" }
    : { exists: false };
}

async function testConnection(server, apiKey) {
  if (!server?.trim()) throw new Error("Enter a server URL.");
  const response = await fetch(`${cleanServerUrl(server)}/api/info`, {
    headers: authHeaders(apiKey)
  });
  if (!response.ok) throw new Error(`LANraragi returned HTTP ${response.status}.`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return { ok: true, name: data.name, version: data.version };
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function sourceUrlVariants(url) {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return [];
  const parsed = new URL(normalized);
  const values = new Set();
  const addSpellings = (candidate) => {
    values.add(candidate);
    values.add(candidate.replace(/\/$/, ""));
    values.add(candidate.replace(/^https?:\/\//, ""));
    values.add(candidate.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  };

  addSpellings(normalized);

  // Storefronts and localized sites often append locale, affiliate, tracking,
  // or session query parameters after navigation. Source tags generally keep
  // the stable product URL, so always try the same URL without its query.
  if (parsed.search) {
    const withoutQuery = new URL(parsed.href);
    withoutQuery.search = "";
    addSpellings(withoutQuery.href);
  }

  if (parsed.hostname.startsWith("www.")) {
    addSpellings(normalized.replace("://www.", "://"));
    if (parsed.search) {
      const withoutQueryAndWww = new URL(parsed.href);
      withoutQueryAndWww.hostname = withoutQueryAndWww.hostname.replace(/^www\./, "");
      withoutQueryAndWww.search = "";
      addSpellings(withoutQueryAndWww.href);
    }
  } else {
    addSpellings(normalized.replace("://", "://www."));
    if (parsed.search) {
      const withoutQueryWithWww = new URL(parsed.href);
      withoutQueryWithWww.hostname = `www.${withoutQueryWithWww.hostname}`;
      withoutQueryWithWww.search = "";
      addSpellings(withoutQueryWithWww.href);
    }
  }

  // These domains represent the same gallery namespace and are commonly
  // interchanged by LANraragi importers.
  if (/^(?:www\.)?(?:e-hentai|exhentai)\.org$/.test(parsed.hostname)) {
    const alternateHost = parsed.hostname.includes("exhentai") ? "e-hentai.org" : "exhentai.org";
    parsed.hostname = alternateHost;
    addSpellings(parsed.href);
  }

  // Doujin.io redirects the stable numeric source URL to a generated slug.
  // LANraragi sources normally retain the former, so derive it from either.
  const doujinMatch = parsed.pathname.match(/^\/manga\/(\d+)(?:\/[^/]+)?\/?$/);
  if (/^(?:www\.)?doujin\.io$/.test(parsed.hostname) && doujinMatch) {
    const canonical = new URL(parsed.origin);
    canonical.pathname = `/manga/${doujinMatch[1]}`;
    addSpellings(canonical.href);
  }

  // MangaZ moved reader URLs from /navi/ to /virgo/view/ without changing the
  // work ID or page suffix recorded in existing source tags.
  const mangazMatch = parsed.pathname.match(/^\/virgo\/view\/(\d+)(\/.*)?$/);
  if (/^(?:www\.)?vw\.mangaz\.com$/.test(parsed.hostname) && mangazMatch) {
    const legacy = new URL(parsed.origin);
    legacy.pathname = `/navi/${mangazMatch[1]}${mangazMatch[2] || ""}`;
    addSpellings(legacy.href);
  }

  return [...values];
}

function cleanServerUrl(server) {
  return server.trim().replace(/\/+$/, "");
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${btoa(apiKey || "")}` };
}

function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

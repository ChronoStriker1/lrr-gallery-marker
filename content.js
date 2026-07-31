"use strict";

const checkedUrls = new Set();
const foundResults = new Map();
// Domains found in the connected library's source tags. The current page is
// checked on every domain; this list enables the more expensive result-grid
// scan only where LANraragi actually has source material.
const SOURCE_HOSTS = new Set([
  "amazon.co.uk", "comics.8muses.com", "comicvine.gamespot.com",
  "dlsite.com", "doujin.io", "doujins.com", "doujinshi.org", "e-hentai.org",
  "exhentai.org", "fakku.net", "hanime.tv", "hentag.com", "hentainexus.com",
  "hitomi.la", "irodoricomics.com", "koharu.to", "luscious.net",
  "myanimelist.net", "nhentai.net", "nhentai.to", "panda.chaika.moe",
  "projecthentai.com", "vw.mangaz.com"
]);
let scanTimer;

scanPage();

const observer = new MutationObserver(() => {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanPage, 200);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type !== "inspectMarker") return;
  const marker = document.querySelector(".lrr-gallery-marker");
  const target = marker?.parentElement;
  const markerRect = marker?.getBoundingClientRect();
  const targetRect = target?.getBoundingClientRect();
  sendResponse({
    url: location.href,
    marker: Boolean(marker),
    markerText: marker?.title || "",
    markerRect: markerRect && rectDetails(markerRect),
    target: target && {
      tag: target.tagName,
      id: target.id,
      className: String(target.className || ""),
      rect: rectDetails(targetRect),
      overflow: getComputedStyle(target).overflow,
      visibility: getComputedStyle(target).visibility,
      display: getComputedStyle(target).display
    },
    pageState: findDetailTarget()?.dataset.lrrMarkerState || ""
  });
  return true;
});

function rectDetails(rect) {
  return {
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function scanPage() {
  const galleries = collectSourcePages();

  // Reactive sites such as DLsite can replace a product gallery after the
  // initial lookup. Restore a confirmed marker without another API request.
  for (const gallery of galleries) {
    const found = foundResults.get(gallery.url);
    if (found && !gallery.target.querySelector(":scope > .lrr-gallery-marker")) {
      addMarker(gallery.target, found.archiveId, found.matchType);
    }
  }

  const unchecked = galleries.filter(({ url }) => !checkedUrls.has(url));
  unchecked.forEach((gallery) => {
    checkedUrls.add(gallery.url);
    gallery.target.dataset.lrrMarkerState = "checking";
    checkGallery(gallery);
  });
}

async function checkGallery(gallery) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "checkGalleries",
      items: [{ url: gallery.url, title: gallery.title }]
    });
  } catch (error) {
    clearPending(gallery);
    console.warn("LRR Gallery Marker:", error);
    return;
  }

  if (!response?.ok) {
    clearPending(gallery);
    if (!response?.needsSetup) console.warn("LRR Gallery Marker:", response?.error);
    return;
  }

  const result = response.results?.[gallery.url];
  if (result?.exists) {
    foundResults.set(gallery.url, result);
    addMarker(gallery.target, result.archiveId, result.matchType);
  } else {
    gallery.target.dataset.lrrMarkerState = result?.error ? "error" : "missing";
  }
}

function clearPending(gallery) {
  delete gallery.target.dataset.lrrMarkerState;
  checkedUrls.delete(gallery.url);
}

function collectSourcePages() {
  const found = new Map();
  const currentUrl = normalizeSourceUrl(location.href);

  if (currentUrl) {
    found.set(currentUrl, {
      url: currentUrl,
      title: findDetailTitle(),
      // Some storefronts create their product gallery after document_idle.
      // Keep the lookup alive on the page root; a later mutation scan will
      // restore a successful result onto the preferred product target.
      target: findDetailTarget() || document.body,
      score: 1000
    });
  }

  // Image links are the common denominator across gallery, comic, manga and
  // storefront result grids. Restricting generic discovery to visual links
  // avoids sending navigation, login and advertising URLs to LANraragi.
  if (!SOURCE_HOSTS.has(location.hostname.toLowerCase().replace(/^www\./, ""))) {
    return [...found.values()];
  }

  for (const link of document.querySelectorAll("a[href]")) {
    const url = normalizeSourceUrl(link.href);
    if (!url || url === currentUrl || !isLikelySourceLink(link)) continue;

    const target = findCoverTarget(link);
    const existing = found.get(url);
    if (!existing || target.score > existing.score) {
      found.set(url, {
        url,
        title: findGalleryTitle(link),
        target: target.element,
        score: target.score
      });
    }
  }

  return [...found.values()];
}

function isLikelySourceLink(link) {
  if (link.querySelector("img, picture, canvas, video")) return true;
  const style = getComputedStyle(link);
  if (style.backgroundImage && style.backgroundImage !== "none") return true;
  return Boolean(link.closest("article, [class*='gallery'], [class*='thumb'], [class*='card']"));
}

function findGalleryTitle(link) {
  const container = link.closest("article, li, tr, [class*='gallery'], [class*='card'], [class*='item']");
  return (
    link.querySelector("img")?.alt ||
    link.getAttribute("title") ||
    container?.querySelector("h1, h2, h3, h4, [class*='title']")?.textContent ||
    link.textContent ||
    ""
  ).trim();
}

function findDetailTitle() {
  return (
    document.querySelector("#gn")?.textContent ||
    document.querySelector("#gj")?.textContent ||
    document.querySelector("h1")?.textContent ||
    document.querySelector("meta[property='og:title']")?.content ||
    document.title ||
    ""
  ).trim();
}

function findDetailTarget() {
  if (/(?:^|\.)dlsite\.com$/i.test(location.hostname)) {
    const dlsiteTarget = findLargestVisibleImageTarget(
      "#work_left img, .work_slider img, .product-slider img, " +
      "[class*='work'] img, [class*='product'] img"
    );
    if (dlsiteTarget) return dlsiteTarget;
  }

  const preferred = document.querySelector(
    "#gd1, #work_left, .work_slider, .product-slider, " +
    "[class*='main_visual'] img, [class*='product-image'] img, " +
    "main img, article img, [class*='cover'] img, [class*='thumbnail'] img, " +
    "meta[property='og:image']"
  );
  if (preferred?.tagName !== "META") return preferred?.closest("a, picture, figure, div") || preferred || document.body;

  return findLargestVisibleImageTarget("img") || document.body;
}

function findLargestVisibleImageTarget(selector) {
  const images = [...document.querySelectorAll(selector)].filter((image) => {
    const rect = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    return rect.width >= 120 && rect.height >= 120 &&
      style.display !== "none" && style.visibility !== "hidden";
  });
  images.sort((a, b) => {
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    return (bRect.width * bRect.height) - (aRect.width * aRect.height);
  });
  const image = images[0];
  // Inline <picture> elements can report only line-height even when their
  // child image is large (DLsite does this), which misplaces the badge.
  return image?.closest("a, figure, div") || image || null;
}

function findCoverTarget(link) {
  const media = link.querySelector("img, picture, canvas, video");
  if (media) return { element: link, score: 100 };

  const wrapper = link.closest("[class*='thumb'], [class*='cover'], [class*='card'], article");
  return wrapper
    ? { element: wrapper, score: 80 }
    : { element: link, score: 20 };
}

function addMarker(target, archiveId, matchType) {
  if (target.querySelector(":scope > .lrr-gallery-marker")) return;
  target.classList.add("lrr-gallery-marker-target");
  target.dataset.lrrMarkerState = "found";

  const marker = document.createElement("span");
  marker.className = "lrr-gallery-marker";
  marker.textContent = "✓";
  const matchLabel = matchType === "title" ? " — exact title match" : "";
  marker.title = `Already in LANraragi${matchLabel}${archiveId ? ` (archive ${archiveId})` : ""}`;
  marker.setAttribute("aria-label", marker.title);
  target.appendChild(marker);
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(value, location.href);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/^(?:localhost|127\.0\.0\.1)$/.test(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

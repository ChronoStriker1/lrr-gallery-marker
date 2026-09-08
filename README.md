# LRR Gallery Marker

A small browser extension that adds a green check to source pages and linked
covers when the item already exists in LANraragi.

## How it works

- Checks the current page on every HTTP(S) source site.
- Finds likely gallery/product links in image grids, cards and lists.
- Handles native image covers and CSS-background tile layouts.
- Sends normalized source URLs to the extension background worker.
- Uses LANraragi's bundled `urlfinder` plugin, like Tsukihi.
- Falls back to an exact normalized title search when an archive has no
  matching `source:` URL or came from a different gallery ID.
- Handles scheme, `www`, trailing-slash, and E-Hentai/ExHentai URL variants.
- Limits concurrent checks and caches results to avoid hammering LANraragi.
- Renders each result as soon as its lookup completes instead of waiting for the
  entire results page.
- Keeps the LANraragi URL and API key in device-local extension storage,
  outside page scripts and browser sync.

## Requirements

- LANraragi with the Source Finder (`urlfinder`) plugin.
- An API key configured in LANraragi, unless authentication is disabled.
- **Enable CORS for the Client API** enabled in LANraragi Server Settings.

## Install from source

Download and extract this repository, or clone it:

```sh
git clone https://github.com/ChronoStriker1/lrr-gallery-marker.git
```

There is no build step. Load the directory containing `manifest.json`.

### Chrome, Edge, Brave, or other Chromium browsers

1. Open the browser's extensions page.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this project directory.
5. Enter the LANraragi server URL and API key in the settings page.
6. Test the connection, save, and reload any already-open gallery tabs.

### Firefox (temporary development install)

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `manifest.json`.
4. Configure and save the LANraragi connection.

## Supported sources

- Any HTTP or HTTPS page whose URL is stored in a LANraragi `source:` tag.
- Visual result grids and detail pages on source sites, including the domains
  already represented in the connected LANraragi library.
- Visual marker only; it does not download, modify, or delete LANraragi archives.

## Security and privacy

- The extension requires access to HTTP and HTTPS pages so it can recognize any
  source URL represented in a LANraragi library.
- Page URLs and titles are sent only to the LANraragi server configured by the
  user. They are used for source and optional exact-title lookups.
- The LANraragi server URL and API key stay in `chrome.storage.local`; content
  scripts cannot read them. Older sync-stored settings are migrated locally and
  removed from sync storage.
- No analytics, advertising, remote code, downloads, archive writes, or archive
  deletion are included.

## Troubleshooting

- If connection testing fails, check the server URL, API key, and LANraragi's Client API CORS setting. Use an address reachable from the browser's computer.
- If a known archive has no check mark, compare its `source:` tag with the page URL and confirm the Source Finder plugin is available. Exact-title fallback can only match titles already stored in LANraragi.
- After changing settings or updating extension files, reload the extension and the gallery tab. Cached lookups expire according to the cache duration in settings.
- A Firefox temporary installation is removed when Firefox closes; load it again for the next development session.

## Credits

The LANraragi connection and `urlfinder` request pattern were informed by
[Tsukihi](https://github.com/Difegue/Tsukihi), licensed under MIT.

# Visual regression harness

Renders FLoRA's on-page UI in a **real browser with the real built extension**
and pixel-diffs full-page screenshots against committed baselines. It exists
because placement of the injected pills/badges is the top source of bug
reports, and those bugs only show up in a rendered layout — not in unit tests.

The harness loads the actual MV3 extension into **Chrome for Testing**, serves
fixture pages over `http://127.0.0.1`, waits for FLoRA to finish injecting, and
captures the page. Everything the extension would fetch is mocked, so pass/fail
never depends on the network.

## Running

```bash
npm run build            # dist/ must exist — the extension is loaded from the repo root
npm run test:visual        # compare against baselines; exits 1 on any diff
npm run test:visual:update # regenerate baselines (after an intentional UI change)
```

On first run the harness auto-installs Chrome for Testing into the default
puppeteer cache (`~/.cache/puppeteer`, **outside the repo**). Nothing is written
into the working tree except baselines (on update) and `output/` (on failure).

### First-run note (macOS)

`@puppeteer/browsers` occasionally extracts the Chrome `.app` bundle without its
`Frameworks/` symlinks, and the browser then fails to launch
(`dlopen … Framework: no such file`). If that happens, re-extract the cached zip
with macOS `ditto`, which handles app bundles correctly:

```bash
cd ~/.cache/puppeteer/chrome
rm -rf mac_arm-*/chrome-mac-arm64
ditto -x -k *.zip mac_arm-<version>/
```

## What gets tested

12 fixtures (viewport 1280×900, `deviceScaleFactor` 1):

| Fixture | Exercises |
| --- | --- |
| `ref-list-flex` | Reference list as flex rows with action links |
| `ref-list-grid` | Reference list in a two-column CSS grid |
| `table-bibliography` | `<table>`-based bibliography |
| `rtl-article` | `dir="rtl"` Arabic article with DOIs (pill mirroring) |
| `editor-textarea` | `contenteditable` editor + `<textarea>` with DOIs |
| `long-article-sticky` | Long article, sticky header + fixed footer, side panel |
| `shared-block-anchor` | Several matched DOIs sharing one block anchor (one badge each) |
| `article-with-dois` | Reused unit fixture — meta DOI + doi.org ref links |
| `doi-in-href` | Reused — DOI only in a link href |
| `doi-in-table` | Reused — DOI in a cell / prose inside a table |
| `doi-in-text` | Reused — DOI in running prose |
| `redacted` | Reused — retracted article, notice pinned to the title |

Each fixture uses DOIs seeded to a known state (has replications, reproductions,
retracted, expression of concern, or no data) so the injected UI is fully
determined by the mocks.

## How the mocks work (hermetic)

Two mechanisms, both in `mocks.ts`, guarantee no real network dependence:

1. **Pre-seeded `chrome.storage`.** Before any fixture loads, the harness writes
   into the service worker's storage via `worker.evaluate(() => chrome.storage…)`:
   - **FLoRA replication cache** — the worker caches lookups through
     `LocalCache` (prefix `"flora"`); entries are `{"flora:<doi>": {data, expiresAt}}`
     (see `src/shared/cache.ts`). Every fixture DOI is seeded, so each lookup is a
     cache hit and the FORRT rep-api is never called.
   - **Retraction map** — stored under `RET_MAP_KEY` (`"RetractionLookupLocal"`,
     `src/shared/data-extract.ts`) as `{retractions, concerns}`, mapping the
     retracted / concern fixture DOIs to notice DOIs. `synctime` is set to "now"
     so the weekly GitHub sync never fires.
   - **Settings** — `flora_settings` in `chrome.storage.sync` with an email set,
     so `isSetupComplete()` is true and the setup prompt never overlays a
     screenshot.
   - **Page-side `BlobCache`s** (`chrome.storage.local`): doi.org validation
     (`flora_doival_blob`), PubPeer (`flora_pubpeer_blob`), and Unpaywall Open
     Access (`flora_oa_blob`) — one entry per fixture DOI, so the content
     script's own lookups are also cache hits.

2. **Request interception.**
   - **Page context** (`page.setRequestInterception`): localhost is allowed; the
     doi.org Handle API, PubPeer POST, and Unpaywall are served canned JSON; any
     other external request is aborted.
   - **Worker context**: the service worker's own fetches (FORRT rep-api,
     Crossref, OpenAlex, the GitHub retraction sync, Google Docs) are failed via
     a CDP `Fetch` session attached to the `service_worker` target — page-level
     interception does not cover worker requests.

The retraction map + settings are re-seeded immediately before each fixture as
insurance against a stray install-time sync.

## Determinism

- **One raster path.** Headful macOS Chrome flaps between GPU and software
  rasterisation across page loads, which shifts the anti-aliasing of *every
  glyph* on the page — runs would pass or fail different fixtures at random
  with whole-page text diffs (~0.2–2 % of pixels). The launch flags pin a
  single software raster path: `--disable-gpu` (the primary fix) plus
  `--disable-gpu-compositing --force-device-scale-factor=1
  --disable-font-subpixel-positioning --disable-partial-raster
  --disable-skia-runtime-opts`.
- Rendering flags: `--force-color-profile=srgb --hide-scrollbars
  --disable-lcd-text --font-render-hinting=none`.
- A stylesheet injected after load disables all animations/transitions, hides the
  caret, and removes the transient "scanning" toast.
- Fixtures use an explicit system font stack and load no external
  fonts/images/scripts; `document.fonts.ready` is awaited before capture.
- After navigation the harness polls the injected FLoRA selectors
  (`.flora-inline-badge, .flora-doi-label, .flora-notice-pill, #flora-pubpeer-panel`)
  until their count is stable for 700 ms, then waits a short settle before
  capturing.

Stability bar: after regenerating baselines, `npm run test:visual` must report
**0 px difference on every fixture across five consecutive runs** before the
baselines are committed.

Comparison uses `pixelmatch` at a per-pixel threshold of `0.1`; a fixture fails
if more than **0.1 %** of pixels differ. On failure the actual and diff images
are written to `output/` (gitignored).

## Baselines are platform-specific

Baselines in `baselines/` were rendered on **macOS**. Font rasterisation differs
across operating systems, so baselines generated on macOS will not match a Linux
CI run pixel-for-pixel. Regenerate baselines on the platform where the tests will
run (`npm run test:visual:update`) and commit them from that platform.

## Updating baselines

When a FLoRA UI change is intentional, run `npm run test:visual:update`,
**visually inspect** the regenerated PNGs in `baselines/`, and commit them
alongside the code change so the diff is reviewable.

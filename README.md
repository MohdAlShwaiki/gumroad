# theMoBader: Gumroad profile

A custom storefront that replaces the default Gumroad profile for `@mohdshwaiki`. It tells a first-time visitor who Mohammad Bader is, shows why to trust the method, and sends them to the right product page in a few seconds, in Arabic, right-to-left, in light and dark.

```
config/site.json   everything you edit: social links, featured products, proof figures, testimonials
src/               index.html, styles.css, script.js, theme-init.js (source, split for maintainability)
build.mjs          inlines src/ into the single file Gumroad accepts: dist/landing.html
tools/sanitize.rb  runs Gumroad's own sanitizer code locally on the built page
test/              local copy of Gumroad's page environment + QA suite
```

## Status

| Step | State |
|---|---|
| Page built (all 12 sections, light + dark, RTL, responsive) | Done |
| Strict build lint (no checkout, no downloads, no dead links, size, URLs) | Passing |
| Gumroad's own sanitizer, run locally on the page | Removes nothing |
| Local QA suite (layout, accessibility, behaviour, Gumroad rules) | 270 of 270 checks passing |
| `gumroad pages preview` against your account | **Not run**, see below |
| `gumroad pages push profile` (going live) | **Not run**, see below |

Preview and publish need two things the build session did not have: network access to `gumroad.com` (the environment's network policy refused it, on a retry as well) and a token for your account. Everything else was verified locally. Nothing has been published.

## Run it on your computer

You need Git and Node 18 or newer. Nothing else is required to see the page.

**macOS or Linux**
```bash
mkdir -p ~/Desktop/themobader-profile && cd ~/Desktop/themobader-profile
git clone --branch claude/youthful-volta-irhy8w https://github.com/MohdAlShwaiki/gumroad.git .
npm run demo
open test/out/preview.html        # on Linux: xdg-open test/out/preview.html
```

**Windows (PowerShell)**
```powershell
mkdir "$HOME\Desktop\themobader-profile"; cd "$HOME\Desktop\themobader-profile"
git clone --branch claude/youthful-volta-irhy8w https://github.com/MohdAlShwaiki/gumroad.git .
npm run demo
start test\out\preview.html
```
If your Desktop is synced by OneDrive, use `$HOME\OneDrive\Desktop` instead.

`npm run demo` rebuilds the page and writes `test/out/preview.html`: the real page with sample products and prices (a red banner says so) and a stand-in for the follow form. Open it and try the theme toggle, the goal buttons, the menu on a narrow window, and the email form. After editing anything in `src/` or `config/`, run `npm run demo` again and refresh.

Opening `dist/landing.html` directly shows a "products could not load" message. That is intended: products only exist once Gumroad renders the page, so use the preview file locally.

**Run the automated tests (optional)**
```bash
npm install
npx playwright install chromium
npm run qa:quick      # about 1 minute
npm run qa            # full run, 9 widths in both themes, about 7 minutes
```
Without a checkout of Gumroad's source the sanitizer step is skipped and the unsanitized build is tested.

## Finish in four steps

1. **Pin your two featured products.** Run `gumroad products list` and put the last part of each product URL into `config/site.json` under `featured.book.permalink` and `featured.course.permalink`. Optional but recommended: pinned cards also work without JavaScript and show Gumroad's live price in search results. Without pins, the page matches products by name.
2. **Fill what you want shown** in `config/site.json`: `social` URLs (empty means hidden), real `testimonials`, and confirm the two `historicalResults` figures.
3. **Build, then preview** (this is the real check against Gumroad's server):
   ```bash
   npm run build:strict
   gumroad pages preview dist/landing.html --json --no-input
   ```
   Read `.sanitization_report` in the output. It should list nothing removed. Open the profile URL from `gumroad user page url` to look at the rendered page.
4. **Publish:**
   ```bash
   npm run golive           # runs: gumroad pages push profile dist/landing.html
   ```
   Gumroad keeps no version history, so keep this repository as the source of truth.

To let a cloud session do steps 3 and 4 for you, allow `gumroad.com` under the environment's network settings and add a Gumroad API token as an environment variable (`GUMROAD_ACCESS_TOKEN`) in the environment settings. Never paste a token into a chat.

## How product data flows

Nothing about a product is typed into the page. Gumroad injects two JSON blocks into the page when it renders:

- `#gumroad-data`: names, links, images, descriptions, order.
- `#gumroad-prices`: the price each visitor would pay, in their currency, discount applied.

`script.js` reads them. The two featured cards use the curated copy from the brief; titles, links, images and prices come live from Gumroad. Every other product appears automatically under "other products". If the catalogue cannot be read, the visitor sees a plain message, never a broken layout. Product buttons are ordinary links to the product page. There is no embedded checkout and no file download link.

## Things Gumroad's platform decides (not the page)

- **Page title, description and share image** come from your Gumroad profile (name and bio), because Gumroad strips `<title>` and `<meta>` from custom pages. Set the profile name and bio in Gumroad for search results.
- **The theme choice does not persist between visits.** Gumroad runs the page in a sandbox where storage is in-memory by design. The toggle works during a visit, and each new visit follows the visitor's device setting (light by default).
- **Fonts** are IBM Plex Sans Arabic and IBM Plex Mono from Google Fonts, which Gumroad allows. System Arabic fonts are the fallback.
- **Images** can only come from Gumroad's own CDN. The page uses your product images from the catalogue and draws everything else in CSS and inline SVG.

## Development

```bash
npm install                      # axe-core and tailwind (QA only)
npm run build                    # build, print warnings
npm run build:strict             # build, fail on any lint issue
ruby tools/sanitize.rb dist/landing.html /path/to/antiwork/gumroad
node test/qa.mjs                 # full QA (add --quick while iterating)
node test/shot.mjs --w 390 --theme dark --out check --sheet 1300
```

The QA suite runs the sanitized page inside a local copy of Gumroad's page environment. It extracts Gumroad's real storage shim, follow bridge and products bridge from their open-source code, and applies their real content security policy. The product data it uses is mock data in `test/support/catalogue.mjs` and is never shipped. This is local verification, not a replacement for `gumroad pages preview`.

Playwright is expected to be installed globally (`PLAYWRIGHT_MODULES` overrides the location). Point `GUMROAD_REPO` at a checkout of `antiwork/gumroad` to enable the sanitizer step.

## What was verified, and what was not

Verified locally, on the sanitized page (the exact markup Gumroad would store), inside a copy of Gumroad's page environment:

- Gumroad's own sanitizer code removes nothing from the page. Script and style bodies come through byte-identical.
- Nine widths (320, 375, 390, 430, 768, 1024, 1280, 1440, 1920) in light and dark: no horizontal scroll, no element overflowing, no clipped text in controls, touch targets of at least 44px on phones and tablets, one `h1` with no skipped heading levels, RTL direction, and no console errors or failed requests.
- axe-core (WCAG 2 A/AA and best practice) at 320, 390 and 1280 in both themes, including colour contrast: no violations. The one rule switched off is `document-title`, because Gumroad's page frame has no `<title>` and strips it from custom pages.
- Keyboard: skip link first, every control shows a visible focus ring. Reduced motion: all content visible at once, no running animation. Content stays visible even if scroll observers never fire, and with JavaScript off the page follows the device's light or dark setting.
- Catalogue behaviour with mock data: both featured products found, a spelling variant of the program name still matched, live and discounted prices shown, images falling back to designed visuals, a catalogue with only one featured product, only unrelated products, an empty catalogue, a missing data block, and a catalogue larger than the first payload.
- Follow form through a copy of Gumroad's real bridge: the form is handed to Gumroad untouched, a loading state shows, and the success, error and not-yet-approved replies all display Gumroad's own message.
- Product buttons are plain links that Gumroad navigates itself. No checkout, no downloads, and exactly one form.

Not verified, because it needs your account: the live `gumroad pages preview` result, how your real product images and prices look, content moderation, and the live page inside Gumroad's frame. Run the preview before publishing and read its `sanitization_report`.

Figures supplied by Mohammad that appear on the page and should be confirmed before publishing: the two historical results (380 and 362), the four credibility lines (product management, Orange Coding Academy, startup consulting, hundreds of learners), "25 tasks" and "30 days" for the book. No testimonials are shown, because none were supplied.

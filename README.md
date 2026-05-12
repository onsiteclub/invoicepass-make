# make.invoicepass.app

Mobile-first prototype of the InvoicePass invoice creation flow. Single static
HTML file — no build step, no dependencies (except Inter font from Google).

## Local

```bash
# Just open it
open index.html

# Or serve it (better for mobile testing on local network)
python3 -m http.server 8080
# then http://localhost:8080
```

## Deploy

### Option A — Vercel (recommended, free)

```bash
npm i -g vercel  # if not installed
vercel
```

When asked, link to project name `make-invoicepass` (or similar). Then in the
Vercel dashboard → Settings → Domains → add `make.invoicepass.app`. Vercel
gives you DNS instructions; add the CNAME record in your domain registrar.

Done. Push to the connected git repo and every commit redeploys.

### Option B — Cloudflare Pages (also free)

1. Create a GitHub repo with this `index.html`
2. Cloudflare Dashboard → Pages → Create project → Connect to Git → pick repo
3. Build settings: leave empty (no build command, no output dir override)
4. Custom domains → add `make.invoicepass.app` → Cloudflare handles DNS automatically if `invoicepass.app` is on Cloudflare

### Option C — Netlify (also free)

Drag the folder containing `index.html` into the Netlify drop zone at app.netlify.com/drop. Done. Custom domain in Site Settings → Domain Management.

## File structure

```
make.invoicepass.app/
├── index.html      # Everything lives here — HTML, CSS, JS, favicon SVG
└── README.md       # This file
```

That's it. No package.json, no node_modules, no framework. Pure static.

## Features

- 5-step invoice flow: Type → Recipient → Job site + Due date → Line items → Review → Sent
- Mobile-first (looks native at 380-480px, scales up to desktop with a phone-frame look)
- Stripe-vibe visual: brand blue + canvas + 1% amber
- Sticky bottom CTA on every step that needs one
- Slide-in transitions between steps
- Back navigation (header arrow + ESC key on desktop)
- HST 13% calculated automatically
- Quick-add chips for common piecework items (with defaults)
- Mock recent contacts list
- Success screen with reset
- Fully accessible (keyboard nav, ARIA labels, focus rings)

## Tokens

Defined as CSS custom properties at the top of `<style>`. To rebrand, edit the
`:root` block. The full design system lives in `@invoicepass/tokens` — when that
becomes a real npm package, this file can import the CSS directly:

```html
<link rel="stylesheet" href="https://unpkg.com/@invoicepass/tokens/css">
```

For now, tokens are inlined.

## What's mocked

- **Contacts**: Paulo Bravo, Joelmir Silva, Mike Osterman are hardcoded
- **Pricing**: piecework chips have rough default qty/price (e.g., Roof Framing = 220 sq ft × $22.50)
- **Persistence**: nothing saves — refresh resets state
- **"Send invoice"**: just advances to success screen; no actual sending

This is a prototype to show the UX. Replace mocks with real data/API when
integrating with the engine.

## Browser support

Modern browsers only (uses CSS `dvh`, `:focus-visible`, `viewport-fit=cover`).
Tested in Chrome, Safari, Firefox latest. iOS 15+ and Android 10+ for mobile.

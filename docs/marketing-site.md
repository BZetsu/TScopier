# Marketing site (tscopier.ai) + app (app.tscopier.ai)

One Vite build serves both hostnames on a single Netlify site. At runtime the browser picks the marketing landing or the product app based on hostname.

## Host routing

| Host | Experience |
|------|------------|
| `tscopier.ai`, `www.tscopier.ai` | Marketing landing (`/`) |
| `app.tscopier.ai` | Product (dashboard, auth, pricing) |
| `localhost` (default) | Product — same as app subdomain |
| `localhost?site=marketing` or `VITE_DEV_SITE=marketing` | Marketing landing preview |

Implementation: [`src/lib/site.ts`](../src/lib/site.ts) and [`src/main.tsx`](../src/main.tsx).

## Netlify setup

1. In **Netlify → Domain management**, add:
   - `tscopier.ai` (apex)
   - `www.tscopier.ai` (optional redirect to apex)
   - `app.tscopier.ai`
2. Point DNS:
   - Apex: Netlify DNS or ALIAS/A records per [Netlify custom domain docs](https://docs.netlify.com/domains-https/custom-domains/)
   - `app`: CNAME to your Netlify site URL (e.g. `your-site.netlify.app`)
3. Keep [`netlify.toml`](../netlify.toml) SPA fallback (`/*` → `/index.html`).
4. Build env (Site configuration → Environment variables):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_APP_URL=https://app.tscopier.ai
VITE_MARKETING_URL=https://tscopier.ai
```

Redeploy after changing any `VITE_*` variable.

## Supabase Auth

Dashboard → **Authentication → URL configuration**:

- **Site URL**: `https://app.tscopier.ai`
- **Redirect URLs** (add all that apply):
  - `https://app.tscopier.ai/**`
  - `http://localhost:5173/**`

Google OAuth and email confirmation links must redirect to the **app** subdomain. Signup/login CTAs on the marketing site use `appUrl()` to send users to `app.tscopier.ai`.

## Local dev

```bash
# Product (default)
npm run dev

# Marketing landing preview
VITE_DEV_SITE=marketing npm run dev
# or open http://localhost:5173/?site=marketing
```

Dependencies are the same as the main app (`tailwindcss`, `postcss`, `autoprefixer` are already in `package.json`). Run `npm install` only if `node_modules` is missing. After changing `tailwind.config.js` or marketing CSS, **restart the dev server** (Ctrl+C, then run the command again) so PostCSS rebuilds styles.

Dark mode toggles `class="dark"` on `<html>` (see `ThemeContext`). If the page background stays light, hard-refresh the browser.

Optional `/etc/hosts` entries for realistic testing:

```
127.0.0.1 local.tscopier.ai
127.0.0.1 app.local.tscopier.ai
```

Then set `VITE_APP_URL=http://app.local.tscopier.ai:5173` and `VITE_MARKETING_URL=http://local.tscopier.ai:5173` in `.env`.

## Stripe

Checkout success/cancel URLs use `window.location.origin`. Users should complete checkout on **app.tscopier.ai** only.

## Smoke test checklist

- [ ] `https://tscopier.ai` — landing, glass cards, dark mode, language switch
- [ ] “Get started” → `https://app.tscopier.ai/signup`
- [ ] `https://app.tscopier.ai` — login, dashboard, existing flows unchanged
- [ ] Email verification redirect lands on app subdomain
- [ ] Google OAuth redirect lands on app subdomain

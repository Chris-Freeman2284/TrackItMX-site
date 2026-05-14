# Deploying TrackItMX

This site is a plain static website, so it can be hosted on GitHub Pages, Cloudflare Pages, Netlify, or nearly any static host.

## Recommended simple path: dedicated GitHub Pages repo

1. Create a new GitHub repo for the site.
2. Copy the contents of this site repo into the repo root.
3. Push the repo to GitHub.
4. Pick one of these GitHub Pages modes:

### Option A: simplest

- In GitHub, open `Settings` -> `Pages`.
- Deploy from the `main` branch and root folder.

### Option B: automatic workflow

- Keep `.github/workflows/deploy-pages.yml` in the repo.
- In GitHub, open `Settings` -> `Pages`.
- Set the source to `GitHub Actions`.
- The included workflow is manual by default, so you can run it from the `Actions` tab without affecting the simpler branch-based setup.
- Add a GitHub Actions secret named `TRACKITMX_FIREBASE_WEB_API_KEY`.
- Use a dedicated web-only Firebase API key for the spectator page rather than reusing the iPhone app key.
- Restrict that web-only key to the `trackitmx.com` and `www.trackitmx.com` web origins you actually serve.
- The workflow writes `runtime-config.js` during deploy, so the key is present in the published site but not committed to git.
- Rotate or restrict the previously exposed Firebase key. GitHub or GitGuardian may keep warning until the old key is remediated, because it already exists in repo history.

#### Spectator relaunch checklist

Before enabling spectator deployment again:

1. Create a dedicated Firebase web API key just for the spectator page.
2. Restrict that key to the live web origins:
   - `https://trackitmx.com/*`
   - `https://www.trackitmx.com/*`
3. Add the GitHub Actions secret `TRACKITMX_FIREBASE_WEB_API_KEY`.
4. Switch GitHub Pages to the `GitHub Actions` source if you want runtime injection to happen during deploy.
5. Rotate or tightly restrict the previously exposed key so repo-history scanners stop flagging it as a live secret.
6. Re-run the deploy workflow only after the secret exists and the old key remediation is complete.

5. In GitHub Pages, set the custom domain to `trackitmx.com`.
6. In your DNS provider, point the domain at GitHub Pages.
7. Wait for DNS and HTTPS to finish provisioning.

## DNS shape to use

For an apex domain like `trackitmx.com`, point the root domain to these GitHub Pages A records:

- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

Optional IPv6 AAAA records:

- `2606:50c0:8000::153`
- `2606:50c0:8001::153`
- `2606:50c0:8002::153`
- `2606:50c0:8003::153`

For `www`, create a `CNAME` record pointing to your GitHub Pages hostname, for example:

- `www` -> `YOUR-USERNAME.github.io`

GitHub recommends adding the custom domain in GitHub Pages before or as you configure DNS.

If you prefer Cloudflare Pages or Netlify instead, connect the repo there and set `trackitmx.com` as the custom domain in that provider.

## App Store Connect fields

Use these values when the site is live:

- Marketing URL: `https://trackitmx.com/`
- Support URL: `https://trackitmx.com/support/`
- Privacy Policy URL: `https://trackitmx.com/privacy/`
- Optional Privacy Choices URL: `https://trackitmx.com/privacy/#your-choices`

## Email links

The site currently sends support and beta clicks to:

- `support@trackitmx.com`

Before launch, configure MX records or forwarding for `support@trackitmx.com` so the public support inbox actually receives mail.

## Editing after the site is live

Yes, you can keep tweaking the site after it is online.

The normal workflow is:

1. Edit the files locally.
2. Commit the changes.
3. Push to the site repo.
4. GitHub Pages republishes the site.

You can also make quick text edits directly in the GitHub web UI if needed, but local edits are easier for larger design changes.

## Analytics and search

- See `ANALYTICS.md` to enable visit metrics.
- See `SEARCH_CONSOLE.md` to help Google discover and index the site faster.

## Before final App Store submission

Review these items one more time:

- The privacy policy still matches the app’s real data handling.
- The support page includes the contact information you want public.
- Any legally required business address or support phone details for your launch regions are added if needed.
- The Pages repo is serving from the repo root so links like `/support/` and `/privacy/` resolve correctly.

# TrackItMX Website

Informational website for the TrackItMX app.

## Public constants

Shared public-facing constants live in `site-config.js`.

- `SITE_NAME = "TrackItMX"`
- `SUPPORT_EMAIL = "support@trackitmx.com"`
- `TESTFLIGHT_URL = "https://testflight.apple.com/join/CxDbc7Bt"`

TODO before launch: configure MX records or forwarding for `support@trackitmx.com` so support mail does not bounce.

## Routes

- `/` - marketing + product overview
- `/support/` - support page for App Store and public help
- `/privacy/` - privacy policy
- `/group-ride/live/` - live spectator page for shared group ride links
- `/404.html` - branded not-found page

## App Store links

- Marketing URL: `https://trackitmx.com/`
- Support URL: `https://trackitmx.com/support/`
- Privacy Policy URL: `https://trackitmx.com/privacy/`
- Optional Privacy Choices URL: `https://trackitmx.com/privacy/#your-choices`

## Local preview

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 4173 --directory /Users/chrisfreeman/Documents/trackitmx-site
```

Then visit:

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/support/`
- `http://127.0.0.1:4173/privacy/`

## Repo-ready extras

- `CNAME` for `trackitmx.com`
- `.nojekyll` for GitHub Pages
- `.github/workflows/deploy-pages.yml` for optional manual Pages deploy via GitHub Actions
- `robots.txt` and `sitemap.xml`
- `site.webmanifest`
- `analytics-config.js` for optional traffic metrics
- `site-config.js` for shared public-facing constants
- `ANALYTICS.md` and `SEARCH_CONSOLE.md` for setup guides
- `docs/testflight-description.txt` for the current TestFlight copy block

## Deployment

See `DEPLOYMENT.md` for the recommended publish flow and domain setup notes.

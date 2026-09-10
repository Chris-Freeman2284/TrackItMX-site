# TrackItMX Website

Informational website for the TrackItMX app.

## Public constants

Shared public-facing constants live in `site-config.js`.

- `SITE_NAME = "TrackItMX"`
- `SUPPORT_EMAIL = "support@trackitmx.com"`
- `APP_STORE_URL = ""`

TODO before launch: configure MX records or forwarding for `support@trackitmx.com` so support mail does not bounce.
TODO before launch: paste the final App Store listing URL into `APP_STORE_URL`; all `data-app-store-link` buttons will update automatically.

## Routes

- `/` - marketing + product overview
- `/support/` - support page for App Store and public help
- `/privacy/` - privacy policy
- `/terms/` - terms of use linked from the app legal center
- `/group-ride/live/` - live spectator page for shared group ride links
- `/ride/` - private shared-ride viewer for unlisted ride links
- `/404.html` - branded not-found page

## App Store links

- Marketing URL: `https://trackitmx.com/`
- Support URL: `https://trackitmx.com/support/`
- Privacy Policy URL: `https://trackitmx.com/privacy/`
- Optional Privacy Choices URL: `https://trackitmx.com/privacy/#your-choices`
- Terms URL used by the app: `https://trackitmx.com/terms/`

## Local preview

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 4173 --directory /Users/chrisfreeman/Documents/Playground/website
```

Then visit:

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/support/`
- `http://127.0.0.1:4173/privacy/`
- `http://127.0.0.1:4173/terms/`
- `http://127.0.0.1:4173/ride/?s=<privateRideShareID>`

## Repo-ready extras

- `CNAME` for `trackitmx.com`
- `.nojekyll` for GitHub Pages
- `.github/workflows/deploy-pages.yml` for optional manual Pages deploy via GitHub Actions
- `robots.txt` and `sitemap.xml`
- `site.webmanifest`
- `analytics-config.js` for optional traffic metrics
- `site-config.js` for shared public-facing constants
- `runtime-config.js` with a Firebase web API key for `/group-ride/live/` and `/ride/`
- `ANALYTICS.md` and `SEARCH_CONSOLE.md` for setup guides
- `docs/app-store-listing-draft.md` for App Store Connect copy and launch metadata
- `docs/app-store-launch-checklist.md` for final submission checks
- `docs/shared-ride-web-contract.md` for the private ride share website contract
- `docs/testflight-description.txt` for archived TestFlight copy if outside testing is needed later

## Deployment

See `DEPLOYMENT.md` for the recommended publish flow and domain setup notes.

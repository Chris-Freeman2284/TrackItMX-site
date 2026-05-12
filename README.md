# TrackItMX Website

Informational website for the TrackItMX app.

## Routes

- `/` - marketing + product overview
- `/support/` - support page for App Store and public help
- `/privacy/` - privacy policy
- `/404.html` - branded not-found page

## App Store links

- Marketing URL: `https://trackitmx.com/`
- Support URL: `https://trackitmx.com/support/`
- Privacy Policy URL: `https://trackitmx.com/privacy/`
- Optional Privacy Choices URL: `https://trackitmx.com/privacy/#your-choices`

## Local preview

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 4173 --directory /Users/chrisfreeman/Documents/Playground/website
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
- `ANALYTICS.md` and `SEARCH_CONSOLE.md` for setup guides

## Deployment

See `DEPLOYMENT.md` for the recommended publish flow and domain setup notes.

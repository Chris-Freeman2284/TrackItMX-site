# TrackItMX Website Analytics

The site is prewired for optional analytics through `analytics-config.js`.

## Recommended fast option: Cloudflare Web Analytics

Why:

- free
- privacy-first
- easy to turn on
- useful for visits, page views, referrers, and performance

## How to enable Cloudflare analytics

1. Create a Cloudflare account.
2. In Cloudflare Web Analytics, add the hostname `trackitmx.com`.
3. Copy the Web Analytics token.
4. Open `analytics-config.js`.
5. Set:

```js
window.TRACKITMX_ANALYTICS = {
  cloudflareToken: "YOUR_TOKEN_HERE",
  gaMeasurementId: ""
};
```

6. Commit and push the change.

Once deployed, you will be able to see:

- visits
- page views
- referrers
- page load time
- Core Web Vitals

## Optional richer option: Google Analytics 4

If you want deeper marketing analytics later, create a GA4 web data stream and paste the measurement ID:

```js
window.TRACKITMX_ANALYTICS = {
  cloudflareToken: "",
  gaMeasurementId: "G-XXXXXXXXXX"
};
```

You can also use both, but if you do, make sure the privacy page still reflects your real setup.

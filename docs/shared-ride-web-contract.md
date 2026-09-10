# TrackItMX Shared Ride Web Contract

Private shared ride links are unlisted browser views for saved rides.

## URL

The app should generate:

```text
https://trackitmx.com/ride/?s=<privateRideShareID>
```

The website also accepts `share`, `shareID`, `shareId`, `id`, `ride`, `rideShare`, `rideShareID`, and `rideShareId` as fallback query names.

## Firestore

The viewer reads:

```text
privateRideShares/{privateRideShareID}
```

Required fields:

- `status = "active"`
- `expiresAt`
- `routePreview`

Expected display fields:

- `riderAlias`
- `title`
- `trailName`
- `matchedTrailName`
- `rideDate`
- `durationSeconds`
- `movingSeconds`
- `distanceMeters`
- `movingDistanceMeters`
- `avgMovingSpeedMps`
- `maxSpeedMps`
- `rideScore`
- `scoreDisplay`
- `scoreDisplayRange`
- `scoreConfidenceLabel`
- `telemetryConfidenceLabel`
- `highlights`

Optional fields shown only when present:

- `lapCount`
- `bestLapSeconds`
- `avgHeartRate`
- `activeEnergyKcal`
- `bestSection`
- `weakestSection`
- `mainFix`

## Privacy And Indexing

- `/ride/` is intentionally `noindex,nofollow,noarchive`.
- `/ride/` should not be listed in `sitemap.xml`.
- Anyone with a valid link can view the shared ride until it expires or the rider revokes it.
- Do not expose private coach notes, full raw GPS timelines, device identifiers, or support data in this web payload.

## Runtime Config

The route requires deploy-time `runtime-config.js` with `TRACKITMX_FIREBASE_WEB_API_KEY`.

Do not commit a real Firebase API key. Use the GitHub Actions secret and restrict the dedicated web key to:

- `https://trackitmx.com/*`
- `https://www.trackitmx.com/*`

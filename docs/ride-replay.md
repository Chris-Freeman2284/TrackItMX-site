# Shared ride replay

The private `/ride/?s=...` viewer offers Play/Pause, Restart, a seek slider, and
1×/2×/4×/8× speeds. Playback is opt-in, pauses when the page is hidden, and stops
at the end. Existing authentication, share-token access, revocation and expiry
checks still run before replay is created.

New iPhone shares optionally include `routeReplay`:

```text
{ version: 1, durationSeconds: number, truncated: boolean,
  points: [{ lat: number, lon: number, t: number, segment: integer }] }
```

`t` is seconds since the existing ride start. The iPhone preserves source GPS
timestamps and segment endpoints when reducing to at most 900 points. Different
segment numbers mean a GPS gap: do not join or interpolate across that interval.
The viewer also hides the moving marker before the first fix and after the last
fix, if the ride clock extends beyond captured GPS. Dateline geometry is unwrapped
for Leaflet without changing timing. New timing is only added to future private
share snapshots; old cloud documents are not migrated.

Older links without this field use a distance-weighted route preview over the
shared duration, explicitly labeled Estimated preview. This cannot reproduce
stops or actual recorded pace. Invalid versioned payloads do not fall back to
invented recorded timing. Shared geometry remains interpolated and reduced;
neither mode claims measured instantaneous speed.

Run `node docs/replay.test.mjs` for timing, gaps, invalid payloads, dateline and
clock transitions. September 18 browser QA used a localhost fixture server
intercepting Firebase responses; no real ride was published for testing. Mobile
390px and desktop 1440px checks covered playback, rate selection, pause, restart,
scrubbing, completion, old-link estimates and unavailable-link UI. The working
fixture server and synthetic payload are outside the website repository.

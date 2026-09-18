# Shared ride replay

The private `/ride/?s=...` viewer offers Play/Pause, Restart, a seek slider, and
1×/2×/4×/8× speeds. Playback is opt-in, pauses when the page is hidden, and stops
at the end. Existing authentication, share-token access, revocation and expiry
checks still run before replay is created.

New iPhone shares optionally include `routeReplay`:

```text
{ version: 1, durationSeconds: number, truncated: boolean,
  points: [{ lat: number, lon: number, t: number, segment: integer }],
  laps?: [{ number: integer, start: number, end: number }] }
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

## Progressive trail and lap colors

Pressing Play, Restart or seeking clears the full preview line and its static
start/finish/highlight pins. Playback draws only elapsed geometry. Restart clears
all completed pieces. The map retains the full ride bounds without drawing the
future route. A numbered color badge identifies the current lap.

The optional `laps` array contains at most 256 explicit recorded lap intervals in
relative seconds. Adjacent intervals may share a boundary, but cannot overlap;
invalid lap metadata falls back to one color. No lap divisions are inferred from
lap count or route crossings. Untimed links remain one-color estimated playback.
Warmup/cooldown outside recorded laps use the normal route tint. Six colors cycle
for longer sessions, while labels retain actual lap numbers. Existing shared
snapshots need a newly created link to acquire lap metadata.

The phone inserts exact boundary frames before reducing the share, preserving
those frames within the 900-point budget. Boundaries inside GPS gaps never create
coordinates. Completed web pieces cache their geometry and only the active piece
changes each frame. September 18 follow-up: 47 executable web checks and desktop /
390px browser checks passed for preview removal, three colors, restart, seek to
end, 8× playback and older links without laps. Native visual QA used a separate
synthetic recording with Firebase disabled.

const validPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const wrap = v => ((v + 180) % 360 + 360) % 360 - 180;
const clamp = (v, max) => Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0));

export function prepareReplay(raw, route, duration) {
  if (raw != null) {
    if (raw.version !== 1 || !Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > 900
        || !Number.isFinite(raw.durationSeconds) || raw.durationSeconds <= 0 || raw.durationSeconds > 31536000) return null;
    let previous = null;
    const points = [];
    for (const p of raw.points) {
      if (!validPoint(p) || !Number.isFinite(p.t) || p.t < 0 || p.t > raw.durationSeconds
          || !Number.isSafeInteger(p.segment) || p.segment < 0
          || (previous && (p.t <= previous.t || p.segment < previous.segment))) return null;
      points.push({ lat: p.lat, lon: p.lon, t: p.t, segment: p.segment });
      previous = p;
    }
    return { points, duration: raw.durationSeconds, recorded: true, truncated: raw.truncated === true, laps: validateLaps(raw.laps, raw.durationSeconds) };
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 31536000 || route.length < 2) return null;
  const points = route.slice(0, 900);
  if (!points.every(validPoint)) return null;
  let total = 0;
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
      + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(wrap(b.lon - a.lon) * rad / 2) ** 2;
    total += 6371000 * 2 * Math.atan2(Math.sqrt(Math.max(0, h)), Math.sqrt(Math.max(0, 1 - h)));
    distances.push(total);
  }
  return { points: points.map((p, i) => ({ ...p, t: duration * (total > 0 ? distances[i] / total : i / (points.length - 1)), segment: 0 })),
    duration, recorded: false, truncated: false, laps: [] };
}

export function replayFrame(timeline, elapsed) {
  const time = clamp(elapsed, timeline.duration), points = timeline.points;
  if (time < points[0].t) return { point: null, index: -1, gap: true, time };
  let low = 0, high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].t <= time) low = middle + 1; else high = middle;
  }
  const index = Math.max(0, low - 1), a = points[index], b = points[index + 1];
  if (time === a.t || (!b && !timeline.recorded)) return { point: a, index, gap: false, time };
  if (!b || a.segment !== b.segment || b.t <= a.t) return { point: null, index, gap: true, time };
  const fraction = (time - a.t) / (b.t - a.t);
  return { point: { lat: a.lat + (b.lat - a.lat) * fraction, lon: wrap(a.lon + wrap(b.lon - a.lon) * fraction), segment: a.segment, t: time }, index, gap: false, time };
}

export function replaySegments(points) {
  const segments = [];
  let lastSegment = null;
  let previousLongitude = null;
  for (const point of points) {
    if (lastSegment !== point.segment) segments.push([]);
    const longitude = previousLongitude == null ? point.lon : previousLongitude + wrap(point.lon - previousLongitude);
    segments[segments.length - 1].push([point.lat, longitude]);
    previousLongitude = longitude;
    lastSegment = point.segment;
  }
  return segments;
}

export class ReplayClock {
  constructor(duration) { this.duration = duration; this.elapsed = 0; this.rate = 1; this.playing = false; this.anchor = 0; }
  position(now) { return clamp(this.elapsed + (this.playing ? Math.max(0, now - this.anchor) * this.rate / 1000 : 0), this.duration); }
  play(now) { if (this.playing || this.duration <= 0) return; if (this.elapsed >= this.duration) this.elapsed = 0; this.anchor = now; this.playing = true; }
  pause(now) { this.elapsed = this.position(now); this.anchor = now; this.playing = false; }
  seek(value, now) { this.elapsed = clamp(value, this.duration); this.anchor = now; }
  setRate(rate, now) { if (![1, 2, 4, 8].includes(rate)) return; this.elapsed = this.position(now); this.anchor = now; this.rate = rate; }
}


// Additive metadata: old links and malformed lap metadata still play in one color.
export function validateLaps(raw, duration) {
  if (!Array.isArray(raw) || raw.length > 256) return [];
  let end = 0, number = 0;
  for (const lap of raw) {
    if (!lap || !Number.isSafeInteger(lap.number) || lap.number <= number || lap.number > 1000000
        || !Number.isFinite(lap.start) || !Number.isFinite(lap.end)
        || lap.start < end || lap.end <= lap.start || lap.end > duration) return [];
    end = lap.end; number = lap.number;
  }
  return raw.map(({number, start, end}) => ({number, start, end}));
}

export function replayLapAt(timeline, time) {
  return timeline.laps.find(lap => time >= lap.start && time < lap.end)?.number
    ?? (time === timeline.duration && timeline.laps.at(-1)?.end === time ? timeline.laps.at(-1).number : null);
}

export function replayLapColor(number) {
  const palette = ['#27d8bc', '#61b0ff', '#f5c75c', '#bf99ff', '#ff8c78', '#73d9cc'];
  return number == null ? palette[0] : palette[(number - 1) % palette.length];
}

// Prepared once, split on both GPS gaps and true lap boundaries. Adjacent lap
// pieces share their boundary coordinate; future geometry is never displayed.
export function replayPieces(timeline) {
  const boundaries = [...new Set(timeline.laps.flatMap(lap => [lap.start, lap.end]))];
  const points = [...timeline.points];
  const existing = new Set(points.map(p => p.t));
  for (const time of boundaries) {
    if (existing.has(time)) continue;
    const frame = replayFrame(timeline, time);
    if (frame.point) points.push({...frame.point, t:time});
  }
  points.sort((a,b) => a.t-b.t);
  const pieces = [];
  let pending = null;
  for (let i=1; i<points.length; i++) {
    const a=points[i-1], b=points[i];
    if (a.segment !== b.segment) { pending=null; continue; }
    const lap = replayLapAt(timeline, (a.t+b.t)/2);
    if (!pending || pending.lap !== lap) {
      pending = {lap, points:[a]}; pieces.push(pending);
    }
    pending.points.push(b);
  }
  return pieces;
}

export function visibleReplayPiece(piece, frame) {
  const visible = piece.points.filter(p => p.t <= frame.time);
  const last = visible.at(-1);
  if (last && frame.point && frame.time < piece.points.at(-1).t
      && frame.point.segment === last.segment && frame.time > last.t) visible.push(frame.point);
  return visible.length >= 2 ? visible : [];
}

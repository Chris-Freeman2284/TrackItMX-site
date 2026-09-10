const PROJECT_ID = "trackitmx-c5656";
const AUTH_STORAGE_KEY = "trackitmx_private_ride_auth_v1";
const FIREBASE_WEB_API_KEY = String(window.TRACKITMX_RUNTIME?.firebaseWebApiKey || "").trim();
const LEAFLET_CSS_URL = new URL("../assets/vendor/leaflet/leaflet.css", import.meta.url).href;
const LEAFLET_JS_URL = new URL("../assets/vendor/leaflet/leaflet.js", import.meta.url).href;
const DEFAULT_MAP_CENTER = [39.8283, -98.5795];
const DEFAULT_MAP_ZOOM = 4;

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const els = {
  title: document.getElementById("ride-title"),
  summary: document.getElementById("ride-summary"),
  pills: document.getElementById("ride-pill-row"),
  readTitle: document.getElementById("ride-read-title"),
  readSummary: document.getElementById("ride-read-summary"),
  stats: document.getElementById("ride-stats"),
  moments: document.getElementById("ride-moments-list"),
  map: document.getElementById("ride-map"),
  mapEmpty: document.getElementById("ride-map-empty"),
  fitRide: document.getElementById("fit-ride"),
  mapModeButtons: Array.from(document.querySelectorAll("[data-map-mode]"))
};

const state = {
  idToken: null,
  tokenExpiresAt: 0,
  shareID: null,
  ride: null,
  mapMode: "hybrid",
  mapAssetsPromise: null,
  map: null,
  roadLayer: null,
  hybridImageryLayer: null,
  hybridLabelsLayer: null,
  routeLayer: null,
  routeGlowLayer: null,
  markerLayer: null,
  routeBounds: null
};

bootstrap();

function bootstrap() {
  hydrateAuth();

  for (const button of els.mapModeButtons) {
    button.addEventListener("click", () => {
      setMapMode(button.getAttribute("data-map-mode") || "hybrid");
    });
  }

  els.fitRide?.addEventListener("click", () => {
    fitRoute({ animate: true });
  });

  const shareID = getRequestedShareID();
  if (!shareID) {
    renderError("This ride link is missing its share code.", "Ask the rider to send a fresh TrackItMX ride link.");
    return;
  }

  if (!FIREBASE_WEB_API_KEY) {
    renderError("Ride links are not configured yet.", "The site needs its Firebase web runtime key before private rides can open here.");
    return;
  }

  state.shareID = shareID;
  void openSharedRide(shareID);
}

async function openSharedRide(shareID) {
  setLoading("Opening shared ride.", "Fetching the route and shared metrics.");

  try {
    const ride = await fetchRideShare(shareID);
    if (!isRideActive(ride)) {
      throw new Error("This ride link has expired or was turned off.");
    }

    state.ride = ride;
    renderRide(ride);

    const route = parseRoutePreview(ride.routePreview);
    if (route.length >= 2) {
      try {
        await ensureMapReady();
        drawRoute(route, parseHighlights(ride.highlights));
      } catch (mapError) {
        showMapNote(mapError instanceof Error ? mapError.message : "Could not draw the map.");
      }
    } else {
      showMapNote("This share does not have enough GPS points to draw the route.");
    }
  } catch (error) {
    renderError(
      error instanceof Error ? error.message : "Could not open this ride.",
      "Try the link again, or ask the rider to create a fresh share."
    );
  }
}

async function fetchRideShare(shareID) {
  const url = `${firestoreBase}/privateRideShares/${encodeURIComponent(shareID)}`;
  const response = await authorizedFetch(url);

  if (response.status === 404) {
    throw new Error("This ride link does not exist anymore.");
  }
  if (!response.ok) {
    throw new Error("Could not load this ride link right now.");
  }

  const json = await response.json();
  const ride = unpackFirestoreValue({ mapValue: { fields: json.fields || {} } });
  if (!ride || typeof ride !== "object") {
    throw new Error("This ride link is missing the shared ride details.");
  }
  ride.id = json.name?.split("/").pop() || shareID;
  return ride;
}

async function authorizedFetch(url, options = {}) {
  const token = await ensureAnonymousToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
}

async function ensureAnonymousToken() {
  const now = Date.now();
  if (state.idToken && state.tokenExpiresAt - now > 60_000) {
    return state.idToken;
  }

  const cached = readCachedAuth();
  if (cached?.idToken && cached.expiresAt - now > 60_000) {
    state.idToken = cached.idToken;
    state.tokenExpiresAt = cached.expiresAt;
    return state.idToken;
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true })
  });

  if (!response.ok) {
    throw new Error("Could not start secure ride-link access.");
  }

  const json = await response.json();
  const expiresAt = now + (Number(json.expiresIn || 3600) * 1000);
  state.idToken = json.idToken;
  state.tokenExpiresAt = expiresAt;
  writeCachedAuth({ idToken: json.idToken, expiresAt });
  return state.idToken;
}

function hydrateAuth() {
  const cached = readCachedAuth();
  if (!cached) {
    return;
  }
  state.idToken = cached.idToken;
  state.tokenExpiresAt = cached.expiresAt;
}

function readCachedAuth() {
  try {
    const raw = window.localStorage?.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed.idToken !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedAuth(auth) {
  try {
    window.localStorage?.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // Private browsing or blocked storage should not kill a one-link viewer.
  }
}

async function ensureMapReady() {
  if (!els.map) {
    return;
  }

  if (!window.L) {
    if (!state.mapAssetsPromise) {
      state.mapAssetsPromise = loadLeafletAssets();
    }
    await state.mapAssetsPromise;
  }

  if (state.map) {
    window.requestAnimationFrame(() => state.map?.invalidateSize());
    return;
  }

  state.map = window.L.map(els.map, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true
  });

  state.roadLayer = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  state.hybridImageryLayer = window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  });
  state.hybridLabelsLayer = window.L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Labels &copy; Esri"
  });
  state.markerLayer = window.L.layerGroup().addTo(state.map);

  setMapMode(state.mapMode);
  state.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  window.requestAnimationFrame(() => state.map?.invalidateSize());
}

function loadLeafletAssets() {
  if (window.L) {
    return Promise.resolve();
  }

  if (!document.getElementById("trackitmx-leaflet-css")) {
    const link = document.createElement("link");
    link.id = "trackitmx-leaflet-css";
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS_URL;
    link.crossOrigin = "";
    document.head.appendChild(link);
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("trackitmx-leaflet-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load the ride map.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "trackitmx-leaflet-script";
    script.src = LEAFLET_JS_URL;
    script.crossOrigin = "";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load the ride map.")), { once: true });
    document.body.appendChild(script);
  });
}

function setMapMode(mode) {
  state.mapMode = mode === "road" ? "road" : "hybrid";

  if (state.map) {
    toggleLayer(state.roadLayer, state.mapMode === "road");
    toggleLayer(state.hybridImageryLayer, state.mapMode === "hybrid");
    toggleLayer(state.hybridLabelsLayer, state.mapMode === "hybrid");
  }

  for (const button of els.mapModeButtons) {
    const active = button.getAttribute("data-map-mode") === state.mapMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function toggleLayer(layer, shouldShow) {
  if (!state.map || !layer) {
    return;
  }

  const hasLayer = state.map.hasLayer(layer);
  if (shouldShow && !hasLayer) {
    layer.addTo(state.map);
  } else if (!shouldShow && hasLayer) {
    state.map.removeLayer(layer);
  }
}

function drawRoute(route, highlights) {
  if (!state.map || !window.L) {
    return;
  }

  state.routeLayer?.remove();
  state.routeGlowLayer?.remove();
  state.markerLayer?.clearLayers();

  const latLngs = route.map((point) => [point.lat, point.lon]);
  state.routeGlowLayer = window.L.polyline(latLngs, {
    color: "#070504",
    weight: 11,
    opacity: 0.62,
    lineJoin: "round",
    lineCap: "round"
  }).addTo(state.map);

  state.routeLayer = window.L.polyline(latLngs, {
    color: "#27d8bc",
    weight: 6,
    opacity: 0.94,
    lineJoin: "round",
    lineCap: "round"
  }).addTo(state.map);

  const bounds = state.routeLayer.getBounds();
  state.routeBounds = bounds;

  addEndpoint(route[0], "Start", "start");
  addEndpoint(route[route.length - 1], "Finish", "finish");
  for (const highlight of highlights) {
    addHighlightMarker(highlight);
  }

  fitRoute({ animate: false });
  showMapNote("");
}

function addEndpoint(point, label, kind) {
  if (!state.markerLayer || !window.L) {
    return;
  }

  const marker = window.L.marker([point.lat, point.lon], {
    icon: window.L.divIcon({
      className: "ride-map-marker-shell",
      html: `<span class="ride-map-marker ride-map-marker--${kind}"><span class="ride-map-marker__dot"></span><span class="ride-map-marker__label">${escapeHTML(label)}</span></span>`,
      iconSize: [1, 1],
      iconAnchor: [0, 0]
    }),
    keyboard: false
  });
  marker.addTo(state.markerLayer);
}

function addHighlightMarker(highlight) {
  if (!state.markerLayer || !window.L || !isFiniteCoordinate(highlight)) {
    return;
  }

  const title = highlight.title || "Key moment";
  const subtitle = highlight.subtitle || "";
  const marker = window.L.marker([highlight.lat, highlight.lon], {
    icon: window.L.divIcon({
      className: "ride-map-marker-shell",
      html: `<span class="ride-map-marker ride-map-marker--moment ride-map-marker--${escapeAttribute(highlight.kind || "moment")}"><span class="ride-map-marker__dot"></span><span class="ride-map-marker__label">${escapeHTML(title)}</span></span>`,
      iconSize: [1, 1],
      iconAnchor: [0, 0]
    }),
    keyboard: false
  });
  marker.bindPopup(`<strong>${escapeHTML(title)}</strong>${subtitle ? `<br>${escapeHTML(subtitle)}` : ""}`);
  marker.addTo(state.markerLayer);
}

function fitRoute({ animate }) {
  if (!state.map || !state.routeBounds || !state.routeBounds.isValid()) {
    return;
  }
  state.map.fitBounds(state.routeBounds.pad(0.18), {
    animate,
    duration: animate ? 0.35 : 0,
    padding: [28, 28],
    maxZoom: 17
  });
  window.requestAnimationFrame(() => state.map?.invalidateSize());
}

function renderRide(ride) {
  const title = firstString(ride.title, ride.trailName, ride.matchedTrailName, "TrackItMX Ride");
  const alias = firstString(ride.riderAlias, ride.username, ride.displayName, "Rider");
  const distance = formatDistance(firstNumber(ride.distanceMeters, ride.movingDistanceMeters));
  const duration = formatDuration(firstNumber(ride.durationSeconds, ride.elapsedSeconds));
  const date = formatDate(ride.rideDate);
  const score = firstString(ride.scoreDisplay, ride.scoreDisplayRange) || (hasNumber(ride.rideScore) ? `${ride.rideScore}/100` : null);
  const confidence = ride.scoreConfidenceLabel || (hasNumber(ride.scoreConfidenceScore) ? `${ride.scoreConfidenceScore}% confidence` : null);

  setText(els.title, title);
  setText(els.summary, sharedRideSummary({ alias, distance, duration, date }));
  setText(els.readTitle, score ? `Score ${score}` : "Shared metrics");

  const readParts = [
    firstString(ride.bestSection) ? `Best: ${firstString(ride.bestSection)}` : null,
    firstString(ride.weakestSection) ? `Weakest: ${firstString(ride.weakestSection)}` : null,
    firstString(ride.mainFix) ? `Main fix: ${firstString(ride.mainFix)}` : null
  ].filter(Boolean);
  setText(els.readSummary, readParts.length ? readParts.join(" · ") : "Route, pace, and key moments from the shared ride.");

  renderPills(ride, confidence);
  renderStats(ride, { distance, duration, score, confidence });
  renderMoments(parseHighlights(ride.highlights));
}

function renderPills(ride, confidence) {
  if (!els.pills) {
    return;
  }

  const expires = formatExpiry(ride.expiresAt);
  const labels = [
    "Unlisted",
    confidence,
    expires ? `Expires ${expires}` : null,
    ride.trailName || ride.matchedTrailName || null
  ].filter(Boolean);

  els.pills.replaceChildren(...labels.map((label) => {
    const pill = document.createElement("span");
    pill.className = "spectator-pill";
    pill.textContent = label;
    return pill;
  }));
}

function renderStats(ride, derived) {
  if (!els.stats) {
    return;
  }

  const stats = [
    ["Distance", derived.distance],
    ["Duration", derived.duration],
    ["Moving", formatDuration(firstNumber(ride.movingSeconds, ride.durationSeconds, ride.elapsedSeconds))],
    ["Avg moving", formatSpeed(ride.avgMovingSpeedMps)],
    ["Max speed", formatSpeed(ride.maxSpeedMps)],
    ["Score", derived.score || "Shared privately"],
    ["Confidence", derived.confidence || ride.scoreEvidenceLabel || "Route only"],
    ["Signal", ride.telemetryConfidenceLabel || (hasNumber(ride.telemetryConfidenceScore) ? `${ride.telemetryConfidenceScore}%` : "Shared GPS")]
  ];

  if (hasNumber(ride.lapCount)) {
    stats.splice(3, 0, ["Laps", String(ride.lapCount)]);
  }
  if (hasNumber(ride.bestLapSeconds)) {
    stats.splice(4, 0, ["Best lap", formatDuration(ride.bestLapSeconds)]);
  }
  if (hasNumber(ride.avgHeartRate)) {
    stats.splice(-1, 0, ["Avg HR", formatHeartRate(ride.avgHeartRate)]);
  }
  if (hasNumber(ride.activeEnergyKcal)) {
    stats.splice(-1, 0, ["Energy", formatEnergy(ride.activeEnergyKcal)]);
  }

  els.stats.replaceChildren(...stats.map(([label, value]) => {
    const article = document.createElement("article");
    article.className = "ride-stat-card";

    const small = document.createElement("span");
    small.className = "label";
    small.textContent = label;

    const strong = document.createElement("strong");
    strong.textContent = value || "--";

    article.append(small, strong);
    return article;
  }));
}

function renderMoments(highlights) {
  if (!els.moments) {
    return;
  }

  if (!highlights.length) {
    els.moments.innerHTML = `
      <article class="ride-moment">
        <span class="ride-moment__type">Route</span>
        <strong>Full ride line shared</strong>
        <p>No extra key moments were attached to this share.</p>
      </article>
    `;
    return;
  }

  els.moments.replaceChildren(...highlights.map((moment) => {
    const article = document.createElement("article");
    article.className = "ride-moment";

    const type = document.createElement("span");
    type.className = "ride-moment__type";
    type.textContent = labelForMomentKind(moment.kind);

    const strong = document.createElement("strong");
    strong.textContent = moment.title || "Key moment";

    const p = document.createElement("p");
    p.textContent = moment.subtitle || "Tap the marker on the map to inspect this point.";

    if (isFiniteCoordinate(moment)) {
      article.addEventListener("click", () => {
        focusMoment(moment);
      });
      article.tabIndex = 0;
      article.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusMoment(moment);
        }
      });
    }

    article.append(type, strong, p);
    return article;
  }));
}

function focusMoment(moment) {
  if (!state.map || !isFiniteCoordinate(moment)) {
    return;
  }
  state.map.flyTo([moment.lat, moment.lon], Math.max(state.map.getZoom(), 16), {
    duration: 0.45
  });
}

function parseRoutePreview(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        return { lat: Number(item[0]), lon: Number(item[1]) };
      }
      if (item && typeof item === "object") {
        return {
          lat: Number(item.lat ?? item.latitude),
          lon: Number(item.lon ?? item.lng ?? item.longitude)
        };
      }
      return null;
    })
    .filter(isFiniteCoordinate);
}

function parseHighlights(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      return {
        kind: safeString(item.kind),
        title: safeString(item.title),
        subtitle: safeString(item.subtitle),
        lat: Number(item.lat ?? item.latitude),
        lon: Number(item.lon ?? item.lng ?? item.longitude),
        score: hasNumber(item.score) ? Number(item.score) : null
      };
    })
    .filter(Boolean)
    .slice(0, 7);
}

function isRideActive(ride) {
  if (!ride) {
    return false;
  }
  const status = safeString(ride.status).toLowerCase();
  if (status && status !== "active") {
    return false;
  }

  const expiresAt = parseDate(ride.expiresAt);
  return !expiresAt || expiresAt.getTime() > Date.now();
}

function getRequestedShareID() {
  const candidates = [];
  const collectFromParams = (params) => {
    for (const key of ["s", "share", "shareID", "shareId", "id", "ride", "rideShare", "rideShareID", "rideShareId"]) {
      candidates.push(params.get(key) || "");
    }
    for (const value of params.values()) {
      if (typeof value === "string" && value.includes("/ride/")) {
        candidates.push(extractShareIDFromURL(value));
      }
    }
  };

  collectFromParams(new URLSearchParams(window.location.search));

  const hash = window.location.hash.replace(/^#/, "");
  if (hash) {
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;
    collectFromParams(new URLSearchParams(hashQuery));
  }

  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const rideIndex = pathParts.lastIndexOf("ride");
  if (rideIndex >= 0) {
    candidates.push(pathParts[rideIndex + 1] || "");
  }

  for (const candidate of candidates) {
    const normalized = normalizeShareID(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function extractShareIDFromURL(raw) {
  try {
    const parsed = new URL(raw, window.location.origin);
    const params = new URLSearchParams(parsed.search);
    return params.get("s") || params.get("share") || params.get("id") || "";
  } catch {
    return "";
  }
}

function normalizeShareID(raw) {
  const trimmed = String(raw || "").trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(trimmed) ? trimmed : "";
}

function setLoading(title, summary) {
  setText(els.title, title);
  setText(els.summary, summary);
  setText(els.readTitle, "Loading");
  setText(els.readSummary, "One moment while TrackItMX opens the shared ride.");
  showMapNote("Loading the map.");
}

function renderError(title, summary) {
  setText(els.title, title);
  setText(els.summary, summary);
  setText(els.readTitle, "Ride unavailable");
  setText(els.readSummary, "Private ride links can expire, be revoked, or fail when service is unavailable.");
  showMapNote(summary);
  renderPills({ expiresAt: null, trailName: null, matchedTrailName: null }, null);

  if (els.stats) {
    els.stats.innerHTML = `
      <article class="ride-stat-card">
        <span class="label">Status</span>
        <strong>Unavailable</strong>
      </article>
    `;
  }
  if (els.moments) {
    els.moments.innerHTML = `
      <article class="ride-moment">
        <span class="ride-moment__type">Next step</span>
        <strong>Ask for a fresh link</strong>
        <p>The rider can create a new private ride share from TrackItMX.</p>
      </article>
    `;
  }
}

function showMapNote(message) {
  if (!els.mapEmpty) {
    return;
  }
  if (!message) {
    els.mapEmpty.hidden = true;
    els.mapEmpty.textContent = "";
  } else {
    els.mapEmpty.hidden = false;
    els.mapEmpty.textContent = message;
  }
}

function unpackFirestoreValue(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("integerValue" in value) {
    return Number(value.integerValue);
  }
  if ("doubleValue" in value) {
    return Number(value.doubleValue);
  }
  if ("booleanValue" in value) {
    return Boolean(value.booleanValue);
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  if ("nullValue" in value) {
    return null;
  }
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(unpackFirestoreValue);
  }
  if ("mapValue" in value) {
    const fields = value.mapValue.fields || {};
    return Object.fromEntries(
      Object.entries(fields).map(([key, fieldValue]) => [key, unpackFirestoreValue(fieldValue)])
    );
  }
  return null;
}

function formatDistance(meters) {
  const miles = Number(meters || 0) / 1609.344;
  if (!Number.isFinite(miles) || miles <= 0) {
    return "--";
  }
  return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
}

function sharedRideSummary({ alias, distance, duration, date }) {
  const parts = [];
  if (distance && distance !== "--") {
    parts.push(distance);
  }
  if (duration && duration !== "0s") {
    parts.push(duration);
  }
  const rideLabel = parts.length ? parts.join(" · ") : "a ride";
  return `${alias} shared ${rideLabel} from ${date}.`;
}

function formatSpeed(mps) {
  const mph = Number(mps || 0) * 2.2369362920544;
  if (!Number.isFinite(mph) || mph <= 0) {
    return "--";
  }
  return `${mph.toFixed(mph >= 10 ? 1 : 0)} mph`;
}

function formatHeartRate(value) {
  const bpm = Math.round(Number(value || 0));
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return "--";
  }
  return `${bpm} bpm`;
}

function formatEnergy(value) {
  const kcal = Math.round(Number(value || 0));
  if (!Number.isFinite(kcal) || kcal <= 0) {
    return "--";
  }
  return `${kcal} kcal`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
  }
  return `${remaining}s`;
}

function formatDate(raw) {
  const date = parseDate(raw);
  if (!date) {
    return "a recent ride";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatExpiry(raw) {
  const date = parseDate(raw);
  if (!date) {
    return "";
  }
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) {
    return "soon";
  }
  if (days === 1) {
    return "1 day";
  }
  return `${days} days`;
}

function parseDate(raw) {
  if (!raw) {
    return null;
  }
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw : null;
  }
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function labelForMomentKind(kind) {
  switch (kind) {
    case "best":
      return "Best";
    case "fix":
      return "Fix";
    case "turn":
      return "Turn";
    case "start":
      return "Start";
    case "finish":
      return "Finish";
    default:
      return "Moment";
  }
}

function isFiniteCoordinate(point) {
  return point
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lon)
    && Math.abs(point.lat) <= 90
    && Math.abs(point.lon) <= 180;
}

function hasNumber(value) {
  return Number.isFinite(Number(value));
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(...values) {
  for (const value of values) {
    const string = safeString(value);
    if (string) {
      return string;
    }
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return 0;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

const PROJECT_ID = "trackitmx-c5656";
const POLL_MS = 3500;
const STALE_ROOM_SECONDS = 600;
const AUTH_STORAGE_KEY = "trackitmx_spectator_auth_v1";
const FIREBASE_WEB_API_KEY = String(window.TRACKITMX_RUNTIME?.firebaseWebApiKey || "").trim();
const LEAFLET_CSS_URL = new URL("../../assets/vendor/leaflet/leaflet.css", import.meta.url).href;
const LEAFLET_JS_URL = new URL("../../assets/vendor/leaflet/leaflet.js", import.meta.url).href;
const TRAILS_URL = new URL("../../assets/trails/michigan_public_trails.json", import.meta.url).href;
const DEFAULT_MAP_CENTER = [39.8283, -98.5795];
const DEFAULT_MAP_ZOOM = 4;
const FOLLOW_ZOOM_FLOOR = 15;

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const els = {
  entry: document.getElementById("spectator-entry"),
  form: document.getElementById("spectator-form"),
  input: document.getElementById("room-code"),
  status: document.getElementById("spectator-status"),
  live: document.getElementById("spectator-live"),
  leaveRoom: document.getElementById("leave-room"),
  roomTitle: document.getElementById("room-title"),
  roomSummary: document.getElementById("room-summary"),
  roomVisibilityPill: document.getElementById("room-visibility-pill"),
  roomContextPill: document.getElementById("room-context-pill"),
  roomCodePill: document.getElementById("room-code-pill"),
  roomRefreshPill: document.getElementById("room-refresh-pill"),
  followPill: document.getElementById("follow-pill"),
  statRiders: document.getElementById("stat-riders"),
  statLive: document.getElementById("stat-live"),
  statAttention: document.getElementById("stat-attention"),
  statRoomAge: document.getElementById("stat-room-age"),
  field: document.getElementById("spectator-field"),
  mapEmpty: document.getElementById("spectator-map-empty"),
  mapNote: document.getElementById("spectator-map-note"),
  ridersList: document.getElementById("spectator-riders-list"),
  fitRiders: document.getElementById("fit-riders"),
  clearFollow: document.getElementById("clear-follow"),
  mapModeButtons: Array.from(document.querySelectorAll("[data-map-mode]"))
};

const state = {
  idToken: null,
  tokenExpiresAt: 0,
  roomId: null,
  shareCode: null,
  pollHandle: null,
  loading: false,
  mapMode: "road",
  map: null,
  markerLayer: null,
  accuracyLayer: null,
  mapAssetsPromise: null,
  trailDataPromise: null,
  trailLayer: null,
  trailLayers: [],
  roadLayer: null,
  hybridImageryLayer: null,
  hybridLabelsLayer: null,
  riderMarkers: new Map(),
  latestRiders: [],
  userHasControlledMap: false,
  hasAutoFit: false,
  hasCenteredFallback: false,
  followedRiderId: null,
  followedRiderName: "",
  programmaticViewportUntil: 0,
  lastFittedRoomKey: null,
  lastRoomSnapshot: null
};

bootstrap();

function bootstrap() {
  if (!FIREBASE_WEB_API_KEY) {
    if (els.input) {
      els.input.disabled = true;
      els.input.placeholder = "Spectator view is not configured";
    }
    const submitButton = els.form?.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }
    setStatus("Spectator access is temporarily unavailable while site configuration is finishing.", "error");
    return;
  }

  hydrateAuth();

  els.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const rawCode = els.input?.value ?? "";
    void openRoom(rawCode);
  });

  els.leaveRoom?.addEventListener("click", () => {
    leaveRoom();
  });

  els.fitRiders?.addEventListener("click", () => {
    fitCurrentRiders({ force: true, fromUser: true });
  });

  els.clearFollow?.addEventListener("click", () => {
    clearFollowMode();
  });

  els.ridersList?.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("[data-follow-rider]")
      : null;
    if (!button) {
      return;
    }

    focusRider(button.getAttribute("data-follow-rider"), { fromUser: true });
  });

  for (const button of els.mapModeButtons) {
    button.addEventListener("click", () => {
      const requestedMode = button.getAttribute("data-map-mode") || "road";
      setMapMode(requestedMode);
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.roomId) {
      void refreshRoom();
    }
  });

  showEntry();

  const initialCode = getRequestedCode();
  if (initialCode && els.input) {
    els.input.value = initialCode;
    void openRoom(initialCode);
  }
}

async function openRoom(rawCode) {
  const cleanedExact = rawCode.trim();
  const normalized = normalizeCode(rawCode);

  if (!cleanedExact && !normalized) {
    hideLiveRoom();
    setStatus("Enter a room code to open the ride.", "idle");
    return;
  }

  stopPolling();
  resetRoomViewState();
  hideLiveRoom();
  setStatus("Opening the live room…", "loading");

  try {
    const room = await resolveActiveRoom(cleanedExact || normalized);
    if (!room) {
      throw new Error("That room code is not active right now.");
    }

    state.roomId = room.id;
    state.shareCode = room.shareCode || normalized || cleanedExact;
    syncUrl(state.shareCode);

    showLiveRoom();
    if (els.mapEmpty) {
      els.mapEmpty.hidden = false;
      els.mapEmpty.textContent = "Loading the map.";
    }
    try {
      await ensureMapReady();
      if (els.mapEmpty) {
        els.mapEmpty.hidden = false;
        els.mapEmpty.textContent = "Waiting for live rider positions.";
      }
    } catch (mapError) {
      if (els.mapEmpty) {
        els.mapEmpty.hidden = false;
        els.mapEmpty.textContent = mapError instanceof Error
          ? mapError.message
          : "Could not load the live map.";
      }
    }
    await refreshRoom(room);
    schedulePoll();
  } catch (error) {
    state.roomId = null;
    state.shareCode = null;
    hideLiveRoom();
    setStatus(error instanceof Error ? error.message : "Could not open this room.", "error");
  }
}

async function refreshRoom(seedRoom = null) {
  if (!state.roomId || state.loading) {
    return;
  }

  state.loading = true;

  try {
    const room = seedRoom ?? await fetchRoomById(state.roomId);
    if (!room || !isRoomActive(room)) {
      throw new Error("This room is no longer active.");
    }

    const riders = await fetchPresence(room.id);
    try {
      await ensureMapReady();
    } catch (mapError) {
      if (els.mapEmpty) {
        els.mapEmpty.hidden = false;
        els.mapEmpty.textContent = mapError instanceof Error
          ? mapError.message
          : "Could not load the live map.";
      }
    }
    renderRoom(room, riders);
    setStatus(`Watching ${riders.length} rider${riders.length === 1 ? "" : "s"} in this room.`, "success");
    els.live.hidden = false;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Live room refresh failed.", "error");
  } finally {
    state.loading = false;
  }
}

function schedulePoll() {
  stopPolling();
  state.pollHandle = window.setTimeout(async () => {
    await refreshRoom();
    if (state.roomId) {
      schedulePoll();
    }
  }, POLL_MS);
}

function stopPolling() {
  if (state.pollHandle) {
    clearTimeout(state.pollHandle);
    state.pollHandle = null;
  }
}

function hideLiveRoom() {
  if (els.live) {
    els.live.hidden = true;
  }

  document.body.classList.remove("page--spectator-room-active");
}

function showLiveRoom() {
  if (els.entry) {
    els.entry.hidden = true;
  }

  if (els.live) {
    els.live.hidden = false;
  }

  document.body.classList.add("page--spectator-room-active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  window.requestAnimationFrame(() => {
    state.map?.invalidateSize();
  });
}

function showEntry() {
  if (els.entry) {
    els.entry.hidden = false;
  }

  document.body.classList.remove("page--spectator-room-active");
}

function leaveRoom() {
  stopPolling();
  state.roomId = null;
  state.shareCode = null;
  state.loading = false;
  resetRoomViewState();

  if (els.input) {
    els.input.value = "";
  }

  clearUrlCode();
  hideLiveRoom();
  showEntry();
  window.scrollTo({ top: 0, behavior: "smooth" });
  setStatus("You left the room. Enter another code any time.", "idle");
}

function resetRoomViewState() {
  state.lastFittedRoomKey = null;
  state.lastRoomSnapshot = null;
  state.latestRiders = [];
  state.riderMarkers.clear();
  state.userHasControlledMap = false;
  state.hasAutoFit = false;
  state.hasCenteredFallback = false;
  state.followedRiderId = null;
  state.followedRiderName = "";
  state.programmaticViewportUntil = 0;

  if (state.markerLayer) {
    state.markerLayer.clearLayers();
  }
  if (state.accuracyLayer) {
    state.accuracyLayer.clearLayers();
  }
  if (els.mapNote) {
    els.mapNote.hidden = true;
    els.mapNote.textContent = "";
  }

  updateFollowUi();
}

function syncUrl(code) {
  if (!code) {
    return;
  }

  const next = new URL(window.location.href);
  next.searchParams.set("code", code);
  window.history.replaceState({}, "", next.toString());
}

function clearUrlCode() {
  const next = new URL(window.location.href);
  next.searchParams.delete("code");
  next.searchParams.delete("room");
  window.history.replaceState({}, "", next.toString());
}

function setStatus(message, tone) {
  if (!els.status) {
    return;
  }

  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

async function ensureMapReady() {
  if (!els.field) {
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

  state.map = window.L.map(els.field, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true
  });

  state.map.createPane("trackitmxTrails");
  state.map.getPane("trackitmxTrails").style.zIndex = "420";

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
  state.accuracyLayer = window.L.layerGroup().addTo(state.map);
  state.map.on("dragstart", handleUserMapDrag);
  state.map.on("zoomstart", handleUserMapZoom);

  setMapMode(state.mapMode);
  state.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  void ensureTrailLayerReady();
  window.requestAnimationFrame(() => state.map?.invalidateSize());
}

function loadLeafletAssets() {
  if (window.L) {
    return Promise.resolve();
  }

  const cssId = "trackitmx-leaflet-css";
  if (!document.getElementById(cssId)) {
    const link = document.createElement("link");
    link.id = cssId;
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS_URL;
    link.crossOrigin = "";
    document.head.appendChild(link);
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("trackitmx-leaflet-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load the live map.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "trackitmx-leaflet-script";
    script.src = LEAFLET_JS_URL;
    script.crossOrigin = "";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the live map."));
    document.head.appendChild(script);
  });
}

async function ensureTrailLayerReady() {
  if (!state.map || state.trailLayer) {
    return;
  }

  if (!state.trailDataPromise) {
    state.trailDataPromise = fetch(TRAILS_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error("Could not load trail context.");
      }
      return response.json();
    });
  }

  const trailGeoJson = await state.trailDataPromise;
  state.trailLayers = [];
  state.trailLayer = window.L.geoJSON(trailGeoJson, {
    pane: "trackitmxTrails",
    style: (feature) => getTrailStyle(feature?.properties),
    onEachFeature(feature, layer) {
      state.trailLayers.push(layer);
      layer.bindTooltip(escapeHtml(feature?.properties?.name || "TrackItMX trail"), {
        sticky: true,
        direction: "top",
        opacity: 0.94
      });
    }
  }).addTo(state.map);

  updateTrailHighlight(state.lastRoomSnapshot);
}

function getTrailStyle(properties = {}, isActive = false) {
  const category = typeof properties.category === "string" ? properties.category.trim().toLowerCase() : "mixed";
  const colors = {
    singletrack: "#7be6c2",
    "single track": "#7be6c2",
    atv: "#f0c37a",
    forestroad: "#8db8ff",
    "forest road": "#8db8ff",
    mxtrack: "#ff9d7b",
    "mx track": "#ff9d7b",
    mixed: "#f2cb92",
    unknown: "#d4ad7b"
  };
  const color = colors[category] || colors.mixed;

  return {
    color: isActive ? "#f7efe3" : color,
    weight: isActive ? 5 : 3,
    opacity: isActive ? 0.95 : 0.72
  };
}

function updateTrailHighlight(room) {
  if (!state.trailLayers.length) {
    return;
  }

  const trailKeys = getRoomTrailKeys(room);

  for (const layer of state.trailLayers) {
    const properties = layer.feature?.properties || {};
    const featureKeys = [
      normalizeTrailKey(properties.slug),
      normalizeTrailKey(properties.name)
    ].filter(Boolean);
    const isMatch = trailKeys.size > 0
      && featureKeys.some((featureKey) => {
        for (const trailKey of trailKeys) {
          if (featureKey === trailKey || featureKey.includes(trailKey) || trailKey.includes(featureKey)) {
            return true;
          }
        }
        return false;
      });

    layer.setStyle(getTrailStyle(properties, isMatch));
    if (isMatch) {
      layer.bringToFront();
    }
  }
}

function getRoomTrailKeys(room) {
  const keys = new Set();
  if (!room) {
    return keys;
  }

  const values = [room.trailName, room.trailID, room.trailId];
  for (const value of values) {
    const normalized = normalizeTrailKey(value);
    if (normalized) {
      keys.add(normalized);
    }
  }
  return keys;
}

function normalizeTrailKey(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function setMapMode(mode) {
  state.mapMode = mode === "hybrid" ? "hybrid" : "road";

  if (state.map) {
    toggleLayer(state.roadLayer, state.mapMode === "road");
    toggleLayer(state.hybridImageryLayer, state.mapMode === "hybrid");
    toggleLayer(state.hybridLabelsLayer, state.mapMode === "hybrid");
  }

  updateMapModeButtons();
}

function updateMapModeButtons() {
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

function handleUserMapDrag() {
  if (isProgrammaticViewportChange()) {
    return;
  }

  state.userHasControlledMap = true;
  if (state.followedRiderId) {
    clearFollowMode();
  }
}

function handleUserMapZoom() {
  if (isProgrammaticViewportChange()) {
    return;
  }

  state.userHasControlledMap = true;
}

function isProgrammaticViewportChange() {
  return state.programmaticViewportUntil > Date.now();
}

function runProgrammaticViewportChange(action, durationMs = 900) {
  state.programmaticViewportUntil = Date.now() + durationMs;
  action();
  window.setTimeout(() => {
    if (state.programmaticViewportUntil <= Date.now()) {
      state.programmaticViewportUntil = 0;
    }
  }, durationMs + 120);
}

function hydrateAuth() {
  try {
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (parsed?.idToken && parsed?.tokenExpiresAt && parsed.tokenExpiresAt > Date.now() + 60_000) {
      state.idToken = parsed.idToken;
      state.tokenExpiresAt = parsed.tokenExpiresAt;
    }
  } catch {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

function persistAuth() {
  if (!state.idToken || !state.tokenExpiresAt) {
    return;
  }

  window.sessionStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      idToken: state.idToken,
      tokenExpiresAt: state.tokenExpiresAt
    })
  );
}

async function ensureAnonymousToken(force = false) {
  if (!force && state.idToken && state.tokenExpiresAt > Date.now() + 60_000) {
    return state.idToken;
  }

  if (!FIREBASE_WEB_API_KEY) {
    throw new Error("Spectator access is not configured.");
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      returnSecureToken: true
    })
  });

  if (!response.ok) {
    throw new Error("Could not initialize spectator access.");
  }

  const data = await response.json();
  state.idToken = data.idToken;
  state.tokenExpiresAt = Date.now() + (Number(data.expiresIn || 3600) * 1000);
  persistAuth();
  return state.idToken;
}

async function authorizedFetch(url, init = {}, retry = true) {
  const token = await ensureAnonymousToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers
  });

  if ((response.status === 401 || response.status === 403) && retry) {
    await ensureAnonymousToken(true);
    return authorizedFetch(url, init, false);
  }

  return response;
}

async function resolveActiveRoom(rawCode) {
  const exact = rawCode.trim();
  const normalized = normalizeCode(rawCode);

  if (exact) {
    const exactRoom = await fetchRoomById(exact);
    if (isRoomActive(exactRoom)) {
      return exactRoom;
    }
  }

  if (!normalized) {
    return null;
  }

  const response = await authorizedFetch(`${firestoreBase}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "rooms" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "shareCode" },
            op: "EQUAL",
            value: { stringValue: normalized }
          }
        },
        limit: 5
      }
    })
  });

  if (!response.ok) {
    throw new Error("Could not query live rooms right now.");
  }

  const rows = await response.json();
  const rooms = rows
    .map((row) => row.document)
    .filter(Boolean)
    .map(parseFirestoreDocument)
    .filter((room) => isRoomActive(room));

  return rooms[0] ?? null;
}

async function fetchRoomById(roomId) {
  const response = await authorizedFetch(`${firestoreBase}/rooms/${encodeURIComponent(roomId)}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Could not load this room.");
  }

  const doc = await response.json();
  return parseFirestoreDocument(doc);
}

async function fetchPresence(roomId) {
  const response = await authorizedFetch(`${firestoreBase}/rooms/${encodeURIComponent(roomId)}/presence?pageSize=100`);

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error("Could not load rider presence.");
  }

  const data = await response.json();
  return (data.documents ?? [])
    .map(parseFirestoreDocument)
    .filter(isRenderablePresence)
    .map((presence) => decoratePresence(presence))
    .sort(comparePresence);
}

function parseFirestoreDocument(document) {
  const name = document.name || "";
  const id = name.split("/").pop() || "";
  const fields = unpackFirestoreFields(document.fields || {});
  return {
    id,
    ...fields
  };
}

function unpackFirestoreFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, unpackFirestoreValue(value)])
  );
}

function unpackFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return unpackFirestoreFields(value.mapValue.fields || {});
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(unpackFirestoreValue);
  return null;
}

function decoratePresence(presence) {
  const effectiveUpdatedAt = getPresenceTimestamp(presence);
  const ageSeconds = effectiveUpdatedAt ? (Date.now() - effectiveUpdatedAt.getTime()) / 1000 : null;
  const freshness = getFreshness(ageSeconds);
  const crashState = normalizeCrashState(presence.crashState);
  const speedMps = typeof presence.speedMps === "number" && Number.isFinite(presence.speedMps)
    ? presence.speedMps
    : null;
  const gpsAccuracyMeters = parseAccuracyMeters(presence.gpsAccuracyMeters);
  const movement = getMovementLabel(speedMps, freshness);

  return {
    ...presence,
    displayName: (presence.displayName || "Rider").trim() || "Rider",
    speedMps,
    gpsAccuracyMeters,
    effectiveUpdatedAt,
    ageSeconds,
    freshness,
    crashState,
    movement,
    sourceLabel: getSourceLabel(presence.liveSource, presence.publishPath),
    accuracyLabel: getAccuracyLabel(gpsAccuracyMeters),
    accuracyTone: getAccuracyTone(gpsAccuracyMeters),
    statusLabel: getStatusLabel(crashState, freshness),
    priorityRank: getPriorityRank(crashState, freshness),
    speedMph: typeof speedMps === "number" ? Math.round(speedMps * 2.23694) : null
  };
}

function comparePresence(a, b) {
  if (a.priorityRank !== b.priorityRank) {
    return a.priorityRank - b.priorityRank;
  }

  if ((a.ageSeconds ?? Infinity) !== (b.ageSeconds ?? Infinity)) {
    return (a.ageSeconds ?? Infinity) - (b.ageSeconds ?? Infinity);
  }

  return a.displayName.localeCompare(b.displayName);
}

function renderRoom(room, riders) {
  state.lastRoomSnapshot = room;
  state.latestRiders = riders;
  const liveCount = riders.filter((rider) => rider.freshness === "live").length;
  const recentCount = riders.filter((rider) => rider.freshness === "weak").length;
  const lastKnownCount = riders.filter((rider) => rider.freshness === "last" || rider.freshness === "offline").length;
  const approximateCount = riders.filter((rider) => rider.accuracyTone === "rough" || rider.accuracyTone === "approx").length;
  const roomAge = getRoomAge(room);
  const displayTitle = (room.title || "").trim() || `Room ${room.shareCode || state.shareCode || room.id}`;
  const shareCode = room.shareCode || state.shareCode || room.id;
  const roomVisibility = getRoomVisibilityLabel(room);
  const roomContext = getRoomContextLabel(room);

  els.roomTitle.textContent = displayTitle;
  const summaryBits = [
    `${riders.length} rider${riders.length === 1 ? "" : "s"} on map`,
    `${liveCount} live`,
    `${recentCount} recent`
  ];

  if (lastKnownCount > 0) {
    summaryBits.push(`${lastKnownCount} last known`);
  }
  if (approximateCount > 0) {
    summaryBits.push(`${approximateCount} approximate`);
  }

  els.roomSummary.textContent = summaryBits.join(" · ");
  if (els.roomVisibilityPill) {
    if (roomVisibility) {
      els.roomVisibilityPill.hidden = false;
      els.roomVisibilityPill.textContent = roomVisibility;
    } else {
      els.roomVisibilityPill.hidden = true;
    }
  }
  if (els.roomContextPill) {
    if (roomContext) {
      els.roomContextPill.hidden = false;
      els.roomContextPill.textContent = roomContext;
    } else {
      els.roomContextPill.hidden = true;
    }
  }
  els.roomCodePill.textContent = `Code ${shareCode}`;
  els.roomRefreshPill.textContent = roomAge == null ? "Waiting for updates" : `Updated ${formatAge(roomAge)}`;

  els.statRiders.textContent = String(riders.length);
  els.statLive.textContent = String(liveCount);
  els.statAttention.textContent = String(lastKnownCount);
  els.statRoomAge.textContent = roomAge == null ? "--" : formatAge(roomAge);

  updateTrailHighlight(room);
  renderField(riders);
  renderRiders(riders);
  updateFollowUi();
}

function renderField(riders) {
  if (!state.map || !state.markerLayer || !state.accuracyLayer) {
    if (els.mapEmpty) {
      els.mapEmpty.hidden = false;
      els.mapEmpty.textContent = "Map is still loading.";
    }
    return;
  }

  state.riderMarkers.clear();
  state.markerLayer.clearLayers();
  state.accuracyLayer.clearLayers();

  if (!riders.length) {
    if (state.followedRiderId) {
      clearFollowMode();
    }
    if (els.mapEmpty) {
      els.mapEmpty.hidden = false;
      els.mapEmpty.textContent = "This room is open, but nobody is sharing a live position yet.";
    }
    centerMapOnRoomFallback();
    return;
  }

  if (els.mapEmpty) {
    els.mapEmpty.hidden = true;
  }
  updateMapNote(riders);

  const bounds = [];

  for (const rider of riders) {
    bounds.push([rider.lat, rider.lon]);
    addAccuracyRing(rider);
    const marker = window.L.marker([rider.lat, rider.lon], {
      icon: window.L.divIcon({
        className: "spectator-map-marker-shell",
        html: `
          <div class="spectator-map-marker spectator-map-marker--${getBadgeTone(rider)}">
            <span class="spectator-map-marker__core"></span>
            <span class="spectator-map-marker__label">${escapeHtml(rider.displayName)}</span>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    });
    marker.on("click", () => {
      focusRider(rider.id, { fromUser: true });
      marker.openTooltip();
    });
    marker.bindTooltip(buildMarkerTooltip(rider), {
      direction: "top",
      offset: [0, -18],
      opacity: 0.96
    });
    marker.bindPopup(buildMarkerPopup(rider), {
      closeButton: false,
      autoPanPadding: [22, 22]
    });
    state.markerLayer.addLayer(marker);
    state.riderMarkers.set(rider.id, marker);
  }

  applyViewportForRiders(riders, bounds);
}

function renderRiders(riders) {
  if (!riders.length) {
    els.ridersList.innerHTML = `
      <article class="support-card">
        <span class="label">No riders</span>
        <h3>Nothing live yet</h3>
        <p>Rider cards will appear here when the room starts sending live positions.</p>
      </article>
    `;
    return;
  }

  els.ridersList.innerHTML = riders.map((rider) => {
    const meta = [];
    meta.push(`<span>${escapeHtml(rider.statusLabel)}</span>`);
    if (typeof rider.ageSeconds === "number") meta.push(`<span>${escapeHtml(formatAge(rider.ageSeconds))}</span>`);
    meta.push(`<span>${escapeHtml(rider.movement)}</span>`);
    if (typeof rider.speedMph === "number") meta.push(`<span>${rider.speedMph} mph</span>`);
    if (rider.accuracyLabel) meta.push(`<span>${escapeHtml(rider.accuracyLabel)}</span>`);
    if (rider.sourceLabel) meta.push(`<span>${escapeHtml(rider.sourceLabel)}</span>`);
    const isActive = rider.id === state.followedRiderId;

    return `
      <article class="spectator-rider ${isActive ? "spectator-rider--active" : ""}">
        <div class="spectator-rider__header">
          <div>
            <p class="label">Presence</p>
            <h3>${escapeHtml(rider.displayName)}</h3>
          </div>
          <span class="spectator-badge spectator-badge--${getBadgeTone(rider)}">${escapeHtml(rider.statusLabel)}</span>
        </div>
        <div class="spectator-rider__meta">
          ${meta.map((item) => `<span class="spectator-meta-pill">${item}</span>`).join("")}
        </div>
        <p class="spectator-rider__note">${escapeHtml(getActionHint(rider))}</p>
        <button class="button button--ghost spectator-rider__follow" type="button" data-follow-rider="${escapeHtml(rider.id)}">${isActive ? "Following rider" : "Follow rider"}</button>
      </article>
    `;
  }).join("");
}

function applyViewportForRiders(riders, bounds) {
  if (state.followedRiderId) {
    const followedRider = riders.find((rider) => rider.id === state.followedRiderId);
    if (followedRider) {
      centerMapOnRider(followedRider, { preserveZoom: true, animate: true });
      return;
    }
    clearFollowMode();
  }

  if (!state.userHasControlledMap && !state.hasAutoFit) {
    fitMapToRiders(bounds);
  }
}

function fitMapToRiders(bounds) {
  if (!state.map || !bounds.length) {
    return;
  }

  const roomFitKey = `${state.roomId}:${bounds.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join("|")}`;
  if (bounds.length === 1) {
    const [lat, lon] = bounds[0];
    runProgrammaticViewportChange(() => {
      state.map.setView([lat, lon], FOLLOW_ZOOM_FLOOR);
    });
    state.lastFittedRoomKey = roomFitKey;
    state.hasAutoFit = true;
    return;
  }

  const leafletBounds = window.L.latLngBounds(bounds);
  runProgrammaticViewportChange(() => {
    state.map.fitBounds(leafletBounds.pad(0.18), {
      padding: [28, 28],
      maxZoom: 16,
      animate: state.lastFittedRoomKey !== roomFitKey
    });
  });
  state.lastFittedRoomKey = roomFitKey;
  state.hasAutoFit = true;
}

function centerMapOnRoomFallback({ force = false } = {}) {
  if (!state.map) {
    return;
  }

  if (!force && (state.userHasControlledMap || state.hasCenteredFallback || state.followedRiderId)) {
    return;
  }

  const lat = Number(state.lastRoomSnapshot?.lastPresenceLat);
  const lon = Number(state.lastRoomSnapshot?.lastPresenceLon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && isValidCoordinate(lat, lon)) {
    runProgrammaticViewportChange(() => {
      state.map.setView([lat, lon], 13);
    });
    state.hasCenteredFallback = true;
    return;
  }

  runProgrammaticViewportChange(() => {
    state.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  });
  state.hasCenteredFallback = true;
}

function fitCurrentRiders({ force = false, fromUser = false } = {}) {
  if (!state.map) {
    return;
  }

  const bounds = state.latestRiders
    .filter((rider) => isValidCoordinate(rider.lat, rider.lon))
    .map((rider) => [rider.lat, rider.lon]);

  if (!bounds.length) {
    if (fromUser) {
      state.userHasControlledMap = true;
    }
    centerMapOnRoomFallback({ force: true });
    return;
  }

  if (force) {
    runProgrammaticViewportChange(() => {
      if (bounds.length === 1) {
        const [lat, lon] = bounds[0];
        state.map.setView([lat, lon], Math.max(state.map.getZoom(), FOLLOW_ZOOM_FLOOR));
      } else {
        state.map.fitBounds(window.L.latLngBounds(bounds).pad(0.18), {
          padding: [28, 28],
          maxZoom: 16,
          animate: true
        });
      }
    });
    if (fromUser) {
      state.userHasControlledMap = true;
    }
    return;
  }

  fitMapToRiders(bounds);
}

function focusRider(riderId, { fromUser = false } = {}) {
  const rider = state.latestRiders.find((entry) => entry.id === riderId);
  if (!rider || !state.map) {
    return;
  }

  state.followedRiderId = rider.id;
  state.followedRiderName = rider.displayName;
  if (fromUser) {
    state.userHasControlledMap = true;
  }

  centerMapOnRider(rider, {
    preserveZoom: false,
    animate: true
  });
  renderRiders(state.latestRiders);
  updateFollowUi();
  state.riderMarkers.get(rider.id)?.openTooltip();
}

function centerMapOnRider(rider, { preserveZoom = true, animate = true } = {}) {
  if (!state.map) {
    return;
  }

  const currentZoom = state.map.getZoom();
  const nextZoom = preserveZoom
    ? currentZoom
    : Math.max(currentZoom, FOLLOW_ZOOM_FLOOR);

  runProgrammaticViewportChange(() => {
    state.map.setView([rider.lat, rider.lon], nextZoom, { animate });
  });
}

function clearFollowMode() {
  state.followedRiderId = null;
  state.followedRiderName = "";
  renderRiders(state.latestRiders);
  updateFollowUi();
}

function updateFollowUi() {
  if (els.followPill) {
    if (state.followedRiderId) {
      els.followPill.hidden = false;
      els.followPill.textContent = `Following ${state.followedRiderName}`;
    } else {
      els.followPill.hidden = true;
    }
  }

  if (els.clearFollow) {
    els.clearFollow.hidden = !state.followedRiderId;
  }
}

function buildMarkerTooltip(rider) {
  const bits = [escapeHtml(rider.displayName), escapeHtml(rider.statusLabel)];
  if (typeof rider.speedMph === "number") {
    bits.push(`${rider.speedMph} mph`);
  }
  if (rider.accuracyLabel) {
    bits.push(escapeHtml(rider.accuracyLabel));
  }
  if (typeof rider.ageSeconds === "number") {
    bits.push(formatAge(rider.ageSeconds));
  }
  return bits.join(" · ");
}

function buildMarkerPopup(rider) {
  const lines = [];
  lines.push(`<strong>${escapeHtml(rider.displayName)}</strong>`);
  lines.push(escapeHtml(rider.statusLabel));
  if (rider.accuracyLabel) {
    lines.push(escapeHtml(rider.accuracyLabel));
  }
  if (rider.sourceLabel) {
    lines.push(escapeHtml(rider.sourceLabel));
  }
  if (typeof rider.speedMph === "number") {
    lines.push(`${rider.speedMph} mph`);
  }
  return lines.join(" · ");
}

function addAccuracyRing(rider) {
  if (!state.accuracyLayer || typeof rider.gpsAccuracyMeters !== "number") {
    return;
  }

  const radius = clampAccuracyRingMeters(rider.gpsAccuracyMeters);
  const style = getAccuracyRingStyle(rider.accuracyTone);

  const ring = window.L.circle([rider.lat, rider.lon], {
    radius,
    color: style.stroke,
    weight: 1.2,
    opacity: style.strokeOpacity,
    fillColor: style.fill,
    fillOpacity: style.fillOpacity,
    interactive: false
  });
  state.accuracyLayer.addLayer(ring);
}

function updateMapNote(riders) {
  if (!els.mapNote) {
    return;
  }

  const approximateCount = riders.filter((rider) => rider.accuracyTone === "rough" || rider.accuracyTone === "approx").length;
  const phoneFallbackCount = riders.filter((rider) => rider.sourceLabel === "Phone fallback").length;

  if (approximateCount > 0) {
    els.mapNote.hidden = false;
    els.mapNote.textContent = `${approximateCount} rider${approximateCount === 1 ? " is" : "s are"} on rough GPS right now, so dots can drift off the road or trail.`;
    return;
  }

  if (phoneFallbackCount > 0) {
    els.mapNote.hidden = false;
    els.mapNote.textContent = `Some riders are coming through on phone fallback. The map is showing raw room GPS, not road snapping.`;
    return;
  }

  els.mapNote.hidden = false;
  els.mapNote.textContent = "Map view shows raw rider GPS from the room. It does not snap riders to roads or trails.";
}

function getRoomVisibilityLabel(room) {
  const rawVisibility = typeof room.visibility === "string"
    ? room.visibility.trim().toLowerCase()
    : typeof room.spectatorVisibility === "string"
      ? room.spectatorVisibility.trim().toLowerCase()
      : null;

  if (rawVisibility === "public") return "Public Room";
  if (rawVisibility === "private") return "Private Room";
  if (typeof room.isPublic === "boolean") return room.isPublic ? "Public Room" : "Private Room";
  return null;
}

function getRoomContextLabel(room) {
  const trailName = typeof room.trailName === "string" ? room.trailName.trim() : "";
  if (trailName) {
    return trailName;
  }

  const trailId = typeof room.trailID === "string"
    ? room.trailID.trim()
    : typeof room.trailId === "string"
      ? room.trailId.trim()
      : "";
  if (trailId) {
    return "Trail linked";
  }

  return null;
}

function getRequestedCode() {
  const params = new URLSearchParams(window.location.search);
  const direct = params.get("code") ?? params.get("room") ?? "";
  if (direct.trim()) {
    return direct.trim();
  }

  const segments = window.location.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";

  if (last && last.toLowerCase() !== "live" && last.toLowerCase() !== "join") {
    return last;
  }

  return "";
}

function normalizeCode(raw) {
  return raw.trim().toUpperCase().replace(/[-\s]/g, "");
}

function millisToDate(value) {
  if (typeof value !== "number") {
    return null;
  }

  return new Date(value);
}

function getPresenceTimestamp(presence) {
  if (presence.updatedAt instanceof Date) {
    return presence.updatedAt;
  }

  return millisToDate(presence.clientUpdatedAtMs) ?? null;
}

function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
}

function isRenderablePresence(presence) {
  return presence
    && typeof presence.displayName === "string"
    && typeof presence.lat === "number"
    && typeof presence.lon === "number"
    && isValidCoordinate(presence.lat, presence.lon);
}

function getRoomAge(room) {
  const candidates = [];
  if (room.lastPresenceAt instanceof Date) candidates.push(room.lastPresenceAt.getTime());
  if (typeof room.lastPresenceClientAtMs === "number") candidates.push(room.lastPresenceClientAtMs);
  if (!candidates.length) return null;
  return Math.max(0, (Date.now() - Math.max(...candidates)) / 1000);
}

function isRoomActive(room) {
  return Boolean(room) && room.active !== false && !isRoomStale(room);
}

function isRoomStale(room) {
  const roomAge = getRoomAge(room);
  return roomAge != null && roomAge > STALE_ROOM_SECONDS;
}

function getFreshness(ageSeconds) {
  if (ageSeconds == null) return "unknown";
  if (ageSeconds < 2) return "live";
  if (ageSeconds < 8) return "weak";
  if (ageSeconds < 45) return "last";
  return "offline";
}

function getMovementLabel(speedMps, freshness) {
  if (typeof speedMps !== "number") {
    if (freshness === "offline") return "Offline";
    if (freshness === "last") return "Last known";
    return "No speed yet";
  }

  if (speedMps < 0.8) return "Stopped";
  if (speedMps < 3) return "Rolling";
  return "Moving";
}

function normalizeCrashState(value) {
  if (value === "confirmed" || value === "suspected") {
    return value;
  }

  return "none";
}

function getStatusLabel(crashState, freshness) {
  if (crashState === "confirmed") return "Alert";
  if (crashState === "suspected") return "Check";
  if (freshness === "live") return "Live";
  if (freshness === "weak") return "Recent";
  if (freshness === "last") return "Last known";
  if (freshness === "offline") return "Offline";
  return "Unknown";
}

function getPriorityRank(crashState, freshness) {
  if (crashState === "confirmed") return 0;
  if (crashState === "suspected") return 1;
  if (freshness === "live") return 2;
  if (freshness === "weak") return 3;
  if (freshness === "last") return 4;
  if (freshness === "offline") return 5;
  return 6;
}

function getBadgeTone(rider) {
  if (rider.crashState === "confirmed") return "alert";
  if (rider.crashState === "suspected") return "check";
  if (rider.freshness === "live") return "live";
  if (rider.freshness === "weak") return "weak";
  if (rider.freshness === "last") return "warn";
  return "idle";
}

function getActionHint(rider) {
  if (rider.crashState === "confirmed") {
    return `Keep ${rider.displayName} in view and treat this as the rider to watch right now.`;
  }
  if (rider.crashState === "suspected") {
    return `Keep an eye on ${rider.displayName} and watch for the next live update.`;
  }
  if (rider.accuracyTone === "approx") {
    return `${rider.displayName}'s GPS is rough right now, so this marker is only an approximate spot.`;
  }
  if (rider.accuracyTone === "rough") {
    return `${rider.displayName} is live, but the GPS fix is loose enough to drift off the road or trail.`;
  }
  if (rider.freshness === "last") {
    return `Showing ${rider.displayName}'s last known spot until new updates come in.`;
  }
  if (rider.freshness === "offline") {
    return `${rider.displayName} has not checked in for a bit, so this map is showing the last known spot.`;
  }
  if (typeof rider.speedMph !== "number") {
    return "Location is coming through. Speed is not available right now.";
  }
  return "Live position is updating normally.";
}

function formatAge(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s ago`;
  const minutes = Math.round(rounded / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function parseAccuracyMeters(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function getAccuracyTone(accuracyMeters) {
  if (typeof accuracyMeters !== "number") {
    return "unknown";
  }
  if (accuracyMeters <= 12) {
    return "tight";
  }
  if (accuracyMeters <= 25) {
    return "good";
  }
  if (accuracyMeters <= 45) {
    return "rough";
  }
  return "approx";
}

function getAccuracyLabel(accuracyMeters) {
  if (typeof accuracyMeters !== "number") {
    return "";
  }

  const rounded = Math.round(accuracyMeters);
  const tone = getAccuracyTone(accuracyMeters);
  if (tone === "tight") return `${rounded}m GPS`;
  if (tone === "good") return `${rounded}m GPS`;
  if (tone === "rough") return `${rounded}m GPS rough`;
  return `${rounded}m GPS approximate`;
}

function clampAccuracyRingMeters(accuracyMeters) {
  return Math.max(8, Math.min(accuracyMeters, 120));
}

function getAccuracyRingStyle(tone) {
  if (tone === "tight") {
    return {
      stroke: "rgba(123, 230, 194, 0.95)",
      strokeOpacity: 0.92,
      fill: "rgba(123, 230, 194, 0.22)",
      fillOpacity: 0.18
    };
  }
  if (tone === "good") {
    return {
      stroke: "rgba(244, 209, 123, 0.9)",
      strokeOpacity: 0.86,
      fill: "rgba(244, 209, 123, 0.18)",
      fillOpacity: 0.14
    };
  }
  if (tone === "rough") {
    return {
      stroke: "rgba(239, 179, 106, 0.88)",
      strokeOpacity: 0.82,
      fill: "rgba(239, 179, 106, 0.16)",
      fillOpacity: 0.12
    };
  }
  return {
    stroke: "rgba(255, 128, 112, 0.84)",
    strokeOpacity: 0.76,
    fill: "rgba(255, 128, 112, 0.14)",
    fillOpacity: 0.1
  };
}

function getSourceLabel(liveSource, publishPath) {
  const normalizedPath = typeof publishPath === "string" ? publishPath.trim() : "";
  const normalizedSource = typeof liveSource === "string" ? liveSource.trim().toLowerCase() : "";

  if (normalizedPath === "phoneFallback") {
    return "Phone fallback";
  }
  if (normalizedPath === "watchBridge") {
    return "Watch bridge";
  }
  if (normalizedPath === "phoneDirect") {
    return "Phone source";
  }
  if (normalizedSource === "watch") {
    return "Watch source";
  }
  if (normalizedSource === "phone") {
    return "Phone source";
  }
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

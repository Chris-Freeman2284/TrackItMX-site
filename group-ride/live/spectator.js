const PROJECT_ID = "trackitmx-c5656";
const POLL_MS = 5000;
const STALE_ROOM_SECONDS = 600;
const AUTH_STORAGE_KEY = "trackitmx_spectator_auth_v1";
const FIREBASE_WEB_API_KEY = String(window.TRACKITMX_RUNTIME?.firebaseWebApiKey || "").trim();

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
  roomCodePill: document.getElementById("room-code-pill"),
  roomRefreshPill: document.getElementById("room-refresh-pill"),
  statRiders: document.getElementById("stat-riders"),
  statLive: document.getElementById("stat-live"),
  statAttention: document.getElementById("stat-attention"),
  statRoomAge: document.getElementById("stat-room-age"),
  field: document.getElementById("spectator-field"),
  mapEmpty: document.getElementById("spectator-map-empty"),
  ridersList: document.getElementById("spectator-riders-list")
};

const state = {
  idToken: null,
  tokenExpiresAt: 0,
  roomId: null,
  shareCode: null,
  pollHandle: null,
  loading: false,
  map: null,
  markerLayer: null,
  mapAssetsPromise: null,
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
    setStatus("Enter a room code to open the spectator view.", "idle");
    return;
  }

  stopPolling();
  hideLiveRoom();
  setStatus("Connecting to TrackItMX live room…", "loading");

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
      els.mapEmpty.textContent = "Loading live map…";
    }
    try {
      await ensureMapReady();
      if (els.mapEmpty) {
        els.mapEmpty.hidden = false;
        els.mapEmpty.textContent = "Waiting for live rider positions…";
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
  state.lastFittedRoomKey = null;
  state.lastRoomSnapshot = null;

  if (els.input) {
    els.input.value = "";
  }

  clearUrlCode();
  hideLiveRoom();
  showEntry();
  window.scrollTo({ top: 0, behavior: "smooth" });
  setStatus("Left the room. Enter a code to open another spectator view.", "idle");
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

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);

  state.markerLayer = window.L.layerGroup().addTo(state.map);
  state.map.setView([39.8283, -98.5795], 4);
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
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
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
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.crossOrigin = "";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the live map."));
    document.head.appendChild(script);
  });
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
  const movement = getMovementLabel(speedMps, freshness);

  return {
    ...presence,
    displayName: (presence.displayName || "Rider").trim() || "Rider",
    speedMps,
    effectiveUpdatedAt,
    ageSeconds,
    freshness,
    crashState,
    movement,
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
  const liveCount = riders.filter((rider) => rider.freshness === "live").length;
  const weakCount = riders.filter((rider) => rider.freshness === "weak").length;
  const fadingCount = riders.filter((rider) => rider.freshness === "last" || rider.freshness === "offline").length;
  const roomAge = getRoomAge(room);
  const displayTitle = (room.title || "").trim() || `Room ${room.shareCode || state.shareCode || room.id}`;
  const shareCode = room.shareCode || state.shareCode || room.id;

  els.roomTitle.textContent = displayTitle;
  const summaryBits = [
    `${riders.length} rider${riders.length === 1 ? "" : "s"} visible`,
    `${liveCount} live`,
    `${weakCount} weak`
  ];

  if (fadingCount > 0) {
    summaryBits.push(`${fadingCount} fading`);
  }

  els.roomSummary.textContent = summaryBits.join(" · ");
  els.roomCodePill.textContent = `Code ${shareCode}`;
  els.roomRefreshPill.textContent = roomAge == null ? "Waiting for updates" : `Room updated ${formatAge(roomAge)}`;

  els.statRiders.textContent = String(riders.length);
  els.statLive.textContent = String(liveCount);
  els.statAttention.textContent = String(fadingCount);
  els.statRoomAge.textContent = roomAge == null ? "--" : formatAge(roomAge);

  renderField(riders);
  renderRiders(riders);
}

function renderField(riders) {
  if (!state.map || !state.markerLayer) {
    if (els.mapEmpty) {
      els.mapEmpty.hidden = false;
      els.mapEmpty.textContent = "Live map is still loading.";
    }
    return;
  }

  state.markerLayer.clearLayers();

  if (!riders.length) {
    if (els.mapEmpty) {
      els.mapEmpty.hidden = false;
      els.mapEmpty.textContent = "No riders are publishing live data in this room yet.";
    }
    centerMapOnRoomFallback();
    return;
  }

  if (els.mapEmpty) {
    els.mapEmpty.hidden = true;
  }

  const bounds = [];

  for (const rider of riders) {
    bounds.push([rider.lat, rider.lon]);
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
    marker.bindTooltip(buildMarkerTooltip(rider), {
      direction: "top",
      offset: [0, -18],
      opacity: 0.96
    });
    state.markerLayer.addLayer(marker);
  }

  fitMapToRiders(bounds);
}

function renderRiders(riders) {
  if (!riders.length) {
    els.ridersList.innerHTML = `
      <article class="support-card">
        <span class="label">No riders</span>
        <h3>Nothing live yet</h3>
        <p>Rider cards will appear here once the room receives live presence updates.</p>
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

    return `
      <article class="spectator-rider">
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
      </article>
    `;
  }).join("");
}

function fitMapToRiders(bounds) {
  if (!state.map || !bounds.length) {
    return;
  }

  const roomFitKey = `${state.roomId}:${bounds.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join("|")}`;
  if (bounds.length === 1) {
    const [lat, lon] = bounds[0];
    state.map.setView([lat, lon], 15);
    state.lastFittedRoomKey = roomFitKey;
    return;
  }

  const leafletBounds = window.L.latLngBounds(bounds);
  state.map.fitBounds(leafletBounds.pad(0.18), {
    padding: [28, 28],
    maxZoom: 16,
    animate: state.lastFittedRoomKey !== roomFitKey
  });
  state.lastFittedRoomKey = roomFitKey;
}

function centerMapOnRoomFallback() {
  if (!state.map) {
    return;
  }

  const lat = Number(state.lastRoomSnapshot?.lastPresenceLat);
  const lon = Number(state.lastRoomSnapshot?.lastPresenceLon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && isValidCoordinate(lat, lon)) {
    state.map.setView([lat, lon], 13);
    return;
  }

  state.map.setView([39.8283, -98.5795], 4);
}

function buildMarkerTooltip(rider) {
  const bits = [escapeHtml(rider.displayName), escapeHtml(rider.statusLabel)];
  if (typeof rider.speedMph === "number") {
    bits.push(`${rider.speedMph} mph`);
  }
  if (typeof rider.ageSeconds === "number") {
    bits.push(formatAge(rider.ageSeconds));
  }
  return bits.join(" · ");
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
    if (freshness === "last") return "Last Known";
    return "No Speed";
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
  if (freshness === "weak") return "Weak";
  if (freshness === "last") return "Last";
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
    return `Keep ${rider.displayName} centered and treat this as an active alert until the room settles.`;
  }
  if (rider.crashState === "suspected") {
    return `Check ${rider.displayName} now and confirm whether this is a real down event or a false spike.`;
  }
  if (rider.freshness === "last") {
    return "This rider is on a last-known position. Treat it as a breadcrumb until fresher updates return.";
  }
  if (rider.freshness === "offline") {
    return "Signal freshness is slipping. Treat the last known position carefully until updates return.";
  }
  if (typeof rider.speedMph !== "number") {
    return "Location is coming through, but this rider is not publishing speed right now.";
  }
  return "Signals look stable right now.";
}

function formatAge(seconds) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s ago`;
  const minutes = Math.round(rounded / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

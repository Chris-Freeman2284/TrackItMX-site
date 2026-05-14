const PROJECT_ID = "trackitmx-c5656";
const POLL_MS = 5000;
const STALE_ROOM_SECONDS = 600;
const AUTH_STORAGE_KEY = "trackitmx_spectator_auth_v1";
const FIREBASE_WEB_API_KEY = String(window.TRACKITMX_RUNTIME?.firebaseWebApiKey || "").trim();

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const els = {
  form: document.getElementById("spectator-form"),
  input: document.getElementById("room-code"),
  status: document.getElementById("spectator-status"),
  live: document.getElementById("spectator-live"),
  roomTitle: document.getElementById("room-title"),
  roomSummary: document.getElementById("room-summary"),
  roomCodePill: document.getElementById("room-code-pill"),
  roomRefreshPill: document.getElementById("room-refresh-pill"),
  statRiders: document.getElementById("stat-riders"),
  statLive: document.getElementById("stat-live"),
  statAttention: document.getElementById("stat-attention"),
  statRoomAge: document.getElementById("stat-room-age"),
  field: document.getElementById("spectator-field"),
  ridersList: document.getElementById("spectator-riders-list")
};

const state = {
  idToken: null,
  tokenExpiresAt: 0,
  roomId: null,
  shareCode: null,
  pollHandle: null,
  loading: false
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

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.roomId) {
      void refreshRoom();
    }
  });

  const initialCode = new URLSearchParams(window.location.search).get("code") ?? "";
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
    if (!room || !room.active || isRoomStale(room)) {
      throw new Error("This room is no longer active.");
    }

    const riders = await fetchPresence(room.id);
    renderRoom(room, riders);
    setStatus(`Watching ${riders.length} rider${riders.length === 1 ? "" : "s"} live.`, "success");
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
}

function syncUrl(code) {
  if (!code) {
    return;
  }

  const next = new URL(window.location.href);
  next.searchParams.set("code", code);
  window.history.replaceState({}, "", next.toString());
}

function setStatus(message, tone) {
  if (!els.status) {
    return;
  }

  els.status.textContent = message;
  els.status.dataset.tone = tone;
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
    if (exactRoom?.active && !isRoomStale(exactRoom)) {
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
    .filter((room) => room?.active && !isRoomStale(room));

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
    .filter((presence) => presence?.lat != null && presence?.lon != null)
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
  const effectiveUpdatedAt = presence.updatedAt ?? millisToDate(presence.clientUpdatedAtMs) ?? null;
  const ageSeconds = effectiveUpdatedAt ? (Date.now() - effectiveUpdatedAt.getTime()) / 1000 : null;
  const freshness = getFreshness(ageSeconds);
  const crashState = presence.crashState || "none";
  const avgHeartRate = typeof presence.avgHeartRate === "number" ? presence.avgHeartRate : null;
  const healthAge = presence.healthUpdatedAt instanceof Date ? (Date.now() - presence.healthUpdatedAt.getTime()) / 1000 : null;
  const hasStaleHealth = healthAge != null && healthAge > 15;
  const hasElevatedEffort = avgHeartRate != null && avgHeartRate >= 175;
  const movement = getMovementLabel(presence.speedMps, freshness, presence.activityStatus);

  return {
    ...presence,
    displayName: (presence.displayName || "Rider").trim() || "Rider",
    effectiveUpdatedAt,
    ageSeconds,
    freshness,
    crashState,
    avgHeartRate,
    hasStaleHealth,
    hasElevatedEffort,
    hasAttention: crashState !== "none" || hasStaleHealth || hasElevatedEffort,
    movement,
    statusLabel: getStatusLabel(crashState, hasStaleHealth, hasElevatedEffort, freshness),
    priorityRank: getPriorityRank(crashState, hasStaleHealth, hasElevatedEffort, freshness, presence.activityStatus),
    recordingLabel: typeof presence.isRecording === "boolean" ? (presence.isRecording ? "REC" : "IDLE") : null,
    speedMph: typeof presence.speedMps === "number" ? Math.round(presence.speedMps * 2.23694) : null
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
  const liveCount = riders.filter((rider) => rider.freshness === "live" || rider.freshness === "weak").length;
  const attentionCount = riders.filter((rider) => rider.hasAttention).length;
  const roomAge = getRoomAge(room);
  const displayTitle = (room.title || "").trim() || `Room ${room.shareCode || state.shareCode || room.id}`;
  const shareCode = room.shareCode || state.shareCode || room.id;

  els.roomTitle.textContent = displayTitle;
  els.roomSummary.textContent = `${riders.length} rider${riders.length === 1 ? "" : "s"} visible · ${liveCount} live now · ${attentionCount} attention`;
  els.roomCodePill.textContent = `Code ${shareCode}`;
  els.roomRefreshPill.textContent = roomAge == null ? "Waiting for updates" : `Room updated ${formatAge(roomAge)}`;

  els.statRiders.textContent = String(riders.length);
  els.statLive.textContent = String(liveCount);
  els.statAttention.textContent = String(attentionCount);
  els.statRoomAge.textContent = roomAge == null ? "--" : formatAge(roomAge);

  renderField(riders);
  renderRiders(riders);
}

function renderField(riders) {
  els.field.innerHTML = "";

  if (!riders.length) {
    els.field.innerHTML = '<div class="spectator-field__empty">No riders are publishing live data in this room yet.</div>';
    return;
  }

  const points = projectRiders(riders);

  for (const rider of points) {
    const dot = document.createElement("div");
    dot.className = `spectator-dot spectator-dot--${rider.dotTone}`;
    dot.style.left = `${rider.x}%`;
    dot.style.top = `${rider.y}%`;
    dot.innerHTML = `
      <span class="spectator-dot__core"></span>
      <span class="spectator-dot__label">${escapeHtml(rider.displayName)}</span>
    `;
    els.field.appendChild(dot);
  }
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
    meta.push(`<span>${escapeHtml(rider.movement)}</span>`);
    meta.push(`<span>${escapeHtml(rider.statusLabel)}</span>`);
    if (typeof rider.speedMph === "number") meta.push(`<span>${rider.speedMph} mph</span>`);
    if (typeof rider.avgHeartRate === "number") meta.push(`<span>${Math.round(rider.avgHeartRate)} bpm</span>`);
    if (rider.liveSource) meta.push(`<span>${escapeHtml(String(rider.liveSource).toUpperCase())}</span>`);
    if (rider.recordingLabel) meta.push(`<span>${escapeHtml(rider.recordingLabel)}</span>`);

    return `
      <article class="spectator-rider">
        <div class="spectator-rider__header">
          <div>
            <p class="label">${escapeHtml(rider.activityStatus || "riding")}</p>
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

function projectRiders(riders) {
  if (riders.length === 1) {
    return [{
      ...riders[0],
      x: 50,
      y: 50,
      dotTone: getBadgeTone(riders[0])
    }];
  }

  const lats = riders.map((rider) => rider.lat);
  const lons = riders.map((rider) => rider.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = Math.max(0.0002, maxLat - minLat);
  const lonSpan = Math.max(0.0002, maxLon - minLon);

  return riders.map((rider) => {
    const x = 12 + (((rider.lon - minLon) / lonSpan) * 76);
    const y = 12 + (((maxLat - rider.lat) / latSpan) * 76);
    return {
      ...rider,
      x,
      y,
      dotTone: getBadgeTone(rider)
    };
  });
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

function getRoomAge(room) {
  const candidates = [];
  if (room.lastPresenceAt instanceof Date) candidates.push(room.lastPresenceAt.getTime());
  if (typeof room.lastPresenceClientAtMs === "number") candidates.push(room.lastPresenceClientAtMs);
  if (!candidates.length) return null;
  return Math.max(0, (Date.now() - Math.max(...candidates)) / 1000);
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

function getMovementLabel(speedMps, freshness, activityStatus) {
  if (activityStatus === "pit") {
    return "Pit";
  }

  if (typeof speedMps !== "number") {
    if (freshness === "offline") return "Offline";
    if (freshness === "last") return "Last Known";
    return "No Speed";
  }

  if (speedMps < 0.8) return "Stopped";
  if (speedMps < 3) return "Rolling";
  return "Moving";
}

function getStatusLabel(crashState, hasStaleHealth, hasElevatedEffort, freshness) {
  if (crashState === "confirmed") return "Alert";
  if (crashState === "suspected") return "Check";
  if (hasStaleHealth) return "Stale";
  if (hasElevatedEffort) return "Effort";
  if (freshness === "live") return "Live";
  if (freshness === "weak") return "Weak";
  if (freshness === "last") return "Last";
  if (freshness === "offline") return "Offline";
  return "Unknown";
}

function getPriorityRank(crashState, hasStaleHealth, hasElevatedEffort, freshness, activityStatus) {
  if (crashState === "confirmed") return 0;
  if (crashState === "suspected") return 1;
  if (hasStaleHealth) return 2;
  if (hasElevatedEffort) return 3;
  if (activityStatus === "pit") return 4;
  if (freshness === "live") return 5;
  if (freshness === "weak") return 6;
  if (freshness === "last" || freshness === "offline") return 7;
  return 8;
}

function getBadgeTone(rider) {
  if (rider.crashState === "confirmed") return "alert";
  if (rider.crashState === "suspected") return "check";
  if (rider.hasAttention) return "warn";
  if (rider.freshness === "live") return "live";
  if (rider.freshness === "weak") return "weak";
  return "idle";
}

function getActionHint(rider) {
  if (rider.crashState === "confirmed") {
    return `Keep ${rider.displayName} centered and treat this as an active alert until the room settles.`;
  }
  if (rider.crashState === "suspected") {
    return `Check ${rider.displayName} now and confirm whether this is a real down event or a false spike.`;
  }
  if (rider.hasStaleHealth) {
    return "Biometric signal is stale. Use movement and live location as the safer truth for now.";
  }
  if (rider.hasElevatedEffort) {
    return "Effort is elevated. This is a monitor condition, not an automatic emergency.";
  }
  if (rider.freshness === "last" || rider.freshness === "offline") {
    return "Signal freshness is slipping. Treat the last known position carefully until updates return.";
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

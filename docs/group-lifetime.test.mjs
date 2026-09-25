import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../group-ride/live/spectator.js', import.meta.url), 'utf8');
const begin = source.indexOf('function isRoomActive(');
const end = source.indexOf('function getFreshness(', begin);
const now = Date.now(), hour = 3600000;
class Clock extends Date { static now() { return now; } }
const active = runInNewContext('const STALE_ROOM_SECONDS=10800, MAX_ROOM_MS=86400000;\n' + source.slice(begin, end) + '\nisRoomActive', { Date: Clock });
const room = (extra = {}) => ({ active: true, createdAt: new Clock(now - hour), expiresAt: new Clock(now + 23 * hour), ...extra });
test('spectator remains available through signal gaps but closes at three hours of rider inactivity', () => {
  assert(active(room({ lastPresenceAt: new Clock(now - 20 * 60000) })));
  assert(!active(room({ createdAt: new Clock(now - 3 * hour), lastPresenceAt: new Clock(now) })));
  assert(active(room({ createdAt: new Clock(now - 4 * hour), lastMemberActivityAt: new Clock(now) })));
});
test('spectator honors fixed 24 hours, explicit closure, and malformed/expired lifetimes', () => {
  assert(!active(room({ createdAt: new Clock(now - 24 * hour), expiresAt: new Clock(now + 24 * hour), lastMemberActivityAt: new Clock(now) })));
  assert(!active(room({ active: false })));
  assert(!active(room({ endedAt: new Clock(now) })));
  assert(!active(room({ expiresAt: new Clock(now) })));
  assert(!active(room({ createdAt: null })));
});

test('expired live viewer returns to entry and stops polling without requesting rider locations', async () => {
  let left = 0, fetched = 0, message;
  const state = { roomId: 'expired', loading: false };
  const start = source.indexOf('async function refreshRoom('), end = source.indexOf('function schedulePoll(', start);
  const refresh = runInNewContext(source.slice(start, end) + '\nrefreshRoom', {
    state, isPublicActiveRoom: () => false, fetchRoomById: async () => ({ active: false }),
    leaveRoom: () => { left++; state.roomId = null; },
    setStatus: text => { message = text; }, fetchPresence: async () => { fetched++; return []; }
  });
  await refresh();
  assert.equal(left,1); assert.equal(fetched,0); assert.equal(state.roomId,null);
  assert.match(message,/ended/);
});

import assert from 'node:assert/strict';
import { prepareReplay, replayFrame, replaySegments, replayPieces, visibleReplayPiece, replayLapAt, replayLapColor, ReplayClock } from '../ride/replay.js';
let checks = 0;
function check(value) { checks++; assert.ok(value); }
const raw = {version:1,durationSeconds:100,points:[
  {lat:40,lon:-80,t:0,segment:0}, {lat:40.001,lon:-80,t:10,segment:0},
  {lat:40.003,lon:-80,t:90,segment:1}, {lat:40.004,lon:-80,t:100,segment:1}
]};
const timeline = prepareReplay(raw, [], 100);
check(timeline.recorded);
check(Math.abs(replayFrame(timeline, 5).point.lat - 40.0005) < 1e-8);
check(replayFrame(timeline, 50).gap && replayFrame(timeline, 50).point === null);
check(replayFrame(timeline, 90).point.lat === 40.003);
check(replayFrame(timeline, 100).point.lat === 40.004);
check(replaySegments(timeline.points).length === 2);
check(prepareReplay({...raw, points:[...raw.points].reverse()}, [], 100) === null);
check(prepareReplay({...raw, points:[{...raw.points[0],lat:NaN}, ...raw.points.slice(1)]}, [], 100) === null);
check(prepareReplay({...raw, points:Array(901).fill(raw.points[0])}, [], 100) === null);
check(prepareReplay({...raw, durationSeconds:Infinity}, [], 100) === null);
check(prepareReplay({...raw, points:raw.points.map(p=>({...p,segment:-1}))}, [], 100) === null);
const late = prepareReplay({...raw, durationSeconds:110}, [], 110);
check(replayFrame(late,105).gap);
const early = prepareReplay({...raw, points:raw.points.slice(1)}, [], 100);
check(replayFrame(early,0).gap);
const legacy = prepareReplay(null, [{lat:0,lon:0},{lat:0,lon:1},{lat:0,lon:3}], 90);
check(!legacy.recorded && Math.abs(legacy.points[1].t-30)<1e-8);
check(!replayFrame(legacy,90).gap);
check(prepareReplay(null, [], 0) === null);
const dateline = prepareReplay({version:1,durationSeconds:10,points:[{lat:0,lon:179,t:0,segment:0},{lat:0,lon:-179,t:10,segment:0}]},[],10);
check(Math.abs(replayFrame(dateline,5).point.lon)===180);
check(replaySegments(dateline.points)[0][1][1] === 181);
const clock = new ReplayClock(100);
clock.play(1000); check(clock.position(2000)===1);
clock.setRate(2,2000); check(clock.position(4000)===5);
clock.pause(4000); check(clock.position(500000)===5);
clock.seek(50,5000); clock.play(5000); check(clock.position(6000)===52);
clock.setRate(7,6000); check(clock.rate===2);
clock.pause(100000); check(clock.elapsed===100);
clock.play(101000); check(clock.position(101000)===0);
const lapped = prepareReplay({...raw,laps:[{number:1,start:0,end:5},{number:2,start:5,end:95}]},[],100);
const pieces = replayPieces(lapped);
check(pieces.length === 4);
check(pieces[0].points.at(-1).t === 5 && pieces[1].points[0].t === 5);
check(pieces[0].lap === 1 && pieces[1].lap === 2 && pieces.at(-1).lap === null);
check(replayLapAt(lapped,5) === 2 && replayLapAt(lapped,96) === null);
check(replayLapColor(1) !== replayLapColor(2));
check(pieces.every(piece => visibleReplayPiece(piece, replayFrame(lapped,0)).length === 0));
const halfway = pieces.flatMap(piece => visibleReplayPiece(piece,replayFrame(lapped,4)));
check(halfway.length === 2 && halfway.at(-1).t === 4);
check(pieces.flatMap(piece => visibleReplayPiece(piece,replayFrame(lapped,50))).every(p => p.t <= 10));
check(pieces.every(piece => piece.points.every(p => p.segment === piece.points[0].segment)));
const gapLap = prepareReplay({...raw,laps:[{number:1,start:0,end:50},{number:2,start:50,end:100}]},[],100);
check(!replayPieces(gapLap).some(piece => piece.points.some(p => p.t === 50)));
check(replayLapAt(gapLap,100) === 2);
check(replayPieces(legacy).every(piece => piece.lap === null));
check(replayPieces(timeline).every(piece => piece.lap === null));
for (const laps of [null, [{number:0,start:0,end:2}], [{number:1,start:0,end:101}],
  [{number:1,start:2,end:2}], [{number:1,start:0,end:NaN}],
  [{number:1,start:0,end:20},{number:2,start:19,end:30}], Array(257).fill({number:1,start:0,end:1})]) {
  check(prepareReplay({...raw,laps},[],100).laps.length === 0);
}
// Seeking backwards/restarting never leaves a later lap on the map.
const endFrame = replayFrame(lapped,100), restartFrame = replayFrame(lapped,0);
check(pieces.flatMap(piece => visibleReplayPiece(piece,endFrame)).length > 0);
check(pieces.flatMap(piece => visibleReplayPiece(piece,restartFrame)).length === 0);
console.log(`PASS: ${checks} web replay timing, gap, parsing and playback checks`);

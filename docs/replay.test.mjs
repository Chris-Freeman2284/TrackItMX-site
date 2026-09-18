import assert from 'node:assert/strict';
import { prepareReplay, replayFrame, replaySegments, ReplayClock } from '../ride/replay.js';
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
console.log(`PASS: ${checks} web replay timing, gap, parsing and playback checks`);

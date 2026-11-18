/**
 * 현실 지구 성능 측정(§15): 월 갱신 시간·초기 로딩(세계 조립·경제 준비)을 잰다.
 *   npx tsx scripts/perf-earth.ts [--months 12] [--scope core|full]
 * 결과는 Node(이 컴퓨터)의 값이다. 브라우저·기기별 값은 화면에서 따로 잰다.
 */
import { buildEarth } from '../src/sim/earth/buildEarth';
import { earthDefinitions, type EarthScope } from '../src/sim/earth/definitions';
import { buildEarthProfile } from '../src/sim/earth/profile';
import { buildEconomyData } from '../src/sim/economy/data';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import { npcStats } from '../src/sim/economy/npc';
import { loadEarthSources } from './earthSources';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : fallback;
};
const months = Number(value('--months', '12'));
const scope = value('--scope', 'full') as EarthScope;

const defs = earthDefinitions(scope);
let t = performance.now();
const src = loadEarthSources();
const { world } = buildEarth(src, defs);
const tBuild = performance.now() - t;
t = performance.now();
const data = buildEconomyData(buildEarthProfile(defs));
let { ctx, state } = createGame(world, data, 'earth-1');
const tGame = performance.now() - t;
const times: number[] = [];
npcStats.arrivals = 0;
npcStats.plans = 0;
for (let m = 0; m < months; m++) {
  t = performance.now();
  state = stepMonth(ctx, state).state;
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(
  `범위 ${scope}: 항구 ${ctx.portIds.length}, 경제권 ${ctx.cityIds.length}, NPC 배 ${state.ships.filter((s) => s.companyId !== 'player').length}척`,
);
console.log(`세계 조립 ${tBuild.toFixed(0)}ms(오프라인 단계), 경제 준비(준비 기간 ${data.warmupMonths}개월 포함) ${tGame.toFixed(0)}ms`);
console.log(`월 갱신 평균 ${avg.toFixed(0)}ms, 중앙 ${times[Math.floor(times.length / 2)].toFixed(0)}ms, 최대 ${times[times.length - 1].toFixed(0)}ms (${months}개월)`);
console.log(`NPC 기항 처리 ${(npcStats.arrivals / months).toFixed(0)}회/월, 항해 계획 견주기 ${(npcStats.plans / months).toFixed(0)}회/월`);

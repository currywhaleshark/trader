/**
 * 장기 변화(M3)를 화면 없이 본다.
 *   npm run decades -- --years 30 [--seed abc] [--events]
 * 5년마다 나라별 인구·소득·기술, 마지막에 수출입 구조가 바뀐 상품과 균형 지표를 출력한다.
 */
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { createEconomy } from '../src/sim/economy/setup';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { EconomyState, SimEvent } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : fallback;
};
const seed = value('--seed', DEFAULT_SEED);
const years = Number(value('--years', '30'));

const { world } = generateWorld(makeConfig({ seed }));
const eco = createEconomy(world, DEFAULT_ECONOMY, seed);
const ctx = eco.ctx;
let state: EconomyState = eco.state;
const money0 = totals(ctx, state).money;
const growth: Extract<SimEvent, { type: 'growth' }>[] = [];
const policy: Extract<SimEvent, { type: 'policy' }>[] = [];
let shortage = 0;
let want = 0;
let bad = 0;
const paid: Record<string, number> = {};
const usedQ: Record<string, number> = {};
const started = Date.now();

for (let m = 0; m < years * 12; m++) {
  const r = stepMonth(ctx, state);
  state = r.state;
  for (const e of r.events) {
    if (e.type === 'growth') growth.push(e);
    if (e.type === 'policy') policy.push(e);
  }
  for (const id of ctx.cityIds) {
    const c = state.cities[id];
    for (const g of ctx.goods) {
      if (m >= 12) {
        shortage += c.last.shortage[g.id];
        want += c.last.consumed[g.id] + c.last.shortage[g.id];
      }
      if (!Number.isFinite(c.price[g.id]) || !Number.isFinite(c.stock[g.id]) || c.stock[g.id] < 0) bad++;
      if (m >= years * 12 - 12) {
        const u = c.last.consumed[g.id] + c.last.usedAsInput[g.id];
        paid[g.id] = (paid[g.id] ?? 0) + u * c.price[g.id];
        usedQ[g.id] = (usedQ[g.id] ?? 0) + u;
      }
    }
  }
}

const name = (k: string) => world.countries.find((c) => c.id === k)?.name ?? k;
console.log(`== 시드 ${seed}, ${years}년, ${Date.now() - started}ms, 비정상 수치 ${bad}건 ==`);
console.log('연도   ' + world.countries.map((c) => c.name.padEnd(16)).join(''));
for (const h of state.history) {
  if ((h.year - ctx.data.startYear) % 5 !== 0) continue;
  console.log(
    `${h.year}  ` +
      world.countries
        .map((c) => {
          const e = h.countries[c.id];
          return `${e.population.toFixed(1)}M ×${e.income.toFixed(2)} T${e.tech.toFixed(1)}`.padEnd(18);
        })
        .join(''),
  );
}
const last = state.history[state.history.length - 1];
console.log(`NPC 선박: 처음 ${state.history[0]?.npcShips} → 마지막 ${last?.npcShips}`);

// 수출입 구조 변화: 처음 3년 평균과 마지막 3년 평균의 부호가 바뀐 (나라, 상품)
console.log('\n수출입 구조가 바뀐 경우(처음 3년 → 마지막 3년, 연 순수출량):');
const head = state.history.slice(0, 3);
const tail = state.history.slice(-3);
let flips = 0;
for (const c of world.countries) {
  for (const g of ctx.goods) {
    const a = head.reduce((s, h) => s + (h.countries[c.id]?.netTrade[g.id] ?? 0), 0) / head.length;
    const b = tail.reduce((s, h) => s + (h.countries[c.id]?.netTrade[g.id] ?? 0), 0) / tail.length;
    const scale = Math.max(Math.abs(a), Math.abs(b));
    if (scale > 30 && Math.sign(a) !== Math.sign(b) && Math.min(Math.abs(a), Math.abs(b)) > scale * 0.15) {
      flips++;
      console.log(`  ${name(c.id)} ${g.name}: ${a > 0 ? '수출' : '수입'} ${Math.abs(a).toFixed(0)} → ${b > 0 ? '수출' : '수입'} ${Math.abs(b).toFixed(0)}`);
    }
  }
}
console.log(`  모두 ${flips}건`);

const kinds: Record<string, number> = {};
for (const e of growth) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log('\n장기 변화 사건:', Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', '));
const firstYears = (kind: string) => [...new Set(growth.filter((e) => e.kind === kind).map((e) => ctx.data.startYear + Math.floor(e.month / 12)))].slice(0, 12).join(',');
console.log('  신설 착공 연도:', firstYears('build_start'));
console.log('  폐쇄 연도:', firstYears('close'));
if (args.includes('--events')) for (const e of growth) console.log(`  ${ctx.data.startYear + Math.floor(e.month / 12)} ${e.text} | ${e.causes.join(' ')}`);
const pk: Record<string, number> = {};
for (const e of policy) pk[e.kind] = (pk[e.kind] ?? 0) + 1;
console.log('\n정책·문화 사건:', Object.entries(pk).map(([k, v]) => `${k} ${v}`).join(', ') || '없음');
for (const e of policy) {
  if (e.kind.endsWith('_end')) continue;
  const y = ctx.data.startYear + Math.floor(e.month / 12);
  console.log(`  ${y} [${e.kind}] ${e.text}`);
  if (args.includes('--events') || e.kind === 'review') for (const x of e.kind === 'review' ? e.effects : e.causes) console.log(`        · ${x}`);
}
console.log(`\n부족률(2년차부터): ${((shortage / want) * 100).toFixed(2)}%`);
const priceRatio = ctx.goods.map((g) => `${g.name} ${(usedQ[g.id] > 0 ? paid[g.id] / usedQ[g.id] / g.basePrice : 1).toFixed(2)}`);
console.log('마지막 해 실제로 치른 값(소비량 가중, 기준 대비):', priceRatio.join(', '));
console.log('돈 보존:', Math.abs(totals(ctx, state).money - money0) < 1e-3 ? '확인' : `불일치 ${totals(ctx, state).money - money0}`);

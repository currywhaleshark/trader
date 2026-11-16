import { SeededRNG } from '../core/rng';
import { updatePrices } from './market';
import { annualStep, completeProjects } from './growth';
import { actAtPort } from './npc';
import { addStock, splitKey, takeStock } from './origin';
import { brandDemandBoost } from './policy';
import { applyCommand, chargePlayerUpkeep, PLAYER_ID, playerArrive, trimLedger } from './player';
import { baseDemand } from './setup';
import {
  emptyStats,
  type CityEconomy,
  type Command,
  type EconomyContext,
  type EconomyState,
  type Industry,
  type SimEvent,
} from './types';

/** 운영비(임금·설비): 모든 값이 기준가일 때 생산비가 기준가 × costShare가 되도록 맞춘다 */
export function operatingCost(ctx: EconomyContext, goodId: string): number {
  const g = ctx.goodById[goodId];
  const m = ctx.data.market;
  let inputs = 0;
  if (g.recipe) for (const [input, qty] of Object.entries(g.recipe)) inputs += qty * ctx.goodById[input].basePrice;
  return Math.max(g.basePrice * m.minOperatingShare, g.basePrice * m.costShare - inputs);
}

/** 시설의 단위 생산비 = 투입재 시세 + 운영비 */
export function unitCost(ctx: EconomyContext, city: CityEconomy, goodId: string): number {
  const g = ctx.goodById[goodId];
  let cost = operatingCost(ctx, goodId);
  if (g.recipe) for (const [input, qty] of Object.entries(g.recipe)) cost += qty * city.price[input];
  return cost;
}

/** 이번 달 이 시설의 최대 생산량(계절·일시적 차질 반영, 투입재·채산성 미반영) */
export function seasonalCapacity(
  ctx: EconomyContext,
  state: EconomyState,
  cityId: string,
  ind: Industry,
): number {
  const g = ctx.goodById[ind.goodId];
  let cap = ind.capacity;
  if (g.source?.kind === 'crop') cap *= ctx.cropCoef[cityId]?.[g.source.id]?.[state.month % 12] ?? 1;
  for (const mod of state.modifiers) {
    if (mod.cityId === cityId && mod.goodId === ind.goodId && state.month <= mod.untilMonth) cap *= mod.factor;
  }
  return cap;
}

/**
 * 한 달 진행. (상태, 명령) -> (다음 상태, 사건).  입력 상태는 바꾸지 않는다.
 * 순서: 생산(투입재 차감) → 선박 도착·거래 → 소비 → 가격 갱신.
 * 난수는 상태에 든 시드에서만 나오므로 같은 상태·명령이면 결과가 같다.
 */
export function stepMonth(
  ctx: EconomyContext,
  prev: EconomyState,
  commands: readonly Command[] = [],
): { state: EconomyState; events: SimEvent[] } {
  const state: EconomyState = structuredClone(prev);
  const rng = SeededRNG.fromState(state.rng);
  const events: SimEvent[] = [];
  const month = state.month;
  const m = ctx.data.market;

  for (const cmd of commands) {
    const r = applyCommand(ctx, state, cmd);
    events.push(...r.events);
    if (!r.ok) events.push({ type: 'notice', month, text: r.error ?? '명령을 처리하지 못했어요.' });
  }
  state.modifiers = state.modifiers.filter((mod) => mod.untilMonth >= month);
  completeProjects(ctx, state, events);

  for (const cityId of ctx.cityIds) {
    const city = state.cities[cityId];
    city.last = emptyStats(ctx.goods);
    const annual = city.annual;

    // --- 생산: 시설이 있어야 하고, 투입재가 있어야 하며, 팔아서 남아야 돌린다
    for (const ind of city.industries) {
      const g = ctx.goodById[ind.goodId];
      let out = seasonalCapacity(ctx, state, cityId, ind);
      annual.capacity[g.id] += out;
      // 채산성: 시세가 생산비에 못 미치면 가동을 줄인다(원료값 상승이 공급 감소로 전달된다)
      const margin = city.price[g.id] / unitCost(ctx, city, g.id);
      annual.marginSum[g.id] += margin;
      out *= Math.min(1, Math.max(0, (margin - m.idleBelowMargin) / (m.fullAtMargin - m.idleBelowMargin)));
      // 창고가 넘치면 멈춘다
      if (city.stock[g.id] >= city.target[g.id] * m.storageCap) out = 0;
      if (g.recipe) {
        for (const [input, qty] of Object.entries(g.recipe)) out = Math.min(out, city.stock[input] / qty);
      }
      if (out <= 0) continue;
      if (g.recipe) {
        for (const [input, qty] of Object.entries(g.recipe)) {
          const used = Math.min(city.stock[input], qty * out);
          takeStock(city, input, used);
          city.last.usedAsInput[input] += used;
        }
      }
      // 이 도시에서 만들었으니 원산지는 이 나라(원료가 어디서 왔든 새 상품이 된다)
      addStock(city, g.id, out, city.countryId, ind.brandCountryId ?? city.countryId);
      city.last.produced[g.id] += out;
      // 부가가치 = 생산량 × (시세 − 투입재 시세)
      let inputs = 0;
      if (g.recipe) for (const [input, qty] of Object.entries(g.recipe)) inputs += qty * city.price[input];
      annual.valueAdded += out * Math.max(0, city.price[g.id] - inputs);
    }
  }

  // --- 선박: 이번 달 안에 도착하는 배를 도착 시각 순으로 처리
  const end = month + 1;
  for (let guard = 0; guard < state.ships.length * 6; guard++) {
    let next = -1;
    for (let k = 0; k < state.ships.length; k++) {
      const s = state.ships[k];
      if (!s.holding && s.arrivesAt < end && (next < 0 || s.arrivesAt < state.ships[next].arrivesAt)) next = k;
    }
    if (next < 0) break;
    const ship = state.ships[next];
    const at = Math.max(ship.arrivesAt, month);
    if (ship.companyId === PLAYER_ID) playerArrive(ctx, state, ship, at, events);
    else actAtPort(ctx, state, ship, at, rng, events);
  }
  // 한 달에 처리 한도를 넘긴 배는 다음 달로 미룬다
  for (const s of state.ships) if (!s.holding && s.arrivesAt < end) s.arrivesAt = end;

  // --- 소비: 이번 달에 들어온 배의 화물까지 쓸 수 있다. 비싸면 덜 사고, 재고가 없으면 못 산다
  for (const cityId of ctx.cityIds) {
    const city = state.cities[cityId];
    for (const g of ctx.goods) {
      const base = baseDemand(g, city.population, city.income);
      if (base <= 0) continue;
      let want = base * Math.pow(city.price[g.id] / g.basePrice, -g.priceElasticity);
      // 문화 유행: 인기 있는 나라 상표의 물건이 창고에 있으면 더 사 간다(없으면 늘지 않는다)
      const mix = city.mix[g.id];
      if (mix && state.cultureWaves.length > 0 && city.stock[g.id] > 0) {
        let boost = 0;
        for (const [key, v] of Object.entries(mix)) {
          if (v <= 0) continue;
          const b = brandDemandBoost(ctx, state, city.countryId, g.id, splitKey(key).brand);
          if (b > 0) boost += b * (v / city.stock[g.id]);
        }
        want *= 1 + boost;
      }
      const got = Math.min(want, city.stock[g.id]);
      takeStock(city, g.id, got);
      city.last.consumed[g.id] += got;
      const lack = want - got;
      if (lack > 1e-9) {
        city.last.shortage[g.id] += lack;
        if (lack / want > 0.3) events.push({ type: 'shortage', month, cityId, goodId: g.id, ratio: lack / want });
      }
    }
  }

  // --- 선박 유지비, 그리고 운영 자금을 넘는 이익의 일부를 본거지에 배당·세금으로 낸다
  const npc = ctx.data.npc;
  for (const company of state.companies) {
    const fleet = state.ships.filter((s) => s.companyId === company.id).length;
    const upkeep = Math.min(company.cash, fleet * npc.shipUpkeep);
    company.cash -= upkeep;
    state.sink += upkeep;
    const home = state.cities[company.homeCityId];
    const excess = company.cash - npc.workingCapital;
    if (home && excess > 0) {
      const payout = excess * npc.payoutRate;
      company.cash -= payout;
      home.treasury += payout;
      company.paidOut += payout;
    }
  }

  chargePlayerUpkeep(ctx, state);

  for (const cityId of ctx.cityIds) {
    const city = state.cities[cityId];
    updatePrices(ctx, city);
    // 한 해 통계 쌓기
    const a = city.annual;
    const l = city.last;
    a.months++;
    for (const g of ctx.goods) {
      a.produced[g.id] += l.produced[g.id];
      a.used[g.id] += l.consumed[g.id] + l.usedAsInput[g.id];
      a.shortage[g.id] += l.shortage[g.id];
      a.imported[g.id] += l.imported[g.id];
      a.exported[g.id] += l.exported[g.id];
      a.priceSum[g.id] += city.price[g.id];
      a.throughput += (l.imported[g.id] + l.exported[g.id]) * g.volume;
    }
  }

  state.month = month + 1;
  trimLedger(ctx, state);
  // 해가 바뀌면 장기 변화
  if (state.month % 12 === 0) annualStep(ctx, state, rng, events);
  state.rng = rng.getState();
  return { state, events };
}

/** 장부 검증용 합계 */
export function totals(ctx: EconomyContext, state: EconomyState): { goods: Record<string, number>; money: number } {
  const goods: Record<string, number> = Object.fromEntries(ctx.goods.map((g) => [g.id, 0]));
  let money = state.sink + state.player.cash;
  for (const id of ctx.cityIds) {
    const c = state.cities[id];
    for (const g of ctx.goods) goods[g.id] += c.stock[g.id];
    money += c.treasury;
  }
  for (const s of state.ships) for (const lot of s.cargo) goods[lot.goodId] += lot.quantity;
  for (const [id, q] of Object.entries(state.spoiled)) goods[id] += q;
  for (const c of state.companies) money += c.cash;
  return { goods, money };
}

import type { SeededRNG } from '../core/rng';
import { annualPolicyStep, brandPremium } from './policy';
import { inventoryUnit } from './market';
import { computeTargets } from './setup';
import { operatingCost } from './step';
import {
  emptyAnnual,
  type AnnualStats,
  type CityEconomy,
  type CountryYear,
  type EconomyContext,
  type EconomyState,
  type Industry,
  type Project,
  type SimEvent,
} from './types';

/**
 * 장기 변화(M3). 매년 1월에 한 번 돈다. 고정 연도 스크립트가 아니라 지난 한 해의 조건에서 결정한다.
 *  1) 끝난 공사 반영(매달 확인)
 *  2) 소득·인구 → 수요·목표 재고 재계산
 *  3) 공장·농장·광산의 증설·쇠퇴·폐쇄
 *  4) 수입 대체 공장 신설(기술·수입 의존·채산성)
 *  5) 기술 발전, 항만 확장, NPC 선단 증감
 *  6) 나라별 기록 저장
 * 모든 변화는 원인 문장(causes)을 단 사건으로 남는다.
 */

const pct = (v: number) => `${Math.round(v * 100)}%`;

function cityName(ctx: EconomyContext, id: string): string {
  return ctx.cityNames[id] ?? id;
}

function countryName(ctx: EconomyContext, id: string): string {
  return ctx.countryNames[id] ?? id;
}

function goodName(ctx: EconomyContext, id: string): string {
  return ctx.goodById[id]?.name ?? id;
}

function newProject(state: EconomyState, p: Omit<Project, 'id'>): Project {
  const project = { ...p, id: `j${state.nextProjectNo++}` };
  state.projects.push(project);
  return project;
}

function hasProject(state: EconomyState, cityId: string, goodId?: string, kind?: Project['kind']): boolean {
  return state.projects.some((p) => p.cityId === cityId && p.goodId === goodId && (!kind || p.kind === kind));
}

/** 매달 시작에: 완공된 공사를 반영한다 */
export function completeProjects(ctx: EconomyContext, state: EconomyState, events: SimEvent[]): void {
  const done = state.projects.filter((p) => p.readyMonth <= state.month);
  if (done.length === 0) return;
  state.projects = state.projects.filter((p) => p.readyMonth > state.month);
  for (const p of done) {
    const city = state.cities[p.cityId];
    const countryId = ctx.countryOfCity[p.cityId];
    if (p.kind === 'port') {
      if (!ctx.portIds.includes(p.cityId)) continue;
      state.portLevel[p.cityId] = Math.min(3, (state.portLevel[p.cityId] ?? 1) + 1);
      events.push({
        type: 'growth', month: state.month, kind: 'port_done', cityId: p.cityId, countryId,
        text: `${cityName(ctx, p.cityId)} 항구 확장이 끝났어요. 이제 더 큰 배가 들어올 수 있어요.`,
        causes: [p.reason],
      });
      continue;
    }
    const goodId = p.goodId!;
    const add = p.capacity ?? 0;
    const src = ctx.goodById[goodId].source;
    const facility = src?.kind === 'crop' ? '농장' : src?.kind === 'resource' ? '광산' : '공장';
    let ind = city.industries.find((i) => i.goodId === goodId);
    if (ind) ind.capacity += add;
    else {
      ind = { goodId, capacity: add, initialCapacity: add, weakYears: 0 };
      const license = ctx.data.licenses.find((l) => l.cityId === p.cityId && l.goodId === goodId);
      if (license) ind.brandCountryId = license.brandCountryId;
      city.industries.push(ind);
    }
    computeTargets(ctx, city);
    events.push({
      type: 'growth', month: state.month, kind: p.kind === 'build' ? 'build_done' : 'expand_done', cityId: p.cityId, countryId, goodId,
      text:
        p.kind === 'build'
          ? `${cityName(ctx, p.cityId)}에 ${goodName(ctx, goodId)} ${facility}이(가) 문을 열었어요.`
          : `${cityName(ctx, p.cityId)}의 ${goodName(ctx, goodId)} 생산 시설 증설이 끝났어요.`,
      causes: [p.reason],
    });
  }
}

/** 한 해 평균 */
function avg(a: AnnualStats, key: 'priceSum' | 'marginSum', goodId: string): number {
  return a.months > 0 ? a[key][goodId] / a.months : 0;
}

function shortageRate(a: AnnualStats, goods: string[]): number {
  let short = 0;
  let want = 0;
  for (const id of goods) {
    short += a.shortage[id];
    want += a.used[id] + a.shortage[id];
  }
  return want > 0 ? short / want : 0;
}

/** 1월마다 */
export function annualStep(ctx: EconomyContext, state: EconomyState, rng: SeededRNG, events: SimEvent[]): void {
  const G = ctx.data.growth;
  const month = state.month;
  const year = ctx.data.startYear + Math.floor(month / 12);
  const push = (e: Omit<Extract<SimEvent, { type: 'growth' }>, 'type' | 'month'>) => events.push({ type: 'growth', month, ...e });

  // ---- 1) 나라별 기록(지난 한 해) — 바꾸기 전에 남긴다. 정책도 지난 한 해를 보고 정한다
  recordYear(ctx, state, year - 1);
  annualPolicyStep(ctx, state, rng, events);
  if (G.enabled === false) {
    // 교사 설정으로 장기 변화를 끈 경우: 기록과 정책만 하고 세계는 그대로 둔다
    for (const id of ctx.cityIds) state.cities[id].annual = emptyAnnual(ctx.goods);
    return;
  }

  // ---- 2) 소득·인구
  let vaSum = 0;
  let popSum = 0;
  for (const id of ctx.cityIds) {
    vaSum += state.cities[id].annual.valueAdded;
    popSum += state.cities[id].population;
  }
  const worldVaPc = popSum > 0 ? vaSum / popSum : 0;
  for (const id of ctx.cityIds) {
    const c = state.cities[id];
    const a = c.annual;
    if (a.months === 0) continue;
    const vaPc = c.population > 0 ? a.valueAdded / c.population : 0;
    const rel = worldVaPc > 0 ? Math.max(-1, Math.min(1.5, vaPc / worldVaPc - 1)) : 0;
    const ess = shortageRate(a, G.essentialGoods);
    const food = shortageRate(a, G.foodGoods);
    const dIncome = clamp(G.baseIncomeGrowth + G.industryIncomeEffect * rel - G.shortageIncomePenalty * ess, G.incomeGrowthMin, G.incomeGrowthMax);
    const dPop = clamp(G.basePopGrowth + G.incomePopEffect * (c.income - 1) - G.foodShortagePopPenalty * food, G.popGrowthMin, G.popGrowthMax);
    c.income *= 1 + dIncome;
    c.population *= 1 + dPop;
  }

  // ---- 3) 시설 증설·쇠퇴
  for (const id of ctx.cityIds) {
    const c = state.cities[id];
    const a = c.annual;
    if (a.months === 0) continue;
    const countryId = ctx.countryOfCity[id];
    for (const ind of [...c.industries]) {
      const g = ctx.goodById[ind.goodId];
      const util = a.capacity[g.id] > 0 ? a.produced[g.id] / a.capacity[g.id] : 0;
      const margin = avg(a, 'marginSum', g.id);
      const cap = g.source?.kind === 'crop' ? G.cropExpandCap : g.source?.kind === 'resource' ? G.resourceExpandCap : Infinity;
      if (util >= G.expandUtilization && margin >= G.expandMargin && !hasProject(state, id, g.id) && ind.capacity * (1 + G.expandShare) <= ind.initialCapacity * cap) {
        const reason = `${cityName(ctx, id)}의 ${g.name} 시설이 거의 쉬지 않고 돌았고(가동률 ${pct(util)}), 팔면 남았어요(값이 생산비의 ${margin.toFixed(2)}배).`;
        newProject(state, { kind: 'expand', cityId: id, goodId: g.id, capacity: ind.capacity * G.expandShare, startedMonth: month, readyMonth: month + G.expandYears * 12, reason });
        push({ kind: 'expand_start', cityId: id, countryId, goodId: g.id, text: `${cityName(ctx, id)}에서 ${g.name} 생산 시설을 늘리기 시작했어요(${G.expandYears}년 공사).`, causes: [reason] });
        ind.weakYears = 0;
        continue;
      }
      const weak = util < G.weakUtilization || margin < G.weakMargin;
      ind.weakYears = weak ? ind.weakYears + 1 : 0;
      if (ind.weakYears >= G.weakYearsToShrink) {
        ind.weakYears = 0;
        const why = util < G.weakUtilization
          ? `${G.weakYearsToShrink}년 넘게 시설의 절반도 돌리지 못했어요(가동률 ${pct(util)}).`
          : `${G.weakYearsToShrink}년 넘게 팔아도 남지 않았어요(값이 생산비의 ${margin.toFixed(2)}배).`;
        const extra = describeCompetition(ctx, state, id, g.id);
        ind.capacity *= 1 - G.shrinkShare;
        if (ind.capacity < ind.initialCapacity * G.closeBelowShare) {
          c.industries = c.industries.filter((x) => x !== ind);
          push({ kind: 'close', cityId: id, countryId, goodId: g.id, text: `${cityName(ctx, id)}의 ${g.name} 공장이 문을 닫았어요.`, causes: [why, ...extra] });
        } else {
          push({ kind: 'shrink', cityId: id, countryId, goodId: g.id, text: `${cityName(ctx, id)}의 ${g.name} 생산이 줄었어요.`, causes: [why, ...extra] });
        }
      }
    }
  }

  // ---- 4) 수입 대체 공장 신설
  const worldCapacity: Record<string, number> = {};
  for (const id of ctx.cityIds) for (const ind of state.cities[id].industries) worldCapacity[ind.goodId] = (worldCapacity[ind.goodId] ?? 0) + ind.capacity;
  const busy: Record<string, number> = {};
  for (const p of state.projects) if (p.kind === 'build') busy[ctx.countryOfCity[p.cityId]] = (busy[ctx.countryOfCity[p.cityId]] ?? 0) + 1;
  for (const id of ctx.cityIds) {
    const c = state.cities[id];
    const a = c.annual;
    if (a.months === 0) continue;
    const countryId = ctx.countryOfCity[id];
    for (const g of ctx.goods) {
      if (!g.recipe) continue; // 농장·광산은 지리가 정한다
      if ((busy[countryId] ?? 0) >= G.maxProjectsPerCountry) break;
      if (c.industries.some((i) => i.goodId === g.id) || hasProject(state, id, g.id)) continue;
      const tech = state.tech[countryId] ?? 0;
      if (tech < g.techRequired) continue;
      const used = a.used[g.id] + a.shortage[g.id];
      if (used <= 0) continue;
      const importShare = Math.min(1, (a.imported[g.id] + a.shortage[g.id]) / used);
      const price = avg(a, 'priceSum', g.id);
      if (importShare < G.buildImportShare || price < g.basePrice * G.buildPriceRatio) continue;
      let cost = operatingCost(ctx, g.id);
      for (const [input, qty] of Object.entries(g.recipe)) {
        const local = c.target[input] > 0 ? inventoryUnit(ctx, state, c, input) : ctx.goodById[input].basePrice * 1.3;
        cost += qty * local;
      }
      const brand = ctx.data.licenses.find((l) => l.cityId === id && l.goodId === g.id)?.brandCountryId ?? countryId;
      const margin = c.price[g.id] * (1 + brandPremium(ctx, state, countryId, g.id, brand)) / cost;
      if (margin < G.buildMargin) continue;
      if (rng.next() >= G.buildChance) continue;
      const capacity = (used / a.months) * G.buildDemandShare;
      if (capacity < (worldCapacity[g.id] ?? 0) * G.minBuildShareOfWorld) continue;
      const causes = [
        `${cityName(ctx, id)}은(는) 쓰는 ${g.name}의 ${pct(importShare)}를 다른 나라에서 사 왔어요.`,
        `${g.name} 값이 기준보다 ${pct(price / g.basePrice - 1)} 비싸, 직접 만들면 생산비의 ${margin.toFixed(2)}배에 팔 수 있어요.`,
        `${countryName(ctx, countryId)}의 기술 수준(${tech.toFixed(1)})이 ${g.name}을(를) 만들 만큼 올라 있어요.`,
      ];
      newProject(state, { kind: 'build', cityId: id, goodId: g.id, capacity, startedMonth: month, readyMonth: month + G.buildYears * 12, reason: causes.join(' ') });
      busy[countryId] = (busy[countryId] ?? 0) + 1;
      push({ kind: 'build_start', cityId: id, countryId, goodId: g.id, text: `${cityName(ctx, id)}에 ${g.name} 공장을 짓기 시작했어요(${G.buildYears}년 뒤 완공).`, causes });
    }
  }

  // ---- 4b) 새 농장·광산: 세계적으로 값이 비싸면 땅·매장량은 있지만 시설이 없던 도시에 연다
  for (const g of ctx.goods) {
    if (!g.source) continue;
    let priceSum = 0;
    let markets = 0;
    for (const id of ctx.cityIds) {
      const a = state.cities[id].annual;
      if (state.cities[id].target[g.id] > 0 && a.months > 0) {
        priceSum += a.priceSum[g.id] / a.months;
        markets++;
      }
    }
    const worldPrice = markets > 0 ? priceSum / markets : g.basePrice;
    if (worldPrice < g.basePrice * G.rawBuildPriceRatio) continue;
    const sites = ctx.cityIds
      .filter((id) => (ctx.rawPotential[id]?.[g.id] ?? 0) > 0 && !state.cities[id].industries.some((i) => i.goodId === g.id) && !hasProject(state, id, g.id))
      .sort((x, y) => ctx.rawPotential[y][g.id] - ctx.rawPotential[x][g.id]);
    const site = sites[0];
    if (!site || rng.next() >= G.buildChance) continue;
    const capacity = ctx.rawPotential[site][g.id] * G.rawBuildShare;
    const kindWord = g.source.kind === 'crop' ? '농장' : '광산';
    const causes = [
      `세계 시장에서 ${g.name} 값이 기준보다 ${pct(worldPrice / g.basePrice - 1)} 비싸졌어요.`,
      `${cityName(ctx, site)} 주변에는 ${g.source.kind === 'crop' ? `${g.name}을(를) 기를 땅` : `${g.name} 매장지`}이(가) 있지만 아직 ${kindWord}이(가) 없었어요.`,
    ];
    newProject(state, { kind: 'build', cityId: site, goodId: g.id, capacity, startedMonth: month, readyMonth: month + G.buildYears * 12, reason: causes.join(' ') });
    push({ kind: 'build_start', cityId: site, countryId: ctx.countryOfCity[site], goodId: g.id, text: `${cityName(ctx, site)}에 ${g.name} ${kindWord}을(를) 새로 열기 시작했어요.`, causes });
  }

  // ---- 5a) 기술
  const countryIncome: Record<string, { pop: number; inc: number }> = {};
  for (const id of ctx.cityIds) {
    const k = ctx.countryOfCity[id];
    const e = (countryIncome[k] ??= { pop: 0, inc: 0 });
    e.pop += state.cities[id].population;
    e.inc += state.cities[id].population * state.cities[id].income;
  }
  const leader = Math.max(...Object.values(state.tech));
  for (const [k, e] of Object.entries(countryIncome)) {
    const before = state.tech[k] ?? 0;
    const income = e.pop > 0 ? e.inc / e.pop : 1;
    // 앞선 나라와 교역하며 기술이 퍼진다(차이가 클수록 빨리 따라잡는다)
    const catchUp = G.techCatchUp * Math.max(0, leader - before);
    const gain = Math.max(0, G.techBase + G.techIncomeEffect * (income - 1) + catchUp + rng.range(-G.techNoise, G.techNoise));
    const after = Math.min(G.techMax, before + gain);
    state.tech[k] = after;
    if (Math.floor(after) > Math.floor(before)) {
      const level = Math.floor(after);
      const unlocked = ctx.goods.filter((g) => g.recipe && g.techRequired === level).map((g) => g.name);
      push({
        kind: 'tech', countryId: k,
        text: `${countryName(ctx, k)}의 기술 수준이 ${level}이(가) 되었어요.${unlocked.length ? ` 이제 ${unlocked.join('·')} 공장을 지을 수 있어요.` : ''}`,
        causes: [
          income >= 1 ? `소득 수준 ${income.toFixed(2)}로 연구와 교육에 쓸 여유가 생겼어요.` : `소득은 아직 낮지만(${income.toFixed(2)}),`,
          ...(catchUp > 0.02 ? ['앞선 나라들과 교역하면서 기술을 배웠어요.'] : []),
        ],
      });
    }
  }

  // ---- 5b) 항만
  for (const id of ctx.portIds) {
    const level = state.portLevel[id] ?? 1;
    if (level >= 3 || hasProject(state, id, undefined, 'port')) continue;
    const need = G.portThroughput[level - 1];
    const through = state.cities[id].annual.throughput;
    if (through < need) continue;
    const reason = `${cityName(ctx, id)} 항구에서 한 해 동안 ${Math.round(through).toLocaleString('ko-KR')}만큼의 화물이 오갔어요(기준 ${need.toLocaleString('ko-KR')}).`;
    newProject(state, { kind: 'port', cityId: id, startedMonth: month, readyMonth: month + G.portYears * 12, reason });
    push({ kind: 'port_start', cityId: id, countryId: ctx.countryOfCity[id], text: `${cityName(ctx, id)} 항구를 넓히는 공사를 시작했어요(${G.portYears}년).`, causes: [reason] });
  }

  // ---- 5c) NPC 선단
  for (const co of state.companies) {
    const fleet = state.ships.filter((s) => s.companyId === co.id);
    const profit = co.cash - co.yearMark.cash + (co.paidOut - co.yearMark.paidOut) + (co.invested - co.yearMark.invested);
    const perShip = fleet.length > 0 ? profit / fleet.length : 0;
    if (co.cash > ctx.data.npc.workingCapital * G.npcExpandCashRatio && perShip > G.npcExpandProfitPerShip && fleet.length < G.npcMaxShips && co.cash > G.npcShipPrice) {
      co.cash -= G.npcShipPrice;
      co.invested += G.npcShipPrice;
      state.sink += G.npcShipPrice;
      const home = co.homeCityId;
      state.ships.push({
        id: `${co.id}_${state.nextProjectNo++}`, companyId: co.id, capacity: ctx.data.npc.shipCapacity,
        from: home, to: home, departedAt: month, arrivesAt: month + rng.range(0, 0.9), cargo: [],
      });
      push({ kind: 'fleet', text: `${co.name}이(가) 배를 한 척 더 샀어요(모두 ${fleet.length + 1}척).`, causes: [`지난해 배 한 척이 평균 ${Math.round(perShip).toLocaleString('ko-KR')}을 벌었어요.`] });
    } else if (perShip < 0 && fleet.length > G.npcMinShips) {
      const idle = fleet.find((s) => s.cargo.length === 0) ?? fleet[fleet.length - 1];
      if (idle.cargo.length === 0) {
        state.ships = state.ships.filter((s) => s !== idle);
        const value = G.npcShipPrice * 0.5;
        co.cash += value;
        co.invested -= value;
        state.sink -= value;
        push({ kind: 'fleet', text: `${co.name}이(가) 배를 한 척 팔았어요(모두 ${fleet.length - 1}척).`, causes: ['지난해 운항해도 손해를 봤어요.'] });
      }
    }
    co.yearMark = { cash: co.cash, paidOut: co.paidOut, invested: co.invested };
  }

  // ---- 6) 수요가 바뀌었으니 목표 재고 재계산, 연간 통계 비우기
  for (const id of ctx.cityIds) {
    computeTargets(ctx, state.cities[id]);
    state.cities[id].annual = emptyAnnual(ctx.goods);
  }
}

/** 이 상품을 더 싸게 대 주는 곳이 있으면 원인에 덧붙인다 */
function describeCompetition(ctx: EconomyContext, state: EconomyState, cityId: string, goodId: string): string[] {
  const c = state.cities[cityId];
  const exp = c.annual.exported[goodId];
  const imp = c.annual.imported[goodId];
  const out: string[] = [];
  if (imp > exp && imp > 0) out.push(`다른 나라에서 들여온 ${goodName(ctx, goodId)}이(가) 더 싸게 팔렸어요.`);
  const cheaper = ctx.cityIds.filter((id) => id !== cityId && state.cities[id].industries.some((i) => i.goodId === goodId) && state.cities[id].price[goodId] < c.price[goodId] * 0.85);
  if (cheaper.length) out.push(`${cheaper.map((id) => cityName(ctx, id)).join('·')}에서 더 싸게 만들어요.`);
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 지난 한 해의 나라별 기록 */
function recordYear(ctx: EconomyContext, state: EconomyState, year: number): void {
  const countries: Record<string, CountryYear> = {};
  for (const id of ctx.cityIds) {
    const k = ctx.countryOfCity[id];
    const c = state.cities[id];
    const a = c.annual;
    const e = (countries[k] ??= {
      population: 0, income: 0, tech: state.tech[k] ?? 0, netTrade: {}, exportValue: 0, importValue: 0, produced: {},
      importValueFrom: {}, importsByGood: {}, paid: {}, used: {}, tariffs: 0,
    });
    e.tariffs += a.tariffs;
    for (const [g, from] of Object.entries(a.importsFrom)) {
      const t = (e.importsByGood[g] ??= {});
      for (const [o, q] of Object.entries(from)) t[o] = (t[o] ?? 0) + q;
    }
    for (const [o, v] of Object.entries(a.importValueFrom)) e.importValueFrom[o] = (e.importValueFrom[o] ?? 0) + v;
    e.income += c.income * c.population;
    e.population += c.population;
    for (const g of ctx.goods) {
      const avgPrice = a.months > 0 ? a.priceSum[g.id] / a.months : g.basePrice;
      e.paid[g.id] = (e.paid[g.id] ?? 0) + a.used[g.id] * avgPrice; // 아래에서 사용량으로 나눈다
      e.used[g.id] = (e.used[g.id] ?? 0) + a.used[g.id];
      e.netTrade[g.id] = (e.netTrade[g.id] ?? 0) + a.exported[g.id] - a.imported[g.id];
      e.produced[g.id] = (e.produced[g.id] ?? 0) + a.produced[g.id];
      const p = a.months > 0 ? a.priceSum[g.id] / a.months : g.basePrice;
      e.exportValue += a.exported[g.id] * p;
      e.importValue += a.imported[g.id] * p;
    }
  }
  for (const e of Object.values(countries)) {
    e.income = e.population > 0 ? e.income / e.population : 0;
    for (const g of ctx.goods) e.paid[g.id] = e.used[g.id] > 0 ? e.paid[g.id] / e.used[g.id] / g.basePrice : 1;
  }
  state.history.push({ year, month: state.month, countries, npcShips: state.ships.filter((s) => s.companyId !== 'player').length });
}

/** 나라 단위로 본 상품의 순수출(+)·순수입(−) 추이 */
export function tradeBalanceSeries(state: EconomyState, countryId: string, goodId: string): number[] {
  return state.history.map((h) => h.countries[countryId]?.netTrade[goodId] ?? 0);
}

export type { CityEconomy, Industry };

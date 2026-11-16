import { SeededRNG } from '../core/rng';
import { addStock } from './origin';
import { createPlayer } from './player';
import { CLIMATE_ZONES, type World } from '../world/types';
import type { EconomyData, GoodDef } from './data';
import {
  emptyAnnual,
  emptyStats,
  type CityEconomy,
  type Company,
  type EconomyContext,
  type EconomyState,
  type Industry,
  type Ship,
} from './types';

/** 도시의 최종 소비 수요(기준 가격일 때, 월) */
export function baseDemand(good: GoodDef, population: number, income: number): number {
  if (good.demandPerMillion <= 0) return 0;
  return population * good.demandPerMillion * Math.pow(income, good.incomeElasticity);
}

/** 투입재를 쓰는 상품이 먼저 오도록 정렬(완제품 → 중간재 → 원재료) */
function consumersFirst(goods: GoodDef[]): GoodDef[] {
  const byId = new Map(goods.map((g) => [g.id, g]));
  const seen = new Set<string>();
  const out: GoodDef[] = [];
  const visit = (g: GoodDef) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    // g를 투입재로 쓰는 상품을 먼저 방문
    for (const h of goods) if (h.recipe && h.recipe[g.id]) visit(h);
    out.push(g);
  };
  for (const g of goods) visit(byId.get(g.id)!);
  return out;
}

export function createContext(world: World, data: EconomyData): EconomyContext {
  const dist = new Map<string, number>();
  for (const r of world.seaRoutes) {
    dist.set(`${r.from}|${r.to}`, r.distanceKm);
    dist.set(`${r.to}|${r.from}`, r.distanceKm);
  }
  const cropCoef: EconomyContext['cropCoef'] = {};
  for (const c of world.cities) {
    cropCoef[c.id] = Object.fromEntries(Object.entries(c.region.crops).map(([id, s]) => [id, s.monthlyCoef]));
  }
  return {
    data,
    goods: data.goods,
    goodById: Object.fromEntries(data.goods.map((g) => [g.id, g])),
    cityIds: world.cities.map((c) => c.id),
    countryOfCity: Object.fromEntries(world.cities.map((c) => [c.id, c.countryId])),
    portSize: Object.fromEntries(world.cities.map((c) => [c.id, c.portSize])),
    cityNames: Object.fromEntries(world.cities.map((c) => [c.id, c.name])),
    countryNames: Object.fromEntries(world.countries.map((c) => [c.id, c.name])),
    rawPotential: Object.fromEntries(world.cities.map((c) => [c.id, {}])),
    cropNeeds: Object.fromEntries(world.config.crops.map((c) => [c.id, { temp: [...c.temp], water: [...c.water] }])),
    continentOfCity: Object.fromEntries(world.cities.map((c) => [c.id, world.layers.continentId[c.cell]])),
    cityInfo: Object.fromEntries(
      world.cities.map((c) => [
        c.id,
        {
          climate: CLIMATE_ZONES[c.region.dominantClimate]?.name ?? '',
          annualPrecip: Math.round(c.region.precipMonthlyMm.reduce((a, b) => a + b, 0)),
          tempMin: Math.round(Math.min(...c.region.tempMonthlyC)),
          tempMax: Math.round(Math.max(...c.region.tempMonthlyC)),
          cropSuitability: Object.fromEntries(Object.entries(c.region.crops).map(([id, s]) => [id, s.suitability])),
          precipMin: Math.round(Math.min(...c.region.precipMonthlyMm)),
          precipMax: Math.round(Math.max(...c.region.precipMonthlyMm)),
        },
      ]),
    ),
    cropCoef,
    distanceKm: (a, b) => (a === b ? 0 : (dist.get(`${a}|${b}`) ?? Infinity)),
  };
}

/**
 * 세계(지리) + 경제 설정 -> 초기 경제 상태.
 *  - 세계 총수요에서 거꾸로 계산해 상품별 필요 생산량을 구한다(완제품 → 중간재 → 원재료).
 *  - 공장은 시나리오가 정한 도시에, 비중대로 생산능력을 나눈다(기술 수준 미달이면 세우지 않는다).
 *  - 농장·광산은 지리가 정한다: 배후지의 경작 가능 면적×적합도, 자원 매장량이 큰 도시에만 생긴다.
 *  - 시작 재고는 목표 재고, 시작 가격은 기준 가격.
 */
export function createEconomy(
  world: World,
  data: EconomyData,
  seed: string,
): { ctx: EconomyContext; state: EconomyState } {
  const ctx = createContext(world, data);
  const goods = data.goods;
  const scenario = (cityId: string) => data.cities[cityId] ?? { population: 3, income: 0.8, factories: {} };

  // 1) 세계 필요 생산량
  const need: Record<string, number> = {};
  for (const g of consumersFirst(goods)) {
    let total = 0;
    for (const c of world.cities) total += baseDemand(g, scenario(c.id).population, scenario(c.id).income);
    for (const h of goods) if (h.recipe?.[g.id]) total += h.recipe[g.id] * need[h.id];
    need[g.id] = total;
  }

  // 2) 도시별 시설
  const industries: Record<string, Industry[]> = Object.fromEntries(world.cities.map((c) => [c.id, []]));
  for (const g of goods) {
    const weights: [string, number][] = [];
    if (g.source) {
      for (const c of world.cities) {
        let w = 0;
        if (g.source.kind === 'crop') {
          const s = c.region.crops[g.source.id];
          if (s) w = s.arableAreaKm2 * s.suitability;
        } else {
          w = c.region.resources[g.source.id] ?? 0;
        }
        weights.push([c.id, Math.pow(Math.max(0, w), data.setup.geographyExponent)]);
      }
      const sum = weights.reduce((s, [, w]) => s + w, 0) || 1;
      // 잠재력은 문턱과 상관없이 남겨 둔다(나중에 값이 오르면 새 농장·광산이 생길 수 있다)
      for (const [cityId, w] of weights) {
        if (w > 0) ctx.rawPotential[cityId][g.id] = (need[g.id] * data.setup.rawSlack * w) / sum;
      }
      for (const entry of weights) if (entry[1] / sum < data.setup.rawShareThreshold) entry[1] = 0;
    } else {
      for (const c of world.cities) {
        const share = scenario(c.id).factories[g.id] ?? 0;
        const tech = data.techByCountry[c.countryId] ?? 0;
        weights.push([c.id, tech >= g.techRequired ? share : 0]);
      }
    }
    const total = weights.reduce((s, [, w]) => s + w, 0);
    if (total <= 0) continue;
    const slack = g.source ? data.setup.rawSlack : data.setup.factorySlack;
    for (const [cityId, w] of weights) {
      if (w > 0) {
        const capacity = (need[g.id] * slack * w) / total;
        industries[cityId].push({ goodId: g.id, capacity, initialCapacity: capacity, weakYears: 0 });
      }
    }
  }

  // 3) 도시 상태
  const cities: Record<string, CityEconomy> = {};
  for (const c of world.cities) {
    const sc = scenario(c.id);
    const zero = () => Object.fromEntries(goods.map((g) => [g.id, 0])) as Record<string, number>;
    const license = (goodId: string) => data.licenses.find((l) => l.cityId === c.id && l.goodId === goodId)?.brandCountryId;
    for (const ind of industries[c.id]) {
      const b = license(ind.goodId);
      if (b) ind.brandCountryId = b;
    }
    const city: CityEconomy = {
      id: c.id,
      countryId: c.countryId,
      population: sc.population,
      income: sc.income,
      industries: industries[c.id],
      stock: zero(),
      price: Object.fromEntries(goods.map((g) => [g.id, g.basePrice])),
      target: zero(),
      reserve: zero(),
      treasury: 0,
      last: emptyStats(goods),
      annual: emptyAnnual(goods),
      mix: {},
    };
    computeTargets(ctx, city);
    // 처음 재고는 그 나라에서 온 것으로 본다(만드는 시설이 있으면 그 상표)
    for (const g of goods) {
      const ind = city.industries.find((i) => i.goodId === g.id);
      addStock(city, g.id, city.target[g.id], c.countryId, ind?.brandCountryId ?? c.countryId);
    }
    cities[c.id] = city;
  }

  // 4) NPC 무역회사와 선박
  const companies: Company[] = [];
  const ships: Ship[] = [];
  const rng = new SeededRNG(`${seed}/economy`);
  for (const spec of data.npc.companies) {
    companies.push({
      id: spec.id,
      name: spec.name,
      homeCityId: spec.homeCityId,
      cash: data.npc.startingCash,
      paidOut: 0,
      invested: 0,
      yearMark: { cash: data.npc.startingCash, paidOut: 0, invested: 0 },
    });
    for (let k = 0; k < data.npc.shipsPerCompany; k++) {
      // 첫 배는 본거지, 나머지는 시드로 흩어 놓는다
      const home = k === 0 && ctx.cityIds.includes(spec.homeCityId) ? spec.homeCityId : ctx.cityIds[rng.int(0, ctx.cityIds.length - 1)];
      ships.push({
        id: `${spec.id}_${k + 1}`,
        companyId: spec.id,
        capacity: data.npc.shipCapacity,
        from: home,
        to: home,
        departedAt: 0,
        arrivesAt: rng.range(0, 0.9),
        cargo: [],
      });
    }
  }

  // 5) 플레이어 회사: 작은 배 한 척과 약간의 현금으로 시작한다
  const start = createPlayer(ctx);
  ships.push(start.ship);

  return {
    ctx,
    state: {
      month: 0,
      rng: rng.getState(),
      cities,
      ships,
      companies,
      modifiers: [],
      sink: 0,
      player: start.player,
      spoiled: {},
      tech: { ...data.techByCountry },
      portLevel: { ...ctx.portSize },
      projects: [],
      nextProjectNo: 1,
      history: [],
      policies: [],
      cultureWaves: [],
      nextPolicyNo: 1,
      policyVersion: 0,
    },
  };
}

/**
 * 인구·소득·시설에서 목표 재고와 남겨 둘 몫을 다시 계산한다(처음과 해마다).
 *  - 쓰는 양 = 주민 수요 + 공장 투입
 *  - 직접 만들지 않는 상품은 배가 오가는 동안 버틸 몫을 더 쌓아 둔다
 *  - 생산지는 배가 실어 갈 때까지 쌓아 두는 수출 대기분도 정상 재고로 본다
 */
export function computeTargets(ctx: EconomyContext, city: CityEconomy): void {
  const data = ctx.data;
  for (const g of ctx.goods) {
    let usage = baseDemand(g, city.population, city.income);
    for (const ind of city.industries) {
      const recipe = ctx.goodById[ind.goodId].recipe;
      if (recipe?.[g.id]) usage += recipe[g.id] * ind.capacity;
    }
    const own = city.industries.find((i) => i.goodId === g.id);
    const localStock = usage * (g.stockMonths + (own ? 0 : data.setup.importBufferMonths));
    let t = localStock;
    if (own) {
      const exportable = Math.max(0, own.capacity - usage);
      const months = g.source?.kind === 'crop' ? data.setup.cropStorageMonths : data.setup.exportBufferMonths;
      t += exportable * months;
    }
    city.target[g.id] = t;
    city.reserve[g.id] = localStock * data.market.reserveShare;
  }
}

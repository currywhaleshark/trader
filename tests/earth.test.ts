import { beforeAll, describe, expect, it } from 'vitest';
import { applySettings, DEFAULT_SETTINGS } from '../src/sim/classroom/settings';
import { scenariosFor, validateScenario } from '../src/sim/classroom/scenarios';
import { botCommands, botFleet, botVoyages } from '../src/sim/economy/bot';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { inlandStep } from '../src/sim/economy/inland';
import { maxBuyable, shipBuyable } from '../src/sim/economy/market';
import { addStock } from '../src/sim/economy/origin';
import { lotTerms } from '../src/sim/economy/policy';
import {
  applyCommand,
  estimateVoyage,
  isDocked,
  payTransits,
  PLAYER_ID,
} from '../src/sim/economy/player';
import { judgeLoop } from '../src/sim/economy/routePlan';
import { voyageWaypoints } from '../src/sim/economy/routing';
import { createEconomy } from '../src/sim/economy/setup';
import { createGame } from '../src/sim/economy/start';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { EconomyContext, EconomyState } from '../src/sim/economy/types';
import { buildEarth, DEFAULT_EARTH_DEFINITIONS, type EarthSources } from '../src/sim/earth/buildEarth';
import { earthDefinitions } from '../src/sim/earth/definitions';
const EARTH_COUNTRIES = earthDefinitions().countries;
const EARTH_MARKETS = earthDefinitions().markets;
import { earthCountryFigures, EARTH_PROFILE } from '../src/sim/earth/profile';
import { economyDataFor } from '../src/sim/modes';
import { packWorld, unpackWorld } from '../src/sim/world/serialize';
import type { World } from '../src/sim/world/types';
import { readSaveFile, makeSaveFile, worldRef, checkSaveCompat } from '../src/ui/save';
import { loadEarthSources } from '../scripts/earthSources';

let src: EarthSources;
let world: World;
let ctx: EconomyContext;
let start: EconomyState;
const SEED = 'earth-1';

beforeAll(() => {
  src = loadEarthSources();
  world = buildEarth(src).world;
  const g = createGame(world, economyDataFor('earth'), SEED, { ...DEFAULT_SETTINGS, mode: 'earth', seed: SEED, scenarioId: 'earth-free' });
  ctx = g.ctx;
  start = g.state;
});

const fresh = () => structuredClone(start);

describe('E1: 실제 지구 지도·항구·해상 경로', () => {
  it('자료 검증을 모두 통과한다(항로·육지 회피·날짜변경선·내해·통과 연결)', () => {
    for (const c of world.validation.checks) expect(c.ok, `${c.label}: ${c.detail}`).toBe(true);
    expect(world.mode).toBe('earth');
    expect(world.cities.filter((c) => c.isPort).length).toBeGreaterThanOrEqual(12);
  });

  it('같은 자료면 같은 세계(지문)가 된다', () => {
    expect(buildEarth(src).world.hash).toBe(world.hash);
  });

  it('지도 단위 수와 경제 국가 수를 따로 둔다: 표시 전용 단위는 경제 국가가 없다', () => {
    const display = world.mapUnits.filter((u) => u.participation === 'display');
    expect(world.mapUnits.length).toBeGreaterThan(200);
    expect(world.countries.length).toBe(EARTH_COUNTRIES.length);
    expect(display.every((u) => !u.countryId)).toBe(true);
    expect(world.mapUnits.filter((u) => u.participation === 'hinterland').map((u) => u.countryId).sort()).toEqual(EARTH_COUNTRIES.filter((c) => c.participation === 'hinterland').map((c) => c.id).sort());
  });

  it('항구마다 운항 가능한 해상 진입점이 있다', () => {
    for (const c of world.cities.filter((x) => x.isPort)) expect(world.layers.seaZone[c.seaCell], c.id).toBe(1);
  });

  it('직렬화해도 16비트 지도 단위 레이어와 항로 대체 경로가 그대로다', () => {
    const { meta, binary } = packWorld(world);
    const back = unpackWorld(JSON.parse(JSON.stringify(meta)), binary.slice().buffer);
    expect(back.layers.countryId).toBeInstanceOf(Uint16Array);
    expect(Array.from(back.layers.countryId)).toEqual(Array.from(world.layers.countryId));
    expect(back.seaRoutes.find((r) => r.alternatives?.length)?.alternatives).toEqual(world.seaRoutes.find((r) => r.alternatives?.length)?.alternatives);
  });
});

describe('E2: 모드 분리와 경제 프로필', () => {
  it('현실 지구 프로필은 현실 지구의 경제권만, 가상 프로필은 가상 도시만 가진다', () => {
    expect(Object.keys(EARTH_PROFILE.cities).sort()).toEqual(world.cities.map((c) => c.id).sort());
    expect(() => createEconomy(world, DEFAULT_ECONOMY, SEED)).toThrow();
  });

  it('현실 지구 시나리오는 현실 지구의 항구·나라·상품만 가리킨다', () => {
    const goods = ctx.goods.map((g) => g.id);
    const list = scenariosFor('earth');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const sc of list) expect(validateScenario(sc, ctx.cityIds, world.countries.map((c) => c.id), goods, Object.keys(ctx.passages))).toEqual([]);
    // 가상 세계 시나리오는 현실 지구 id로는 통과하지 못한다(모드가 섞이지 않게)
    expect(scenariosFor('virtual').some((sc) => validateScenario(sc, ctx.cityIds, world.countries.map((c) => c.id), goods).length > 0)).toBe(true);
  });

  it('표시 전용 지도 단위를 더해도 생산·소비·NPC·재고가 늘지 않는다', () => {
    const extra: EarthSources = {
      ...src,
      naturalEarth: {
        features: [
          ...src.naturalEarth.features,
          { a3: 'ZZZ', isoA3: 'ZZZ', isoN3: '999', name: 'Test Isle', nameKo: '시험섬', continent: 'Oceania', labelLat: -50, labelLon: -140, rings: [[-14100, -5100, 200, 0, 0, 200, -200, 0]] },
        ],
      },
    };
    const w2 = buildEarth(extra).world;
    expect(w2.mapUnits.some((u) => u.id === 'ZZZ' && u.participation === 'display')).toBe(true);
    const a = createEconomy(world, economyDataFor('earth'), SEED).state;
    const b = createEconomy(w2, economyDataFor('earth'), SEED).state;
    expect(JSON.stringify(b.cities)).toBe(JSON.stringify(a.cities));
    expect(b.ships.length).toBe(a.ships.length);
  });

  it('다항구 국가: 경제권 인구 합 = 나라 게임 인구, 몫의 합 = 포함 비율', () => {
    for (const f of earthCountryFigures()) {
      const markets = EARTH_MARKETS.filter((m) => m.countryId === f.id);
      const pop = markets.reduce((s, m) => s + EARTH_PROFILE.cities[m.id].population, 0);
      expect(pop, f.id).toBeCloseTo(f.gamePopulation, 2);
      expect(markets.reduce((s, m) => s + m.share.pop, 0), f.id).toBeCloseTo(f.simShare, 9);
      for (const k of ['arable', 'forest', 'iron', 'oil'] as const) expect(markets.reduce((s, m) => s + (m.share[k] ?? 0), 0)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('다항구 국가: 미국을 한 경제권으로 합쳐도 세계 총수요와 상품별 총생산능력은 같다(복제 없음)', () => {
    const la = EARTH_MARKETS.find((m) => m.id === 'los_angeles')!;
    const ny = EARTH_MARKETS.find((m) => m.id === 'new_york')!;
    const merged = {
      ...ny,
      share: { pop: la.share.pop + ny.share.pop, arable: la.share.arable + ny.share.arable, forest: la.share.forest + ny.share.forest, iron: 1, oil: (la.share.oil ?? 0) + (ny.share.oil ?? 0) },
      factories: Object.fromEntries([...new Set([...Object.keys(la.factories), ...Object.keys(ny.factories)])].map((k) => [k, (la.factories[k] ?? 0) + (ny.factories[k] ?? 0)])),
    };
    const defs = { ...DEFAULT_EARTH_DEFINITIONS, markets: EARTH_MARKETS.filter((m) => m.id !== 'los_angeles').map((m) => (m.id === 'new_york' ? merged : m)) };
    const w2 = buildEarth(src, defs).world;
    const data2 = economyDataFor('earth');
    data2.cities.new_york = { ...data2.cities.new_york, population: data2.cities.new_york.population + data2.cities.los_angeles.population, factories: merged.factories };
    delete data2.cities.los_angeles;
    const a = createEconomy(world, economyDataFor('earth'), SEED).state;
    const b = createEconomy(w2, data2, SEED).state;
    const usPop = (s: EconomyState) => Object.values(s.cities).filter((c) => c.countryId === 'usa').reduce((t, c) => t + c.population, 0);
    expect(usPop(b)).toBeCloseTo(usPop(a), 6);
    const cap = (s: EconomyState) => {
      const out: Record<string, number> = {};
      for (const c of Object.values(s.cities)) for (const i of c.industries) out[i.goodId] = (out[i.goodId] ?? 0) + i.capacity;
      return out;
    };
    const ca = cap(a);
    const cb = cap(b);
    for (const g of ctx.goods) {
      if (g.source) continue; // 원재료는 땅·기후(경제권 위치)에 따라 나뉘므로 공장 상품만 비교한다
      expect(cb[g.id] ?? 0, g.id).toBeCloseTo(ca[g.id] ?? 0, 6);
    }
  });

  it('기술이 있어도 시설이 없으면 그 품목은 생산되지 않는다', () => {
    // 오스트레일리아는 전자부품 기술 단계(4)를 넘지만 전자부품 공장을 두지 않았다
    const aus = world.cities.filter((c) => c.countryId === 'aus').map((c) => start.cities[c.id]);
    expect(ctx.data.techByCountry.aus).toBeGreaterThanOrEqual(ctx.goodById.electronics.techRequired);
    for (const c of aus) expect(c.industries.some((i) => i.goodId === 'electronics')).toBe(false);
    let s = fresh();
    for (let m = 0; m < 6; m++) s = stepMonth(ctx, s).state;
    for (const c of aus) expect(s.cities[c.id].last.produced.electronics).toBe(0);
  });
});

describe('원자재 생산국과 판매(원유·철광석)', () => {
  const RAW = ['crude_oil', 'iron_ore'];
  const producers = (s: EconomyState, goodId: string) =>
    new Set(ctx.cityIds.filter((id) => s.cities[id].industries.some((i) => i.goodId === goodId && i.capacity > 0)).map((id) => ctx.countryOfCity[id]));

  it('실제 중간 규모 생산국도 생산국으로 남는다(국가 몫 문턱에 통째로 빠지지 않는다)', () => {
    const oil = producers(start, 'crude_oil');
    for (const c of ['sau', 'usa', 'rus', 'gbr', 'idn', 'mys', 'egy', 'arg', 'ind', 'aus', 'kaz']) expect(oil.has(c), c).toBe(true);
    for (const c of ['kor', 'jpn', 'twn', 'sgp']) expect(oil.has(c), c).toBe(false);
    const iron = producers(start, 'iron_ore');
    for (const c of ['aus', 'bra', 'ind', 'chn', 'zaf', 'usa', 'rus', 'kaz']) expect(iron.has(c), c).toBe(true);
    for (const c of ['kor', 'jpn']) expect(iron.has(c), c).toBe(false);
  });

  it('생산하지 않는 항구는 원유·철광석을 배에 팔지 않는다(처음과 1년 뒤)', () => {
    let s = fresh();
    const check = (st: EconomyState) => {
      for (const id of ctx.portIds) {
        for (const g of RAW) {
          const own = st.cities[id].industries.some((i) => i.goodId === g && i.capacity > 0);
          const gateway = ctx.inlandLinks.some((l) => l.portId === id && st.cities[l.inlandId].industries.some((i) => i.goodId === g && i.capacity > 0));
          if (!own && !gateway) expect(shipBuyable(ctx, st, st.cities[id], g), `${id} ${g}`).toBe(0);
        }
      }
    };
    check(s);
    for (let m = 0; m < 12; m++) s = stepMonth(ctx, s).state;
    check(s);
    // 플레이어도 부산에서 원유를 살 수 없다(재고는 있어도 정유용)
    const t = fresh();
    expect(t.cities.busan.stock.crude_oil).toBeGreaterThan(0);
    const me = t.ships.find((x) => x.companyId === PLAYER_ID)!;
    const r = applyCommand(ctx, t, { type: 'trade', shipId: me.id, goodId: 'crude_oil', side: 'buy', quantity: 5 });
    expect(r.ok).toBe(false);
    // 생산국 항구에서는 살 수 있다
    expect(shipBuyable(ctx, start, start.cities.ras_tanura, 'crude_oil')).toBeGreaterThan(0);
  });

  it('비생산 관문항도 배후 운송으로는 원유를 내륙에 넘길 수 있고, 가상 세계는 이 규칙을 쓰지 않는다', () => {
    const s = fresh();
    const rot = s.cities.rotterdam;
    // 로테르담에 수입 원유가 넉넉하고 스위스는 모자라 비싸다
    addStock(rot, 'crude_oil', rot.target.crude_oil, 'sau', 'sau');
    s.cities.swiss.stock.crude_oil = 0;
    s.cities.swiss.mix.crude_oil = {};
    s.cities.swiss.price.crude_oil = ctx.goodById.crude_oil.basePrice * 3;
    expect(shipBuyable(ctx, s, rot, 'crude_oil')).toBe(0);
    expect(maxBuyable(ctx, rot, 'crude_oil')).toBeGreaterThan(0);
    inlandStep(ctx, s, s.month);
    const sent = (s.inland ?? []).filter((x) => x.from === 'rotterdam' && x.to === 'swiss' && x.goodId === 'crude_oil');
    expect(sent.reduce((a, x) => a + x.quantity, 0)).toBeGreaterThan(0);
    expect(sent.some((x) => x.originCountryId === 'sau')).toBe(true);
    expect(DEFAULT_ECONOMY.market.rawOnlyFromSource).toBeFalsy();
  });
});

describe('E2: 배후 경제권(내륙국)', () => {
  it('내륙 경제권은 배가 직접 갈 수 없고 관문항과 배후 연결로 이어진다', () => {
    expect(ctx.portIds).not.toContain('swiss');
    expect(ctx.cityIds).toContain('swiss');
    const s = fresh();
    const ship = s.ships.find((x) => x.companyId === PLAYER_ID)!;
    const r = applyCommand(ctx, s, { type: 'sail', shipId: ship.id, to: 'czech' });
    expect(r.ok).toBe(false);
    expect(world.inlandLinks.map((l) => `${l.inlandId}>${l.portId}`)).toEqual(expect.arrayContaining(['czech>hamburg', 'swiss>rotterdam']));
    // 내륙 경제권마다 대표 관문항 하나
    for (const m of EARTH_MARKETS.filter((x) => x.kind === 'inland')) expect(world.inlandLinks.filter((l) => l.inlandId === m.id)).toHaveLength(1);
  });

  it('생산 100·소비 40, 시작 재고 0이면 내보낼 수 있는 양은 60 이하이고 이동 시간이 걸린다', () => {
    const s = fresh();
    s.inland = [];
    const g = 'machinery';
    const czech = s.cities.czech;
    const ham = s.cities.hamburg;
    czech.stock[g] = 0;
    czech.mix[g] = {};
    // 이번 달: 100을 만들고 40을 썼다 → 남은 60
    addStock(czech, g, 100, 'cze', 'cze');
    czech.stock[g] -= 40;
    czech.mix[g] = { 'cze/cze': 60 };
    czech.reserve[g] = 0;
    czech.price[g] = ctx.goodById[g].basePrice * 0.6;
    ham.price[g] = ctx.goodById[g].basePrice * 2;
    ham.stock[g] = 0;
    ham.mix[g] = {};
    const hamBefore = ham.stock[g];
    const before = totals(ctx, s).goods[g];
    inlandStep(ctx, s, s.month);
    const moving = (s.inland ?? []).filter((x) => x.goodId === g).reduce((t, x) => t + x.quantity, 0);
    expect(moving).toBeGreaterThan(0);
    expect(moving).toBeLessThanOrEqual(60 + 1e-9);
    // 이동 중인 물량은 아직 관문항 재고가 아니다
    expect(s.cities.hamburg.stock[g]).toBe(hamBefore);
    expect(totals(ctx, s).goods[g]).toBeCloseTo(before, 6);
    // 다음 달 처리에서 도착한다(원산지 체코 유지)
    inlandStep(ctx, s, s.month + 1);
    expect(s.cities.hamburg.stock[g]).toBeGreaterThan(hamBefore);
    expect(s.cities.hamburg.mix[g]['cze/cze']).toBeGreaterThan(0);
    expect(totals(ctx, s).goods[g]).toBeCloseTo(before, 6);
  });

  it('경유한 물건의 원산지는 그대로이고, 수입국 관세는 원산지 기준으로 한 번 매긴다', () => {
    const s = fresh();
    applyCommand(ctx, s, {
      type: 'addPolicy',
      policy: { kind: 'tariff', countries: ['jpn'], targets: ['cze'], goods: ['automobiles'], rate: 0.2, cause: 'scenario', startMonth: s.month, endMonth: s.month + 24, title: '시험 관세', causes: [], effects: [] },
    });
    // 함부르크에 체코산 자동차가 섞여 있어도 일본에서의 관세는 원산지(체코)로 정한다
    expect(lotTerms(ctx, s, 'yokohama', 'automobiles', 'cze', 'cze').tariff).toBeCloseTo(0.2);
    expect(lotTerms(ctx, s, 'yokohama', 'automobiles', 'deu', 'deu').tariff).toBe(0);
    // 배후 운송(체코→함부르크)에는 관세가 없다: 같은 물건에 두 번 매기지 않는다
    const tariffsBefore = Object.values(s.cities).reduce((t, c) => t + c.annual.tariffs, 0);
    inlandStep(ctx, s, s.month);
    inlandStep(ctx, s, s.month + 1);
    expect(Object.values(s.cities).reduce((t, c) => t + c.annual.tariffs, 0)).toBe(tariffsBefore);
  });
});

describe('E2·E3: 운하·해협과 항해 비용', () => {
  const smallPlayer = () => {
    const s = fresh();
    const ship = s.ships.find((x) => x.companyId === PLAYER_ID)!;
    s.player.cash = 200000;
    ship.from = 'shanghai';
    ship.to = 'shanghai';
    return { s, ship };
  };

  it('운하가 막히면 경로·기간·연료·통과료·지도 경로가 같은 우회 결과를 따른다', () => {
    const { s, ship } = smallPlayer();
    const open = estimateVoyage(ctx, ship.typeId!, 'shanghai', 'rotterdam', s);
    expect(open.passages).toContain('suez');
    expect(open.fees).toBeGreaterThan(0);
    applyCommand(ctx, s, { type: 'setPassage', passageId: 'suez', closed: true, reason: '시험 봉쇄' });
    const shut = estimateVoyage(ctx, ship.typeId!, 'shanghai', 'rotterdam', s);
    expect(shut.passages).not.toContain('suez');
    expect(shut.distanceKm).toBeGreaterThan(open.distanceKm + 3000);
    expect(shut.months).toBeGreaterThan(open.months);
    expect(shut.fuel).toBeGreaterThan(open.fuel);
    expect(shut.reasons.join(' ')).toContain('수에즈');
    const cash = s.player.cash;
    expect(applyCommand(ctx, s, { type: 'sail', shipId: ship.id, to: 'rotterdam' }).ok).toBe(true);
    // 실제 차감 = 견적 연료비, 도착 시각 = 견적 기간, 지도 경로 = 우회 경로
    expect(cash - s.player.cash).toBeCloseTo(shut.fuel, 6);
    expect(ship.arrivesAt - ship.departedAt).toBeCloseTo(shut.months, 6);
    expect(ship.voyage!.avoid).toContain('suez');
    expect(voyageWaypoints(ctx, ship)).toEqual(shut.leg!.waypoints);
    // NPC 운임도 같은 우회를 따른다
    expect(ctx.routeOptions('shanghai', 'rotterdam')[0].passages).toContain('suez');
  });

  it('통과료는 실제로 지날 때 한 번만 낸다', () => {
    const { s, ship } = smallPlayer();
    const v = estimateVoyage(ctx, ship.typeId!, 'shanghai', 'rotterdam', s);
    applyCommand(ctx, s, { type: 'sail', shipId: ship.id, to: 'rotterdam' });
    let state = s;
    for (let m = 0; m < 6 && !isDocked(state.ships.find((x) => x.id === ship.id)!); m++) state = stepMonth(ctx, state).state;
    const paid = state.player.lifetime.passageFees ?? 0;
    expect(paid).toBeCloseTo(v.fees, 6);
    // 한 번 더 처리해도 다시 내지 않는다
    const again = structuredClone(state);
    payTransits(ctx, again, again.month + 5);
    expect(again.player.lifetime.passageFees ?? 0).toBeCloseTo(v.fees, 6);
  });

  it('통과 지점·항구 근처를 지나는 것만으로 시장 재고·소비·하역량이 바뀌지 않는다', () => {
    const { s, ship } = smallPlayer();
    applyCommand(ctx, s, { type: 'sail', shipId: ship.id, to: 'rotterdam' });
    const before = JSON.stringify(s.cities);
    payTransits(ctx, s, s.month + 3);
    expect(JSON.stringify(s.cities)).toBe(before);
  });

  it('항해 중 봉쇄: 지금 위치에서 다시 찾고, 순간이동·비용 취소·통과료 중복이 없다', () => {
    const { s, ship } = smallPlayer();
    applyCommand(ctx, s, { type: 'sail', shipId: ship.id, to: 'rotterdam', at: s.month });
    const suezAt = ship.voyage!.transits.find((t) => t.id === 'suez')!.at;
    const now = s.month + Math.min(0.3, (suezAt - s.month) * 0.5);
    const fuelBefore = s.player.lifetime.fuel;
    const pathBefore = voyageWaypoints(ctx, ship)!;
    const r = applyCommand(ctx, s, { type: 'setPassage', passageId: 'suez', closed: true, reason: '시험', at: now });
    expect(r.ok).toBe(true);
    expect(r.events.some((e) => e.type === 'passage' && e.kind === 'reroute')).toBe(true);
    const v = ship.voyage!;
    expect(v.passages).not.toContain('suez');
    expect(v.path).toBeTruthy();
    // 새 경로의 첫 점은 원래 경로 위(순간이동 없음): 출발 항구 쪽 경로에서 멀지 않다
    const first = v.path![0];
    const nearOld = pathBefore.some((p) => Math.abs(p[0] - first[0]) + Math.abs(p[1] - first[1]) < 25);
    expect(nearOld).toBe(true);
    expect(ship.departedAt).toBeCloseTo(now, 9);
    expect(s.player.lifetime.fuel).toBeGreaterThanOrEqual(fuelBefore);
    // 막힌 수에즈의 통과료는 낼 일정에 없고, 새 길의 통과료만 지날 때 한 번 낸다
    expect(v.transits.some((t) => t.id === 'suez')).toBe(false);
    const due = v.transits.reduce((t, x) => t + x.fee, 0);
    let state = s;
    for (let m = 0; m < 8 && !isDocked(state.ships.find((x) => x.id === ship.id)!); m++) state = stepMonth(ctx, state).state;
    expect(state.ships.find((x) => x.id === ship.id)!.to).toBe('rotterdam');
    expect(state.player.lifetime.passageFees ?? 0).toBeCloseTo(due, 6);
  });

  it('지날 수 없는 크기의 배는 제한된 운하를 피해 간다(파나마 통행 제한)', () => {
    const s = fresh();
    applyCommand(ctx, s, { type: 'setPassage', passageId: 'panama', closed: false, maxShipSize: 2, reason: '가뭄' });
    const small = estimateVoyage(ctx, 'small', 'new_york', 'los_angeles', s);
    const big = estimateVoyage(ctx, 'container', 'new_york', 'los_angeles', s);
    expect(small.passages).toContain('panama');
    expect(big.passages).not.toContain('panama');
    expect(big.distanceKm).toBeGreaterThan(small.distanceKm * 2);
  });
});

describe('§9.3 운항 판단과 총순이익', () => {
  it('운항 자체의 손실: 판매 11,000·매입 10,000·연료 900·기타 200이면 유지비 전부터 −100이라 출항을 보류한다', () => {
    const j = judgeLoop({ tradeGain: 11000 - 10000, fuel: 900, fees: 200, upkeep: 300 });
    expect(j.contribution).toBe(-100);
    expect(j.sail).toBe(false);
  });

  it('총순이익과 정박 비교: 연료 600·기타 200·유지비 300이면 총순이익 −100(수익 항로 아님), 출항은 정박보다 낫다', () => {
    const j = judgeLoop({ tradeGain: 1000, fuel: 600, fees: 200, upkeep: 300 });
    expect(j.net).toBe(-100);
    expect(j.profitable).toBe(false);
    expect(j.contribution).toBe(200);
    expect(j.sail).toBe(true);
  });
});

describe('E2: 처음부터 끝까지 플레이(현실 지구)', () => {
  it('부산에서 작은 배로 시작해 첫 거래·이익·배 늘리기까지 이어지고, 저장 후 이어서 같은 결과가 난다', () => {
    let s = fresh();
    const me = s.ships.find((x) => x.companyId === PLAYER_ID)!;
    expect(me.to).toBe('busan');
    expect(me.typeId).toBe('small');
    const opt = { buyShips: ['small', 'medium'], keepCashPerShip: 10000 };
    const startCash = s.player.cash;
    let saved: string | null = null;
    for (let m = 0; m < 48; m++) {
      s = structuredClone(s);
      for (const phase of [botCommands, botFleet, botVoyages]) for (const cmd of phase(ctx, s, opt)) applyCommand(ctx, s, cmd);
      s = stepMonth(ctx, s).state;
      if (m === 24) saved = JSON.stringify(makeSaveFile({ label: 't', world: worldRef(world, ctx.data), settings: { ...DEFAULT_SETTINGS, mode: 'earth', seed: SEED }, state: s }));
    }
    expect(s.player.tradeCount).toBeGreaterThan(5);
    expect(s.ships.filter((x) => x.companyId === PLAYER_ID).length).toBeGreaterThanOrEqual(2);
    expect(s.player.cash + s.ships.filter((x) => x.companyId === PLAYER_ID).length * 20000).toBeGreaterThan(startCash);
    // 저장 파일로 이어 하기: 같은 세계·프로필이면 불러올 수 있고, 같은 명령이면 같은 결과
    const file = readSaveFile(JSON.parse(saved!))!;
    expect(file.world.mode).toBe('earth');
    expect(checkSaveCompat(file, world, ctx.data).ok).toBe(true);
    const ctx2 = createEconomy(world, applySettings(economyDataFor('earth'), file.settings), file.settings.seed).ctx;
    const a = stepMonth(ctx2, file.state).state;
    const b = stepMonth(ctx, file.state).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('자동항로를 배정하면 현실 지구에서도 돌고, 장부의 물량·돈이 맞는다', () => {
    let s = fresh();
    s.player.cash = 300000;
    const r = applyCommand(ctx, s, {
      type: 'saveRoute',
      route: {
        name: '부산–상하이',
        stops: [
          { cityId: 'busan', buy: [{ goodId: 'automobiles', maxQuantity: 30 }], sell: ['textiles', 'clothing'] },
          { cityId: 'shanghai', buy: [{ goodId: 'clothing', maxQuantity: 30 }], sell: ['automobiles'] },
        ],
        minMargin: 0,
        cashReserve: 0,
      },
    });
    expect(r.ok).toBe(true);
    const ship = s.ships.find((x) => x.companyId === PLAYER_ID)!;
    expect(applyCommand(ctx, s, { type: 'assignRoute', shipId: ship.id, routeId: s.player.routes[0].id }).ok).toBe(true);
    const before = totals(ctx, s);
    let trips = 0;
    for (let m = 0; m < 12; m++) {
      const b = totals(ctx, s);
      s = stepMonth(ctx, s).state;
      const a = totals(ctx, s);
      // 물량 보존(상품별): 모든 재고 + 배의 짐 + 배후 운송 중 + 상해 버린 양의 변화 = 생산 − 소비 − 공장 투입.
      // 매매·운송·환적은 위치와 주인만 바꾼다.
      for (const g of ctx.goods) {
        let made = 0;
        for (const id of ctx.cityIds) {
          const l = s.cities[id].last;
          made += l.produced[g.id] - l.consumed[g.id] - l.usedAsInput[g.id];
        }
        expect(a.goods[g.id] - b.goods[g.id], `${g.id} ${m}월`).toBeCloseTo(made, 3);
      }
      trips += s.player.chronicle.length > 0 ? 1 : 0;
    }
    const after = totals(ctx, s);
    expect(s.ships.find((x) => x.id === ship.id)!.routeId).toBe(s.player.routes[0].id);
    expect(trips).toBeGreaterThan(0);
    expect(after.money).toBeCloseTo(before.money, 3);
  });

  it('3년 동안 같은 시드·같은 자료면 같은 결과이고 값이 발산하지 않는다', () => {
    const run = () => {
      let s = fresh();
      for (let m = 0; m < 36; m++) s = stepMonth(ctx, s).state;
      return s;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const id of ctx.cityIds) {
      for (const g of ctx.goods) {
        const c = a.cities[id];
        expect(Number.isFinite(c.price[g.id]) && c.stock[g.id] >= 0).toBe(true);
        expect(c.price[g.id]).toBeLessThanOrEqual(g.basePrice * ctx.data.market.priceCeil + 1e-6);
      }
    }
  });
});

describe('규모 설정(§2.2): 통합 검증판과 첫 정식 범위', () => {
  it('핵심 범위(14개 항구·내륙 2곳)도 같은 엔진으로 만들어지고 돈다', async () => {
    const { earthDefinitions } = await import('../src/sim/earth/definitions');
    const { buildEarthProfile } = await import('../src/sim/earth/profile');
    const { buildEconomyData } = await import('../src/sim/economy/data');
    const defs = earthDefinitions('core');
    const w = buildEarth(src, defs).world;
    expect(w.validation.ok).toBe(true);
    expect(w.cities.filter((c) => c.isPort)).toHaveLength(14);
    expect(w.dataVersion).not.toBe(world.dataVersion);
    const g = createGame(w, buildEconomyData(buildEarthProfile(defs)), SEED);
    let s = g.state;
    for (let m = 0; m < 6; m++) s = stepMonth(g.ctx, s).state;
    expect(Object.keys(s.cities)).toHaveLength(16);
    // 전체 범위의 저장은 핵심 범위 세계에서 불러오지 않는다(없는 항구를 다른 항구에 잇지 않는다)
    const file = makeSaveFile({ label: 't', world: worldRef(world, ctx.data), settings: { ...DEFAULT_SETTINGS, mode: 'earth', seed: SEED }, state: start });
    expect(checkSaveCompat(file, w, g.ctx.data).ok).toBe(false);
  });
});

describe('§9.2 운항 자금', () => {
  it('물건을 산 뒤 다음 구간의 연료·통과료를 낼 수 없는 계획을 그대로 확정하지 않는다', async () => {
    const { legInfo } = await import('../src/sim/economy/routePlan');
    let s = fresh();
    const ship = s.ships.find((x) => x.companyId === PLAYER_ID)!;
    expect(ship.to).toBe('busan');
    const r = applyCommand(ctx, s, {
      type: 'saveRoute',
      route: {
        name: '부산–로테르담',
        stops: [
          { cityId: 'busan', buy: [{ goodId: 'electronics', maxQuantity: 100 }, { goodId: 'automobiles', maxQuantity: 30 }], sell: [] },
          { cityId: 'rotterdam', buy: [], sell: ['electronics', 'automobiles'] },
        ],
        minMargin: 0,
        cashReserve: 0,
      },
    });
    expect(r.ok).toBe(true);
    const leg = legInfo(ctx, ship.typeId!, 'busan', 'rotterdam', s);
    expect(leg.fees).toBeGreaterThan(0);
    // 물건값으로 쓸 돈은 조금, 연료·통과료는 딱 낼 수 있을 만큼
    s.player.cash = leg.fuel + leg.fees + 4000;
    applyCommand(ctx, s, { type: 'assignRoute', shipId: ship.id, routeId: s.player.routes[0].id });
    s = stepMonth(ctx, s).state;
    const after = s.ships.find((x) => x.id === ship.id)!;
    // 짐을 샀다면 반드시 떠났어야 한다(연료가 모자라 기다리지 않는다)
    if (after.cargo.length > 0) {
      expect(after.to).toBe('rotterdam');
      expect(after.routeWait?.reason).not.toBe('fuel');
    }
    expect(after.routeWait?.reason).not.toBe('fuel');
    expect(s.player.cash).toBeGreaterThanOrEqual(-1e-6);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { buildReport, reportToText } from '../src/sim/classroom/report';
import { scenarioById, SCENARIOS } from '../src/sim/classroom/scenarios';
import { DEFAULT_SETTINGS, type GameSettings } from '../src/sim/classroom/settings';
import { botCommands, botFleet, botVoyages } from '../src/sim/economy/bot';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { applyCommand, isDocked } from '../src/sim/economy/player';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import type { EconomyContext, EconomyState, SimEvent } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import type { World } from '../src/sim/world/types';

let world: World;

beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
});

function game(over: Partial<GameSettings>) {
  const settings = { ...DEFAULT_SETTINGS, ...over };
  return createGame(world, DEFAULT_ECONOMY, settings.seed, settings);
}

/** 봇으로 months개월 플레이(bot=false면 시간만 흐름) */
function play(ctx: EconomyContext, start: EconomyState, months: number, bot = true): { state: EconomyState; events: SimEvent[] } {
  let state = start;
  const events: SimEvent[] = [];
  const opt = { buyShips: ['small'], keepCashPerShip: 25000 };
  for (let m = 0; m < months; m++) {
    state = structuredClone(state);
    if (bot) for (const phase of [botCommands, botFleet, botVoyages]) for (const cmd of phase(ctx, state, opt)) applyCommand(ctx, state, cmd);
    const r = stepMonth(ctx, state);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe('교사 설정', () => {
  it('자동 정책·유행을 끄면 저절로 생기지 않는다(시나리오 사건은 따로)', () => {
    const { ctx, state } = game({ scenarioId: 'none', autoPolicies: false, autoCulture: false });
    const { events } = play(ctx, state, 12 * 12, false);
    expect(events.some((e) => e.type === 'policy' && e.kind !== 'review')).toBe(false);
  }, 120_000);

  it('장기 성장을 끄면 인구·시설이 그대로다', () => {
    const { ctx, state } = game({ scenarioId: 'none', longTermGrowth: false });
    const { state: end, events } = play(ctx, state, 36, false);
    expect(events.some((e) => e.type === 'growth')).toBe(false);
    for (const id of ctx.cityIds) {
      expect(end.cities[id].population).toBe(state.cities[id].population);
      expect(end.cities[id].industries.length).toBe(state.cities[id].industries.length);
    }
    expect(end.history.length).toBeGreaterThan(state.history.length); // 기록은 계속된다
  });

  it('시작 자금을 바꿀 수 있다', () => {
    expect(game({ startingCash: 77777 }).state.player.cash).toBe(77777);
  });
});

describe('수업 시나리오', () => {
  it('모든 시나리오의 사건 도시·상품·나라가 실제로 있다', () => {
    const { ctx } = game({});
    for (const s of SCENARIOS) {
      expect(s.minutes).toBeGreaterThanOrEqual(20);
      expect(s.minutes).toBeLessThanOrEqual(40);
      for (const t of s.triggers) {
        const a = t.action as Record<string, unknown>;
        if (typeof a.cityId === 'string') expect(ctx.cityIds, t.id).toContain(a.cityId);
        if (typeof a.goodId === 'string') expect(ctx.goodById[a.goodId], t.id).toBeDefined();
        for (const k of [...((a.countries as string[]) ?? []), ...((a.targets as string[]) ?? [])]) expect(ctx.countryNames[k], t.id).toBeDefined();
        if (typeof a.brand === 'string') expect(ctx.countryNames[a.brand]).toBeDefined();
      }
    }
  });

  it('정해진 달에 사건이 일어나고 경제 변수가 바뀐다', () => {
    const { ctx, state } = game({ scenarioId: 'first-trade' });
    const def = scenarioById('first-trade')!;
    const drought = def.triggers.find((t) => t.id === 'drought-north')!;
    const before = play(ctx, state, drought.atMonth, false);
    expect(before.state.scenario!.fired).not.toContain('drought-north');
    const after = play(ctx, before.state, 1, false);
    expect(after.state.scenario!.fired).toContain('drought-north');
    expect(after.events.some((e) => e.type === 'scenario' && e.kind === 'trigger' && e.text.includes('가뭄'))).toBe(true);
    expect(after.state.modifiers.some((m) => m.cityId === 'lumen' && m.goodId === 'grain' && m.factor < 1)).toBe(true);
  });

  it('관세 시나리오는 협정·관세·갈등·유행을 차례로 건다', () => {
    const { ctx, state } = game({ scenarioId: 'tariffs' });
    const { state: end } = play(ctx, state, 80, false);
    expect(end.policies.some((p) => p.kind === 'fta' && p.countries.includes('karuna') && p.countries.includes('orden'))).toBe(true);
    expect(end.policies.some((p) => p.kind === 'tariff' && p.goods?.includes('clothing'))).toBe(true);
    expect(end.policies.some((p) => p.cause === 'conflict')).toBe(true);
    expect(end.cultureWaves.some((w) => w.brand === 'astera')).toBe(true);
  }, 120_000);

  it('목표를 이루면 그 달이 기록되고, 기간이 끝나면 알린다', () => {
    const { ctx, state } = game({ scenarioId: 'first-trade' });
    const def = scenarioById('first-trade')!;
    const { state: end, events } = play(ctx, state, def.months + 1);
    expect(end.scenario!.goalsDone['first-sale']).toBeGreaterThanOrEqual(state.month);
    expect(events.some((e) => e.type === 'scenario' && e.kind === 'goal')).toBe(true);
    expect(events.some((e) => e.type === 'scenario' && e.kind === 'end')).toBe(true);
    expect(end.scenario!.ended).toBe(true);
  }, 120_000);
});

describe('거래 연대기', () => {
  it('거래마다 산 곳이 왜 쌌고 판 곳이 왜 비쌌는지 남는다', () => {
    const { ctx, state } = game({ scenarioId: 'first-trade' });
    const { state: end } = play(ctx, state, 12);
    const chron = end.player.chronicle;
    expect(chron.length).toBeGreaterThan(3);
    for (const e of chron) {
      expect(e.sourceReason.text.length).toBeGreaterThan(5);
      expect(e.destReason.text.length).toBeGreaterThan(5);
      expect(e.profit).toBeCloseTo(e.revenue - e.tariff - e.cost, 6);
      expect(e.origins.length).toBeGreaterThan(0);
    }
    expect(end.player.tradeCount).toBe(chron.length);
  });

  it('곡물 농장이 있는 도시에서 산 곡물의 이유는 기후나 계절이다', () => {
    const { ctx, state } = game({ scenarioId: 'none' });
    const s = structuredClone(state);
    s.player.cash = 1e6;
    const ship = s.ships.find((x) => x.id === 'p1')!;
    ship.from = ship.to = 'lumen';
    expect(applyCommand(ctx, s, { type: 'trade', shipId: 'p1', goodId: 'grain', side: 'buy', quantity: 20 }).ok).toBe(true);
    ship.from = ship.to = 'granbel';
    expect(isDocked(ship)).toBe(true);
    expect(applyCommand(ctx, s, { type: 'trade', shipId: 'p1', goodId: 'grain', side: 'sell', quantity: 20 }).ok).toBe(true);
    const e = s.player.chronicle[s.player.chronicle.length - 1];
    expect(['climate', 'season']).toContain(e.sourceReason.category);
    expect(e.fromCityId).toBe('lumen');
    expect(e.toCityId).toBe('granbel');
  });
});

describe('수업 리포트 (M5 완료 조건)', () => {
  let report: ReturnType<typeof buildReport>;
  beforeAll(() => {
    const { ctx, state } = game({ scenarioId: 'first-trade' });
    const { state: end } = play(ctx, state, 36);
    report = buildReport(ctx, end);
  }, 120_000);

  it('무역이 생긴 이유를 여러 갈래로, 실제 거래 예와 함께 보여 준다', () => {
    const cats = report.reasons.map((r) => r.category).filter((c) => c !== 'market');
    expect(cats.length).toBeGreaterThanOrEqual(3);
    for (const r of report.reasons) {
      expect(r.count).toBeGreaterThan(0);
      expect(r.examples.length).toBeGreaterThan(0);
      for (const t of r.examples) expect(t).not.toMatch(/\((이|가|을|를|은|는|으)\)/);
    }
  });

  it('나라 사이 상호 의존의 구체적 사례가 들어 있다', () => {
    expect(report.interdependence.length).toBeGreaterThan(0);
    expect(report.interdependence[0]).toMatch(/\d+%/);
    expect(report.mutual.length).toBeGreaterThan(0);
  });

  it('회사 성적·내 역할·질문이 있고 글로 내보낼 수 있다', () => {
    expect(report.company.trades).toBeGreaterThan(0);
    expect(report.myRole.length).toBeGreaterThan(0);
    expect(report.questions.length).toBeGreaterThanOrEqual(3);
    expect(report.scenario?.goals.length).toBeGreaterThan(0);
    const text = reportToText(report);
    for (const h of ['무역은 왜 생겼을까?', '나라들은 서로 기대고 있어요', '생각해 볼 질문']) expect(text).toContain(h);
  });
});

describe('저장·이어하기', () => {
  it('JSON으로 저장했다 불러와 이어 하면 그대로 이어진다', () => {
    const { ctx, state } = game({ scenarioId: 'tariffs' });
    const mid = play(ctx, state, 20).state;
    const saved = JSON.stringify(mid);
    const restored = JSON.parse(saved) as EconomyState;
    const a = play(ctx, mid, 12).state;
    const b = play(ctx, restored, 12).state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 120_000);

  it('같은 설정이면 모둠마다 같은 세계·같은 사건으로 시작한다', () => {
    const a = game({ scenarioId: 'tariffs' });
    const b = game({ scenarioId: 'tariffs' });
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});

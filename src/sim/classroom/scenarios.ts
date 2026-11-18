import { applyCommand, netProfit, PLAYER_ID } from '../economy/player';
import type { Command, EconomyContext, EconomyState, SimEvent } from '../economy/types';
import type { GameSettings } from './settings';
import type { WorldMode } from '../world/types';
import { EARTH_SCENARIOS } from '../earth/scenarios';

/**
 * 수업용 시나리오(M5). 정해진 때 일어나는 사건(트리거)과 학생이 이룰 목표를 데이터로 정의한다.
 * 사건은 경제 변수만 바꾼다(생산 차질·관세·협정·유행). 값은 공통 시장 규칙으로 반응한다.
 * 진행 상황은 상태(state.scenario)에 들어 있어 저장·이어하기와 재현이 된다.
 */

export type TriggerAction =
  | { kind: 'news' }
  | { kind: 'harvestFailure'; cityId: string; goodId: string; factor: number; months: number; reason: string }
  | { kind: 'tariff'; countries: string[]; targets?: string[]; goods?: string[]; rate: number; years: number; conflict?: boolean; title: string; causes: string[]; effects: string[] }
  | { kind: 'fta'; countries: string[]; years: number; title: string; causes: string[]; effects: string[] }
  | { kind: 'culture'; brand: string; countries: string[]; strength: number; years: number; title: string; causes: string[]; effects: string[] }
  /** 운하·해협을 막거나 열거나 큰 배를 제한한다(maxShipSize: null이면 제한 해제) */
  | { kind: 'passage'; passageId: string; closed: boolean; maxShipSize?: 1 | 2 | 3 | null; reason: string };

export interface ScenarioTrigger {
  id: string;
  /** 시나리오 시작부터 몇 달째에 */
  atMonth: number;
  action: TriggerAction;
  /** 학생에게 보이는 소식 */
  headline: string;
  /** 생각해 볼 질문(선택) */
  question?: string;
}

export type GoalKind =
  | { kind: 'firstSale' }
  | { kind: 'profit'; target: number }
  | { kind: 'ships'; target: number }
  | { kind: 'deliver'; goodId: string; target: number }
  | { kind: 'countries'; target: number }
  | { kind: 'crossContinent'; target: number }
  | { kind: 'reason'; category: string; target: number }
  | { kind: 'reasonKinds'; target: number }
  /** 이 나라들이 원산지인 물건을 판 횟수(경유항을 거쳐도 원산지로 센다) */
  | { kind: 'origin'; countries: string[]; target: number };

export interface ScenarioGoal {
  id: string;
  text: string;
  check: GoalKind;
}

export interface ScenarioDef {
  id: string;
  /** 이 시나리오를 쓰는 세계 모드(없으면 가상 세계). 대상 도시·나라 id가 그 모드의 것이어야 한다. */
  modes?: WorldMode[];
  title: string;
  /** 권장 수업 시간(분) */
  minutes: number;
  /** 게임 속 진행 기간(달). 끝나면 리포트를 보라고 알린다(게임은 계속된다) */
  months: number;
  /** 교사용 설명 */
  summary: string;
  /** 연결되는 성취기준·핵심 질문 */
  learning: string[];
  /** 이 시나리오가 권하는 설정(교사가 바꿀 수 있다) */
  settings: Partial<GameSettings>;
  triggers: ScenarioTrigger[];
  goals: ScenarioGoal[];
}

export interface ScenarioProgress {
  id: string;
  startMonth: number;
  fired: string[];
  /** 목표 id -> 이룬 달 */
  goalsDone: Record<string, number>;
  ended: boolean;
  /** 교사가 끈 사건 id */
  disabled?: string[];
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'first-trade',
    title: '첫 무역 — 남는 곳에서 모자라는 곳으로',
    minutes: 20,
    months: 60,
    summary: '작은 배 한 척으로 시작해, 값이 싼 곳에서 사서 비싼 곳에 파는 무역의 기본을 익힌다. 2년째에 북쪽 곡창에 가뭄이 들어 곡물 값이 출렁인다.',
    learning: ['[6사11-03] 무역이 발생하는 이유: 나라마다 자연환경·자원·기술이 다르다', '왜 같은 물건이 도시마다 값이 다를까?'],
    settings: { autoPolicies: false, autoCulture: false, longTermGrowth: true, showHints: true },
    triggers: [
      { id: 'intro', atMonth: 1, action: { kind: 'news' }, headline: '시장 보기에서 같은 상품이 어디서 싸고 어디서 비싼지 찾아보세요.', question: '왜 곡물은 어떤 도시에서는 싸고 어떤 도시에서는 비쌀까요?' },
      {
        id: 'drought-north', atMonth: 14,
        action: { kind: 'harvestFailure', cityId: 'lumen', goodId: 'grain', factor: 0.3, months: 12, reason: '가뭄' },
        headline: '루멘에 가뭄이 들어 곡물 수확이 크게 줄었어요.',
        question: '루멘 곡물이 모자라면 루멘에서 곡물을 사 가던 도시들은 어떻게 될까요?',
      },
      { id: 'second-ship', atMonth: 30, action: { kind: 'news' }, headline: '돈이 모였다면 배를 한 척 더 사 볼까요? 결과·회사 탭에서 살 수 있어요.' },
    ],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'grain', text: '곡물 100개를 다른 도시에 실어 나르기', check: { kind: 'deliver', goodId: 'grain', target: 100 } },
      { id: 'profit', text: '순이익 2만 만들기', check: { kind: 'profit', target: 20000 } },
      { id: 'ships', text: '배 두 척 가지기', check: { kind: 'ships', target: 2 } },
      { id: 'reasons', text: '서로 다른 이유 3가지로 무역해 보기(기후·자원·공장·계절…)', check: { kind: 'reasonKinds', target: 3 } },
    ],
  },
  {
    id: 'two-hemispheres',
    title: '반대인 계절 — 북반구와 남반구',
    minutes: 25,
    months: 72,
    summary: '보레아(북)와 메리디아(남) 대륙은 계절이 반대라 곡물 수확기가 다르다. 수확기 차이를 이용해 두 대륙 사이 곡물 무역을 경험한다.',
    learning: ['[6사09-01] 지구본·위도와 계절', '[6사10-02] 세계의 기후와 인간 생활', '왜 같은 달에 어떤 곳은 수확철이고 어떤 곳은 아닐까?'],
    settings: { autoPolicies: false, autoCulture: false, longTermGrowth: false, showHints: true },
    triggers: [
      { id: 'season-hint', atMonth: 1, action: { kind: 'news' }, headline: '지도의 「수확 시기」 레이어를 켜 보세요. 북쪽과 남쪽 대륙의 색이 어떻게 다른가요?', question: '1월에 남반구는 무슨 계절일까요?' },
      {
        id: 'storm-south', atMonth: 28,
        action: { kind: 'harvestFailure', cityId: 'draven', goodId: 'grain', factor: 0.4, months: 8, reason: '태풍' },
        headline: '드라벤에 태풍이 지나가 곡물 밭이 망가졌어요.',
      },
    ],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'season', text: '수확철 차이 때문에 생긴 거래 2번 하기', check: { kind: 'reason', category: 'season', target: 2 } },
      { id: 'cross', text: '다른 대륙으로 3번 실어 나르기', check: { kind: 'crossContinent', target: 3 } },
      { id: 'grain', text: '곡물 200개 실어 나르기', check: { kind: 'deliver', goodId: 'grain', target: 200 } },
    ],
  },
  {
    id: 'tariffs',
    title: '관세와 자유무역협정',
    minutes: 40,
    months: 108,
    summary: '협정·관세·무역 갈등·문화 유행이 차례로 일어난다. 같은 물건이라도 어느 나라에서 만들었는지(원산지)에 따라 남는 돈이 달라지는 것을 경험하고, 정책이 생산자·소비자·무역회사에 서로 다르게 작용함을 확인한다.',
    learning: ['[6사11-03] 국가 간 경쟁과 상호 의존(심화)', '관세는 누구에게 좋고 누구에게 부담일까?', '협정을 맺으면 왜 무역이 늘어날까?'],
    settings: { autoPolicies: false, autoCulture: false, longTermGrowth: true, showHints: true },
    triggers: [
      {
        id: 'fta', atMonth: 6,
        action: {
          kind: 'fta', countries: ['karuna', 'orden'], years: 10,
          title: '카루나·오르덴 자유무역협정',
          causes: ['두 나라는 서로 필요한 물건(카루나의 과일·직물, 오르덴의 곡물·철강)이 달라 더 많이 사고팔고 싶었어요.'],
          effects: ['두 나라가 만든 물건은 서로 관세 없이 팔 수 있어요.', '다른 나라에서 만든 물건은 회원국 항구를 거쳐 와도 혜택이 없어요.'],
        },
        headline: '카루나와 오르덴이 자유무역협정을 맺었어요.',
        question: '협정은 누구에게 도움이 될까요? 협정에 들지 못한 나라는요?',
      },
      {
        id: 'tariff-protect', atMonth: 24,
        action: {
          kind: 'tariff', countries: ['orden'], goods: ['clothing'], rate: 0.3, years: 5,
          title: '오르덴의 의류 수입 관세 30%',
          causes: ['오르덴 의류 공장들이 값싼 수입 의류 때문에 어렵다고 정부에 보호를 요청했어요.'],
          effects: ['오르덴 의류 공장: 더 잘 팔릴 수 있어요.', '오르덴 소비자: 옷값이 오를 수 있어요.', '무역회사: 오르덴에 옷을 팔 때 관세를 내요. 단, 협정국 카루나에서 만든 옷은 관세가 없어요.'],
        },
        headline: '오르덴이 수입 의류에 30% 관세를 매기기 시작했어요.',
        question: '같은 옷이라도 어느 나라에서 만들었는지가 왜 중요할까요?',
      },
      {
        id: 'conflict', atMonth: 48,
        action: {
          kind: 'tariff', countries: ['velorin'], targets: ['astera'], goods: ['electronics', 'automobiles'], rate: 0.35, years: 4, conflict: true,
          title: '벨로린의 아스테라산 전자부품·자동차 관세 35%',
          causes: ['벨로린은 아스테라에서 사 오는 것이 파는 것보다 훨씬 많았어요(무역 적자).'],
          effects: ['벨로린 자동차 공장: 원료인 전자부품 값이 올라 부담이 커져요.', '아스테라 수출업자: 다른 시장을 찾아야 해요.', '무역회사: 다른 나라에서 만든 전자부품을 실어 가면 관세를 피할 수 있어요.'],
        },
        headline: '벨로린과 아스테라 사이에 무역 갈등이 생겼어요.',
      },
      {
        id: 'culture', atMonth: 72,
        action: {
          kind: 'culture', brand: 'astera', countries: ['orden', 'miren'], strength: 1, years: 3,
          title: '아스테라 드라마 「별빛 시장」 유행',
          causes: ['아스테라 드라마 「별빛 시장」이 오르덴·미렌에서 큰 인기를 얻었어요.'],
          effects: ['오르덴·미렌 사람들이 아스테라 상표 화장품·의류를 더 찾아요.', '물건이 저절로 생기지는 않아요. 누군가 실어 와야 해요.'],
        },
        headline: '아스테라 드라마가 오르덴과 미렌에서 크게 유행해요.',
        question: '드라마가 인기를 끌면 왜 화장품이 더 팔릴까요?',
      },
    ],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'countries', text: '네 나라 이상에 물건 팔기', check: { kind: 'countries', target: 4 } },
      { id: 'policy', text: '관세나 자유무역협정이 영향을 준 거래 하기', check: { kind: 'reason', category: 'policy', target: 1 } },
      { id: 'culture', text: '문화 유행 덕분에 비싸게 판 거래 하기', check: { kind: 'reason', category: 'culture', target: 1 } },
      { id: 'profit', text: '순이익 5만 만들기', check: { kind: 'profit', target: 50000 } },
    ],
  },
  {
    id: 'free',
    title: '자유 놀이',
    minutes: 40,
    months: 360,
    summary: '사건을 미리 정하지 않는다. 나라들이 스스로 관세·협정을 정하고 문화 유행도 저절로 생긴다.',
    learning: ['30년 동안 나라들의 산업과 무역이 어떻게 바뀌는지 관찰한다.'],
    settings: { autoPolicies: true, autoCulture: true, longTermGrowth: true, showHints: true },
    triggers: [],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'ships', text: '배 다섯 척 가지기', check: { kind: 'ships', target: 5 } },
      { id: 'countries', text: '여섯 나라 모두와 무역하기', check: { kind: 'countries', target: 6 } },
    ],
  },
  ...EARTH_SCENARIOS,
];

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** 이 모드에서 고를 수 있는 시나리오 */
export function scenariosFor(mode: WorldMode): ScenarioDef[] {
  return SCENARIOS.filter((s) => (s.modes ?? ['virtual']).includes(mode));
}

/**
 * 시나리오가 가리키는 도시·나라·상품 id가 이 세계·경제에 모두 있는지(모드가 섞이지 않게).
 * 문제 목록을 돌려준다(비어 있으면 통과).
 */
export function validateScenario(def: ScenarioDef, cityIds: string[], countryIds: string[], goodIds: string[], passageIds: string[] = []): string[] {
  const out: string[] = [];
  const city = new Set(cityIds);
  const country = new Set(countryIds);
  const good = new Set(goodIds);
  const needCity = (id: string) => !city.has(id) && out.push(`${def.id}: 없는 도시 ${id}`);
  const needCountry = (id: string) => !country.has(id) && out.push(`${def.id}: 없는 나라 ${id}`);
  const needGood = (id: string) => !good.has(id) && out.push(`${def.id}: 없는 상품 ${id}`);
  for (const t of def.triggers) {
    const a = t.action;
    if (a.kind === 'harvestFailure') {
      needCity(a.cityId);
      needGood(a.goodId);
    } else if (a.kind === 'tariff') {
      a.countries.forEach(needCountry);
      a.targets?.forEach(needCountry);
      a.goods?.forEach(needGood);
    } else if (a.kind === 'fta') a.countries.forEach(needCountry);
    else if (a.kind === 'culture') {
      needCountry(a.brand);
      a.countries.forEach(needCountry);
    } else if (a.kind === 'passage' && !passageIds.includes(a.passageId)) out.push(`${def.id}: 없는 통과 지점 ${a.passageId}`);
  }
  for (const g of def.goals) {
    if (g.check.kind === 'deliver') needGood(g.check.goodId);
    if (g.check.kind === 'origin') g.check.countries.forEach(needCountry);
  }
  if (def.settings.startCityId) needCity(def.settings.startCityId);
  return out;
}

export function startScenario(state: EconomyState, id: string, disabled: string[] = []): void {
  state.scenario = { id, startMonth: state.month, fired: [], goalsDone: {}, ended: false, ...(disabled.length ? { disabled: [...disabled] } : {}) };
}

/** 목표를 지금 얼마나 이뤘는가(0~1)와 현재값 */
export function goalProgress(ctx: EconomyContext, state: EconomyState, goal: ScenarioGoal): { value: number; target: number; ratio: number } {
  const p = state.player;
  const chron = p.chronicle;
  const c = goal.check;
  let value = 0;
  let target = 1;
  switch (c.kind) {
    case 'firstSale':
      value = p.tradeCount > 0 ? 1 : 0;
      break;
    case 'profit':
      value = netProfit(p.lifetime);
      target = c.target;
      break;
    case 'ships':
      value = state.ships.filter((s) => s.companyId === PLAYER_ID).length;
      target = c.target;
      break;
    case 'deliver':
      value = chron.filter((e) => e.goodId === c.goodId && e.fromCityId !== e.toCityId).reduce((s, e) => s + e.quantity, 0);
      target = c.target;
      break;
    case 'countries':
      value = new Set(chron.map((e) => ctx.countryOfCity[e.toCityId])).size;
      target = c.target;
      break;
    case 'crossContinent':
      value = chron.filter((e) => ctx.continentOfCity[e.fromCityId] !== ctx.continentOfCity[e.toCityId]).length;
      target = c.target;
      break;
    case 'reason':
      // 누적 통계를 쓴다(연대기는 최근 것만 남는다)
      value = p.reasonStats?.[c.category]?.count ?? 0;
      target = c.target;
      break;
    case 'reasonKinds':
      value = Object.entries(p.reasonStats ?? {}).filter(([k, v]) => k !== 'market' && v.count > 0).length;
      target = c.target;
      break;
    case 'origin':
      value = chron.filter((e) => e.origins.some((o) => c.countries.includes(o))).length;
      target = c.target;
      break;
  }
  return { value, target, ratio: Math.max(0, Math.min(1, value / target)) };
}

function toCommand(state: EconomyState, a: TriggerAction): Command | null {
  const now = state.month;
  switch (a.kind) {
    case 'news':
      return null;
    case 'harvestFailure':
      return { type: 'addModifier', modifier: { cityId: a.cityId, goodId: a.goodId, factor: a.factor, untilMonth: now + a.months - 1, reason: a.reason } };
    case 'tariff':
      return {
        type: 'addPolicy',
        policy: {
          kind: 'tariff', countries: a.countries, targets: a.targets, goods: a.goods, rate: a.rate,
          cause: a.conflict ? 'conflict' : 'scenario', startMonth: now, endMonth: now + a.years * 12,
          title: a.title, causes: a.causes, effects: a.effects,
        },
      };
    case 'fta':
      return {
        type: 'addPolicy',
        policy: { kind: 'fta', countries: a.countries, rate: 0, cause: 'agreement', startMonth: now, endMonth: now + a.years * 12, title: a.title, causes: a.causes, effects: a.effects },
      };
    case 'culture':
      return {
        type: 'addCultureWave',
        wave: { brand: a.brand, countries: a.countries, strength: a.strength, startMonth: now, endMonth: now + a.years * 12, title: a.title, causes: a.causes, effects: a.effects },
      };
    case 'passage':
      return { type: 'setPassage', passageId: a.passageId, closed: a.closed, maxShipSize: a.maxShipSize, reason: a.reason, at: now };
  }
}

/** 매달 시작에: 때가 된 사건을 일으키고, 새로 이룬 목표를 알린다 */
export function scenarioStep(ctx: EconomyContext, state: EconomyState, events: SimEvent[]): void {
  const sc = state.scenario;
  if (!sc) return;
  const def = scenarioById(sc.id);
  if (!def) return;
  const elapsed = state.month - sc.startMonth;
  for (const t of def.triggers) {
    if (sc.fired.includes(t.id) || elapsed < t.atMonth) continue;
    sc.fired.push(t.id);
    // 교사가 끈 사건은 일어나지 않는다(소식도 띄우지 않는다)
    if (sc.disabled?.includes(t.id)) continue;
    const cmd = toCommand(state, t.action);
    if (cmd) {
      const r = applyCommand(ctx, state, cmd);
      events.push(...r.events);
    }
    events.push({ type: 'scenario', month: state.month, kind: 'trigger', text: t.headline, question: t.question });
  }
  for (const g of def.goals) {
    if (sc.goalsDone[g.id] !== undefined) continue;
    if (goalProgress(ctx, state, g).ratio >= 1) {
      sc.goalsDone[g.id] = state.month;
      events.push({ type: 'scenario', month: state.month, kind: 'goal', text: `목표를 이뤘어요: ${g.text}` });
    }
  }
  if (!sc.ended && elapsed >= def.months) {
    sc.ended = true;
    events.push({ type: 'scenario', month: state.month, kind: 'end', text: `「${def.title}」 수업 시간이 끝났어요. 결과·회사 탭의 수업 리포트를 확인해 보세요.` });
  }
}

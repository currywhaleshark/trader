import type { World } from '../world/types';
import type { EconomyData, GoodDef } from './data';

/** 도시의 생산 시설. 시설이 없으면 그 상품은 생산되지 않는다. */
export interface Industry {
  goodId: string;
  /** 월 최대 생산량(작물은 연평균 기준, 실제 월 생산은 계절 계수를 곱한다) */
  capacity: number;
  /** 처음(또는 지을 때)의 생산능력. 농장·광산 확장 한도와 폐쇄 기준에 쓴다. */
  initialCapacity: number;
  /** 놀거나 적자인 해가 연달아 몇 해째인가 */
  weakYears: number;
  /** 다른 나라 상표로 만드는 시설(위탁 생산). 없으면 그 도시 나라 상표 */
  brandCountryId?: string;
}

/** 한 해 동안 쌓는 도시 통계(연 단위 틱이 읽고 비운다) */
export interface AnnualStats {
  months: number;
  produced: Record<string, number>;
  /** 그달 낼 수 있었던 최대 생산(계절·차질 반영) */
  capacity: Record<string, number>;
  /** 시세 / 생산비 합(가동 중인 시설) */
  marginSum: Record<string, number>;
  /** 주민 소비 + 공장 투입 */
  used: Record<string, number>;
  shortage: Record<string, number>;
  imported: Record<string, number>;
  exported: Record<string, number>;
  priceSum: Record<string, number>;
  /** 생산이 만든 부가가치(생산량 × (시세 − 투입재 시세)) */
  valueAdded: number;
  /** 배로 들고 난 화물 부피 */
  throughput: number;
  /** 상품별·원산지 나라별 수입량 */
  importsFrom: Record<string, Record<string, number>>;
  /** 원산지 나라별 수입액 */
  importValueFrom: Record<string, number>;
  /** 거둔 관세 */
  tariffs: number;
}

/** 몇 년이 걸리는 공사(공장 신설·증설, 항만 확장) */
export interface Project {
  id: string;
  kind: 'build' | 'expand' | 'port';
  cityId: string;
  goodId?: string;
  /** 완공 때 더해질 생산능력 */
  capacity?: number;
  startedMonth: number;
  readyMonth: number;
  /** 왜 시작했는가(학생용 문장) */
  reason: string;
}

/** 해마다 남기는 나라별 기록(교육 리포트·테스트용) */
export interface CountryYear {
  population: number;
  income: number;
  tech: number;
  /** 상품별 (수출량 − 수입량). 양수면 그 해 순수출국 */
  netTrade: Record<string, number>;
  exportValue: number;
  importValue: number;
  /** 상품별 생산량 */
  produced: Record<string, number>;
  /** 원산지 나라별 수입액 */
  importValueFrom: Record<string, number>;
  /** 상품별·원산지 나라별 수입량 */
  importsByGood: Record<string, Record<string, number>>;
  /** 상품별로 실제로 치른 값(소비·투입량 가중, 기준가 대비) */
  paid: Record<string, number>;
  /** 상품별 사용량(주민 소비 + 공장 투입) */
  used: Record<string, number>;
  /** 거둔 관세 */
  tariffs: number;
}

export interface YearRecord {
  /** 달력 연도 */
  year: number;
  month: number;
  countries: Record<string, CountryYear>;
  npcShips: number;
}

/** 지난달 한 도시에서 일어난 일(상품별 수량) */
export interface MonthStats {
  produced: Record<string, number>;
  consumed: Record<string, number>;
  usedAsInput: Record<string, number>;
  /** 사고 싶었지만 재고가 없어 못 산 양 */
  shortage: Record<string, number>;
  /** 무역회사가 사 간 양(수출) / 팔고 간 양(수입) */
  exported: Record<string, number>;
  imported: Record<string, number>;
}

export interface CityEconomy {
  id: string;
  countryId: string;
  population: number;
  income: number;
  industries: Industry[];
  stock: Record<string, number>;
  price: Record<string, number>;
  /** 목표 재고. 0이면 이 도시에는 그 상품의 시장이 없다(쓰지도 만들지도 않음). */
  target: Record<string, number>;
  /** 무역회사에 팔지 않고 남겨 두는 몫(주민·공장이 쓸 양) */
  reserve: Record<string, number>;
  /** 도시 상인들의 누적 수지(무역회사와의 거래 상대방). 장부용이며 한도는 없다. */
  treasury: number;
  last: MonthStats;
  annual: AnnualStats;
  /** 재고의 원산지·상표 구성: 상품 -> "원산지/상표" -> 수량 (합 = stock) */
  mix: Record<string, Record<string, number>>;
}

/** 화물 묶음. 원산지는 환적해도 바뀌지 않는다(관세 판정용). */
export interface CargoLot {
  goodId: string;
  quantity: number;
  /** 실은 항구 */
  originCityId: string;
  /** 만든 나라(원산지). 관세는 이것으로 정한다 */
  originCountryId: string;
  /** 상표 나라. 문화 유행의 웃돈은 이것으로 정한다 */
  brandCountryId: string;
  /** 살 때 치른 단가(수수료 포함) */
  unitCost: number;
}

export interface Ship {
  id: string;
  companyId: string;
  /** 선종(플레이어 선박). NPC 선단은 추상화된 범용선이라 없다. */
  typeId?: string;
  /** 배 이름(화면용) */
  name?: string;
  /** 적재량(부피 단위) */
  capacity: number;
  /** 항해 구간. 정박 중이면 from === to */
  from: string;
  to: string;
  /** 출발·도착 시각(월 단위 실수, 0 = 시작 시점) */
  departedAt: number;
  arrivesAt: number;
  /** 플레이어 선박이 항구에 서서 명령을 기다리는 중(도착 처리 대상이 아님) */
  holding?: boolean;
  /** 배정된 정기 항로와 다음에 들를 기항지 번호 */
  routeId?: string;
  routeStop?: number;
  cargo: CargoLot[];
}

/** 정기 항로의 기항지 하나에서 할 일 */
export interface RouteStop {
  cityId: string;
  /** 이 항구에서 살 상품과 한 번에 살 최대량 */
  buy: { goodId: string; maxQuantity: number }[];
  /** 이 항구에서 팔 상품 */
  sell: string[];
}

/** 여러 항구를 도는 정기 항로(§10.3) */
export interface TradeRoute {
  id: string;
  name: string;
  stops: RouteStop[];
  /** 살 때 기대 이익률(운항비 반영)이 이보다 낮으면 사지 않는다 */
  minMargin: number;
  /** 이 아래로는 현금을 쓰지 않는다 */
  cashReserve: number;
}

/** 플레이어 회사의 한 달 장부 */
export interface LedgerMonth {
  month: number;
  sales: number;
  purchases: number;
  fuel: number;
  portFees: number;
  upkeep: number;
  /** 배를 사면 음수, 팔면 양수 */
  shipTrade: number;
  /** 상해서 버린 화물의 원가 */
  spoiledCost: number;
  /** 낸 관세 */
  tariffs: number;
}

export interface PlayerState {
  name: string;
  cash: number;
  /** 현금이 모자라 못 낸 유지비. 다음 수입에서 먼저 갚는다. */
  arrears: number;
  nextShipNo: number;
  nextRouteNo: number;
  routes: TradeRoute[];
  /** 최근 달부터의 장부(최대 ledgerMonths개) */
  ledger: LedgerMonth[];
  /** 시작부터의 합계 */
  lifetime: Omit<LedgerMonth, 'month'>;
}

export interface Company {
  id: string;
  name: string;
  homeCityId: string;
  cash: number;
  /** 지금까지 본거지에 낸 배당·세금 합계 */
  paidOut: number;
  /** 지난 연 단위 틱 때의 현금·배당·선박 투자(한 해 이익 계산용) */
  yearMark: { cash: number; paidOut: number; invested: number };
  /** 지금까지 배를 사고판 순액(산 값 − 판 값) */
  invested: number;
}

/** 일시적인 생산 변화(흉작·시설 고장 등). factor 0.5 = 절반만 생산 */
export interface Modifier {
  cityId: string;
  goodId: string;
  factor: number;
  /** 이 달(포함)까지 적용 */
  untilMonth: number;
  reason: string;
}

/** 시뮬레이션 상태 전체. JSON으로 직렬화할 수 있다. */
export interface EconomyState {
  /** 시작부터 지난 달 수. 달력의 월 = month % 12 (0 = 1월) */
  month: number;
  rng: { origin: string; s: number };
  cities: Record<string, CityEconomy>;
  ships: Ship[];
  companies: Company[];
  modifiers: Modifier[];
  /** 운임·항만비·선박 유지비·선박 대금으로 경제 밖으로 나간 돈(장부 검증용) */
  sink: number;
  player: PlayerState;
  /** 항해 중 상해 버려진 화물(상품 보존 검증용) */
  spoiled: Record<string, number>;
  /** 나라별 산업 기술 수준(실수, 해마다 오른다) */
  tech: Record<string, number>;
  /** 도시별 항만 규모(1~3, 확장 공사로 오른다) */
  portLevel: Record<string, number>;
  projects: Project[];
  nextProjectNo: number;
  history: YearRecord[];
  policies: Policy[];
  cultureWaves: CultureWave[];
  nextPolicyNo: number;
  /** 정책·유행이 바뀔 때마다 오른다(관세율 계산 캐시를 비우는 신호) */
  policyVersion: number;
}

/** 정책 시작 무렵의 상태(1년 뒤 효과 보고용). 키는 "나라|상품" */
export interface PolicyBaseline {
  produced: Record<string, number>;
  paid: Record<string, number>;
  foreignImports: Record<string, number>;
  /** 나라 -> 원산지 나라별 수입액 */
  importValueFrom: Record<string, Record<string, number>>;
  tariffs: number;
}

/** 관세·무역협정(§8) */
export interface Policy {
  id: string;
  kind: 'tariff' | 'fta';
  /** tariff: 관세를 매기는 나라 / fta: 회원국 */
  countries: string[];
  /** tariff: 대상 원산지 나라(없으면 모든 나라) */
  targets?: string[];
  /** 대상 상품(없으면 모든 상품) */
  goods?: string[];
  rate: number;
  cause: 'protection' | 'conflict' | 'retaliation' | 'agreement' | 'scenario';
  startMonth: number;
  endMonth: number;
  title: string;
  /** 왜 시작했나 */
  causes: string[];
  /** 누구에게 어떤 영향이 예상되나(이해관계자별) */
  effects: string[];
  baseline?: PolicyBaseline;
  reviewed: boolean;
  ended: boolean;
}

/** 문화 유행(§9): brand 나라 상표 상품이 countries에서 인기 */
export interface CultureWave {
  id: string;
  brand: string;
  countries: string[];
  strength: number;
  startMonth: number;
  endMonth: number;
  title: string;
  causes: string[];
  effects: string[];
  ended: boolean;
}

/**
 * 플레이어와 시나리오의 명령. applyCommand가 즉시 처리하고, 실패하면 이유를 돌려준다.
 * at: 명령을 내린 시각(월 단위 실수). 없으면 그 달의 시작.
 */
export type Command =
  | { type: 'addModifier'; modifier: Modifier }
  | { type: 'trade'; shipId: string; goodId: string; side: 'buy' | 'sell'; quantity: number }
  | { type: 'sail'; shipId: string; to: string; at?: number }
  | { type: 'buyShip'; typeId: string; cityId: string }
  | { type: 'sellShip'; shipId: string }
  | { type: 'saveRoute'; route: Omit<TradeRoute, 'id'> & { id?: string } }
  | { type: 'deleteRoute'; routeId: string }
  | { type: 'assignRoute'; shipId: string; routeId: string | null; at?: number }
  | { type: 'addPolicy'; policy: Omit<Policy, 'id' | 'reviewed' | 'ended' | 'baseline'> }
  | { type: 'addCultureWave'; wave: Omit<CultureWave, 'id' | 'ended'> };

export type SimEvent =
  | { type: 'departure'; month: number; shipId: string; companyId: string; from: string; to: string; goodId: string; quantity: number; cost: number }
  | { type: 'delivery'; month: number; shipId: string; companyId: string; from: string; to: string; goodId: string; quantity: number; revenue: number; originCityId: string }
  | { type: 'shortage'; month: number; cityId: string; goodId: string; ratio: number }
  | { type: 'modifier'; month: number; cityId: string; goodId: string; factor: number; reason: string }
  | { type: 'arrival'; month: number; shipId: string; cityId: string; spoiled: { goodId: string; quantity: number }[] }
  | { type: 'notice'; month: number; shipId?: string; cityId?: string; text: string }
  | { type: 'trade'; month: number; shipId: string; cityId: string; goodId: string; side: 'buy' | 'sell'; quantity: number; total: number; cashAfter: number }
  | {
      type: 'growth';
      month: number;
      kind: 'build_start' | 'build_done' | 'expand_start' | 'expand_done' | 'shrink' | 'close' | 'port_start' | 'port_done' | 'tech' | 'fleet';
      cityId?: string;
      countryId?: string;
      goodId?: string;
      text: string;
      /** 이 변화가 일어난 까닭들(요구서 Event.explanatoryCauses) */
      causes: string[];
    }
  | {
      type: 'policy';
      month: number;
      kind: 'tariff_start' | 'tariff_end' | 'tariff_repeal' | 'fta_start' | 'fta_end' | 'conflict_start' | 'review' | 'culture_start' | 'culture_end';
      countries: string[];
      goods?: string[];
      text: string;
      causes: string[];
      /** 이해관계자별 예상 영향, 또는(review) 실제로 잰 변화 */
      effects: string[];
    };

/** 틱마다 바뀌지 않는 참조 데이터 */
export interface EconomyContext {
  data: EconomyData;
  goods: GoodDef[];
  goodById: Record<string, GoodDef>;
  cityIds: string[];
  countryOfCity: Record<string, string>;
  /** 도시별·작물별 월 생산 계수 */
  cropCoef: Record<string, Record<string, number[]>>;
  /** 항구 사이 해상 거리(km) */
  distanceKm: (a: string, b: string) => number;
  /** 항만 규모 1~3. 이보다 큰 배는 들어갈 수 없다. */
  portSize: Record<string, number>;
  cityNames: Record<string, string>;
  countryNames: Record<string, string>;
  /** 도시별 원재료 잠재 생산능력(땅·매장량). 처음엔 시설이 없어도 나중에 농장·광산을 열 수 있다. */
  rawPotential: Record<string, Record<string, number>>;
}

export function emptyAnnual(goods: GoodDef[]): AnnualStats {
  const zero = () => Object.fromEntries(goods.map((g) => [g.id, 0]));
  return {
    months: 0, produced: zero(), capacity: zero(), marginSum: zero(), used: zero(), shortage: zero(),
    imported: zero(), exported: zero(), priceSum: zero(), valueAdded: 0, throughput: 0,
    importsFrom: Object.fromEntries(goods.map((g) => [g.id, {}])), importValueFrom: {}, tariffs: 0,
  };
}

export function emptyStats(goods: GoodDef[]): MonthStats {
  const zero = () => Object.fromEntries(goods.map((g) => [g.id, 0]));
  return { produced: zero(), consumed: zero(), usedAsInput: zero(), shortage: zero(), exported: zero(), imported: zero() };
}

export type { World };

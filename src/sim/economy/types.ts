import type { World } from '../world/types';
import type { EconomyData, GoodDef } from './data';

/** 도시의 생산 시설. 시설이 없으면 그 상품은 생산되지 않는다. */
export interface Industry {
  goodId: string;
  /** 월 최대 생산량(작물은 연평균 기준, 실제 월 생산은 계절 계수를 곱한다) */
  capacity: number;
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
}

/** 화물 묶음. 원산지는 환적해도 바뀌지 않는다(M4 관세 판정용). */
export interface CargoLot {
  goodId: string;
  quantity: number;
  originCityId: string;
  originCountryId: string;
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
  | { type: 'assignRoute'; shipId: string; routeId: string | null; at?: number };

export type SimEvent =
  | { type: 'departure'; month: number; shipId: string; companyId: string; from: string; to: string; goodId: string; quantity: number; cost: number }
  | { type: 'delivery'; month: number; shipId: string; companyId: string; from: string; to: string; goodId: string; quantity: number; revenue: number; originCityId: string }
  | { type: 'shortage'; month: number; cityId: string; goodId: string; ratio: number }
  | { type: 'modifier'; month: number; cityId: string; goodId: string; factor: number; reason: string }
  | { type: 'arrival'; month: number; shipId: string; cityId: string; spoiled: { goodId: string; quantity: number }[] }
  | { type: 'notice'; month: number; shipId?: string; cityId?: string; text: string }
  | { type: 'trade'; month: number; shipId: string; cityId: string; goodId: string; side: 'buy' | 'sell'; quantity: number; total: number; cashAfter: number };

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
}

export function emptyStats(goods: GoodDef[]): MonthStats {
  const zero = () => Object.fromEntries(goods.map((g) => [g.id, 0]));
  return { produced: zero(), consumed: zero(), usedAsInput: zero(), shortage: zero(), exported: zero(), imported: zero() };
}

export type { World };

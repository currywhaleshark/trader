import type { LatLon } from '../core/sphere';
import type { InlandLink, World } from '../world/types';
import type { ScenarioProgress } from '../classroom/scenarios';
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
  /** 그해 국가 내에서 모의한 경제권 수요 인구의 합(게임 단위) */
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
  inputCostDelta?: Record<string, number>;
  id: string;
  countryId: string;
  /** 배후지를 포함한 시장의 현재 수요 인구(게임 단위, 구버전 저장과 동일). */
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

export interface CityInfo {
  climate: string;
  annualPrecip: number;
  tempMin: number;
  tempMax: number;
  /** 작물 id -> 적합도 0~1 */
  cropSuitability: Record<string, number>;
  /** 월 강수 최소·최대(mm) */
  precipMin: number;
  precipMax: number;
}

/** 거래가 생긴 까닭(학생용 분류와 문장) */
export interface TradeReason {
  category: 'climate' | 'resource' | 'industry' | 'season' | 'shortage' | 'demand' | 'policy' | 'culture' | 'market';
  text: string;
}

/** 거래 연대기 한 줄: 어디서 사서 어디에 팔았고, 왜 남았(밑졌)는가 */
export interface ChronicleEntry {
  specialtyId?: string;
  /** 선택해서 받은 도시 발주 납품 */
  orderId?: string;
  month: number;
  shipId?: string;
  /** 회사 창고에서 직접 판매한 거래 */
  storage?: 'ambient' | 'cold';
  goodId: string;
  quantity: number;
  fromCityId: string;
  toCityId: string;
  /** 원산지 나라들(섞여 있을 수 있다) */
  origins: string[];
  /** 산 값(항만비 포함) */
  cost: number;
  revenue: number;
  tariff: number;
  /** revenue − tariff − cost (연료·유지비는 장부에서 따로) */
  profit: number;
  sourceReason: TradeReason;
  destReason: TradeReason;
  policyReason?: TradeReason;
  /** 1개당 받은 값이 출발 때 예상과 크게 달랐으면 그 차이와 까닭(화면 설명용) */
  surprise?: { expectedUnit: number; actualUnit: number; priceAtDeparture: number; priceNow: number; reasons: TradeReason[] };
}

/** 화물 묶음. 원산지는 환적해도 바뀌지 않는다(관세 판정용). */
export interface CargoLot {
  /** 일반 상품의 한정 특산품. 시장에 판매하면 수출 보증은 소진된다. */
  specialtyId?: string;
  goodId: string;
  quantity: number;
  /** 실은 항구 */
  originCityId: string;
  /** 만든 나라(원산지). 관세는 이것으로 정한다 */
  originCountryId: string;
  /** 상표 나라. 산업 평판과 문화 유행의 웃돈은 이것으로 정한다 */
  brandCountryId: string;
  /** 플레이어가 산 때와 그곳이 쌌던 까닭(연대기용) */
  bought?: { month: number; reason: TradeReason };
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
  /** 정기 항로가 지금은 남지 않아 기항지에서 기다리는 중(다달이 다시 따진다) */
  routeWaiting?: boolean;
  /**
   * 정기 항로 배가 기항지에 서 있는 까닭(화면 표시용). 다시 출발하면 지운다.
   *  profit: 한 바퀴 돌아도 연료비만큼 못 벌어 기다림(estimate = 한 바퀴 예상 수익)
   *  fuel: 다음 기항지까지 갈 연료비가 모자람
   */
  routeWait?: { reason: 'profit' | 'fuel' | 'blocked'; since: number; estimate?: number; detail?: string };
  cargo: CargoLot[];
  /** 지금 항해의 실제 경로(통과 지점·우회). 없으면 기본 항로(예전 저장과 같다) */
  voyage?: ShipVoyage;
  /** 이 배의 이력(플레이어 선박, 배 현황 화면용). 예전 저장에는 없어 처음 쓸 때 만든다 */
  record?: ShipRecord;
  /** 마지막으로 떠날 때 본 목적지 예상과, 그 뒤 목적지에서 일어난 일(플레이어 선박, 설명용) */
  expect?: SaleExpectation;
}

/** 출발할 때의 예상(목적지·상품별)과 항해하는 동안 목적지에서 실제로 일어난 일 */
export interface SaleExpectation {
  to: string;
  departedAt: number;
  plannedMonths: number;
  /** 실제로 닿은 때(우회·지연을 알 수 있다) */
  arrivedAt?: number;
  goods: Record<
    string,
    {
      /** 1개당 손에 쥘 것으로 본 값(관세·유행 반영, 상하기 전) */
      unit: number;
      price: number;
      stock: number;
      /** 그때 이미 항해 중이던 다른 배의 짐 */
      knownIncoming: number;
      /** 더 실어 올 것으로 어림한 양 */
      resupply: number;
      /** 그때의 한 달 생산·소비 */
      produced: number;
      used: number;
      /** 관세·유행 몫(받는 값에 곱한다) */
      factor: number;
      /** 그때 목적지에 있던 사건 */
      events: string[];
    }
  >;
  /** 출발 뒤 목적지에서 쌓인 양(달마다) */
  seen: Record<string, { imported: number; produced: number; used: number; months: number }>;
}

/** 배 한 척의 이력: 산 달(선령), 항해 거리·횟수, 이 배로 오간 돈 */
export interface ShipRecord {
  /** 산 달(처음 받은 배는 0). 예전 저장에서 처음 만들 때는 알 수 없어 그 저장의 시작(0)으로 둔다 */
  since: number;
  distanceKm: number;
  voyages: number;
  sales: number;
  purchases: number;
  fuel: number;
  /** 항만비·관세·운하/해협 통과료 */
  fees: number;
  upkeep: number;
}

/** 한 번의 항해가 실제로 따르는 길: 지도·도착 시각·비용이 모두 이 값을 쓴다 */
export interface ShipVoyage {
  distanceKm: number;
  /** 지나는 통과 지점(순서대로) */
  passages: string[];
  /** 피해서 고른 통과 지점(대체 항로). 비어 있으면 기본 항로 */
  avoid: string[];
  /** 통과 지점마다 지날 시각과 통과료(지날 때 한 번 낸다) */
  transits: { id: string; at: number; fee: number; paid: boolean }[];
  /** 항해 중 경로를 바꾼 경우의 실제 경로(현재 위치에서 다시 찾은 길) */
  path?: LatLon[];
  /** 기본 항로와 다른 길로 가는 까닭(학생용) */
  note?: string;
}

/** 운하·해협의 지금 상태(게임 속 사건으로 바뀐다) */
export interface PassageState {
  closed: boolean;
  /** 이 크기 등급까지만 지날 수 있다(가뭄 등) */
  maxShipSize?: 1 | 2 | 3;
  reason: string;
  since: number;
}

/** 배후 연결로 이동 중인 물량(재고와 따로 센다) */
export interface InlandShipment {
  id: string;
  linkId: string;
  from: string;
  to: string;
  goodId: string;
  quantity: number;
  originCountryId: string;
  brandCountryId: string;
  departedAt: number;
  arrivesAt: number;
  /** 출발지에서 치른 값(단가) */
  unitValue: number;
}

/** 정기 항로의 기항지 하나에서 할 일 */
export interface RouteStop {
  cityId: string;
  /** 이 항구에서 살 상품과 한 번에 살 최대량 */
  buy: { goodId: string; brandCountryId?: string; maxQuantity: number }[];
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
  /** 운하·해협 통과료(예전 장부에는 없다) */
  passageFees?: number;
  storageFees?: number;
  /** 선박 매입처럼 순이익과 구분하는 시설 투자액 */
  warehouseInvestment?: number;
}

export interface TradeOrder {
  id: string;
  /** 없으면 기존 도시 발주. 지역 발주는 회사 거점으로 납품한다. */
  kind?: 'city' | 'local';
  /** 고정 튜토리얼 대본이 낸 발주 */
  scripted?: boolean;
  sourceKind?: 'market' | 'warehouse' | 'cargo';
  /** 발주 당시 신뢰도에 따른 추가 단가율. 수락 후에도 고정한다. */
  trustBonus?: number;
  /** 종료 때 한 번 반영한 실제 신뢰도 변화(상·하한 적용 후). */
  trustChange?: number;
  cityId: string;
  goodId: string;
  quantity: number;
  delivered: number;
  /** 관세·하역비를 발주처가 부담하는 고정 실수령 단가 */
  unitPrice: number;
  referencePrice: number;
  issuedMonth: number;
  /** 이 달 시작부터 수락/납품 불가(화면에는 앞 달 말까지로 표시) */
  offerExpiresMonth: number;
  deadlineMonth: number;
  status: 'offered' | 'accepted' | 'completed' | 'declined' | 'expired' | 'cancelled';
  acceptedMonth?: number;
  closedMonth?: number;
  reason: TradeReason;
  /** 발주 당시의 조달 예시. 재고를 예약하지는 않는다. */
  sourceCityId: string;
  sourceReason: TradeReason;
  suggestedBuyQuantity: number;
  estimatedCost: number;
}

export interface TradeOrderBook {
  items: TradeOrder[];
  nextNo: number;
  nextOfferMonth: number;
  nextLocalOfferMonth?: number;
}

export interface CityTradeTrust {
  score: number;
  completed: number;
  cancelled: number;
  expired: number;
  lastChange?: { month: number; orderId: string; delta: number; outcome: 'completed' | 'cancelled' | 'expired' };
}

export type StorageZone = 'ambient' | 'cold';

export interface CompanyWarehouse {
  cityId: string;
  capacity: number;
  coldCapacity: number;
  cargo: CargoLot[];
  coldCargo: CargoLot[];
}

export interface PlayerState {
  /** 도시별 거래 신뢰도. 예전 저장의 미거래 도시는 0점부터 시작한다. */
  cityTrust?: Record<string, CityTradeTrust>;
  /** 예전 저장은 빈 기본 창고로 시작한다. */
  warehouse?: CompanyWarehouse;
  /** 예전 저장 파일에는 없을 수 있다. */
  orders?: TradeOrderBook;
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
  /** 회사를 세운 달 */
  startMonth: number;
  /** 거래 연대기(최신이 뒤, 최대 chronicleMax개) */
  chronicle: ChronicleEntry[];
  /** 지금까지의 거래 수(연대기가 잘려도 센다) */
  tradeCount: number;
  /** 무역 이유별 누적 횟수와 처음 몇 개의 예(연대기가 잘려도 남는다) */
  reasonStats: Record<string, { count: number; examples: string[] }>;
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

/** 이 세계를 시작할 때 고정한 브랜드 국가별 대표·보조 산업 배정. */
export interface IndustryReputation {
  version: number;
  premiums: Record<string, Record<string, number>>;
  unassigned: Record<string, string>;
}

/** 시뮬레이션 상태 전체. JSON으로 직렬화할 수 있다. */
export interface EconomyState {
  /** 특산품별 국가 공통 기본 공급 배정(신뢰 혜택 적용 전). 실제 상품은 일반 재고에서 선별한다. */
  specialtySupply?: Record<string, { month: number; remaining: number }>;
  reputation?: IndustryReputation;
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
  /** 수업 시나리오 진행 상황(없으면 시나리오 없음) */
  scenario?: ScenarioProgress;
  /** 운하·해협 상태(없으면 모두 열림). 통과 지점 id -> 상태 */
  passages?: Record<string, PassageState>;
  /** 배후 연결로 이동 중인 물량 */
  inland?: InlandShipment[];
  nextInlandNo?: number;
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
  | { type: 'warehouseTransfer'; shipId: string; goodId: string; specialtyId?: string | null; quantity: number; direction: 'store' | 'load'; storage: StorageZone }
  | { type: 'warehouseMove'; goodId: string; specialtyId?: string | null; quantity: number; to: StorageZone }
  | { type: 'warehouseSell'; goodId: string; specialtyId?: string | null; quantity: number; storage: StorageZone }
  | { type: 'upgradeWarehouse' }
  | { type: 'acceptOrder' | 'declineOrder' | 'cancelOrder'; orderId: string }
  | { type: 'fillOrder'; orderId: string; shipId: string }
  /** 고정 튜토리얼의 대본 발주를 낸다(이미 진행 중이거나 끝냈으면 아무 일도 없다) */
  | { type: 'tutorialOrder' }
  | { type: 'deliverOrder'; orderId: string; shipId: string; quantity: number }
  | { type: 'deliverWarehouseOrder'; orderId: string; storage: StorageZone; quantity: number }
  | { type: 'addModifier'; modifier: Modifier }
  | { type: 'trade'; shipId: string; goodId: string; brandCountryId?: string; specialtyId?: string | null; side: 'buy' | 'sell'; quantity: number }
  | { type: 'sail'; shipId: string; to: string; at?: number }
  | { type: 'buyShip'; typeId: string }
  | { type: 'sellShip'; shipId: string }
  | { type: 'renameShip'; shipId: string; name: string }
  | { type: 'saveRoute'; route: Omit<TradeRoute, 'id'> & { id?: string } }
  | { type: 'deleteRoute'; routeId: string }
  | { type: 'assignRoute'; shipId: string; routeId: string | null; at?: number }
  | { type: 'addPolicy'; policy: Omit<Policy, 'id' | 'reviewed' | 'ended' | 'baseline'> }
  | { type: 'addCultureWave'; wave: Omit<CultureWave, 'id' | 'ended'> }
  /** 운하·해협을 막거나 열거나 통행을 제한한다(게임 속 사건·교사 설정) */
  | { type: 'setPassage'; passageId: string; closed: boolean; maxShipSize?: 1 | 2 | 3 | null; reason: string; at?: number };

export type SimEvent =
  | { type: 'order'; month: number; orderId: string; kind: 'offered' | 'accepted' | 'declined' | 'cancelled' | 'delivered' | 'completed' | 'expired'; text: string }
  | { type: 'departure'; month: number; shipId: string; companyId: string; from: string; to: string; goodId: string; quantity: number; cost: number }
  | { type: 'delivery'; month: number; shipId: string; companyId: string; from: string; to: string; goodId: string; quantity: number; revenue: number; originCityId: string }
  | { type: 'shortage'; month: number; cityId: string; goodId: string; ratio: number }
  | { type: 'modifier'; month: number; cityId: string; goodId: string; factor: number; reason: string }
  | { type: 'arrival'; month: number; shipId: string; cityId: string; spoiled: { goodId: string; quantity: number }[] }
  | { type: 'notice'; month: number; shipId?: string; cityId?: string; text: string }
  | { type: 'trade'; specialtyId?: string; month: number; shipId: string; cityId: string; goodId: string; side: 'buy' | 'sell'; quantity: number; total: number; cashAfter: number }
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
  | { type: 'scenario'; month: number; kind: 'trigger' | 'goal' | 'end'; text: string; question?: string }
  | { type: 'passage'; month: number; passageId: string; kind: 'closed' | 'opened' | 'restricted' | 'reroute'; text: string; shipId?: string }
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

/** 항구 쌍 사이의 한 가지 항로(기본 또는 통과 지점을 피한 대체 항로) */
export interface RouteOption {
  /** 이 항로가 피한 통과 지점(기본 항로는 빈 목록) */
  avoid: string[];
  distanceKm: number;
  passages: string[];
  /** 통과 지점 -> 그 지점까지 간 거리의 비율(0~1) */
  passageAt: Record<string, number>;
  waypoints: LatLon[];
}

/** 통과 지점의 고정 정보(요금·지연·선박 제한) */
export interface PassageInfo {
  id: string;
  name: string;
  type: 'canal' | 'strait';
  fee: [number, number, number];
  delayMonths: number;
  maxShipSize?: 1 | 2 | 3;
  index: number;
}

/** 틱마다 바뀌지 않는 참조 데이터 */
export interface EconomyContext {
  reputation: IndustryReputation;
  data: EconomyData;
  goods: GoodDef[];
  goodById: Record<string, GoodDef>;
  /** 모든 시장(항구 + 내륙 경제권). 생산·소비·가격은 모두 돈다. */
  cityIds: string[];
  /** 배가 드나드는 항구(내륙 경제권은 빠진다) */
  portIds: string[];
  /** 운하·해협 */
  passages: Record<string, PassageInfo>;
  /** 두 항구 사이에 미리 계산한 항로들(기본 + 대체) */
  routeOptions: (a: string, b: string) => RouteOption[];
  /** 미리 계산한 항로로 피할 수 없을 때, 막힌 통과 지점을 빼고 다시 찾는다(없으면 null) */
  liveRoute: (a: string, b: string, blocked: readonly string[]) => RouteOption | null;
  /** 지금 위치에서 도착 항구까지 다시 찾는다(항해 중 봉쇄). 없으면 null */
  routeFromPoint: (lat: number, lon: number, to: string, blocked: readonly string[]) => RouteOption | null;
  /** 배후 연결 */
  inlandLinks: InlandLink[];
  countryOfCity: Record<string, string>;
  /** 도시별·작물별 월 생산 계수 */
  cropCoef: Record<string, Record<string, number[]>>;
  /** 항구 사이 해상 거리(km) */
  distanceKm: (a: string, b: string) => number;
  /** 항만 규모 1~3. 이보다 큰 배는 들어갈 수 없다. */
  portSize: Record<string, number>;
  cityNames: Record<string, string>;
  countryNames: Record<string, string>;
  /** 도시 배후지의 기후·작물 정보(거래 이유 설명용) */
  cityInfo: Record<string, CityInfo>;
  /** 작물별 생육 조건: 월평균 기온·월 강수의 [최저, 적정 하한, 적정 상한, 최고] */
  cropNeeds: Record<string, { temp: number[]; water: number[] }>;
  /** 대륙 번호(리포트에서 "다른 대륙과의 무역"을 가리기 위해) */
  continentOfCity: Record<string, number>;
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

/**
 * 경제 설정 데이터. 상품·레시피·수요·도시 시나리오·시장 계수·선종·플레이어·NPC.
 * 화면 코드에 숫자를 두지 않는다. 밸런싱은 이 파일에서 한다.
 */
import type { WorldMode } from '../world/types';

export type GoodCategory = 'raw' | 'intermediate' | 'final';
export type CargoClass = 'bulk' | 'general' | 'perishable';

/** 선종(§10.2). 큰 배가 언제나 이익이 되지 않도록 크기·속도·비용·항만 제약이 서로 다르다. */
export interface ShipTypeDef {
  id: string;
  name: string;
  /** 한 줄 설명(학생용) */
  blurb: string;
  price: number;
  /** 적재량(부피) */
  capacity: number;
  /** 한 달 항해 거리(km) */
  speedKmPerMonth: number;
  /** 1000km마다 드는 연료비(짐을 얼마나 실었는지와 무관) */
  fuelPer1000Km: number;
  /** 매달 드는 유지비(선원·정비·보험) */
  upkeepPerMonth: number;
  /** 크기 등급. 항구의 portSize보다 크면 들어갈 수 없다. */
  size: 1 | 2 | 3;
  cargoClasses: CargoClass[];
  /** 부패성 화물을 상하지 않게 나르는가 */
  refrigerated: boolean;
  /** 팔 때 받는 값(구매가 대비) */
  resaleShare: number;
}

export interface GoodDef {
  id: string;
  name: string;
  category: GoodCategory;
  /** 기준 가격(단위당) */
  basePrice: number;
  /** 단위당 화물 부피(선박 적재량 기준) */
  volume: number;
  /** 화물 구분: 벌크(곡물·광물), 일반(공산품), 부패성(냉장이 없으면 항해 중 상한다) */
  cargoClass: CargoClass;
  /** 원재료의 출처: 작물(세계 생성의 crop id) 또는 지하자원(resource id) */
  source?: { kind: 'crop' | 'resource'; id: string };
  /** 1단위 생산에 필요한 투입재 */
  recipe?: Record<string, number>;
  /** 인구 100만 명이 한 달에 쓰는 양(소득 1, 기준 가격일 때) */
  demandPerMillion: number;
  /** 소득이 늘 때 수요가 느는 정도 */
  incomeElasticity: number;
  /** 가격이 오를 때 수요가 주는 정도 */
  priceElasticity: number;
  /** 목표 재고 = 월 사용량 × 이 값 */
  stockMonths: number;
  /** 이 기술 수준 이상인 나라만 공장을 가질 수 있다 */
  techRequired: number;
}

export const GOODS: GoodDef[] = [
  { id: 'grain', name: '곡물', category: 'raw', basePrice: 100, volume: 1, cargoClass: 'bulk', source: { kind: 'crop', id: 'grain' }, demandPerMillion: 6, incomeElasticity: 0.2, priceElasticity: 0.25, stockMonths: 4, techRequired: 0 },
  { id: 'fruit', name: '과일', category: 'raw', basePrice: 180, volume: 1, cargoClass: 'perishable', source: { kind: 'crop', id: 'fruit' }, demandPerMillion: 2.5, incomeElasticity: 0.6, priceElasticity: 0.5, stockMonths: 3, techRequired: 0 },
  { id: 'cotton', name: '면화', category: 'raw', basePrice: 160, volume: 1.2, cargoClass: 'bulk', source: { kind: 'crop', id: 'cotton' }, demandPerMillion: 0, incomeElasticity: 0, priceElasticity: 0, stockMonths: 3, techRequired: 0 },
  { id: 'timber', name: '목재', category: 'raw', basePrice: 90, volume: 1.4, cargoClass: 'bulk', source: { kind: 'crop', id: 'timber' }, demandPerMillion: 0.5, incomeElasticity: 0.5, priceElasticity: 0.4, stockMonths: 2, techRequired: 0 },
  { id: 'iron_ore', name: '철광석', category: 'raw', basePrice: 70, volume: 1, cargoClass: 'bulk', source: { kind: 'resource', id: 'iron_ore' }, demandPerMillion: 0, incomeElasticity: 0, priceElasticity: 0, stockMonths: 3, techRequired: 0 },
  { id: 'crude_oil', name: '원유', category: 'raw', basePrice: 120, volume: 1, cargoClass: 'bulk', source: { kind: 'resource', id: 'crude_oil' }, demandPerMillion: 0, incomeElasticity: 0, priceElasticity: 0, stockMonths: 3, techRequired: 0 },

  { id: 'steel', name: '철강', category: 'intermediate', basePrice: 300, volume: 1, cargoClass: 'general', recipe: { iron_ore: 1.6, crude_oil: 0.2 }, demandPerMillion: 0.3, incomeElasticity: 0.8, priceElasticity: 0.4, stockMonths: 3, techRequired: 2 },
  { id: 'textiles', name: '직물', category: 'intermediate', basePrice: 380, volume: 1, cargoClass: 'general', recipe: { cotton: 1.2 }, demandPerMillion: 0.2, incomeElasticity: 0.6, priceElasticity: 0.5, stockMonths: 3, techRequired: 1 },
  { id: 'fuel', name: '연료', category: 'intermediate', basePrice: 220, volume: 1, cargoClass: 'general', recipe: { crude_oil: 1.1 }, demandPerMillion: 3, incomeElasticity: 0.9, priceElasticity: 0.3, stockMonths: 2, techRequired: 2 },
  { id: 'electronics', name: '전자부품', category: 'intermediate', basePrice: 900, volume: 0.6, cargoClass: 'general', recipe: { iron_ore: 0.5, crude_oil: 0.4 }, demandPerMillion: 0.3, incomeElasticity: 1.4, priceElasticity: 0.7, stockMonths: 3, techRequired: 4 },

  { id: 'processed_food', name: '가공식품', category: 'final', basePrice: 320, volume: 1, cargoClass: 'general', recipe: { grain: 0.8, fruit: 0.4 }, demandPerMillion: 4, incomeElasticity: 0.8, priceElasticity: 0.5, stockMonths: 2, techRequired: 1 },
  { id: 'clothing', name: '의류', category: 'final', basePrice: 700, volume: 1, cargoClass: 'general', recipe: { textiles: 1 }, demandPerMillion: 1.2, incomeElasticity: 1, priceElasticity: 0.7, stockMonths: 2, techRequired: 1 },
  { id: 'furniture', name: '가구', category: 'final', basePrice: 650, volume: 2, cargoClass: 'general', recipe: { timber: 1.2, textiles: 0.2 }, demandPerMillion: 0.6, incomeElasticity: 1.1, priceElasticity: 0.8, stockMonths: 2, techRequired: 1 },
  { id: 'machinery', name: '기계', category: 'final', basePrice: 1400, volume: 1.5, cargoClass: 'general', recipe: { steel: 1, electronics: 0.3 }, demandPerMillion: 0.25, incomeElasticity: 1.2, priceElasticity: 0.6, stockMonths: 2, techRequired: 3 },
  { id: 'automobiles', name: '자동차', category: 'final', basePrice: 2200, volume: 2, cargoClass: 'general', recipe: { steel: 0.8, electronics: 0.5 }, demandPerMillion: 0.35, incomeElasticity: 1.6, priceElasticity: 0.9, stockMonths: 2, techRequired: 3 },
  { id: 'cosmetics', name: '화장품', category: 'final', basePrice: 1200, volume: 0.5, cargoClass: 'general', recipe: { fruit: 0.3, fuel: 0.2 }, demandPerMillion: 0.3, incomeElasticity: 1.4, priceElasticity: 0.9, stockMonths: 2, techRequired: 3 },
];

export interface CityScenario {
  /** 배후지를 포함한 인구(백만 명) */
  population: number;
  /** 소득 지수(세계 평균 ≈ 1) */
  income: number;
  /** 제조업 공장: 상품 id -> 세계 생산에서 차지하는 비중(가중치) */
  factories: Record<string, number>;
}

export interface EconomyData {
  /** 이 경제 데이터를 만든 모드별 프로필(저장 파일이 같은 프로필인지 확인할 때 쓴다) */
  profile: { id: string; mode: WorldMode; version: string };
  /** 달력의 0개월째 연도 */
  startYear: number;
  /** 플레이어가 들어오기 전에 경제를 먼저 돌려 두는 기간(달) */
  warmupMonths: number;
  goods: GoodDef[];
  /** 국가별 산업 기술 수준 */
  techByCountry: Record<string, number>;
  cities: Record<string, CityScenario>;
  setup: {
    /** 제조업 총 생산능력 / 세계 수요 */
    factorySlack: number;
    /** 원재료 총 생산능력 / 세계 수요 */
    rawSlack: number;
    /** 지리 가중치에 주는 지수(클수록 좋은 땅에 생산이 몰린다) */
    geographyExponent: number;
    /** 세계 가중치의 이 비율 미만인 도시는 그 원재료 시설이 없다 */
    rawShareThreshold: number;
    /**
     * rawShareThreshold를 무엇에 견주는가.
     *  - city: 도시 하나의 몫(가상 세계의 처음 규칙)
     *  - country: 나라 전체의 몫. 한 나라를 여러 항구 경제권으로 나눠도 생산자가 통째로 빠지지 않는다(§6.3).
     */
    rawThresholdScope?: 'city' | 'country';
    /** 작물 생산 도시가 정상으로 여기는 수출 대기 재고(남는 생산의 몇 달치) */
    cropStorageMonths: number;
    /** 공장·광산 도시가 정상으로 여기는 수출 대기 재고(남는 생산의 몇 달치) */
    exportBufferMonths: number;
    /** 직접 만들지 않는 상품에 더하는 비축 기간(달). 수입선이 오가는 시간을 버틴다. */
    importBufferMonths: number;
  };
  market: {
    /** 매수·매도 호가 차이(한쪽) */
    spread: number;
    /** 거래량이 가격을 미는 정도 */
    impactExponent: number;
    /** 재고/목표 비율이 가격에 주는 영향 */
    stockExponent: number;
    /** 가격 하한·상한(기준 가격의 배수) */
    priceFloor: number;
    priceCeil: number;
    /** 한 달에 목표 가격 쪽으로 움직이는 비율 */
    priceAdjust: number;
    /** 시장 깊이의 바닥(목표 재고 대비). 재고가 바닥나도 이만큼의 거래량은 가격을 덜 흔든다. */
    depthFloor: number;
    /** 채산성(시세/생산비)이 이 값 이하면 생산 중단, fullAt 이상이면 최대 가동 */
    idleBelowMargin: number;
    fullAtMargin: number;
    /** 도시가 남겨 두는 몫(자기 쓸 몫의 목표 재고 대비). 이 아래로는 무역회사에 팔지 않는다. */
    reserveShare: number;
    /** 한 번에 살 수 있는 재고 비율 */
    maxBuyShare: number;
    /**
     * 모든 값이 기준 가격일 때 단위 생산비가 기준 가격의 몇 %인가(나머지가 정상 이윤).
     * 운영비(임금·설비) = 기준가 × costShare − 투입재 기준가 합. 투입재 값이 오르면 생산비도 오른다.
     */
    costShare: number;
    /** 운영비의 하한(기준 가격 대비). 투입재가 기준가 대부분을 차지하는 상품용 */
    minOperatingShare: number;
    /** 재고가 목표의 이 배수를 넘으면 생산을 멈춘다 */
    storageCap: number;
    /**
     * true면 광물 원자재(source.kind 'resource': 원유·철광석)는 그것을 생산하는 시장, 또는 생산하는
     * 내륙 경제권의 관문항만 배에 판다. 생산하지 않는 시장의 재고는 자기 정유·제철에 쓰는 몫으로 보고 내놓지 않는다.
     * 배후 운송(관문항 → 내륙)은 이 규칙과 상관없이 옮긴다. 없으면 false(가상 세계의 기존 동작).
     */
    rawOnlyFromSource?: boolean;
  };
  shipping: {
    /** 부피 1단위를 1000km 나르는 비용 */
    costPerUnitPer1000Km: number;
    /** 항만 처리비(부피 1단위, 싣고 내릴 때 각각) */
    portFeePerUnit: number;
    /** 관세 자리(M4). 지금은 0. */
    defaultTariff: number;
  };
  shipTypes: ShipTypeDef[];
  /** 배후 운송(내륙 경제권 ↔ 관문항): 값 차이가 운송비보다 이 비율 이상 클 때 옮긴다 */
  inland: { minMargin: number; fillTo: number; minLot: number };
  /** 위탁 생산: 이 도시의 이 시설은 다른 나라 상표로 만든다(브랜드 ≠ 원산지) */
  licenses: { cityId: string; goodId: string; brandCountryId: string }[];
  /** 무역 정책(M4) */
  policy: {
    /** 정책이 없을 때의 기본 관세 */
    baseTariff: number;
    maxActivePerCountry: number;
    /** 시작한 정책은 적어도 이 기간(년)은 유지한다 */
    minYears: number;
    /** 한 나라가 동시에 맺을 수 있는 자유무역협정 수 */
    maxFtaPerCountry: number;
    /** 산업 보호: 국내 가동률이 낮고 수입 비중이 높으면 관세. 값이 너무 오르면 일찍 거둔다 */
    protection: { utilizationBelow: number; importShareAbove: number; rate: number; years: number; chance: number; repealPriceRatio: number };
    /** 무역협정: 두 나라 수입에서 서로의 몫이 크면 */
    fta: { tradeShareAbove: number; chance: number; years: number };
    /** 무역 갈등: 한 나라에서의 수입이 그 나라로의 수출보다 크게 많으면 */
    conflict: { deficitRatio: number; minShareOfImports: number; chance: number; rate: number; years: number; goodsCount: number };
  };
  /** 문화·브랜드(M4) */
  culture: {
    /** 나라별 문화 영향력(유행을 일으킬 가능성) */
    influence: Record<string, number>;
    /** 상품별 상표 민감도(0이면 유행의 영향을 받지 않는다) */
    sensitivity: Record<string, number>;
    waveChance: number;
    yearsMin: number;
    yearsMax: number;
    strengthMin: number;
    strengthMax: number;
    /** 유행 세기 1·민감도 1일 때 판매 웃돈 비율, 수요 증가율 */
    premiumScale: number;
    demandScale: number;
    media: string[];
    titles: string[];
  };
  /** 해마다 도는 장기 변화(M3) */
  growth: {
    /** 장기 변화를 켜고 끈다(꺼도 기록·정책은 돈다) */
    enabled: boolean;
    /** 소득: 기본 증가율, 부가가치(1인당, 세계 평균 대비)의 영향, 생필품 부족의 감점, 한 해 변화 한도 */
    baseIncomeGrowth: number;
    industryIncomeEffect: number;
    shortageIncomePenalty: number;
    incomeGrowthMin: number;
    incomeGrowthMax: number;
    /** 인구: 기본 증가율, 소득이 높을수록 덜 늘어나는 정도, 식량 부족의 감점, 한도 */
    basePopGrowth: number;
    incomePopEffect: number;
    foodShortagePopPenalty: number;
    popGrowthMin: number;
    popGrowthMax: number;
    /** 소득·인구에 영향을 주는 생필품 */
    essentialGoods: string[];
    foodGoods: string[];
    /** 증설: 가동률·채산성이 이 이상이면 생산능력을 expandShare만큼 늘린다(공사 expandYears년) */
    expandUtilization: number;
    expandMargin: number;
    expandShare: number;
    expandYears: number;
    /** 농장·광산은 처음 능력의 이 배수까지만 늘릴 수 있다(땅·매장량 한계) */
    cropExpandCap: number;
    resourceExpandCap: number;
    /** 신설(수입 대체): 수입 의존도·값·예상 채산성이 기준을 넘으면 buildChance 확률로 착공 */
    buildImportShare: number;
    buildPriceRatio: number;
    buildMargin: number;
    buildChance: number;
    /** 새 공장의 규모(그 도시가 쓰는 양 대비)와 공사 기간 */
    buildDemandShare: number;
    /** 새 공장은 세계 생산능력의 이 비율 이상일 때만 짓는다(채산이 안 맞는 초소형 공장 방지) */
    minBuildShareOfWorld: number;
    buildYears: number;
    /** 나라마다 동시에 지을 수 있는 공장 수 */
    maxProjectsPerCountry: number;
    /** 쇠퇴: 가동률·채산성이 낮은 해가 weakYearsToShrink년 이어지면 shrinkShare만큼 줄이고, 처음의 closeBelowShare 아래면 닫는다 */
    weakUtilization: number;
    weakMargin: number;
    weakYearsToShrink: number;
    shrinkShare: number;
    closeBelowShare: number;
    /** 기술: 해마다 base + 소득 효과 + 잡음만큼 오른다 */
    techBase: number;
    techIncomeEffect: number;
    techNoise: number;
    techMax: number;
    /** 기술 확산: 가장 앞선 나라와의 차이 × 이 값만큼 따라잡는다 */
    techCatchUp: number;
    /** 새 농장·광산: 세계 평균 값이 기준의 이 배수를 넘으면, 땅·매장량은 있는데 시설이 없던 도시에 짓는다 */
    rawBuildPriceRatio: number;
    rawBuildShare: number;
    /** 항만: 한 해 물동량(부피)이 [1→2, 2→3] 기준을 넘으면 확장 공사 */
    portThroughput: [number, number];
    portYears: number;
    /** NPC 선단: 배 값, 최소·최대 척수, 증선 기준(운영 자금 대비 현금, 배 한 척의 연 이익) */
    npcShipPrice: number;
    npcMinShips: number;
    npcMaxShips: number;
    npcExpandCashRatio: number;
    npcExpandProfitPerShip: number;
  };
  player: {
    companyName: string;
    startingCash: number;
    startShipType: string;
    startCityId: string;
    /** 부패성 화물이 냉장 없이 한 달 항해할 때 상하는 비율 */
    spoilagePerMonth: number;
    /** 장부를 남기는 달 수 */
    ledgerMonths: number;
    /** 거래 연대기를 남기는 개수 */
    chronicleMax: number;
  };
  npc: {
    companies: { id: string; name: string; homeCityId: string }[];
    shipsPerCompany: number;
    shipCapacity: number;
    /** 한 달 항해 거리(km) */
    speedKmPerMonth: number;
    /** 기항 시간(월) */
    portTimeMonths: number;
    startingCash: number;
    /** 선박 1척의 월 고정비 */
    shipUpkeep: number;
    /** 판단 오차(±비율). 완벽한 AI가 되지 않게 한다. */
    judgementNoise: number;
    /** 이보다 이익이 작으면 떠나지 않는다 */
    minTripProfit: number;
    /** 작은 시장에 덤으로 실어 가는 최소 수량 */
    minLotQuantity: number;
    /** 도착지 재고를 목표의 몇 배까지 채워 주는가(다음 배가 올 때까지 버틸 몫) */
    fillTo: number;
    /** 회사가 쥐고 있는 운영 자금. 이를 넘는 현금은 매달 일부를 본거지 도시에 배당·세금으로 낸다. */
    workingCapital: number;
    payoutRate: number;
    /**
     * 빈 배로 옮겨 가서 살 항구 후보를 지금 항구에서 가까운 몇 곳으로 줄인다(큰 세계의 계산량, §15).
     * 파는 곳(도착 항구)은 줄이지 않아 어느 지역의 수입 경로도 빠지지 않는다. 없으면 모든 항구를 본다.
     */
    repositionCandidates?: number;
  };
}

/**
 * 모드별 경제 프로필: 세계마다 달라지는 초기값만 담는다(나라·도시·시작 조건).
 * 상품·레시피·시장·선박·정책·성장 규칙은 COMMON_RULES 하나를 두 모드가 함께 쓴다.
 */
export interface EconomyProfile {
  id: string;
  mode: WorldMode;
  /** 프로필 값이 바뀌면 올린다(저장 호환 판단) */
  version: string;
  startYear: number;
  techByCountry: Record<string, number>;
  cities: Record<string, CityScenario>;
  licenses: EconomyData['licenses'];
  /** 나라별 문화 영향력 */
  cultureInfluence: Record<string, number>;
  npcCompanies: EconomyData['npc']['companies'];
  /** 플레이어가 처음 서 있는 항구 */
  startCityId: string;
  /** 공통 규칙 일부를 이 세계 규모에 맞게 바꾼다(바꾼 이유는 프로필 옆에 적어 둔다) */
  overrides?: {
    setup?: Partial<EconomyData['setup']>;
    npc?: Partial<Omit<EconomyData['npc'], 'companies'>>;
    growth?: Partial<EconomyData['growth']>;
    shipping?: Partial<EconomyData['shipping']>;
    market?: Partial<EconomyData['market']>;
    warmupMonths?: number;
  };
}

/** 가상 세계(두 대륙·6개국)의 초기값 */
export const VIRTUAL_PROFILE: EconomyProfile = {
  id: 'virtual',
  mode: 'virtual',
  version: '1',
  startYear: 2000,
  techByCountry: { karuna: 2, velorin: 4, astera: 5, solmar: 1, orden: 3, miren: 4 },
  cities: {
    portabel: { population: 6, income: 0.7, factories: { textiles: 2, processed_food: 1, furniture: 1, steel: 1 } },
    nandia: { population: 2.5, income: 0.6, factories: { processed_food: 1 } },
    havenru: { population: 5, income: 1.2, factories: { steel: 2, machinery: 1, fuel: 1 } },
    granbel: { population: 9, income: 1.3, factories: { automobiles: 3, machinery: 2, fuel: 2, processed_food: 1 } },
    lumen: { population: 10, income: 1.4, factories: { electronics: 4, cosmetics: 3, clothing: 2, machinery: 2 } },
    kelda: { population: 3, income: 1.1, factories: { steel: 1, furniture: 1 } },
    soltia: { population: 5, income: 0.6, factories: { textiles: 2, clothing: 2 } },
    maraco: { population: 3, income: 0.5, factories: { furniture: 1, processed_food: 1 } },
    orpa: { population: 12, income: 1.0, factories: { steel: 3, automobiles: 2, fuel: 2, processed_food: 2 } },
    draven: { population: 2.5, income: 0.9, factories: { processed_food: 1 } },
    mirapo: { population: 7, income: 0.9, factories: { electronics: 1, cosmetics: 1, clothing: 1, processed_food: 2 } },
    selwyn: { population: 4, income: 0.8, factories: { furniture: 2, fuel: 1, textiles: 1 } },
  },
  licenses: [{ cityId: 'soltia', goodId: 'clothing', brandCountryId: 'astera' }],
  cultureInfluence: { karuna: 0.2, velorin: 0.5, astera: 0.8, solmar: 0.3, orden: 0.4, miren: 0.6 },
  npcCompanies: [
    { id: 'npc_north', name: '보레아 해운', homeCityId: 'granbel' },
    { id: 'npc_south', name: '메리디아 상선', homeCityId: 'orpa' },
    { id: 'npc_gate', name: '관문 무역', homeCityId: 'portabel' },
  ],
  startCityId: 'portabel',
};

/** 공통 규칙: 모드와 상관없이 같은 상품·시장·선박·정책·성장 규칙 */
export type CommonRules = Omit<EconomyData, 'profile' | 'startYear' | 'techByCountry' | 'cities' | 'licenses'>;

export const COMMON_RULES: CommonRules = {
  warmupMonths: 12,
  goods: GOODS,
  setup: {
    factorySlack: 1.2,
    rawSlack: 1.1,
    geographyExponent: 1.5,
    rawShareThreshold: 0.05,
    cropStorageMonths: 3,
    exportBufferMonths: 2,
    importBufferMonths: 2,
  },
  market: {
    spread: 0.04,
    impactExponent: 0.4,
    stockExponent: 0.7,
    priceFloor: 0.3,
    priceCeil: 4,
    priceAdjust: 0.35,
    depthFloor: 0.6,
    idleBelowMargin: 0.85,
    fullAtMargin: 1.05,
    reserveShare: 0.6,
    maxBuyShare: 0.5,
    costShare: 0.82,
    minOperatingShare: 0.1,
    storageCap: 6,
  },
  shipping: { costPerUnitPer1000Km: 2.5, portFeePerUnit: 2, defaultTariff: 0 },
  inland: { minMargin: 0.04, fillTo: 1.2, minLot: 0.5 },
  shipTypes: [
    { id: 'small', name: '소형 일반화물선', blurb: '싸고 작은 항구에도 들어가요. 짐은 조금밖에 못 실어요.', price: 40000, capacity: 60, speedKmPerMonth: 10000, fuelPer1000Km: 70, upkeepPerMonth: 300, size: 1, cargoClasses: ['bulk', 'general', 'perishable'], refrigerated: false, resaleShare: 0.6 },
    { id: 'medium', name: '중형 일반화물선', blurb: '무엇이든 넉넉히 싣는 만능 배예요. 아주 작은 항구에는 못 들어가요.', price: 160000, capacity: 220, speedKmPerMonth: 11000, fuelPer1000Km: 180, upkeepPerMonth: 900, size: 2, cargoClasses: ['bulk', 'general', 'perishable'], refrigerated: false, resaleShare: 0.6 },
    { id: 'bulk', name: '벌크선', blurb: '곡물·광석·원유를 아주 많이 실어요. 공산품은 못 실어요.', price: 260000, capacity: 650, speedKmPerMonth: 9000, fuelPer1000Km: 300, upkeepPerMonth: 1400, size: 2, cargoClasses: ['bulk'], refrigerated: false, resaleShare: 0.6 },
    { id: 'container', name: '컨테이너선', blurb: '공산품을 많이, 빠르게 날라요. 큰 항구에만 들어가요.', price: 480000, capacity: 600, speedKmPerMonth: 15000, fuelPer1000Km: 450, upkeepPerMonth: 2500, size: 3, cargoClasses: ['general'], refrigerated: false, resaleShare: 0.6 },
    { id: 'reefer', name: '냉장선', blurb: '과일이 상하지 않아요. 유지비가 비싸요.', price: 200000, capacity: 180, speedKmPerMonth: 12500, fuelPer1000Km: 200, upkeepPerMonth: 1500, size: 2, cargoClasses: ['perishable', 'general'], refrigerated: true, resaleShare: 0.6 },
  ],
  growth: {
    enabled: true,
    baseIncomeGrowth: 0.012,
    industryIncomeEffect: 0.02,
    shortageIncomePenalty: 0.08,
    incomeGrowthMin: -0.03,
    incomeGrowthMax: 0.045,
    basePopGrowth: 0.013,
    incomePopEffect: -0.005,
    foodShortagePopPenalty: 0.12,
    popGrowthMin: -0.01,
    popGrowthMax: 0.025,
    essentialGoods: ['grain', 'processed_food', 'fuel'],
    foodGoods: ['grain', 'processed_food'],
    expandUtilization: 0.85,
    expandMargin: 1.08,
    expandShare: 0.15,
    expandYears: 2,
    cropExpandCap: 2.2,
    resourceExpandCap: 3.0,
    buildImportShare: 0.5,
    buildPriceRatio: 1.05,
    buildMargin: 1.12,
    buildChance: 0.35,
    buildDemandShare: 0.6,
    minBuildShareOfWorld: 0.06,
    buildYears: 3,
    maxProjectsPerCountry: 2,
    weakUtilization: 0.45,
    weakMargin: 0.9,
    weakYearsToShrink: 3,
    shrinkShare: 0.15,
    closeBelowShare: 0.15,
    techBase: 0.03,
    techIncomeEffect: 0.05,
    techNoise: 0.05,
    techMax: 6,
    techCatchUp: 0.025,
    rawBuildPriceRatio: 1.3,
    rawBuildShare: 0.6,
    portThroughput: [1500, 3000],
    portYears: 3,
    npcShipPrice: 150000,
    npcMinShips: 3,
    npcMaxShips: 12,
    npcExpandCashRatio: 1.25,
    npcExpandProfitPerShip: 20000,
  },
  policy: {
    baseTariff: 0,
    maxActivePerCountry: 2,
    minYears: 3,
    maxFtaPerCountry: 2,
    protection: { utilizationBelow: 0.6, importShareAbove: 0.35, rate: 0.25, years: 5, chance: 0.15, repealPriceRatio: 1.6 },
    fta: { tradeShareAbove: 0.15, chance: 0.06, years: 10 },
    conflict: { deficitRatio: 2.5, minShareOfImports: 0.12, chance: 0.06, rate: 0.35, years: 4, goodsCount: 3 },
  },
  culture: {
    influence: {},
    sensitivity: { cosmetics: 1, clothing: 0.8, furniture: 0.3, automobiles: 0.4, processed_food: 0.2, electronics: 0.1 },
    waveChance: 0.25,
    yearsMin: 3,
    yearsMax: 5,
    strengthMin: 0.5,
    strengthMax: 1,
    premiumScale: 0.3,
    demandScale: 0.8,
    media: ['드라마', '노래', '영화', '웹툰', '게임'],
    titles: ['푸른 항구', '바람의 노래', '별빛 시장', '파도 위의 약속', '은빛 도시', '등대지기', '남쪽 바다의 여름', '마지막 무역선'],
  },
  player: {
    companyName: '우리 무역회사',
    startingCash: 30000,
    startShipType: 'small',
    startCityId: '',
    spoilagePerMonth: 0.12,
    ledgerMonths: 36,
    chronicleMax: 400,
  },
  npc: {
    companies: [],
    shipsPerCompany: 6,
    shipCapacity: 200,
    speedKmPerMonth: 12000,
    portTimeMonths: 0.15,
    startingCash: 400000,
    shipUpkeep: 800,
    judgementNoise: 0.2,
    minTripProfit: 200,
    minLotQuantity: 0.2,
    fillTo: 1.2,
    workingCapital: 600000,
    payoutRate: 0.25,
  },
};

/** 공통 규칙 + 모드별 프로필 -> 엔진이 읽는 경제 데이터 */
export function buildEconomyData(profile: EconomyProfile, rules: CommonRules = COMMON_RULES): EconomyData {
  const r = structuredClone(rules);
  const o = profile.overrides ?? {};
  return {
    ...r,
    profile: { id: profile.id, mode: profile.mode, version: profile.version },
    startYear: profile.startYear,
    warmupMonths: o.warmupMonths ?? r.warmupMonths,
    techByCountry: { ...profile.techByCountry },
    cities: structuredClone(profile.cities),
    licenses: structuredClone(profile.licenses),
    setup: { ...r.setup, ...o.setup },
    shipping: { ...r.shipping, ...o.shipping },
    market: { ...r.market, ...o.market },
    growth: { ...r.growth, ...o.growth },
    culture: { ...r.culture, influence: { ...profile.cultureInfluence } },
    player: { ...r.player, startCityId: profile.startCityId },
    npc: { ...r.npc, ...o.npc, companies: structuredClone(profile.npcCompanies) },
  };
}

/** 가상 세계의 경제 데이터(예전 DEFAULT_ECONOMY와 같은 값) */
export const DEFAULT_ECONOMY: EconomyData = buildEconomyData(VIRTUAL_PROFILE);

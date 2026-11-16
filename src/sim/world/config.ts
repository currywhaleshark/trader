import type { GridSpec } from '../core/grid';
import type { LatLon } from '../core/sphere';

/**
 * 세계 생성 설정. 요구서에 없는 수치는 전부 여기에 있다.
 * 값을 바꾼 뒤 `npm run gen:world`로 다시 생성한다.
 * 이 객체는 world.json에 함께 저장되어 생성 조건을 재현할 수 있게 한다.
 */

/** 구면 위 선분(from→to) 주변 radiusDeg 이내가 육지 후보가 되는 "캡슐" */
export interface CapsuleSpec {
  from: LatLon;
  to: LatLon;
  radiusDeg: number;
}

export interface RidgeSpec {
  from: LatLon;
  to: LatLon;
  /** 산맥 폭(도) */
  widthDeg: number;
  /** 능선 높이(m) */
  heightM: number;
}

export interface ContinentSpec {
  id: number;
  name: string;
  /** 이 위도 밖으로는 육지가 생기지 않는다 */
  latMin: number;
  latMax: number;
  capsules: CapsuleSpec[];
  ridges: RidgeSpec[];
}

/**
 * 관문 해협. a, b는 양쪽 육지 안쪽의 점이고, 선분 a-b가 수로를 가로지른다.
 * 선분 중간에 수로를 강제로 파고, 선분 주변 바다를 "봉쇄 가능한 해협 구역"으로 표시한다.
 */
export interface GateSpec {
  id: string;
  name: string;
  a: LatLon;
  b: LatLon;
  /** 강제로 여는 수로의 반폭(도) */
  channelHalfWidthDeg: number;
  /** 강제로 여는 수로의 길이(도) */
  channelLengthDeg: number;
  /** 해협 구역으로 표시하는 반폭(도) */
  tagHalfWidthDeg: number;
}

export interface CountrySpec {
  id: string;
  name: string;
  continent: number;
  /** 영토가 자라나는 중심점 */
  anchor: LatLon;
  color: string;
}

export interface CitySpec {
  id: string;
  name: string;
  countryId: string;
  /** 이 근처 해안에서 가장 좋은 항구 자리를 찾는다 */
  anchor: LatLon;
  /** 1 소형, 2 중형, 3 대형 항만 */
  portSize: 1 | 2 | 3;
  note: string;
}

export interface CropSpec {
  id: string;
  name: string;
  /** seasonal: 재배 기간 뒤 수확 / perennial: 연중(목재) */
  kind: 'seasonal' | 'perennial';
  /** 월평균 기온(°C) 적합 범위 [최저, 적정 하한, 적정 상한, 최고] */
  temp: [number, number, number, number];
  /** 월 강수(mm) 적합 범위 */
  water: [number, number, number, number];
  /** 재배 기간(개월) */
  seasonMonths: number;
}

export interface ResourceSpec {
  id: string;
  name: string;
  kind: 'mineral' | 'oil';
  /** 매장 지대(광상 구역) 개수 */
  provinces: number;
  provinceRadiusDeg: number;
  /** 지대 사이 최소 간격(도) */
  minSeparationDeg: number;
  /** 육지 고도(m) 적합 범위 */
  elevation: [number, number, number, number];
  /** 해안에서 이 거리(km)까지의 얕은 바다에도 분포 (0이면 육지만) */
  shelfKm: number;
}

export interface WorldGenConfig {
  seed: string;
  grid: GridSpec;
  planetRadiusKm: number;
  landmass: {
    /** 큰 굴곡(만·반도) 노이즈의 세기(육지장 단위)와 주파수 */
    noiseAmp: number;
    noiseFreq: number;
    /** 잔 굴곡 노이즈의 세기와 주파수 */
    detailAmp: number;
    detailFreq: number;
    noiseOctaves: number;
    /** 청사진 좌표를 시드로 흔드는 폭(도) */
    jitterDeg: number;
    /** 반지름을 시드로 흔드는 비율 */
    radiusJitter: number;
    /** 이보다 작은 섬(셀 수)은 지운다 */
    minIslandCells: number;
    /** 캡슐 이음매를 둥글게 하는 정도 */
    blend: number;
    /** 캡슐 반지름의 이 비율 안쪽은 노이즈와 무관하게 항상 육지(팔·반도가 끊기지 않게) */
    coreFraction: number;
    /** 캡슐 반지름의 이 배수 바깥은 항상 바다(대륙이 번져 바다를 메우지 않게) */
    maxReach: number;
  };
  continents: ContinentSpec[];
  gates: GateSpec[];
  /** 중앙해 한가운데의 점(중앙해 구역 판별용) */
  centralSeaProbe: LatLon;
  elevation: {
    baseInlandM: number;
    hillsM: number;
    /** 해안 평야가 끝나는 거리(km) */
    coastalPlainKm: number;
    ridgeHeightJitter: number;
    ridgeJitterDeg: number;
  };
  climate: {
    /** 적도 해수면 연평균 기온(°C) */
    equatorTempC: number;
    /** 적도-극 기온 차(°C) */
    poleDropC: number;
    /** 연교차 진폭: 바다 / 대륙 내부 (극 기준, °C) */
    seasonalAmpOceanC: number;
    seasonalAmpLandC: number;
    /** 이 거리(km)에서 대륙도가 최대 */
    continentalityKm: number;
    lapseRateCPerKm: number;
    /** 해류 효과: 해안 판정 창(경도 도), 영향 범위(km), 세기(°C) */
    currentWindowDeg: number;
    currentReachKm: number;
    currentTempC: number;
    /** 탁월풍대·수렴대가 계절에 따라 남북으로 이동하는 폭(도) */
    beltShiftDeg: number;
    /** 기온 1°C당 포화 수증기량 증가율(지수) */
    saturationExp: number;
    /** 위도 기압대 계수: 바탕 / 적도 수렴대 가산 / 중위도 폭풍대 가산 */
    beltBase: number;
    beltEquator: number;
    beltMidLat: number;
    /** 수증기 재충전 거리(바다, km) */
    seaRechargeKm: number;
    /** 내륙으로 가며 비로 빠지는 거리(km) */
    landRainoutKm: number;
    /** 육지 증발산에 의한 재충전: 비율과 거리(km) */
    landRecycle: number;
    landRechargeKm: number;
    /** 해안 부근 공기의 습도(포화 대비)와 그 영향 거리(km). 풍향과 무관한 저기압성 수증기 유입을 근사한다. */
    maritimeHumidity: number;
    maritimeReachKm: number;
    /** 지형성 강수: 이 높이(m)만큼 오르면 남은 수증기의 63%가 비가 된다 */
    orographicScaleM: number;
    /** 비그늘: 이 높이(m)만큼 내려가면 강수가 절반 */
    leeScaleM: number;
    /** 포화 초과분이 비로 빠지는 비율 */
    excessRate: number;
    /** 이류 강수 환산 계수 */
    advectionScale: number;
    /** 적도 수렴대 대류성 강수(mm/월)와 폭(도) */
    convectionMm: number;
    convectionWidthDeg: number;
    /** 반복 완화 횟수(4방향 스윕 × rounds) */
    rounds: number;
  };
  hydrology: {
    /** 하천으로 표시할 최소 유량(m³/s) */
    riverMinFlow: number;
  };
  agriculture: {
    /** 하천 주변 관개 효과(mm/월 상당) */
    irrigationMm: number;
    /** 경작 가능으로 치는 최소 적합도(0~1) */
    arableThreshold: number;
  };
  crops: CropSpec[];
  resources: ResourceSpec[];
  countries: CountrySpec[];
  /** 국경이 산을 피하게 하는 고도 척도(m). 작을수록 산맥이 국경이 된다. */
  borderElevationScaleM: number;
  cities: CitySpec[];
  cityPlacement: {
    searchRadiusDeg: number;
    minSpacingDeg: number;
    /** 앞바다 자원을 가까운 도시에 귀속시키는 거리(km) */
    offshoreClaimKm: number;
  };
  routes: {
    /** 이 위도 너머는 항해 불가(얼음) */
    maxNavLatDeg: number;
  };
}

export const DEFAULT_SEED = 'trade-world-1';

export const DEFAULT_WORLD_CONFIG: WorldGenConfig = {
  seed: DEFAULT_SEED,
  grid: { width: 720, height: 360 },
  planetRadiusKm: 6371,

  landmass: {
    noiseAmp: 2.0,
    noiseFreq: 1.7,
    detailAmp: 0.9,
    detailFreq: 5.5,
    noiseOctaves: 4,
    jitterDeg: 1.0,
    radiusJitter: 0.08,
    minIslandCells: 14,
    blend: 0.14,
    coreFraction: 0.35,
    maxReach: 1.35,
  },

  continents: [
    {
      id: 1,
      name: '보레아 대륙',
      latMin: -16,
      latMax: 57,
      capsules: [
        { from: [40, -62], to: [36, -30], radiusDeg: 13 }, // 본체 서부
        { from: [33, -32], to: [37, 0], radiusDeg: 11 }, // 본체 중부
        { from: [38, -2], to: [34, 26], radiusDeg: 13 }, // 본체 동부
        { from: [46, -72], to: [39, -52], radiusDeg: 7 }, // 북서부
        { from: [38, -60], to: [8, -58], radiusDeg: 9.5 }, // 서쪽 팔(북)
        { from: [8, -58], to: [-8, -52], radiusDeg: 8 }, // 서쪽 팔(남, 적도를 넘는다)
        { from: [35, 24], to: [22, 36], radiusDeg: 5 }, // 남동 곶(동쪽 수로 북안)
        { from: [35, 24], to: [49, 46], radiusDeg: 6 }, // 북동 반도
        { from: [35, -14], to: [15, -8], radiusDeg: 4.5 }, // 중앙해로 뻗은 반도
      ],
      ridges: [
        { from: [48, -68], to: [30, -66], widthDeg: 2.2, heightM: 2600 }, // 서해안 산맥
        { from: [44, -45], to: [40, 0], widthDeg: 2.5, heightM: 2000 }, // 중앙 산지
        { from: [22, -66], to: [-4, -57], widthDeg: 2.2, heightM: 2400 }, // 팔 서쪽 산맥
        { from: [42, 12], to: [33, 30], widthDeg: 2.2, heightM: 1700 }, // 동부 산지
      ],
    },
    {
      id: 2,
      name: '메리디아 대륙',
      latMin: -57,
      latMax: 16,
      capsules: [
        { from: [-32, -22], to: [-37, 6], radiusDeg: 13 }, // 본체 서부
        { from: [-37, 6], to: [-33, 30], radiusDeg: 11 }, // 본체 중부
        { from: [-34, 30], to: [-38, 58], radiusDeg: 13.5 }, // 본체 동부
        { from: [-37, 52], to: [-6, 48], radiusDeg: 8.5 }, // 동쪽 팔(남)
        { from: [-6, 48], to: [7, 45], radiusDeg: 7.5 }, // 동쪽 팔(북, 적도를 넘는다)
        { from: [-33, -20], to: [-19, -40], radiusDeg: 5 }, // 북서 반도(서쪽 해협 남안)
        { from: [-33, -20], to: [-48, -46], radiusDeg: 6 }, // 남서 반도
        { from: [-38, 56], to: [-45, 66], radiusDeg: 8 }, // 남동부
        { from: [3, 2], to: [1, 6], radiusDeg: 3 }, // 중앙해의 섬
      ],
      ridges: [
        { from: [-44, -5], to: [-40, 50], widthDeg: 2.5, heightM: 3000 }, // 남부 대산맥
        { from: [-18, 55], to: [5, 47], widthDeg: 2.2, heightM: 2300 }, // 팔 동쪽 산맥
        { from: [-26, -28], to: [-44, -30], widthDeg: 2.2, heightM: 1900 }, // 서부 산맥
      ],
    },
  ],

  gates: [
    {
      id: 'west',
      name: '카루나 해협',
      a: [-8, -52],
      b: [-19, -40],
      channelHalfWidthDeg: 1.25,
      channelLengthDeg: 7,
      tagHalfWidthDeg: 1.0,
    },
    {
      id: 'east',
      name: '솔마르 수로',
      a: [7, 45],
      b: [22, 36],
      channelHalfWidthDeg: 2.0,
      channelLengthDeg: 7,
      tagHalfWidthDeg: 1.0,
    },
  ],
  centralSeaProbe: [8, -20],

  elevation: {
    baseInlandM: 360,
    hillsM: 520,
    coastalPlainKm: 260,
    ridgeHeightJitter: 0.15,
    ridgeJitterDeg: 2.5,
  },

  climate: {
    equatorTempC: 28,
    poleDropC: 36,
    seasonalAmpOceanC: 5,
    seasonalAmpLandC: 20,
    continentalityKm: 1200,
    lapseRateCPerKm: 6,
    currentWindowDeg: 10,
    currentReachKm: 500,
    currentTempC: 3.5,
    beltShiftDeg: 8,
    saturationExp: 0.045,
    beltBase: 0.31,
    beltEquator: 0.45,
    beltMidLat: 0.8,
    seaRechargeKm: 1500,
    landRainoutKm: 3000,
    landRecycle: 0.2,
    landRechargeKm: 700,
    maritimeHumidity: 0.9,
    maritimeReachKm: 1000,
    orographicScaleM: 9000,
    leeScaleM: 500,
    excessRate: 0.5,
    advectionScale: 700000,
    convectionMm: 100,
    convectionWidthDeg: 9,
    rounds: 3,
  },

  hydrology: { riverMinFlow: 350 },

  agriculture: { irrigationMm: 60, arableThreshold: 0.4 },

  crops: [
    { id: 'grain', name: '곡물', kind: 'seasonal', temp: [6, 14, 24, 31], water: [25, 55, 130, 220], seasonMonths: 5 },
    { id: 'fruit', name: '과일', kind: 'seasonal', temp: [11, 18, 28, 34], water: [35, 75, 190, 320], seasonMonths: 7 },
    { id: 'cotton', name: '면화', kind: 'seasonal', temp: [17, 22, 31, 37], water: [20, 45, 110, 170], seasonMonths: 6 },
    { id: 'timber', name: '목재', kind: 'perennial', temp: [-2, 6, 27, 32], water: [35, 70, 400, 800], seasonMonths: 12 },
  ],

  resources: [
    {
      id: 'iron_ore',
      name: '철광석',
      kind: 'mineral',
      provinces: 4,
      provinceRadiusDeg: 6,
      minSeparationDeg: 22,
      elevation: [120, 350, 1700, 2800],
      shelfKm: 0,
    },
    {
      id: 'crude_oil',
      name: '원유',
      kind: 'oil',
      provinces: 4,
      provinceRadiusDeg: 6,
      minSeparationDeg: 22,
      elevation: [0, 0, 260, 520],
      shelfKm: 220,
    },
  ],

  countries: [
    { id: 'karuna', name: '카루나', continent: 1, anchor: [5, -55], color: '#e07a5f' },
    { id: 'velorin', name: '벨로린', continent: 1, anchor: [40, -45], color: '#5b8def' },
    { id: 'astera', name: '아스테라', continent: 1, anchor: [38, 15], color: '#9b6bd6' },
    { id: 'solmar', name: '솔마르', continent: 2, anchor: [-5, 47], color: '#f2b134' },
    { id: 'orden', name: '오르덴', continent: 2, anchor: [-35, -12], color: '#3fa796' },
    { id: 'miren', name: '미렌', continent: 2, anchor: [-37, 42], color: '#d65d8f' },
  ],
  borderElevationScaleM: 500,

  cities: [
    { id: 'portabel', name: '포르타벨', countryId: 'karuna', anchor: [-6, -44], portSize: 3, note: '서쪽 관문 해협의 중앙해 쪽 입구' },
    { id: 'nandia', name: '난디아', countryId: 'karuna', anchor: [9, -66], portSize: 1, note: '외해 쪽 서해안' },
    { id: 'havenru', name: '하벤루', countryId: 'velorin', anchor: [40, -80], portSize: 2, note: '외해 쪽 서해안' },
    { id: 'granbel', name: '그란벨', countryId: 'velorin', anchor: [23, -30], portSize: 3, note: '중앙해 북안' },
    { id: 'lumen', name: '루멘', countryId: 'astera', anchor: [23, 10], portSize: 3, note: '중앙해 북동안' },
    { id: 'kelda', name: '켈다', countryId: 'astera', anchor: [47, 46], portSize: 1, note: '외해 쪽 북동 반도' },
    { id: 'soltia', name: '솔티아', countryId: 'solmar', anchor: [12, 43], portSize: 2, note: '동쪽 수로의 남쪽 입구' },
    { id: 'maraco', name: '마라코', countryId: 'solmar', anchor: [-8, 58], portSize: 1, note: '외해 쪽 동해안' },
    { id: 'orpa', name: '오르파', countryId: 'orden', anchor: [-20, -8], portSize: 3, note: '중앙해 남안' },
    { id: 'draven', name: '드라벤', countryId: 'orden', anchor: [-45, -40], portSize: 1, note: '외해 쪽 남서 반도' },
    { id: 'mirapo', name: '미라포', countryId: 'miren', anchor: [-21, 25], portSize: 2, note: '중앙해 남동안' },
    { id: 'selwyn', name: '셀윈', countryId: 'miren', anchor: [-48, 58], portSize: 2, note: '외해 쪽 남동해안' },
  ],
  cityPlacement: { searchRadiusDeg: 8, minSpacingDeg: 4, offshoreClaimKm: 450 },

  routes: { maxNavLatDeg: 78 },
};

/** 시드(및 일부 값)만 바꾼 설정을 만든다. */
export function makeConfig(overrides: Partial<WorldGenConfig> = {}): WorldGenConfig {
  return { ...structuredClone(DEFAULT_WORLD_CONFIG), ...overrides };
}

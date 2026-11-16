import type { GridSpec } from '../core/grid';
import type { LatLon } from '../core/sphere';
import type { WorldGenConfig } from './config';

/** 바다 구역 레이어 값 */
export const SEA_ZONE = {
  LAND: 0,
  OUTER: 1,
  CENTRAL: 2,
  NON_NAVIGABLE: 3,
  /** 4 + 해협 번호 */
  GATE_BASE: 4,
} as const;

export interface ClimateZoneDef {
  id: number;
  key: string;
  name: string;
  group: string;
  color: string;
}

/** 쾨펜 구분을 초등 사회과 수준(열대·건조·온대·냉대·한대·고산)에 맞춰 단순화 */
export const CLIMATE_ZONES: ClimateZoneDef[] = [
  { id: 0, key: 'sea', name: '바다', group: '바다', color: '#1d4e89' },
  { id: 1, key: 'rainforest', name: '열대 우림', group: '열대', color: '#0b7a3b' },
  { id: 2, key: 'savanna', name: '사바나', group: '열대', color: '#8fbf4d' },
  { id: 3, key: 'desert', name: '사막', group: '건조', color: '#e8c872' },
  { id: 4, key: 'steppe', name: '초원(스텝)', group: '건조', color: '#d4a85a' },
  { id: 5, key: 'mediterranean', name: '지중해성', group: '온대', color: '#e3883c' },
  { id: 6, key: 'humid_subtropical', name: '온난 습윤', group: '온대', color: '#5fb86a' },
  { id: 7, key: 'oceanic', name: '서안 해양성', group: '온대', color: '#3aa5a0' },
  { id: 8, key: 'continental', name: '냉대', group: '냉대', color: '#6f86c9' },
  { id: 9, key: 'polar', name: '한대(툰드라)', group: '한대', color: '#c9d6df' },
  { id: 10, key: 'highland', name: '고산', group: '고산', color: '#9a8fa3' },
];

/**
 * 격자 레이어. 모두 길이 width*height (월별 레이어는 12배, 월 m의 셀 i = m*N + i).
 * 생성 시 확정되고 런타임에는 읽기만 한다.
 */
export interface WorldLayers {
  /** 고도(m). 바다는 음수(수심). */
  elevation: Int16Array;
  /** 0 바다, 1.. 대륙 번호 */
  continentId: Uint8Array;
  /** 0 없음, 1.. = world.countries의 순번+1 */
  countryId: Uint8Array;
  /** 0 없음, 1.. = world.cities의 순번+1 (도시 배후지) */
  cityRegion: Uint8Array;
  /** SEA_ZONE 참조 */
  seaZone: Uint8Array;
  /** CLIMATE_ZONES의 id */
  climateZone: Uint8Array;
  /** 하천 유량: round(log2(1 + m³/s) * 16) */
  riverFlow: Uint8Array;
  /** 기본 해상 위험 계수 0~255 */
  seaRisk: Uint8Array;
  /** 곡물 수확이 가장 많은 달 1~12 (재배 부적합 0) */
  harvestMonth: Uint8Array;
  /** 월평균 기온, 0.5°C 단위 */
  tempMonthly: Int8Array;
  /** 월 강수량, 4mm 단위 */
  precipMonthly: Uint8Array;
  /** 작물별 재배 적합도 0~255 */
  cropSuitability: Record<string, Uint8Array>;
  /** 자원별 매장 풍부도 0~255 */
  resourceRichness: Record<string, Uint8Array>;
}

export const TEMP_SCALE = 0.5;
export const PRECIP_SCALE = 4;

export interface ContinentInfo {
  id: number;
  name: string;
  areaKm2: number;
  latMin: number;
  latMax: number;
  centroidLat: number;
}

export interface Country {
  id: string;
  /** countryId 레이어 값 (1..) */
  index: number;
  name: string;
  continent: number;
  color: string;
  areaKm2: number;
  coastCells: number;
  cityIds: string[];
}

export interface CropRegionStats {
  /** 배후지 평균 적합도 0~1 */
  suitability: number;
  /** 적합도가 기준 이상인 면적(km²) */
  arableAreaKm2: number;
  /** 월별 생산 계수. 평균 1(합 12). 수확기에 몰린다. */
  monthlyCoef: number[];
}

/** 도시 배후지 요약. M1 경제의 입력이 된다. */
export interface RegionSummary {
  areaKm2: number;
  meanElevationM: number;
  tempMonthlyC: number[];
  precipMonthlyMm: number[];
  dominantClimate: number;
  /** 기후대 id -> 면적 비율 */
  climateShare: Record<string, number>;
  crops: Record<string, CropRegionStats>;
  /** 자원 id -> 매장량 지수(풍부도 × 면적 합, 천 km² 단위) */
  resources: Record<string, number>;
}

export interface City {
  id: string;
  name: string;
  countryId: string;
  lat: number;
  lon: number;
  /** 도시가 놓인 육지 셀 */
  cell: number;
  /** 항구 앞바다 셀(항로의 시작점) */
  seaCell: number;
  isPort: boolean;
  portSize: 1 | 2 | 3;
  /** 항구가 면한 바다 */
  seaZone: 'central' | 'outer' | 'gate';
  note: string;
  region: RegionSummary;
}

export interface Chokepoint {
  id: string;
  /** seaZone 레이어 값 = GATE_BASE + index */
  index: number;
  name: string;
  lat: number;
  lon: number;
  cells: number;
}

export interface SeaRoute {
  from: string;
  to: string;
  distanceKm: number;
  /** 바다 위 경유점. 사이는 대권으로 잇는다. */
  waypoints: LatLon[];
  /** 통과하는 관문 해협 id */
  gates: string[];
}

export interface ValidationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: ValidationCheck[];
}

export interface WorldStats {
  landFraction: number;
  /** 기후대 id -> 육지 면적 비율 */
  climateShare: Record<string, number>;
  centralSeaAreaKm2: number;
}

export interface World {
  version: 1;
  seed: string;
  config: WorldGenConfig;
  planetRadiusKm: number;
  grid: GridSpec;
  layers: WorldLayers;
  continents: ContinentInfo[];
  countries: Country[];
  cities: City[];
  chokepoints: Chokepoint[];
  /** 항구 쌍마다 하나(from < to 순번). */
  seaRoutes: SeaRoute[];
  stats: WorldStats;
  validation: ValidationReport;
  /** 레이어와 구조 데이터 전체의 지문. 같은 시드면 같아야 한다. */
  hash: string;
}

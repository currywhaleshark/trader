import type { GridSpec } from '../core/grid';
import type { LatLon } from '../core/sphere';
import type { CropSpec, ResourceSpec, WorldGenConfig } from './config';

/**
 * 세계 모드. 같은 경제·선박·자동항로 엔진에 모드별 세계 데이터와 경제 프로필을 연결한다.
 *  - virtual: 시드로 만든 가상 세계(두 대륙·6개국)
 *  - earth: 실제 지구 지도와 선정한 무역항(오프라인 전처리 자료)
 */
export type WorldMode = 'virtual' | 'earth';
export const WORLD_MODES: WorldMode[] = ['virtual', 'earth'];

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
  /**
   * 0 없음, 1.. = world.mapUnits의 순번+1 (지도에 그리는 국가·지역 단위).
   * 가상 세계는 지도 단위 = 경제 국가라 world.countries의 순번과 같다.
   * 256개를 넘을 수 있어 16비트 배열도 허용한다(값이 조용히 잘리지 않게).
   */
  countryId: Uint8Array | Uint16Array;
  /** 0 없음, 1.. = world.cities의 순번+1 (도시 배후지) */
  cityRegion: Uint8Array | Uint16Array;
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
  /** 항구가 면한 바다(가상 세계의 구분. 현실 지구는 'outer'이고 seaName을 쓴다) */
  seaZone: 'central' | 'outer' | 'gate';
  /** 면한 바다의 이름(현실 지구) */
  seaName?: string;
  note: string;
  region: RegionSummary;
  /** 현실 지구: UN/LOCODE */
  locode?: string;
  /** 이 항구 시장과 배후 연결로 이어진 내륙 경제권(도시 id) */
  hinterlands?: string[];
  /** 내륙 경제권이면 관문항 id(배가 직접 기항하지 않는다) */
  gatewayPortId?: string;
}

/** 지도 단위의 경제 참여 수준(§3.1) */
export type Participation = 'active' | 'hinterland' | 'display';

/**
 * 지도에 그리는 국가·지역 단위. 경제 국가(countries)와 따로 둔다.
 * 표시 전용 단위는 이번 시나리오에서 경제 계산을 생략한 지역이다(무역이 없다는 뜻이 아니다).
 */
export interface MapUnit {
  /** 안정적인 id(현실 지구: ISO 3166-1 숫자 코드 기반) */
  id: string;
  /** countryId 레이어 값(1..) */
  index: number;
  name: string;
  color: string;
  /** 연결된 경제 국가 id(표시 전용이면 없음) */
  countryId?: string;
  participation: Participation;
  /** 원자료의 코드(예: ISO 3166-1 alpha-3) */
  isoA3?: string;
  areaKm2: number;
  /** 라벨 위치 */
  labelLat: number;
  labelLon: number;
}

/** 모드 공통으로 경제·화면이 쓰는 세계 목록(작물·자원·하천 기준) */
export interface WorldCatalog {
  crops: CropSpec[];
  resources: ResourceSpec[];
  /** 하천으로 그리는 최소 유량(m³/s) */
  riverMinFlow: number;
}

/** 이 세계 자료에 실제로 들어 있는 격자 레이어(없는 것은 화면에서 끈다) */
export interface LayerAvailability {
  climate: boolean;
  /** 월별 기온·강수 격자 */
  monthly: boolean;
  /** 작물 적합도·수확 시기 격자 */
  crops: boolean;
  resources: boolean;
  rivers: boolean;
}

/**
 * 통과 지점(운하·해협). 두 가지 방식:
 *  - zone: 격자 위 해협 구역(가상 세계). 봉쇄하면 그 셀을 막는다. seaZone = GATE_BASE + index.
 *  - link: 해상 격자와 따로 둔 명시적 통과 연결(현실 지구). 입구 셀 a와 출구 셀 b를 잇는 간선이며,
 *    봉쇄하면 간선을 뺀다. 그 해협을 격자로 돌아가지 못하도록 해협을 가로지르는 칸은 막아 둔다.
 */
export interface Chokepoint {
  id: string;
  /** 번호(봉쇄 목록·zone의 seaZone 값에 쓴다) */
  index: number;
  name: string;
  lat: number;
  lon: number;
  cells: number;
  kind?: 'zone' | 'link';
  /** 운하/해협 */
  type?: 'canal' | 'strait';
  /** link: 입구·출구 바다 셀 */
  aCell?: number;
  bCell?: number;
  /** link: 통과 경로(입구→출구) */
  path?: LatLon[];
  /** link: 통과 거리(km) */
  lengthKm?: number;
  /** 배 한 척이 한 번 지날 때 내는 통과료(크기 등급 1,2,3) */
  fee?: [number, number, number];
  /** 통과·대기에 더 걸리는 기간(월) */
  delayMonths?: number;
  /** 지날 수 있는 가장 큰 배의 크기 등급(없으면 제한 없음) */
  maxShipSize?: 1 | 2 | 3;
  /** 학생용 설명(게임용 비용·조건의 기준) */
  note?: string;
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

/**
 * 배후 연결: 내륙 경제권의 물량이 관문항 시장을 오가는 길(§4.2).
 * 플레이어가 조작하지 않고 월별 경제 처리에서 자동으로 옮긴다. 이동 중인 물량은 따로 추적한다.
 */
export interface InlandLink {
  id: string;
  /** 내륙 경제권(도시 id) */
  inlandId: string;
  /** 관문항(도시 id) */
  portId: string;
  /** 운송 기간(월) */
  months: number;
  /** 부피 1단위당 운송비 */
  costPerUnit: number;
  /** 한 달에 한 방향으로 옮길 수 있는 최대 부피 */
  monthlyCapacity: number;
  /** 연결 가능 상태 */
  open: boolean;
  /** 학생용 설명(예: 라인강 바지선·철도) */
  mode: string;
  /** 지도에 그리는 경로 */
  path: LatLon[];
}

export interface DataSourceRecord {
  id: string;
  name: string;
  url: string;
  version: string;
  retrieved: string;
  /** 통계 기준연도·기후 평년 기간 */
  period: string;
  license: string;
  attribution: string;
  /** 원본(또는 정규화 입력)의 SHA-256 */
  sha256?: string;
  notes?: string;
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

/** 세계 자료 계약 버전. 2부터 mode·worldId·catalog·mapUnits가 들어 있다. */
export const WORLD_FORMAT_VERSION = 2;

export interface World {
  version: 1 | 2;
  mode: WorldMode;
  /** 세계 id(가상: 'virtual', 현실: 'earth') */
  worldId: string;
  /** 지리·경제 자료 버전(현실 지구: 데이터 묶음 버전, 가상: 생성기 버전) */
  dataVersion: string;
  /** 가상: 지형을 만든 시드. 현실: 자료 묶음 이름(지형을 시드로 다시 만들지 않는다) */
  seed: string;
  /** 가상 세계 생성 설정(현실 지구에는 없다) */
  config?: WorldGenConfig;
  catalog: WorldCatalog;
  layerAvailability: LayerAvailability;
  /** 지도 단위(국경·이름). 레이어 countryId가 가리킨다. */
  mapUnits: MapUnit[];
  planetRadiusKm: number;
  grid: GridSpec;
  layers: WorldLayers;
  continents: ContinentInfo[];
  countries: Country[];
  cities: City[];
  chokepoints: Chokepoint[];
  /** 항구 쌍마다 하나(from < to 순번). */
  seaRoutes: SeaRoute[];
  /** 배후 연결(내륙 경제권 ↔ 관문항) */
  inlandLinks: InlandLink[];
  /** 해상 운항 범위(극지 항로 제외 등) */
  navigation?: { maxLatN: number; maxLatS: number; note: string };
  /** 자료 출처·버전(현실 지구) */
  sources?: DataSourceRecord[];
  stats: WorldStats;
  validation: ValidationReport;
  /** 레이어와 구조 데이터 전체의 지문. 같은 시드면 같아야 한다. */
  hash: string;
}

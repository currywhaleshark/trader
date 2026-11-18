import type { LatLon } from '../core/sphere';

/**
 * 현실 지구 모드의 설계 자료(게임 데이터). 실제 자료(인구·소득·경지·삼림·기후)는
 * data/earth/sources/ 의 고정 묶음에서 읽고, 여기에는 다음만 둔다:
 *  - 어떤 나라·경제권·항구를 계산에 넣는가(선정)
 *  - 나라 총량을 경제권에 나누는 비율(share)
 *  - 자료로 정하지 않는 게임 설계값(기술 단계·공장 비중·문화 영향력)
 *  - 수동 입력 참고값(철광석·원유 생산량, 반올림 근사) — 출처를 함께 적는다
 *  - 항구 좌표·운항용 해상 진입점, 통과 지점(운하·해협)과 배후 연결
 * 각 항목의 근거와 단위는 docs/EARTH_DATA.md 에 정리한다.
 */

/** 대륙 번호(지도 continentId 레이어) */
export const EARTH_CONTINENTS: { id: number; key: string; name: string }[] = [
  { id: 1, key: 'Asia', name: '아시아' },
  { id: 2, key: 'Europe', name: '유럽' },
  { id: 3, key: 'Africa', name: '아프리카' },
  { id: 4, key: 'North America', name: '북아메리카' },
  { id: 5, key: 'South America', name: '남아메리카' },
  { id: 6, key: 'Oceania', name: '오세아니아' },
  { id: 7, key: 'Antarctica', name: '남극' },
];

export interface EarthCountryDef {
  /** 경제 국가 id(소문자 ISO 3166-1 alpha-3) */
  id: string;
  /** Natural Earth ADM0_A3(지도 단위와 잇는 키) */
  a3: string;
  /** 화면 이름(짧게) */
  name: string;
  color: string;
  participation: 'active' | 'hinterland';
  /**
   * 게임 기술 단계(1~6, 가상 세계와 같은 척도). 공장을 세울 수 있는 품목을 가른다(설계값).
   * 국가를 영구 서열화하려는 값이 아니며, 장기 변화로 바뀐다.
   */
  tech: number;
  /** 문화 영향력 0~1(설계값) */
  culture: number;
  /**
   * 국가 총량 가운데 시뮬레이션에 넣는 비율(경제권 share.pop의 합).
   * 1이면 나라 전체, 1보다 작으면 일부 경제권만 표본으로 넣은 것이다.
   */
  simShare: number;
  /**
   * 수동 입력 참고값(반올림 근사). 철광석 사용 가능 광석 생산(Mt/년, USGS MCS 2024의 2023년 추정치),
   * 원유·콘덴세이트 생산(천 배럴/일, EIA 2023). 실제 통계로 표시하지 않고 생산 분포의 상대 비중으로만 쓴다.
   */
  ironOreMt?: number;
  crudeKbd?: number;
}

export interface EarthPortDef {
  /** UN/LOCODE(공식 배포본과 대조하지 않은 값이면 locodeVerified=false) */
  locode: string;
  /** 표시 좌표(항만 중심 근사) */
  lat: number;
  lon: number;
  /** 운항용 해상 진입점(배가 서는 앞바다). 항구 이름으로 가장 가까운 아무 바다 칸에 붙이지 않고 직접 정한다. */
  entry: LatLon;
  /** 1 소형, 2 중형, 3 대형 항만(게임 등급) */
  size: 1 | 2 | 3;
  seaName: string;
  /** 주로 다루는 화물(학생용 설명) */
  cargo: string;
}

export interface EarthMarketDef {
  /** 경제권(=시장) id. 항구면 항구 id와 같다. */
  id: string;
  countryId: string;
  name: string;
  kind: 'port' | 'inland';
  /**
   * 나라 총량에서 이 경제권이 맡는 몫(배타적 배분). 같은 나라 경제권들의 pop 합 = simShare.
   * arable·forest·iron·oil은 그 나라 경지·삼림·철광석·원유에서 이 경제권에 둔 몫.
   */
  share: { pop: number; arable: number; forest: number; iron?: number; oil?: number };
  /** 농업 기후를 대표하는 생산 배후지의 지점(항구 위치가 아니다) */
  climatePoint: LatLon;
  climateLabel: string;
  /** 제조업 공장: 상품 id -> 세계 생산 비중 가중치(게임 설계값, 실제 산업 구조를 참고) */
  factories: Record<string, number>;
  /**
   * 관개 보정(mm/월 상당, 게임 보정값). 강수만으로는 작물이 안 되지만 관개 농업이 큰 곳(캘리포니아·칠레 중앙 계곡 등).
   * 가상 세계의 하천 관개와 같은 작물 모형 입력이다.
   */
  irrigationMm?: number;
  port?: EarthPortDef;
  note: string;
}

/** 운하·해협 통과 연결(§8.1). 좌표는 게임용 근사. 요금은 게임 단위(가상 세계와 같은 화폐)다. */
export interface EarthPassageDef {
  id: string;
  name: string;
  type: 'canal' | 'strait';
  /** 입구·출구(바다 위 점) */
  a: LatLon;
  b: LatLon;
  /** a에서 b까지의 통과 경로(양 끝 포함) */
  path: LatLon[];
  /**
   * 격자로 이 해협을 돌아 지나지 못하게 막는 선분(양 끝은 양쪽 육지 안). 좁아서 격자에서 이미 막힌 곳은 비워 둔다.
   */
  barrier: [LatLon, LatLon][];
  /** 크기 등급 1·2·3 배의 1회 통과료(게임 단위) */
  fee: [number, number, number];
  delayMonths: number;
  maxShipSize?: 1 | 2 | 3;
  note: string;
}

export interface EarthInlandLinkDef {
  id: string;
  inlandId: string;
  portId: string;
  months: number;
  costPerUnit: number;
  monthlyCapacity: number;
  mode: string;
  path: LatLon[];
}

// ---------------------------------------------------------------- 나라

export const EARTH_COUNTRIES: EarthCountryDef[] = [
  { id: 'kor', a3: 'KOR', name: '한국', color: '#5b8def', participation: 'active', tech: 5, culture: 0.8, simShare: 1, ironOreMt: 0.5 },
  { id: 'chn', a3: 'CHN', name: '중국', color: '#e07a5f', participation: 'active', tech: 4, culture: 0.6, simShare: 0.35, ironOreMt: 280, crudeKbd: 4200 },
  { id: 'jpn', a3: 'JPN', name: '일본', color: '#d65d8f', participation: 'active', tech: 5, culture: 0.8, simShare: 1 },
  { id: 'sgp', a3: 'SGP', name: '싱가포르', color: '#f28482', participation: 'active', tech: 5, culture: 0.3, simShare: 1 },
  { id: 'mys', a3: 'MYS', name: '말레이시아', color: '#84a59d', participation: 'active', tech: 4, culture: 0.2, simShare: 1, crudeKbd: 550 },
  { id: 'are', a3: 'ARE', name: '아랍에미리트', color: '#c9a227', participation: 'active', tech: 3, culture: 0.3, simShare: 1, crudeKbd: 3300 },
  { id: 'nld', a3: 'NLD', name: '네덜란드', color: '#f4a261', participation: 'active', tech: 5, culture: 0.4, simShare: 1, crudeKbd: 15 },
  { id: 'deu', a3: 'DEU', name: '독일', color: '#8d99ae', participation: 'active', tech: 5, culture: 0.5, simShare: 1, crudeKbd: 35 },
  { id: 'usa', a3: 'USA', name: '미국', color: '#3a86ff', participation: 'active', tech: 5, culture: 1, simShare: 0.55, ironOreMt: 46, crudeKbd: 12900 },
  { id: 'bra', a3: 'BRA', name: '브라질', color: '#2a9d8f', participation: 'active', tech: 3, culture: 0.4, simShare: 1, ironOreMt: 440, crudeKbd: 3400 },
  { id: 'chl', a3: 'CHL', name: '칠레', color: '#bc4749', participation: 'active', tech: 3, culture: 0.2, simShare: 1, ironOreMt: 17 },
  { id: 'zaf', a3: 'ZAF', name: '남아프리카공화국', color: '#6a994e', participation: 'active', tech: 3, culture: 0.3, simShare: 1, ironOreMt: 63 },
  { id: 'aus', a3: 'AUS', name: '오스트레일리아', color: '#e9c46a', participation: 'active', tech: 4, culture: 0.4, simShare: 0.12, ironOreMt: 960, crudeKbd: 300 },
  { id: 'che', a3: 'CHE', name: '스위스', color: '#ef476f', participation: 'hinterland', tech: 5, culture: 0.4, simShare: 1 },
  { id: 'cze', a3: 'CZE', name: '체코', color: '#7b2cbf', participation: 'hinterland', tech: 4, culture: 0.3, simShare: 1 },
];

// ---------------------------------------------------------------- 경제권(시장)과 항구

export const EARTH_MARKETS: EarthMarketDef[] = [
  {
    id: 'busan', countryId: 'kor', name: '부산', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, iron: 1 },
    climatePoint: [36.0, 127.8], climateLabel: '한반도 중부·남부',
    factories: { steel: 3, automobiles: 3, electronics: 3, machinery: 2, fuel: 2, cosmetics: 2 },
    port: { locode: 'KRPUS', lat: 35.10, lon: 129.04, entry: [34.75, 129.25], size: 3, seaName: '대한해협', cargo: '컨테이너·자동차·철강' },
    note: '한국 전체를 하나의 경제권으로 넣었다(나라 전체).',
  },
  {
    id: 'shanghai', countryId: 'chn', name: '상하이', kind: 'port',
    share: { pop: 0.35, arable: 0.3, forest: 0.2, iron: 0.35, oil: 0.2 },
    climatePoint: [32.0, 118.8], climateLabel: '창장 하류·화북 남부',
    factories: { textiles: 3, clothing: 3, electronics: 4, steel: 4, machinery: 3, furniture: 3, processed_food: 2, automobiles: 2 },
    port: { locode: 'CNSHA', lat: 31.23, lon: 121.49, entry: [30.75, 122.75], size: 3, seaName: '동중국해', cargo: '컨테이너·공산품' },
    note: '중국은 창장 유역 배후권만 표본으로 넣었다(인구의 35%).',
  },
  {
    id: 'yokohama', countryId: 'jpn', name: '요코하마', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [36.0, 139.5], climateLabel: '간토 평야',
    factories: { automobiles: 4, machinery: 3, electronics: 2, steel: 2, cosmetics: 1, fuel: 1 },
    port: { locode: 'JPYOK', lat: 35.45, lon: 139.65, entry: [34.75, 139.75], size: 3, seaName: '태평양(사가미만)', cargo: '자동차·기계' },
    note: '일본 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'singapore', countryId: 'sgp', name: '싱가포르', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [1.35, 103.8], climateLabel: '싱가포르',
    factories: { fuel: 3, electronics: 2, processed_food: 1 },
    port: { locode: 'SGSIN', lat: 1.26, lon: 103.84, entry: [1.75, 104.75], size: 3, seaName: '싱가포르 해협(남중국해 쪽)', cargo: '컨테이너·석유 제품' },
    note: '말라카 해협 동쪽 끝. 해협 통과 연결의 동쪽 입구와 가깝다.',
  },
  {
    id: 'port_klang', countryId: 'mys', name: '포트클랑', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [3.5, 101.8], climateLabel: '말레이반도 서안',
    factories: { electronics: 2, furniture: 2, fuel: 1, processed_food: 1 },
    port: { locode: 'MYPKG', lat: 3.00, lon: 101.39, entry: [2.75, 100.75], size: 2, seaName: '말라카 해협', cargo: '컨테이너·전자부품·목재' },
    note: '말레이시아 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'jebel_ali', countryId: 'are', name: '제벨알리', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [24.5, 54.7], climateLabel: '아랍에미리트 해안',
    factories: { fuel: 3, steel: 1 },
    port: { locode: 'AEJEA', lat: 25.01, lon: 55.06, entry: [25.25, 54.75], size: 3, seaName: '페르시아만', cargo: '석유 제품·컨테이너' },
    note: '호르무즈 해협 안쪽 페르시아만에 있다.',
  },
  {
    id: 'rotterdam', countryId: 'nld', name: '로테르담', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [52.0, 5.3], climateLabel: '네덜란드',
    factories: { fuel: 3, processed_food: 2, machinery: 1, cosmetics: 1 },
    port: { locode: 'NLRTM', lat: 51.95, lon: 4.14, entry: [52.25, 3.75], size: 3, seaName: '북해', cargo: '원유·석유 제품·컨테이너' },
    note: '스위스 배후 경제권이 라인강 바지선·철도로 이어진다.',
  },
  {
    id: 'hamburg', countryId: 'deu', name: '함부르크', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [52.0, 10.5], climateLabel: '독일 북부·중부',
    factories: { automobiles: 3, machinery: 4, steel: 2, electronics: 1, cosmetics: 1 },
    port: { locode: 'DEHAM', lat: 53.54, lon: 9.97, entry: [54.25, 7.75], size: 3, seaName: '북해(엘베강 하구)', cargo: '컨테이너·기계·자동차' },
    note: '항만은 엘베강 상류에 있어 운항용 진입점은 하구 앞바다로 따로 정했다. 체코 배후 경제권과 이어진다.',
  },
  {
    id: 'los_angeles', countryId: 'usa', name: '로스앤젤레스', kind: 'port',
    share: { pop: 0.2, arable: 0.1, forest: 0.15, oil: 0.05 },
    climatePoint: [36.7, -119.8], climateLabel: '캘리포니아 중앙 계곡',
    factories: { electronics: 2, processed_food: 2, furniture: 1, fuel: 1, clothing: 1 },
    port: { locode: 'USLAX', lat: 33.74, lon: -118.27, entry: [33.5, -118.5], size: 3, seaName: '태평양', cargo: '컨테이너·농산물' },
    irrigationMm: 90,
    note: '미국 서부 경제권. 미국은 두 경제권(서부·동부와 중서부)으로 나눴다.',
  },
  {
    id: 'new_york', countryId: 'usa', name: '뉴욕', kind: 'port',
    share: { pop: 0.35, arable: 0.45, forest: 0.25, iron: 1, oil: 0.1 },
    climatePoint: [41.0, -86.0], climateLabel: '미국 중서부 곡창',
    factories: { machinery: 2, automobiles: 2, steel: 2, cosmetics: 2, processed_food: 2, fuel: 2 },
    port: { locode: 'USNYC', lat: 40.67, lon: -74.04, entry: [40.25, -73.5], size: 3, seaName: '대서양', cargo: '컨테이너·곡물·공산품' },
    note: '미국 동부와 중서부 곡창·오대호 철광을 배후로 둔다(게임 단순화).',
  },
  {
    id: 'santos', countryId: 'bra', name: '산투스', kind: 'port',
    share: { pop: 1, arable: 1, forest: 0.3, iron: 1, oil: 1 },
    climatePoint: [-21.5, -48.5], climateLabel: '상파울루 내륙',
    factories: { processed_food: 3, steel: 2, automobiles: 1, textiles: 1, fuel: 1, furniture: 1 },
    port: { locode: 'BRSSZ', lat: -23.96, lon: -46.30, entry: [-24.25, -46.25], size: 3, seaName: '남대서양', cargo: '곡물·설탕·철광석·커피' },
    note: '브라질 전체를 하나의 경제권으로 넣었다(남반구 계절).',
  },
  {
    id: 'san_antonio', countryId: 'chl', name: '산안토니오', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, iron: 1 },
    climatePoint: [-34.5, -71.0], climateLabel: '칠레 중앙 계곡',
    factories: { processed_food: 1, furniture: 1 },
    port: { locode: 'CLSAI', lat: -33.59, lon: -71.61, entry: [-33.75, -72.25], size: 2, seaName: '남태평양', cargo: '과일·목재·구리' },
    irrigationMm: 90,
    note: '남아메리카 태평양 쪽 항구. 지중해성 기후의 과일 수출지.',
  },
  {
    id: 'durban', countryId: 'zaf', name: '더반', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, iron: 1 },
    climatePoint: [-27.0, 29.0], climateLabel: '하이벨트',
    factories: { steel: 1, automobiles: 1, fuel: 1, processed_food: 1, textiles: 1 },
    port: { locode: 'ZADUR', lat: -29.87, lon: 31.03, entry: [-30.0, 31.5], size: 3, seaName: '인도양', cargo: '컨테이너·자동차·석탄' },
    note: '아프리카 남쪽 끝을 도는 항로의 기항지.',
  },
  {
    id: 'port_hedland', countryId: 'aus', name: '포트헤들랜드', kind: 'port',
    share: { pop: 0.12, arable: 0.35, forest: 0.1, iron: 1, oil: 0.4 },
    climatePoint: [-31.5, 117.5], climateLabel: '서오스트레일리아 밀 재배 지대',
    factories: { processed_food: 1 },
    port: { locode: 'AUPHE', lat: -20.31, lon: 118.58, entry: [-19.75, 118.5], size: 2, seaName: '인도양', cargo: '철광석' },
    note: '오스트레일리아 서부 경제권(인구 12%)을 표본으로 넣었다. 필바라 철광석의 수출항.',
  },
  {
    id: 'swiss', countryId: 'che', name: '스위스', kind: 'inland',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [47.0, 8.0], climateLabel: '스위스 고원',
    factories: { machinery: 2, cosmetics: 2, electronics: 1, processed_food: 1 },
    note: '바다가 없는 나라. 대표 관문항 로테르담과 라인강·철도로 이어진다(게임 단순화: 유일한 교역로라는 뜻이 아니다).',
  },
  {
    id: 'czech', countryId: 'cze', name: '체코', kind: 'inland',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [49.8, 15.5], climateLabel: '보헤미아',
    factories: { automobiles: 2, machinery: 2, steel: 1, furniture: 1, processed_food: 1 },
    note: '바다가 없는 나라. 대표 관문항 함부르크와 엘베강·철도로 이어진다.',
  },
];

// ---------------------------------------------------------------- 배후 연결

export const EARTH_INLAND_LINKS: EarthInlandLinkDef[] = [
  {
    id: 'swiss-rotterdam', inlandId: 'swiss', portId: 'rotterdam', months: 0.3, costPerUnit: 6, monthlyCapacity: 160,
    mode: '라인강 바지선·철도', path: [[47.4, 8.5], [47.56, 7.6], [48.6, 7.8], [50.0, 8.2], [50.9, 6.9], [51.85, 5.9], [51.92, 4.48]],
  },
  {
    id: 'czech-hamburg', inlandId: 'czech', portId: 'hamburg', months: 0.25, costPerUnit: 5, monthlyCapacity: 160,
    mode: '엘베강 바지선·철도', path: [[50.08, 14.43], [50.66, 14.05], [51.05, 13.74], [52.1, 11.6], [53.54, 9.97]],
  },
];

// ---------------------------------------------------------------- 통과 지점

/** 운하 요금 단위: 소형 배 연료비 1000km(70) 기준으로 우회 절감액보다 작게 잡은 게임값 */
export const EARTH_PASSAGES: EarthPassageDef[] = [
  {
    id: 'suez', name: '수에즈 운하', type: 'canal',
    a: [31.75, 32.25], b: [27.25, 34.25],
    path: [[31.75, 32.25], [31.25, 32.31], [30.6, 32.33], [30.3, 32.38], [29.95, 32.55], [29.4, 32.75], [28.6, 33.15], [27.9, 33.65], [27.25, 34.25]],
    barrier: [],
    fee: [250, 1200, 2600], delayMonths: 0.05,
    note: '지중해와 홍해를 잇는다. 막히면 아프리카 남쪽(희망봉)으로 돌아간다. 요금은 게임 단위의 근사값이다.',
  },
  {
    id: 'panama', name: '파나마 운하', type: 'canal',
    a: [9.75, -79.75], b: [8.25, -79.25],
    path: [[9.75, -79.75], [9.36, -79.92], [9.2, -79.8], [9.05, -79.68], [8.9, -79.55], [8.6, -79.4], [8.25, -79.25]],
    barrier: [],
    fee: [300, 1400, 3000], delayMonths: 0.1,
    note: '카리브해와 태평양을 잇는다. 갑문 운하라 시간이 더 걸린다. 가뭄 때는 큰 배의 통행이 제한될 수 있다(시나리오).',
  },
  {
    id: 'malacca', name: '말라카 해협', type: 'strait',
    a: [2.25, 101.0], b: [1.75, 104.75],
    path: [[2.25, 101.0], [1.9, 102.2], [1.4, 103.2], [1.2, 103.8], [1.35, 104.3], [1.75, 104.75]],
    barrier: [[[2.5, 102.4], [0.8, 102.0]]],
    fee: [0, 0, 0], delayMonths: 0.02,
    note: '인도양과 남중국해를 잇는 가장 짧은 길. 통행료는 없다. 막히면 순다 해협 등으로 돌아간다.',
  },
  {
    id: 'sunda', name: '순다 해협', type: 'strait',
    a: [-6.25, 105.25], b: [-5.25, 106.25],
    path: [[-6.25, 105.25], [-5.9, 105.8], [-5.25, 106.25]],
    barrier: [[[-5.4, 105.4], [-6.4, 106.2]]],
    fee: [0, 0, 0], delayMonths: 0.02,
    note: '수마트라와 자와 사이. 말라카 해협의 대체 해로 가운데 하나.',
  },
  {
    id: 'hormuz', name: '호르무즈 해협', type: 'strait',
    a: [26.25, 55.75], b: [25.75, 57.25],
    path: [[26.25, 55.75], [26.55, 56.2], [26.4, 56.6], [25.75, 57.25]],
    barrier: [[[27.2, 56.3], [26.0, 56.35]]],
    fee: [0, 0, 0], delayMonths: 0.02,
    note: '페르시아만의 유일한 바다 출입구. 막히면 만 안쪽 항구에 배가 드나들 수 없다.',
  },
  {
    id: 'bab_el_mandeb', name: '바브엘만데브 해협', type: 'strait',
    a: [13.75, 42.25], b: [12.25, 44.25],
    path: [[13.75, 42.25], [13.0, 42.9], [12.6, 43.35], [12.25, 44.25]],
    barrier: [[[12.1, 43.0], [13.0, 43.7]]],
    fee: [0, 0, 0], delayMonths: 0.02,
    note: '홍해의 남쪽 출입구. 수에즈 운하 항로와 이어진다.',
  },
  {
    id: 'gibraltar', name: '지브롤터 해협', type: 'strait',
    a: [35.75, -6.75], b: [36.25, -4.25],
    path: [[35.75, -6.75], [35.95, -5.6], [36.25, -4.25]],
    barrier: [[[36.6, -5.6], [35.3, -5.5]]],
    fee: [0, 0, 0], delayMonths: 0.02,
    note: '지중해와 대서양을 잇는다.',
  },
  {
    id: 'dover', name: '도버 해협', type: 'strait',
    a: [50.25, 0.75], b: [51.75, 2.25],
    path: [[50.25, 0.75], [50.95, 1.5], [51.75, 2.25]],
    barrier: [[[51.5, 1.1], [50.6, 2.1]]],
    fee: [0, 0, 0], delayMonths: 0.01,
    note: '영국 해협과 북해를 잇는다. 막히면 영국 북쪽으로 돌아간다.',
  },
  {
    id: 'turkish', name: '튀르키예 해협(다르다넬스·보스포루스)', type: 'strait',
    a: [39.75, 25.75], b: [41.75, 29.5],
    path: [[39.75, 25.75], [40.05, 26.2], [40.4, 26.7], [40.7, 27.6], [40.9, 28.6], [41.05, 29.0], [41.2, 29.1], [41.45, 29.2], [41.75, 29.5]],
    barrier: [],
    fee: [50, 200, 400], delayMonths: 0.05,
    note: '에게해와 흑해를 잇는 두 해협과 마르마라해를 한 통과 구간으로 묶었다. 등대·안전 요금 정도의 작은 비용.',
  },
];

/** 해상 운항 범위: 극지 항로·해빙은 첫 버전에서 다루지 않는다 */
export const EARTH_NAVIGATION = {
  maxLatN: 66,
  maxLatS: -62,
  note: '북위 66도보다 북쪽(북극 항로)과 남위 62도보다 남쪽은 운항하지 않는다. 해빙 변화는 다루지 않는다.',
};

/** 새 게임 기본 시작항과 고를 수 있는 시작항(짧은 항로부터 익히기 좋은 곳) */
export const EARTH_START_PORT_IDS = ['busan', 'rotterdam', 'singapore', 'santos'];

/** 자료 묶음 버전(정의·원자료가 바뀌면 올린다). 저장 호환 판단에 쓴다. */
export const EARTH_DATA_VERSION = 'earth-core-1';

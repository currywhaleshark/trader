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
   * 수동 입력 참고값(반올림 근사). 철광석 사용 가능 광석 생산(Mt/년, USGS MCS 2024의 2023년 추정 수준),
   * 원유·콘덴세이트 생산(천 배럴/일, EIA 2023 수준). 원표를 내려받아 대조한 값이 아니라 작성자가 넣은 근사라서
   * 실제 통계로 표시하지 않고 생산 분포의 상대 비중으로만 쓴다(자료 갱신 때 원표와 대조할 것).
   */
  ironOreMt?: number;
  crudeKbd?: number;
  /** 전체 범위(E3)에서 쓰는 포함 비율(핵심 범위와 경제권 나누기가 다를 때) */
  fullSimShare?: number;
  /**
   * World Bank에 자료가 없는 나라의 수동 참고값(출처와 함께). 결측을 0이나 임의 기본값으로 채우지 않기 위해
   * 확인한 공식 통계의 반올림값을 적는다.
   */
  manualRef?: { population: number; gdpPerCapitaUsd: number; arableHa: number; forestKm2: number; year: number; source: string };
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
   * pop은 도시 주민을 제외한 배후 인구의 배분 가중치. 같은 나라 경제권들의 pop 합 = simShare.
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
  /** 전체 범위(E3)에서 바꾸는 값(나라를 더 많은 경제권으로 나눌 때) */
  full?: Partial<Pick<EarthMarketDef, 'share' | 'climatePoint' | 'climateLabel' | 'factories' | 'note' | 'irrigationMm'>>;
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
  { id: 'chn', a3: 'CHN', name: '중국', color: '#e07a5f', participation: 'active', tech: 4, culture: 0.6, simShare: 0.35, fullSimShare: 0.75, ironOreMt: 280, crudeKbd: 4200 },
  { id: 'jpn', a3: 'JPN', name: '일본', color: '#d65d8f', participation: 'active', tech: 5, culture: 0.8, simShare: 1 },
  { id: 'sgp', a3: 'SGP', name: '싱가포르', color: '#f28482', participation: 'active', tech: 5, culture: 0.3, simShare: 1 },
  { id: 'mys', a3: 'MYS', name: '말레이시아', color: '#84a59d', participation: 'active', tech: 4, culture: 0.2, simShare: 1, crudeKbd: 550 },
  { id: 'are', a3: 'ARE', name: '아랍에미리트', color: '#c9a227', participation: 'active', tech: 3, culture: 0.3, simShare: 1, crudeKbd: 3300 },
  { id: 'nld', a3: 'NLD', name: '네덜란드', color: '#f4a261', participation: 'active', tech: 5, culture: 0.4, simShare: 1, crudeKbd: 15 },
  { id: 'deu', a3: 'DEU', name: '독일', color: '#8d99ae', participation: 'active', tech: 5, culture: 0.5, simShare: 1, crudeKbd: 35 },
  { id: 'usa', a3: 'USA', name: '미국', color: '#3a86ff', participation: 'active', tech: 5, culture: 1, simShare: 0.55, fullSimShare: 0.6, ironOreMt: 46, crudeKbd: 12900 },
  { id: 'bra', a3: 'BRA', name: '브라질', color: '#2a9d8f', participation: 'active', tech: 3, culture: 0.4, simShare: 1, ironOreMt: 440, crudeKbd: 3400 },
  { id: 'chl', a3: 'CHL', name: '칠레', color: '#bc4749', participation: 'active', tech: 3, culture: 0.2, simShare: 1, ironOreMt: 17 },
  { id: 'zaf', a3: 'ZAF', name: '남아프리카공화국', color: '#6a994e', participation: 'active', tech: 3, culture: 0.3, simShare: 1, ironOreMt: 63 },
  { id: 'aus', a3: 'AUS', name: '오스트레일리아', color: '#e9c46a', participation: 'active', tech: 4, culture: 0.4, simShare: 0.12, fullSimShare: 0.82, ironOreMt: 960, crudeKbd: 300 },
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
    full: { note: '중국은 화북(톈진)·창장(상하이)·화남(선전) 세 경제권으로 나눴다(인구의 75%).', share: { pop: 0.35, arable: 0.3, forest: 0.2, iron: 0.35, oil: 0.2 } },
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
    full: { note: '미국 서부 경제권. 미국은 서부·북동부·남부와 중서부 세 경제권으로 나눴다.', share: { pop: 0.18, arable: 0.1, forest: 0.15, oil: 0.05 } },
  },
  {
    id: 'new_york', countryId: 'usa', name: '뉴욕', kind: 'port',
    share: { pop: 0.35, arable: 0.45, forest: 0.25, iron: 1, oil: 0.1 },
    climatePoint: [41.0, -86.0], climateLabel: '미국 중서부 곡창',
    factories: { machinery: 2, automobiles: 2, steel: 2, cosmetics: 2, processed_food: 2, fuel: 2 },
    port: { locode: 'USNYC', lat: 40.67, lon: -74.04, entry: [40.25, -73.5], size: 3, seaName: '대서양', cargo: '컨테이너·곡물·공산품' },
    note: '미국 동부와 중서부 곡창·오대호 철광을 배후로 둔다(게임 단순화).',
    full: {
      note: '미국 북동부와 오대호 공업 지대(철광 포함)를 배후로 둔다. 중서부 곡창은 휴스턴 경제권으로 나눴다.',
      share: { pop: 0.22, arable: 0.15, forest: 0.25, iron: 1, oil: 0.03 },
      climatePoint: [41.5, -77.5],
      climateLabel: '미국 북동부(펜실베이니아)',
    },
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
    full: { note: '오스트레일리아 서부 경제권. 동부는 시드니 경제권으로 나눴다. 필바라 철광석의 수출항.', share: { pop: 0.12, arable: 0.35, forest: 0.1, iron: 1, oil: 0.4 } },
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

// ---------------------------------------------------------------- 전체 범위(E3)에서 더하는 나라·경제권·배후 연결

export const EARTH_EXPANSION_COUNTRIES: EarthCountryDef[] = [
  {
    id: 'twn', a3: 'TWN', name: '대만', color: '#4cc9f0', participation: 'active', tech: 5, culture: 0.4, simShare: 1,
    manualRef: {
      population: 23_420_000, gdpPerCapitaUsd: 32_300, arableHa: 790_000, forestKm2: 21_970, year: 2023,
      source: 'World Bank WDI에 대만 항목이 없어 넣은 수동 참고값(대만 주계총처·농업부 공표 수준의 반올림 근사, 이 작업에서 공식 표와 다시 대조하지 않음)',
    },
  },
  { id: 'vnm', a3: 'VNM', name: '베트남', color: '#e63946', participation: 'active', tech: 4, culture: 0.2, simShare: 1, ironOreMt: 5 },
  { id: 'tha', a3: 'THA', name: '태국', color: '#457b9d', participation: 'active', tech: 4, culture: 0.4, simShare: 1 },
  { id: 'idn', a3: 'IDN', name: '인도네시아', color: '#f4a3a8', participation: 'active', tech: 3, culture: 0.2, simShare: 1, crudeKbd: 600 },
  { id: 'ind', a3: 'IND', name: '인도', color: '#ff9f1c', participation: 'active', tech: 3, culture: 0.6, simShare: 0.6, ironOreMt: 270, crudeKbd: 600 },
  { id: 'pak', a3: 'PAK', name: '파키스탄', color: '#2b9348', participation: 'active', tech: 2, culture: 0.1, simShare: 1 },
  { id: 'sau', a3: 'SAU', name: '사우디아라비아', color: '#80b918', participation: 'active', tech: 3, culture: 0.2, simShare: 1, crudeKbd: 9600 },
  { id: 'egy', a3: 'EGY', name: '이집트', color: '#d4a373', participation: 'active', tech: 2, culture: 0.3, simShare: 1, crudeKbd: 550 },
  { id: 'nga', a3: 'NGA', name: '나이지리아', color: '#06a77d', participation: 'active', tech: 2, culture: 0.4, simShare: 1, crudeKbd: 1300 },
  { id: 'dji', a3: 'DJI', name: '지부티', color: '#90be6d', participation: 'active', tech: 1, culture: 0.05, simShare: 1 },
  { id: 'bel', a3: 'BEL', name: '벨기에', color: '#ffb703', participation: 'active', tech: 5, culture: 0.3, simShare: 1 },
  { id: 'gbr', a3: 'GBR', name: '영국', color: '#8338ec', participation: 'active', tech: 5, culture: 0.8, simShare: 1, crudeKbd: 700 },
  { id: 'fra', a3: 'FRA', name: '프랑스', color: '#3d5a80', participation: 'active', tech: 5, culture: 0.8, simShare: 1 },
  { id: 'esp', a3: 'ESP', name: '스페인', color: '#ee6c4d', participation: 'active', tech: 4, culture: 0.5, simShare: 1 },
  { id: 'ita', a3: 'ITA', name: '이탈리아', color: '#52b788', participation: 'active', tech: 5, culture: 0.7, simShare: 1 },
  { id: 'tur', a3: 'TUR', name: '튀르키예', color: '#c1121f', participation: 'active', tech: 3, culture: 0.5, simShare: 1, ironOreMt: 10 },
  { id: 'rus', a3: 'RUS', name: '러시아', color: '#6c757d', participation: 'active', tech: 3, culture: 0.4, simShare: 0.25, ironOreMt: 88, crudeKbd: 10100 },
  { id: 'can', a3: 'CAN', name: '캐나다', color: '#d62828', participation: 'active', tech: 5, culture: 0.5, simShare: 0.35, ironOreMt: 54, crudeKbd: 4900 },
  { id: 'mex', a3: 'MEX', name: '멕시코', color: '#588157', participation: 'active', tech: 4, culture: 0.4, simShare: 1, ironOreMt: 11, crudeKbd: 1900 },
  { id: 'per', a3: 'PER', name: '페루', color: '#bc6c25', participation: 'active', tech: 2, culture: 0.1, simShare: 1, ironOreMt: 17 },
  { id: 'arg', a3: 'ARG', name: '아르헨티나', color: '#90e0ef', participation: 'active', tech: 3, culture: 0.4, simShare: 1, crudeKbd: 650 },
  { id: 'nzl', a3: 'NZL', name: '뉴질랜드', color: '#1b4332', participation: 'active', tech: 4, culture: 0.2, simShare: 1 },
  { id: 'kaz', a3: 'KAZ', name: '카자흐스탄', color: '#48cae4', participation: 'hinterland', tech: 3, culture: 0.1, simShare: 1, ironOreMt: 30, crudeKbd: 1800 },
  { id: 'eth', a3: 'ETH', name: '에티오피아', color: '#ffd166', participation: 'hinterland', tech: 1, culture: 0.1, simShare: 1 },
];

const P = (locode: string, lat: number, lon: number, entry: LatLon, size: 1 | 2 | 3, seaName: string, cargo: string): EarthPortDef => ({
  locode, lat, lon, entry, size, seaName, cargo,
});

export const EARTH_EXPANSION_MARKETS: EarthMarketDef[] = [
  {
    id: 'tianjin', countryId: 'chn', name: '톈진', kind: 'port',
    share: { pop: 0.2, arable: 0.3, forest: 0.1, iron: 0.45, oil: 0.6 },
    climatePoint: [37.5, 116.0], climateLabel: '화북 평원',
    factories: { steel: 4, machinery: 2, automobiles: 2, fuel: 2, processed_food: 1 },
    port: P('CNTSN', 38.98, 117.78, [38.75, 118.75], 3, '보하이만', '철강·석탄·자동차'),
    note: '중국 화북 경제권(베이징·허베이).',
  },
  {
    id: 'shenzhen', countryId: 'chn', name: '선전', kind: 'port',
    share: { pop: 0.2, arable: 0.15, forest: 0.3, iron: 0.1, oil: 0.1 },
    climatePoint: [23.5, 113.5], climateLabel: '주장 삼각주',
    factories: { electronics: 5, clothing: 3, furniture: 3, textiles: 2, cosmetics: 1, machinery: 1 },
    port: P('CNSZX', 22.5, 113.9, [21.75, 114.25], 3, '남중국해', '컨테이너·전자제품'),
    note: '중국 화남 경제권(광둥).',
  },
  {
    id: 'kaohsiung', countryId: 'twn', name: '가오슝', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [23.0, 120.5], climateLabel: '대만 서남부 평야',
    factories: { electronics: 5, machinery: 2, steel: 2, fuel: 1 },
    port: P('TWKHH', 22.6, 120.28, [22.25, 119.75], 3, '대만 해협', '전자부품·컨테이너'),
    note: '대만 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'ho_chi_minh', countryId: 'vnm', name: '호찌민', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, iron: 1 },
    climatePoint: [10.5, 106.0], climateLabel: '메콩 삼각주',
    factories: { clothing: 4, textiles: 3, electronics: 3, furniture: 3, processed_food: 1 },
    port: P('VNSGN', 10.77, 106.75, [10.0, 107.25], 2, '남중국해', '의류·전자제품·쌀'),
    note: '베트남 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'laem_chabang', countryId: 'tha', name: '램차방', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [15.0, 100.5], climateLabel: '짜오프라야 평원',
    factories: { automobiles: 2, electronics: 2, processed_food: 2, cosmetics: 1, fuel: 1 },
    port: P('THLCH', 13.08, 100.88, [12.75, 100.75], 2, '타이만', '자동차·전자부품·쌀'),
    note: '태국 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'jakarta', countryId: 'idn', name: '자카르타', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [-7.0, 110.0], climateLabel: '자와섬 중부',
    factories: { textiles: 2, clothing: 2, furniture: 2, processed_food: 2, fuel: 1 },
    port: P('IDTPP', -6.1, 106.88, [-5.75, 106.75], 2, '자와해', '석탄·목재·의류'),
    note: '인도네시아 전체를 하나의 경제권으로 넣었다(탄중프리오크항).',
  },
  {
    id: 'nhava_sheva', countryId: 'ind', name: '나바셰바(뭄바이)', kind: 'port',
    share: { pop: 0.3, arable: 0.35, forest: 0.2, iron: 0.3, oil: 0.5 },
    climatePoint: [21.0, 75.0], climateLabel: '데칸고원 서부(면화 지대)',
    factories: { textiles: 3, clothing: 2, fuel: 3, steel: 2, automobiles: 1, cosmetics: 1 },
    port: P('INNSA', 18.95, 72.95, [18.75, 72.25], 3, '아라비아해', '컨테이너·석유 제품·면직물'),
    note: '인도 서부 경제권. 인도는 서부·남동부 두 경제권(인구의 60%)으로 넣었다.',
  },
  {
    id: 'chennai', countryId: 'ind', name: '첸나이', kind: 'port',
    share: { pop: 0.3, arable: 0.35, forest: 0.3, iron: 0.7, oil: 0.3 },
    climatePoint: [12.5, 78.5], climateLabel: '남인도',
    factories: { automobiles: 2, textiles: 2, steel: 2, processed_food: 1 },
    port: P('INMAA', 13.1, 80.3, [13.0, 80.75], 2, '벵골만', '자동차·철광석'),
    note: '인도 남동부 경제권.',
  },
  {
    id: 'karachi', countryId: 'pak', name: '카라치', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [30.5, 72.5], climateLabel: '펀자브(관개 농업)',
    irrigationMm: 90,
    factories: { textiles: 3, clothing: 2, processed_food: 1 },
    port: P('PKKHI', 24.8, 66.97, [24.5, 66.5], 2, '아라비아해', '면직물·쌀'),
    note: '파키스탄 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'ras_tanura', countryId: 'sau', name: '라스타누라', kind: 'port',
    share: { pop: 0.4, arable: 0.3, forest: 0.5, oil: 0.9 },
    climatePoint: [26.0, 49.5], climateLabel: '사우디 동부',
    factories: { fuel: 3, steel: 1 },
    port: P('SARTA', 26.64, 50.16, [26.75, 50.75], 3, '페르시아만', '원유·석유 제품'),
    note: '사우디아라비아 동부(원유 지대). 호르무즈 해협 안쪽.',
  },
  {
    id: 'jeddah', countryId: 'sau', name: '제다', kind: 'port',
    share: { pop: 0.6, arable: 0.7, forest: 0.5, oil: 0.1 },
    climatePoint: [21.5, 39.5], climateLabel: '헤자즈',
    factories: { processed_food: 1, fuel: 1 },
    port: P('SAJED', 21.48, 39.17, [21.5, 38.75], 3, '홍해', '컨테이너·식품'),
    note: '사우디아라비아 서부. 홍해 쪽이라 수에즈·바브엘만데브 항로와 이어진다.',
  },
  {
    id: 'alexandria', countryId: 'egy', name: '알렉산드리아', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [30.5, 31.0], climateLabel: '나일 삼각주(관개)',
    irrigationMm: 120,
    factories: { textiles: 2, clothing: 1, processed_food: 2, fuel: 1 },
    port: P('EGALY', 31.18, 29.87, [31.5, 29.75], 2, '지중해', '면화·곡물'),
    note: '이집트 전체를 하나의 경제권으로 넣었다. 나일강 관개 농업.',
  },
  {
    id: 'lagos', countryId: 'nga', name: '라고스', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [7.5, 4.5], climateLabel: '나이지리아 남서부',
    factories: { processed_food: 1, fuel: 1, textiles: 1 },
    port: P('NGAPP', 6.44, 3.37, [6.0, 3.5], 2, '기니만', '원유·식품'),
    note: '나이지리아 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'djibouti', countryId: 'dji', name: '지부티', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [11.6, 43.1], climateLabel: '지부티',
    factories: {},
    port: P('DJJIB', 11.6, 43.14, [11.75, 43.75], 2, '아덴만', '환적·에티오피아 화물'),
    note: '작은 나라지만 에티오피아의 대표 관문항이다.',
  },
  {
    id: 'antwerp', countryId: 'bel', name: '안트베르펜', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [50.8, 4.5], climateLabel: '벨기에',
    factories: { fuel: 2, cosmetics: 1, automobiles: 1, steel: 1, processed_food: 1 },
    port: P('BEANR', 51.27, 4.35, [51.75, 3.0], 3, '북해(스헬데강 하구)', '컨테이너·화학제품'),
    note: '항만은 스헬데강 상류라 운항용 진입점은 하구 앞바다로 정했다.',
  },
  {
    id: 'felixstowe', countryId: 'gbr', name: '펠릭스토', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [52.5, -1.0], climateLabel: '잉글랜드 중부',
    factories: { machinery: 2, automobiles: 2, cosmetics: 2, fuel: 1, electronics: 1, processed_food: 1 },
    port: P('GBFXT', 51.95, 1.32, [52.25, 2.25], 3, '북해', '컨테이너'),
    note: '영국 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'le_havre', countryId: 'fra', name: '르아브르', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [48.5, 1.5], climateLabel: '파리 분지',
    factories: { cosmetics: 3, automobiles: 2, machinery: 2, processed_food: 2, fuel: 1 },
    port: P('FRLEH', 49.48, 0.1, [49.75, -0.5], 3, '영국 해협', '컨테이너·화장품·곡물'),
    note: '프랑스 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'valencia', countryId: 'esp', name: '발렌시아', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [39.5, -1.5], climateLabel: '스페인 동부(관개 과수원)',
    irrigationMm: 60,
    factories: { automobiles: 2, processed_food: 2, clothing: 2, furniture: 1, fuel: 1 },
    port: P('ESVLC', 39.44, -0.32, [39.25, 0.25], 3, '지중해', '컨테이너·과일·자동차'),
    note: '스페인 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'genoa', countryId: 'ita', name: '제노바', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [45.0, 10.0], climateLabel: '포 평원',
    factories: { machinery: 3, clothing: 2, furniture: 2, steel: 1, cosmetics: 1, automobiles: 1, processed_food: 1 },
    port: P('ITGOA', 44.4, 8.92, [44.0, 8.75], 3, '리구리아해', '컨테이너·기계'),
    note: '이탈리아 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'mersin', countryId: 'tur', name: '메르신', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, iron: 1 },
    climatePoint: [37.0, 35.3], climateLabel: '추쿠로바 평야',
    factories: { textiles: 3, clothing: 3, automobiles: 2, steel: 2, processed_food: 2, furniture: 1 },
    port: P('TRMER', 36.78, 34.63, [36.5, 34.75], 2, '지중해', '면직물·자동차·과일'),
    note: '튀르키예 전체를 하나의 경제권으로 넣었다(지중해 쪽 항구).',
  },
  {
    id: 'novorossiysk', countryId: 'rus', name: '노보로시스크', kind: 'port',
    share: { pop: 0.25, arable: 0.4, forest: 0.05, iron: 0.5, oil: 0.5 },
    climatePoint: [45.5, 40.0], climateLabel: '쿠반 곡창',
    factories: { steel: 2, fuel: 2, processed_food: 1 },
    port: P('RUNVS', 44.72, 37.78, [44.25, 37.5], 2, '흑해', '곡물·원유·철강'),
    note: '러시아 남부 경제권만 표본으로 넣었다(인구의 25%). 흑해에서 튀르키예 해협을 지나야 대양으로 나간다.',
  },
  {
    id: 'houston', countryId: 'usa', name: '휴스턴', kind: 'port',
    share: { pop: 0.2, arable: 0.6, forest: 0.15, oil: 0.62 },
    climatePoint: [40.5, -90.0], climateLabel: '미국 중서부 옥수수 지대',
    factories: { fuel: 3, cosmetics: 1, machinery: 1, automobiles: 1, processed_food: 2 },
    port: P('USHOU', 29.73, -95.27, [28.75, -94.75], 3, '멕시코만', '원유·석유화학·곡물'),
    note: '미국 남부와 미시시피강 유역 곡창을 배후로 둔다(게임 단순화).',
  },
  {
    id: 'vancouver', countryId: 'can', name: '밴쿠버', kind: 'port',
    share: { pop: 0.35, arable: 0.8, forest: 0.6, oil: 0.8 },
    climatePoint: [51.0, -106.0], climateLabel: '캐나다 프레리',
    factories: { furniture: 1, fuel: 1, processed_food: 1, machinery: 1 },
    port: P('CAVAN', 49.29, -123.1, [48.5, -125.5], 3, '태평양(후안데푸카 해협 앞바다)', '곡물·목재·석탄'),
    note: '캐나다 서부와 프레리를 배후로 둔다(인구의 35%). 항만은 해협 안쪽이라 운항용 진입점을 해협 앞바다로 정했다.',
  },
  {
    id: 'veracruz', countryId: 'mex', name: '베라크루스', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, iron: 1, oil: 1 },
    climatePoint: [20.0, -101.0], climateLabel: '멕시코 고원(바히오)',
    factories: { automobiles: 3, electronics: 2, machinery: 1, processed_food: 2, fuel: 1, clothing: 1 },
    port: P('MXVER', 19.2, -96.13, [19.5, -95.75], 2, '멕시코만', '자동차·원유'),
    note: '멕시코 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'callao', countryId: 'per', name: '카야오', kind: 'port',
    share: { pop: 1, arable: 1, forest: 0.2, iron: 1 },
    climatePoint: [-12.0, -76.5], climateLabel: '페루 해안(관개)',
    irrigationMm: 90,
    factories: { processed_food: 1, textiles: 1 },
    port: P('PECLL', -12.05, -77.15, [-12.0, -77.5], 2, '남태평양', '광물·과일'),
    note: '페루 전체를 하나의 경제권으로 넣었다(아마존 삼림은 20%만).',
  },
  {
    id: 'buenos_aires', countryId: 'arg', name: '부에노스아이레스', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1, oil: 1 },
    climatePoint: [-34.0, -61.0], climateLabel: '팜파스',
    factories: { processed_food: 3, automobiles: 1, steel: 1, fuel: 1, textiles: 1 },
    port: P('ARBUE', -34.6, -58.37, [-35.25, -56.0], 2, '라플라타강 하구', '곡물·식품'),
    note: '아르헨티나 전체를 하나의 경제권으로 넣었다. 항만은 강 하구 안쪽이라 운항용 진입점을 하구로 정했다.',
  },
  {
    id: 'sydney', countryId: 'aus', name: '시드니', kind: 'port',
    share: { pop: 0.7, arable: 0.6, forest: 0.8, oil: 0.6 },
    climatePoint: [-34.5, 147.0], climateLabel: '머리-달링 분지',
    factories: { processed_food: 2, steel: 1, fuel: 1, machinery: 1 },
    port: P('AUSYD', -33.97, 151.21, [-34.0, 151.75], 3, '태즈먼해', '컨테이너·곡물·석탄'),
    note: '오스트레일리아 동부 경제권.',
  },
  {
    id: 'auckland', countryId: 'nzl', name: '오클랜드', kind: 'port',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [-38.0, 176.0], climateLabel: '뉴질랜드 북섬',
    factories: { processed_food: 2, furniture: 1 },
    port: P('NZAKL', -36.84, 174.77, [-36.25, 175.5], 2, '하우라키만', '과일·목재·식품'),
    note: '뉴질랜드 전체를 하나의 경제권으로 넣었다.',
  },
  {
    id: 'kazakhstan', countryId: 'kaz', name: '카자흐스탄', kind: 'inland',
    share: { pop: 1, arable: 1, forest: 1, iron: 1, oil: 1 },
    climatePoint: [51.0, 71.0], climateLabel: '카자흐 북부 스텝',
    factories: { steel: 1, fuel: 1 },
    note: '바다가 없는 나라. 대표 관문항 노보로시스크와 송유관·철도로 이어진다(게임 단순화).',
  },
  {
    id: 'ethiopia', countryId: 'eth', name: '에티오피아', kind: 'inland',
    share: { pop: 1, arable: 1, forest: 1 },
    climatePoint: [9.0, 38.7], climateLabel: '에티오피아 고원',
    factories: { clothing: 1, textiles: 1, processed_food: 1 },
    note: '바다가 없는 나라. 대표 관문항 지부티와 철도로 이어진다.',
  },
];

export const EARTH_EXPANSION_LINKS: EarthInlandLinkDef[] = [
  {
    id: 'kazakhstan-novorossiysk', inlandId: 'kazakhstan', portId: 'novorossiysk', months: 0.6, costPerUnit: 9, monthlyCapacity: 160,
    mode: '송유관(CPC)·철도', path: [[51.17, 71.43], [50.3, 57.2], [47.1, 51.9], [45.6, 45.0], [44.72, 37.78]],
  },
  {
    id: 'ethiopia-djibouti', inlandId: 'ethiopia', portId: 'djibouti', months: 0.4, costPerUnit: 7, monthlyCapacity: 90,
    mode: '아디스아바바–지부티 철도', path: [[9.03, 38.74], [9.6, 41.86], [11.0, 42.7], [11.59, 43.15]],
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

/**
 * 규모 설정(§2.2). core = 통합 검증판(14개 항구, 내륙 배후권 2개), full = 첫 정식 범위(42개 항구, 내륙 배후권 4개).
 * 범위를 바꾸면 자료 버전이 달라져 저장 호환 검사가 다른 세계로 본다.
 */
export type EarthScope = 'core' | 'full';
export const EARTH_SCOPE: EarthScope = 'full';

export interface EarthDefinitionSet {
  scope: EarthScope;
  countries: EarthCountryDef[];
  markets: EarthMarketDef[];
  inlandLinks: EarthInlandLinkDef[];
  passages: EarthPassageDef[];
  navigation: typeof EARTH_NAVIGATION;
  dataVersion: string;
}

export function earthDefinitions(scope: EarthScope = EARTH_SCOPE): EarthDefinitionSet {
  if (scope === 'core') {
    return {
      scope,
      countries: EARTH_COUNTRIES,
      markets: EARTH_MARKETS,
      inlandLinks: EARTH_INLAND_LINKS,
      passages: EARTH_PASSAGES,
      navigation: EARTH_NAVIGATION,
      dataVersion: 'earth-core-1',
    };
  }
  return {
    scope,
    countries: [...EARTH_COUNTRIES, ...EARTH_EXPANSION_COUNTRIES].map((c) => ({ ...c, simShare: c.fullSimShare ?? c.simShare })),
    markets: [...EARTH_MARKETS.map((m) => ({ ...m, ...(m.full ?? {}) })), ...EARTH_EXPANSION_MARKETS],
    inlandLinks: [...EARTH_INLAND_LINKS, ...EARTH_EXPANSION_LINKS],
    passages: EARTH_PASSAGES,
    navigation: EARTH_NAVIGATION,
    dataVersion: 'earth-full-1',
  };
}

/** 자료 묶음 버전(정의·원자료가 바뀌면 올린다). 저장 호환 판단에 쓴다. */
export const EARTH_DATA_VERSION = earthDefinitions(EARTH_SCOPE).dataVersion;

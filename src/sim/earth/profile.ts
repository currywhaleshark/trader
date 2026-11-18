import type { CityScenario, EconomyProfile } from '../economy/data';
import worldBank from '../../../data/earth/sources/worldbank-wdi.json';
import { EARTH_COUNTRIES, EARTH_DATA_VERSION, EARTH_MARKETS, EARTH_START_PORT_IDS } from './definitions';

/**
 * 현실 지구 경제 프로필. 실제 자료(World Bank 인구·1인당 GDP)를 보존하고,
 * 아래 변환 규칙으로 게임 수치를 만든다(§6.1). 원자료 값·게임 값·수동 보정은 earthProfileReport()로 함께 본다.
 *
 * 변환 순서
 *  1) 나라 인구 × 시뮬레이션 포함 비율(simShare) = 계산에 넣는 인구
 *  2) 나라의 게임 인구 = popScale × (계산 인구[백만 명])^popExponent  — 큰 나라와 작은 나라의 차이를 줄인다
 *  3) 경제권의 게임 인구 = 나라 게임 인구 × (경제권 몫 / simShare)   — 경제권 합 = 나라 총량(복제 없음)
 *  4) 소득 지수 = (1인당 GDP / incomeRef)^incomeExponent              — 소득 수준의 참고값일 뿐 가처분소득이 아니다
 * 1인당 GDP는 나라 안 모든 경제권에 같은 값을 쓴다.
 */
export const EARTH_SCALING = {
  popScale: 1,
  popExponent: 0.5,
  incomeRef: 13000,
  incomeExponent: 0.4,
};

type WBValue = { value: number; year: number } | null;
const WB = worldBank as unknown as { baseYear: number; countries: Record<string, Record<string, WBValue>> };

export interface EarthCountryFigures {
  id: string;
  name: string;
  /** 원자료 */
  population: WBValue;
  gdpPerCapitaUsd: WBValue;
  /** 계산에 넣은 비율과 그 인구(백만 명) */
  simShare: number;
  simPopulationM: number;
  /** 게임 값 */
  gamePopulation: number;
  gameIncome: number;
  tech: number;
}

export function earthCountryFigures(): EarthCountryFigures[] {
  return EARTH_COUNTRIES.map((c) => {
    const pop = WB.countries[c.id.toUpperCase()]?.population ?? null;
    const gdp = WB.countries[c.id.toUpperCase()]?.gdpPerCapitaUsd ?? null;
    if (!pop || !gdp) throw new Error(`World Bank 자료에 ${c.id}의 인구·1인당 GDP가 없습니다(결측을 기본값으로 채우지 않는다). npm run fetch:earth`);
    const simPopulationM = (pop.value / 1e6) * c.simShare;
    return {
      id: c.id,
      name: c.name,
      population: pop,
      gdpPerCapitaUsd: gdp,
      simShare: c.simShare,
      simPopulationM,
      gamePopulation: EARTH_SCALING.popScale * Math.pow(simPopulationM, EARTH_SCALING.popExponent),
      gameIncome: Math.pow(gdp.value / EARTH_SCALING.incomeRef, EARTH_SCALING.incomeExponent),
      tech: c.tech,
    };
  });
}

function round(v: number, d = 3): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function buildCities(): Record<string, CityScenario> {
  const figures = new Map(earthCountryFigures().map((f) => [f.id, f]));
  const out: Record<string, CityScenario> = {};
  for (const m of EARTH_MARKETS) {
    const f = figures.get(m.countryId)!;
    out[m.id] = {
      population: round(f.gamePopulation * (m.share.pop / f.simShare)),
      income: round(f.gameIncome),
      factories: { ...m.factories },
    };
  }
  return out;
}

const NAMES = new Map(EARTH_MARKETS.map((m) => [m.id, m.name]));
export const EARTH_START_PORTS: { id: string; name: string }[] = EARTH_START_PORT_IDS.map((id) => ({ id, name: NAMES.get(id) ?? id }));

export const EARTH_PROFILE: EconomyProfile = {
  id: 'earth',
  mode: 'earth',
  version: EARTH_DATA_VERSION,
  // 자료 기준연도(2023)와 게임 시작 연도는 다르다: 게임은 준비 기간 뒤 2025년부터 시작한다
  startYear: 2024,
  techByCountry: Object.fromEntries(EARTH_COUNTRIES.map((c) => [c.id, c.tech])),
  cities: buildCities(),
  licenses: [],
  cultureInfluence: Object.fromEntries(EARTH_COUNTRIES.map((c) => [c.id, c.culture])),
  npcCompanies: [
    { id: 'npc_asia', name: '아시아 해운', homeCityId: 'shanghai' },
    { id: 'npc_europe', name: '유럽 상선', homeCityId: 'rotterdam' },
    { id: 'npc_america', name: '아메리카 라인', homeCityId: 'new_york' },
    { id: 'npc_strait', name: '해협 무역', homeCityId: 'singapore' },
  ],
  startCityId: 'busan',
  overrides: {
    // 한 나라를 여러 항구 경제권으로 나누므로 원재료 생산자 문턱을 나라 단위로 본다(§6.3)
    setup: { rawThresholdScope: 'country' },
    // 실제 지구의 항로는 가상 세계보다 길다(평균 1만 km 이상): 선단과 적재량을 늘려 총수요·운송 기간에 맞춘다
    npc: { shipsPerCompany: 8, shipCapacity: 240 },
    warmupMonths: 12,
  },
};

/** 원자료·게임 값·변환 규칙을 함께 보여 주는 표(화면·문서용) */
export function earthProfileReport(): { scaling: typeof EARTH_SCALING; baseYear: number; countries: EarthCountryFigures[] } {
  return { scaling: EARTH_SCALING, baseYear: WB.baseYear, countries: earthCountryFigures() };
}

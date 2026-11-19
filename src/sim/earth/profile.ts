import type { CityScenario, CountryPopulation, EconomyProfile } from '../economy/data';
import worldBank from '../../../data/earth/sources/worldbank-wdi.json';
import portPopulation from '../../../data/earth/sources/port-city-populations.json';
import { earthDefinitions, EARTH_START_PORT_IDS, type EarthCountryDef, type EarthDefinitionSet } from './definitions';

/**
 * 현실 지구 경제 프로필. 실제 자료(World Bank 인구·1인당 GDP)를 보존하고,
 * 아래 변환 규칙으로 게임 수치를 만든다(§6.1). 원자료 값·게임 값·수동 보정은 earthProfileReport()로 함께 본다.
 *
 * 변환 순서
 *  1) 나라 인구 × 시뮬레이션 포함 비율(simShare) = 계산에 넣는 인구
 *  2) 나라의 게임 인구 = popScale × (계산 인구[백만 명])^popExponent  — 큰 나라와 작은 나라의 차이를 줄인다
 *  3) 포함 인구에서 항구 도시 주민을 먼저 배정하고 나머지 배후 주민만 경제권별 가중치로 나눈다.
 *  4) 소득 지수 = (1인당 GDP / incomeRef)^incomeExponent              — 소득 수준의 참고값일 뿐 가처분소득이 아니다
 * 1인당 GDP는 나라 안 모든 경제권에 같은 값을 쓴다.
 */
export const EARTH_SCALING = {
  popScale: 1,
  popExponent: 0.5,
  incomeRef: 13000,
  incomeExponent: 0.4,
};

type WBValue = { value: number; year: number; manual?: string } | null;
const WB = worldBank as unknown as { baseYear: number; countries: Record<string, Record<string, WBValue>> };

/** World Bank 값, 없으면 정의의 수동 참고값(출처 표시) */
function ref(c: EarthCountryDef, key: 'population' | 'gdpPerCapitaUsd'): WBValue {
  const v = WB.countries[c.id.toUpperCase()]?.[key];
  if (v) return v;
  if (c.manualRef) return { value: c.manualRef[key], year: c.manualRef.year, manual: c.manualRef.source };
  return null;
}

export interface EarthCountryFigures {
  id: string;
  name: string;
  /** 원자료 */
  population: NonNullable<WBValue>;
  gdpPerCapitaUsd: WBValue;
  /** 계산에 넣은 비율과 그 인구(백만 명) */
  simShare: number;
  simPopulationM: number;
  /** 게임 값 */
  gamePopulation: number;
  gameIncome: number;
  tech: number;
}

export function earthCountryFigures(defs: EarthDefinitionSet = earthDefinitions()): EarthCountryFigures[] {
  return defs.countries.map((c) => {
    const pop = ref(c, 'population');
    const gdp = ref(c, 'gdpPerCapitaUsd');
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

function buildMarkets(defs: EarthDefinitionSet) {
  const cities: Record<string, CityScenario> = {};
  const countryPopulations: Record<string, CountryPopulation> = {};
  const observations: Record<string, { residents: number }> = portPopulation.cities;
  for (const f of earthCountryFigures(defs)) {
    const markets = defs.markets.filter((m) => m.countryId === f.id);
    const covered = f.population.value * f.simShare;
    const residentsPerUnit = covered / f.gamePopulation;
    countryPopulations[f.id] = { residents: f.population.value, year: f.population.year, residentsPerUnit };
    const local = markets.map((m) => {
      if (m.kind === 'inland') return 0;
      if (m.id === 'singapore') return f.population.value;
      const observation = observations[m.id];
      if (!observation) throw new Error(`항구 도시 인구 자료 누락: ${m.id}`);
      return observation.residents;
    });
    const hinterland = covered - local.reduce((sum, n) => sum + n, 0);
    if (hinterland < 0) throw new Error(`도시 인구가 국가의 포함 인구를 초과합니다: ${f.id}`);
    for (const [i, m] of markets.entries()) {
      const marketResidents = local[i] + hinterland * (m.share.pop / f.simShare);
      cities[m.id] = {
        population: marketResidents / residentsPerUnit,
        ...(m.kind === 'port' && { cityResidents: local[i] }),
        income: round(f.gameIncome),
        factories: { ...m.factories },
      };
    }
  }
  return { cities, countryPopulations };
}

const NAMES = new Map(earthDefinitions().markets.map((m) => [m.id, m.name]));
export const EARTH_START_PORTS: { id: string; name: string }[] = EARTH_START_PORT_IDS.map((id) => ({ id, name: NAMES.get(id) ?? id }));

/** 규모 설정(핵심/전체)에 맞는 현실 지구 경제 프로필 */
export function buildEarthProfile(defs: EarthDefinitionSet = earthDefinitions()): EconomyProfile {
  const full = defs.scope === 'full';
  return {
    id: 'earth',
    mode: 'earth',
    version: defs.dataVersion,
    // 자료 기준연도(2023)와 게임 시작 연도는 다르다: 준비 기간(1년) 뒤 2025년부터 시작한다
    startYear: 2024,
    techByCountry: Object.fromEntries(defs.countries.map((c) => [c.id, c.tech])),
    ...buildMarkets(defs),
    licenses: [],
    cultureInfluence: Object.fromEntries(defs.countries.map((c) => [c.id, c.culture])),
    npcCompanies: [
      { id: 'npc_asia', name: '아시아 해운', homeCityId: 'shanghai' },
      { id: 'npc_europe', name: '유럽 상선', homeCityId: 'rotterdam' },
      { id: 'npc_america', name: '아메리카 라인', homeCityId: 'new_york' },
      { id: 'npc_strait', name: '해협 무역', homeCityId: 'singapore' },
      ...(full
        ? [
            { id: 'npc_gulf', name: '걸프 탱커', homeCityId: 'jebel_ali' },
            { id: 'npc_south', name: '남반구 해운', homeCityId: 'santos' },
          ]
        : []),
    ],
    // 실제 가격 통계가 아닌 게임 프로필. 순서대로 대표·보조 산업.
    signatureIndustries: {
      deu: ['automobiles', 'machinery'], kor: ['electronics', 'cosmetics'], ita: ['clothing', 'furniture'],
      chn: ['electronics', 'steel'], jpn: ['automobiles', 'machinery'], sgp: ['fuel'], mys: ['electronics'],
      are: ['crude_oil', 'fuel'], nld: ['processed_food'], usa: ['machinery', 'electronics'], bra: ['iron_ore', 'processed_food'],
      chl: ['processed_food'], zaf: ['steel', 'iron_ore'], aus: ['iron_ore', 'processed_food'], che: ['machinery'], cze: ['automobiles'],
      twn: ['electronics'], vnm: ['clothing'], tha: ['automobiles'], idn: ['furniture'], ind: ['textiles'],
      pak: ['textiles'], sau: ['crude_oil', 'fuel'], egy: ['textiles'], nga: ['crude_oil', 'processed_food'], dji: [],
      bel: ['fuel'], gbr: ['machinery'], fra: ['cosmetics'], esp: ['automobiles'], tur: ['clothing'],
      rus: ['steel', 'crude_oil'], can: ['furniture', 'crude_oil'], mex: ['automobiles'], per: ['textiles'], arg: ['grain', 'processed_food'],
      nzl: ['processed_food'], kaz: ['crude_oil', 'steel'], eth: ['clothing'],
    },
    startCityId: 'busan',
    overrides: {
      // 한 나라를 여러 항구 경제권으로 나누므로 원재료 생산자 문턱을 나라 단위로 본다(§6.3)
      // 문턱은 실제 생산국을 빼지 않을 만큼 낮게 둔다. 1.2%(전체)·5%(기본)였을 때 영국·인도네시아·말레이시아·이집트·
      // 아르헨티나·인도·오스트레일리아 원유와 남아공·미국·러시아·카자흐스탄 철광석이 생산 0이 되었다.
      // 0.1%면 원유 약 30만 배럴/일·철광석 약 1천만 t/년 이상인 나라가 남고, 독일·네덜란드처럼 아주 적은 생산국만 빠진다
      // (견주는 몫은 geographyExponent 1.5를 거친 가중치).
      setup: { rawThresholdScope: 'country', rawShareThreshold: 0.001 },
      // 산유국·철광석 생산국이 아닌 항구는 원유·철광석을 배에 팔지 않는다(자기 정유·제철에 쓰는 재고)
      market: { rawOnlyFromSource: true },
      // 실제 지구의 항로는 가상 세계보다 길다(평균 1만 km 이상): 선단과 적재량을 총수요·운송 기간에 맞춘다(나라 수에 비례시키지 않는다)
      npc: { shipsPerCompany: 8, shipCapacity: full ? 320 : 240, ...(full ? { repositionCandidates: 6 } : {}) },
      // 성장 한도: 회사당 최대 척수는 선단 규모에 맞춘다
      growth: full ? { npcMaxShips: 16 } : {},
      warmupMonths: 12,
    },
  };
}

export const EARTH_PROFILE: EconomyProfile = buildEarthProfile();

/** 원자료·게임 값·변환 규칙을 함께 보여 주는 표(화면·문서용) */
export function earthProfileReport(): { scaling: typeof EARTH_SCALING; baseYear: number; countries: EarthCountryFigures[] } {
  return { scaling: EARTH_SCALING, baseYear: WB.baseYear, countries: earthCountryFigures() };
}

export function earthCountryDef(id: string): EarthCountryDef | undefined {
  return earthDefinitions().countries.find((c) => c.id === id);
}

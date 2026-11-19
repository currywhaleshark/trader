import type { EconomyData } from './data';
import type { CityEconomy, EconomyState } from './types';

/** 저장된 경제권 수요 인구를 주민 수로 환산한다. 도시와 배후지는 같은 지역 성장률을 따른다. */
export function marketPopulation(data: EconomyData, city: CityEconomy) {
  const profile = data.cities[city.id];
  const market = city.population * (data.countryPopulations?.[city.countryId]?.residentsPerUnit ?? 1_000_000);
  const growth = profile.population > 0 ? city.population / profile.population : 0;
  const local = profile.cityResidents === undefined ? undefined : Math.min(market, profile.cityResidents * growth);
  return { local, market, hinterland: Math.max(0, market - (local ?? 0)) };
}

export function countryPopulation(data: EconomyData, state: EconomyState, countryId: string) {
  const reference = data.countryPopulations?.[countryId];
  let market = 0;
  let weightedIncome = 0;
  for (const city of Object.values(state.cities)) {
    if (city.countryId !== countryId) continue;
    const residents = marketPopulation(data, city).market;
    market += residents;
    weightedIncome += residents * city.income;
  }
  return { national: reference?.residents ?? market, year: reference?.year, market, income: market > 0 ? weightedIncome / market : 0 };
}

const people = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
export const formatResidents = (n: number) => `${people.format(Math.round(n))} 명`;

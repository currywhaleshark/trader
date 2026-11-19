import type { EconomyData } from '../sim/economy/data';
import { countryPopulation, formatResidents, marketPopulation } from '../sim/economy/population';
import type { CityEconomy, EconomyState } from '../sim/economy/types';

export function PopulationDetails({ data, state, city }: { data: EconomyData; state: EconomyState; city: CityEconomy }) {
  const { local, hinterland, market } = marketPopulation(data, city);
  const country = countryPopulation(data, state, city.countryId);
  const cityReference = data.cities[city.id].cityResidents;
  const cityLabel = city.id === 'nhava_sheva' ? '나비뭄바이 인구' : '도시 인구';
  return (
    <div className="small">
      {local !== undefined && <>{cityLabel} {formatResidents(country.year ? cityReference! : local)}{country.year && city.id !== 'singapore' && ' (GeoNames)'} · </>}
      국가 인구 {formatResidents(country.national)}{country.year && ` (${country.year}년)`}
      <div title="해당 시장이 공급하는 주민 수를 게임 규모로 환산한 뒤 품목별 소비량과 소득 수준을 적용합니다.">
        시장 수요 인구(게임) <b>{formatResidents(market)}</b>
        {local !== undefined && <> · 도시 {formatResidents(local)} + 배후지 {formatResidents(hinterland)}</>}
      </div>
    </div>
  );
}

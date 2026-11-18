import type { EconomyProfile } from '../economy/data';

/**
 * 현실 지구 경제 프로필(자리). E2에서 실제 값으로 채운다.
 */
export const EARTH_START_PORTS: { id: string; name: string }[] = [{ id: 'busan', name: '부산' }];

export const EARTH_PROFILE: EconomyProfile = {
  id: 'earth',
  mode: 'earth',
  version: '0',
  startYear: 2024,
  techByCountry: {},
  cities: {},
  licenses: [],
  cultureInfluence: {},
  npcCompanies: [],
  startCityId: 'busan',
};

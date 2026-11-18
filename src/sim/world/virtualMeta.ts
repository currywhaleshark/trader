import type { WorldGenConfig } from './config';
import type { Country, MapUnit, WorldCatalog } from './types';

/** 가상 세계 생성기 버전(생성 규칙이 바뀌어 같은 시드의 결과가 달라지면 올린다) */
export const VIRTUAL_GENERATOR_VERSION = 'virtual-gen-1';

export function catalogOf(cfg: WorldGenConfig): WorldCatalog {
  return { crops: cfg.crops, resources: cfg.resources, riverMinFlow: cfg.hydrology.riverMinFlow };
}

/** 가상 세계는 지도 단위 = 경제 국가(모두 직접 참여) */
export function mapUnitsOf(countries: Country[]): MapUnit[] {
  return countries.map((c) => ({
    id: c.id,
    index: c.index,
    name: c.name,
    color: c.color,
    countryId: c.id,
    participation: 'active' as const,
    areaKm2: c.areaKm2,
    labelLat: 0,
    labelLon: 0,
  }));
}

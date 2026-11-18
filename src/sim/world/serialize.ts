import { catalogOf, mapUnitsOf, VIRTUAL_GENERATOR_VERSION } from './virtualMeta';
import type { World, WorldLayers } from './types';

type LayerArray = Int16Array | Uint8Array | Int8Array | Uint16Array;
type LayerType = 'Int16' | 'Uint8' | 'Int8' | 'Uint16';

interface LayerEntry {
  name: string;
  type: LayerType;
  offset: number;
  length: number;
}

/** world.json의 모양: 레이어는 world.bin 안의 위치만 기록한다. */
export type WorldMeta = Omit<World, 'layers'> & { layers: LayerEntry[] };

/** 버전 1(모드 도입 전) world.json: mode·catalog·mapUnits가 없다 */
export type LegacyWorldMeta = Omit<
  WorldMeta,
  'mode' | 'worldId' | 'dataVersion' | 'catalog' | 'layerAvailability' | 'mapUnits' | 'inlandLinks'
> &
  Partial<WorldMeta>;

function flatten(layers: WorldLayers): [string, LayerArray][] {
  const out: [string, LayerArray][] = [
    ['elevation', layers.elevation],
    ['continentId', layers.continentId],
    ['countryId', layers.countryId],
    ['cityRegion', layers.cityRegion],
    ['seaZone', layers.seaZone],
    ['climateZone', layers.climateZone],
    ['riverFlow', layers.riverFlow],
    ['seaRisk', layers.seaRisk],
    ['harvestMonth', layers.harvestMonth],
    ['tempMonthly', layers.tempMonthly],
    ['precipMonthly', layers.precipMonthly],
  ];
  for (const k of Object.keys(layers.cropSuitability).sort()) out.push([`crop:${k}`, layers.cropSuitability[k]]);
  for (const k of Object.keys(layers.resourceRichness).sort()) out.push([`res:${k}`, layers.resourceRichness[k]]);
  return out;
}

function typeOf(a: LayerArray): LayerType {
  return a instanceof Int16Array ? 'Int16' : a instanceof Int8Array ? 'Int8' : a instanceof Uint16Array ? 'Uint16' : 'Uint8';
}

function bytesOf(a: LayerArray): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

function isEmpty(a: LayerArray): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) return false;
  return true;
}

/**
 * 세계 -> (JSON 메타, 이진 레이어 묶음). 오프라인 생성 결과를 파일로 저장할 때 쓴다.
 * 모두 0인 레이어(현실 지구의 월별 격자처럼 자료가 없는 것)는 파일에 넣지 않는다. 읽을 때 0으로 채운다.
 */
export function packWorld(world: World): { meta: WorldMeta; binary: Uint8Array } {
  const flat = flatten(world.layers).filter(([, a]) => !isEmpty(a));
  const total = flat.reduce((s, [, a]) => s + a.byteLength, 0);
  const binary = new Uint8Array(total);
  const entries: LayerEntry[] = [];
  let offset = 0;
  for (const [name, arr] of flat) {
    binary.set(bytesOf(arr), offset);
    entries.push({ name, type: typeOf(arr), offset, length: arr.length });
    offset += arr.byteLength;
  }
  const { layers: _layers, ...rest } = world;
  return { meta: { ...rest, layers: entries }, binary };
}

/** (JSON 메타, 이진 레이어 묶음) -> 세계. 런타임 로드. 예전 형식(버전 1)도 읽는다. */
export function unpackWorld(raw: WorldMeta | LegacyWorldMeta, buffer: ArrayBuffer): World {
  const meta = normalizeMeta(raw);
  const n = meta.grid.width * meta.grid.height;
  const get = (e: LayerEntry): LayerArray => {
    const size = e.type === 'Int16' || e.type === 'Uint16' ? 2 : 1;
    if (e.length !== n && e.length !== 12 * n) throw new Error(`레이어 크기가 격자와 맞지 않습니다: ${e.name}`);
    const slice = buffer.slice(e.offset, e.offset + e.length * size);
    if (slice.byteLength !== e.length * size) throw new Error(`세계 이진 파일이 잘렸습니다: ${e.name}`);
    return e.type === 'Int16'
      ? new Int16Array(slice)
      : e.type === 'Uint16'
        ? new Uint16Array(slice)
        : e.type === 'Int8'
          ? new Int8Array(slice)
          : new Uint8Array(slice);
  };
  const byName = new Map(meta.layers.map((e) => [e.name, e]));
  const blank: Record<string, () => LayerArray> = {
    elevation: () => new Int16Array(n),
    tempMonthly: () => new Int8Array(12 * n),
    precipMonthly: () => new Uint8Array(12 * n),
  };
  const need = (name: string): LayerArray => {
    const e = byName.get(name);
    if (!e) return (blank[name] ?? (() => new Uint8Array(n)))();
    return get(e);
  };
  const cropSuitability: Record<string, Uint8Array> = {};
  const resourceRichness: Record<string, Uint8Array> = {};
  for (const c of meta.catalog.crops) cropSuitability[c.id] = new Uint8Array(n);
  for (const r of meta.catalog.resources) resourceRichness[r.id] = new Uint8Array(n);
  for (const e of meta.layers) {
    if (e.name.startsWith('crop:')) cropSuitability[e.name.slice(5)] = get(e) as Uint8Array;
    if (e.name.startsWith('res:')) resourceRichness[e.name.slice(4)] = get(e) as Uint8Array;
  }
  const layers: WorldLayers = {
    elevation: need('elevation') as Int16Array,
    continentId: need('continentId') as Uint8Array,
    countryId: need('countryId') as Uint8Array | Uint16Array,
    cityRegion: need('cityRegion') as Uint8Array | Uint16Array,
    seaZone: need('seaZone') as Uint8Array,
    climateZone: need('climateZone') as Uint8Array,
    riverFlow: need('riverFlow') as Uint8Array,
    seaRisk: need('seaRisk') as Uint8Array,
    harvestMonth: need('harvestMonth') as Uint8Array,
    tempMonthly: need('tempMonthly') as Int8Array,
    precipMonthly: need('precipMonthly') as Uint8Array,
    cropSuitability,
    resourceRichness,
  };
  return { ...meta, layers };
}

/**
 * 예전(버전 1) world.json을 지금 계약으로 읽는다: 모드가 없으면 가상 세계다.
 * 가상 세계 생성 설정에서 작물·자원 목록과 지도 단위를 채운다.
 */
export function normalizeMeta(raw: WorldMeta | LegacyWorldMeta): WorldMeta {
  if (raw.mode && raw.catalog && raw.mapUnits && raw.layerAvailability) {
    return { ...raw, inlandLinks: raw.inlandLinks ?? [] } as WorldMeta;
  }
  if (raw.mode && raw.mode !== 'virtual') throw new Error('현실 지구 자료에 필요한 항목이 빠져 있습니다.');
  if (!raw.config) throw new Error('세계 자료에 모드와 생성 설정이 모두 없습니다.');
  return {
    ...raw,
    mode: 'virtual',
    worldId: 'virtual',
    dataVersion: raw.dataVersion ?? VIRTUAL_GENERATOR_VERSION,
    catalog: catalogOf(raw.config),
    layerAvailability: { climate: true, monthly: true, crops: true, resources: true, rivers: true },
    mapUnits: mapUnitsOf(raw.countries),
    inlandLinks: [],
    chokepoints: raw.chokepoints.map((g) => ({ kind: 'zone' as const, type: 'strait' as const, ...g })),
  } as WorldMeta;
}

/** 레이어 전체와 도시·항로 구조의 지문(FNV-1a 32비트 두 벌). 재현성 확인용. */
export function hashWorld(world: World): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const feed = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
      h2 = Math.imul(h2 ^ bytes[i], 0x85ebca6b) + i;
    }
  };
  for (const [name, arr] of flatten(world.layers)) {
    feed(new TextEncoder().encode(name));
    feed(bytesOf(arr));
  }
  const parts: unknown[] = [world.seed, world.cities, world.countries, world.seaRoutes, world.chokepoints];
  // 현실 지구는 지도 단위·배후 연결·자료 버전도 지문에 넣는다(가상 세계의 지문 규칙은 그대로 둔다)
  if (world.mode === 'earth') parts.push(world.mapUnits, world.inlandLinks, world.dataVersion);
  const structure = JSON.stringify(parts);
  feed(new TextEncoder().encode(structure));
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

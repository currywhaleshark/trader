import type { World, WorldLayers } from './types';

type LayerArray = Int16Array | Uint8Array | Int8Array;
type LayerType = 'Int16' | 'Uint8' | 'Int8';

interface LayerEntry {
  name: string;
  type: LayerType;
  offset: number;
  length: number;
}

/** world.json의 모양: 레이어는 world.bin 안의 위치만 기록한다. */
export type WorldMeta = Omit<World, 'layers'> & { layers: LayerEntry[] };

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
  return a instanceof Int16Array ? 'Int16' : a instanceof Int8Array ? 'Int8' : 'Uint8';
}

function bytesOf(a: LayerArray): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

/** 세계 -> (JSON 메타, 이진 레이어 묶음). 오프라인 생성 결과를 파일로 저장할 때 쓴다. */
export function packWorld(world: World): { meta: WorldMeta; binary: Uint8Array } {
  const flat = flatten(world.layers);
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

/** (JSON 메타, 이진 레이어 묶음) -> 세계. 런타임 로드. */
export function unpackWorld(meta: WorldMeta, buffer: ArrayBuffer): World {
  const get = (e: LayerEntry): LayerArray => {
    const size = e.type === 'Int16' ? 2 : 1;
    const slice = buffer.slice(e.offset, e.offset + e.length * size);
    return e.type === 'Int16' ? new Int16Array(slice) : e.type === 'Int8' ? new Int8Array(slice) : new Uint8Array(slice);
  };
  const byName = new Map(meta.layers.map((e) => [e.name, e]));
  const need = (name: string): LayerArray => {
    const e = byName.get(name);
    if (!e) throw new Error(`world.bin에 레이어가 없습니다: ${name}`);
    return get(e);
  };
  const cropSuitability: Record<string, Uint8Array> = {};
  const resourceRichness: Record<string, Uint8Array> = {};
  for (const e of meta.layers) {
    if (e.name.startsWith('crop:')) cropSuitability[e.name.slice(5)] = get(e) as Uint8Array;
    if (e.name.startsWith('res:')) resourceRichness[e.name.slice(4)] = get(e) as Uint8Array;
  }
  const layers: WorldLayers = {
    elevation: need('elevation') as Int16Array,
    continentId: need('continentId') as Uint8Array,
    countryId: need('countryId') as Uint8Array,
    cityRegion: need('cityRegion') as Uint8Array,
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
  const structure = JSON.stringify([world.seed, world.cities, world.countries, world.seaRoutes, world.chokepoints]);
  feed(new TextEncoder().encode(structure));
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

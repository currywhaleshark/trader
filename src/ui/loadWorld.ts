import { modeOf } from '../sim/modes';
import { unpackWorld, type WorldMeta } from '../sim/world/serialize';
import type { World, WorldMode } from '../sim/world/types';

/**
 * 오프라인 생성 결과(public/world…)를 읽는다. 런타임에는 기후·지형을 다시 계산하지 않는다.
 * 모드마다 폴더가 다르다(가상: world/world.*, 현실 지구: world/earth/earth.*). 쓰지 않는 모드의 자료는 고를 때 읽는다.
 * 배포 base 경로(import.meta.env.BASE_URL) 아래에서 찾는다.
 */
export async function loadWorld(mode: WorldMode = 'virtual'): Promise<World> {
  const def = modeOf(mode);
  const base = `${import.meta.env.BASE_URL}${def.assetDir}`;
  const [metaRes, binRes] = await Promise.all([fetch(`${base}${def.assetName}.json`), fetch(`${base}${def.assetName}.bin`)]);
  if (!metaRes.ok || !binRes.ok) {
    throw new Error(
      mode === 'earth'
        ? '현실 지구 자료가 없습니다. 먼저 `npm run gen:earth`를 실행하세요.'
        : '세계 데이터가 없습니다. 먼저 `npm run gen:world`를 실행하세요.',
    );
  }
  const meta = (await metaRes.json()) as WorldMeta;
  const world = unpackWorld(meta, await binRes.arrayBuffer());
  if (world.mode !== mode) throw new Error(`${def.name} 자리에 다른 모드의 자료가 들어 있습니다.`);
  return world;
}

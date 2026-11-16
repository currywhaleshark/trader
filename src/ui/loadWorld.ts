import { unpackWorld, type WorldMeta } from '../sim/world/serialize';
import type { World } from '../sim/world/types';

/** 오프라인 생성 결과(public/world)를 읽는다. 런타임에는 기후·지형을 다시 계산하지 않는다. */
export async function loadWorld(): Promise<World> {
  const base = `${import.meta.env.BASE_URL}world/`;
  const [metaRes, binRes] = await Promise.all([fetch(`${base}world.json`), fetch(`${base}world.bin`)]);
  if (!metaRes.ok || !binRes.ok) {
    throw new Error('세계 데이터가 없습니다. 먼저 `npm run gen:world`를 실행하세요.');
  }
  const meta = (await metaRes.json()) as WorldMeta;
  return unpackWorld(meta, await binRes.arrayBuffer());
}

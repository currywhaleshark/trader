/** data/earth/sources 의 고정 자료를 읽고 체크섬을 확인한다(Node 전용: 생성 스크립트·테스트). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EarthSources } from '../src/sim/earth/buildEarth';

export const EARTH_SOURCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../data/earth/sources');

export function loadEarthSources(dir = EARTH_SOURCE_DIR): EarthSources {
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as EarthSources['manifest'];
  const read = (id: string): Buffer => {
    const rec = manifest.records.find((r) => r.id === id);
    if (!rec) throw new Error(`자료 목록에 ${id}가 없습니다. npm run fetch:earth`);
    const buf = readFileSync(resolve(dir, (rec as { file: string }).file));
    const sum = createHash('sha256').update(buf).digest('hex');
    if (rec.sha256 && sum !== rec.sha256) throw new Error(`${id}의 체크섬이 자료 목록과 다릅니다(파일이 바뀌었습니다).`);
    return buf;
  };
  const etopoBuf = read('etopo1-0p5deg');
  const koppenBuf = read('koppen-kottek2006-0p5deg');
  return {
    naturalEarth: JSON.parse(read('naturalearth-admin0-50m').toString('utf8')),
    etopo: new Int16Array(etopoBuf.buffer.slice(etopoBuf.byteOffset, etopoBuf.byteOffset + etopoBuf.byteLength)),
    koppen: new Uint8Array(koppenBuf),
    worldBank: JSON.parse(read('worldbank-wdi').toString('utf8')),
    power: JSON.parse(read('nasa-power-climatology').toString('utf8')),
    manifest,
  };
}

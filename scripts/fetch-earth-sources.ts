/**
 * 현실 지구 원자료 갱신(개발 단계 전용). 일반 빌드는 이 스크립트를 부르지 않고,
 * 여기서 정규화해 data/earth/sources/ 에 고정한 파일만 읽는다(§11.2).
 *
 *   npm run fetch:earth            없는 자료만 받는다
 *   npm run fetch:earth -- --force 모두 다시 받는다(자료 버전이 바뀌므로 EARTH_DATA_VERSION도 올린다)
 *
 * 받는 자료(각각 원본 SHA-256·정규화 파일 SHA-256·받은 날을 manifest.json에 남긴다):
 *  - Natural Earth 1:50m Admin 0 Countries v5.1.2 (공개 도메인)
 *  - ETOPO1 지형·수심(NOAA, 0.5° 간격 표본, 공개 자료)
 *  - 쾨펜-가이거 기후 구분 0.5°(Kottek et al. 2006, 1951–2000)
 *  - World Bank WDI: 인구, 1인당 GDP(현재 US$), 경지 면적, 삼림 면적(기준연도 2023, 없으면 가장 가까운 앞선 해)
 *  - NASA POWER 월별 기후 평년값(경제권 대표 지점의 기온·강수)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { EARTH_COUNTRIES, EARTH_MARKETS } from '../src/sim/earth/definitions';
import { KOPPEN_CODES } from '../src/sim/earth/koppen';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../data/earth/sources');
const force = process.argv.includes('--force');
const today = new Date().toISOString().slice(0, 10);
mkdirSync(OUT, { recursive: true });

const sha = (b: Buffer | Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const manifestPath = resolve(OUT, 'manifest.json');
interface Rec {
  id: string;
  name: string;
  url: string;
  version: string;
  retrieved: string;
  period: string;
  license: string;
  attribution: string;
  sha256Raw?: string;
  file: string;
  sha256: string;
  notes?: string;
}
const manifest: { records: Rec[] } = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { records: [] };
const put = (r: Rec) => {
  manifest.records = manifest.records.filter((x) => x.id !== r.id);
  manifest.records.push(r);
  manifest.records.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
};
const has = (id: string) => !force && manifest.records.some((r) => r.id === id && existsSync(resolve(OUT, r.file)));

async function get(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'trade-sim-data-builder' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// ------------------------------------------------------------------ Natural Earth

async function naturalEarth() {
  const id = 'naturalearth-admin0-50m';
  if (has(id)) return;
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';
  const raw = await get(url);
  const gj = JSON.parse(raw.toString('utf8')) as {
    features: { properties: Record<string, string | number>; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[];
  };
  // 정규화: 필요한 속성만, 좌표는 0.01° 정수로 바꾸고 고리마다 차분 부호화
  const features = gj.features.map((f) => {
    const p = f.properties;
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    const rings: number[][] = [];
    for (const poly of polys) {
      for (const ring of poly) {
        const flat: number[] = [];
        let px = 0;
        let py = 0;
        for (const [lon, lat] of ring) {
          const x = Math.round(lon * 100);
          const y = Math.round(lat * 100);
          if (flat.length > 0 && x === px && y === py) continue;
          flat.push(x - px, y - py);
          px = x;
          py = y;
        }
        rings.push(flat);
      }
    }
    return {
      a3: String(p.ADM0_A3),
      isoA3: String(p.ISO_A3),
      isoN3: String(p.ISO_N3),
      name: String(p.NAME),
      nameKo: String(p.NAME_KO ?? p.NAME),
      continent: String(p.CONTINENT),
      labelLat: Number(p.LABEL_Y),
      labelLon: Number(p.LABEL_X),
      rings,
    };
  });
  const file = `${id}.json`;
  const text = JSON.stringify({ quantization: 0.01, encoding: 'delta [dLon, dLat] pairs per ring; even-odd fill', features });
  writeFileSync(resolve(OUT, file), text);
  put({
    id,
    name: 'Natural Earth 1:50m Cultural Vectors — Admin 0 Countries',
    url,
    version: '5.1.2',
    retrieved: today,
    period: '자료 기준: Natural Earth 5.1.2 배포',
    license: 'Public domain (Natural Earth terms of use)',
    attribution: 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.',
    sha256Raw: sha(raw),
    file,
    sha256: sha(text),
    notes: '속성은 ADM0_A3, ISO_A3, ISO_N3, NAME, NAME_KO, CONTINENT, LABEL_X/Y만 남기고 좌표를 0.01° 정수 차분으로 줄였다. 국경·명칭은 Natural Earth의 표기이며 게임의 경제 주체 연결은 src/sim/earth/definitions.ts에서 한다.',
  });
  console.log(`Natural Earth: ${features.length}개 지도 단위`);
}

// ------------------------------------------------------------------ ETOPO1

async function etopo() {
  const id = 'etopo1-0p5deg';
  if (has(id)) return;
  // 0.5° 격자 셀 중심(-89.75..89.75, -179.75..179.75)의 표본. ETOPO1은 1′ 간격이라 30칸마다 하나씩 고른다.
  const url =
    'https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.csv?altitude%5B(-89.75):30:(89.75)%5D%5B(-179.75):30:(179.75)%5D';
  const raw = await get(url);
  const lines = raw.toString('utf8').trim().split('\n').slice(2);
  const W = 720;
  const H = 360;
  const grid = new Int16Array(W * H);
  let count = 0;
  for (const line of lines) {
    const [la, lo, alt] = line.split(',').map(Number);
    const y = Math.round((90 - la) / 0.5 - 0.5);
    const x = Math.round((lo + 180) / 0.5 - 0.5);
    if (y < 0 || y >= H || x < 0 || x >= W) continue;
    grid[y * W + x] = Math.max(-32000, Math.min(32000, Math.round(alt)));
    count++;
  }
  if (count !== W * H) throw new Error(`ETOPO 표본 수가 맞지 않습니다: ${count}`);
  const file = `${id}.i16`;
  const bytes = Buffer.from(grid.buffer);
  writeFileSync(resolve(OUT, file), bytes);
  put({
    id,
    name: 'ETOPO1 Global Relief Model (Ice Surface), sampled at 0.5° cell centers via NOAA ERDDAP (etopo180)',
    url,
    version: 'ETOPO1 (2009)',
    retrieved: today,
    period: '-',
    license: 'Public domain (U.S. Government work, NOAA NCEI)',
    attribution: 'Amante, C. and B.W. Eakins, 2009. ETOPO1 1 Arc-Minute Global Relief Model. NOAA Technical Memorandum NESDIS NGDC-24.',
    sha256Raw: sha(raw),
    file,
    sha256: sha(bytes),
    notes: 'Int16 little-endian, 720×360, 북쪽 행부터, 단위 m(바다는 음수). 셀 평균이 아니라 셀 중심 한 점의 값이다(화면 지형용).',
  });
  console.log('ETOPO1: 0.5° 표본 저장');
}

// ------------------------------------------------------------------ Köppen-Geiger

/** zip에서 첫 번째 .txt 항목을 꺼낸다(로컬 파일 헤더를 따라간다) */
function unzipFirstText(zip: Buffer): string {
  let off = 0;
  while (off + 30 <= zip.length && zip.readUInt32LE(off) === 0x04034b50) {
    const method = zip.readUInt16LE(off + 8);
    const csize = zip.readUInt32LE(off + 18);
    const nlen = zip.readUInt16LE(off + 26);
    const xlen = zip.readUInt16LE(off + 28);
    const name = zip.toString('utf8', off + 30, off + 30 + nlen);
    const start = off + 30 + nlen + xlen;
    const data = zip.subarray(start, start + csize);
    if (/\.txt$/i.test(name)) return (method === 8 ? inflateRawSync(data) : data).toString('latin1');
    off = start + csize;
  }
  throw new Error('zip 안에 txt가 없습니다');
}


async function koppen() {
  const id = 'koppen-kottek2006-0p5deg';
  if (has(id)) return;
  const url = 'http://koeppen-geiger.vu-wien.ac.at/data/Koeppen-Geiger-ASCII.zip';
  const raw = await get(url);
  const text = unzipFirstText(raw);
  const W = 720;
  const H = 360;
  const grid = new Uint8Array(W * H);
  let n = 0;
  const unknown = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || !/^-?\d/.test(parts[0])) continue;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    const code = KOPPEN_CODES.indexOf(parts[2]);
    if (code <= 0) {
      unknown.add(parts[2]);
      continue;
    }
    const y = Math.round((90 - lat) / 0.5 - 0.5);
    const x = Math.round((lon + 180) / 0.5 - 0.5);
    if (y < 0 || y >= H || x < 0 || x >= W) continue;
    grid[y * W + x] = code;
    n++;
  }
  if (n < 50000) throw new Error(`쾨펜 셀이 너무 적습니다: ${n}`);
  const file = `${id}.u8`;
  const bytes = Buffer.from(grid);
  writeFileSync(resolve(OUT, file), bytes);
  put({
    id,
    name: 'World Map of the Köppen-Geiger climate classification (0.5°)',
    url,
    version: 'Kottek et al. 2006 (1951–2000)',
    retrieved: today,
    period: '기후 평년 1951–2000 (과거 관측 기반, 미래 전망 아님)',
    license: '출처 표시 조건의 학술 공개 자료(배포처 안내를 따름)',
    attribution: 'Kottek, M., J. Grieser, C. Beck, B. Rudolf, and F. Rubel, 2006: World Map of the Köppen-Geiger climate classification updated. Meteorol. Z., 15, 259-263.',
    sha256Raw: sha(raw),
    file,
    sha256: sha(bytes),
    notes: `Uint8 720×360, 북쪽 행부터, 값은 KOPPEN_CODES 순번(0 = 자료 없음/바다). 육지 셀 ${n}개. 알 수 없는 코드: ${[...unknown].join(',') || '없음'}`,
  });
  console.log(`쾨펜: ${n}개 셀`);
}

// ------------------------------------------------------------------ World Bank

const WB_INDICATORS: Record<string, string> = {
  population: 'SP.POP.TOTL',
  gdpPerCapitaUsd: 'NY.GDP.PCAP.CD',
  arableHa: 'AG.LND.ARBL.HA',
  forestKm2: 'AG.LND.FRST.K2',
};
const WB_YEAR = 2023;

async function worldBank() {
  const id = 'worldbank-wdi';
  const file = `${id}.json`;
  const path = resolve(OUT, file);
  const existing: { countries: Record<string, Record<string, { value: number; year: number } | null>> } = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { countries: {} };
  const want = EARTH_COUNTRIES.map((c) => c.id.toUpperCase());
  const missing = force ? want : want.filter((c) => !existing.countries[c]);
  if (missing.length === 0 && has(id)) return;
  const raws: Buffer[] = [];
  for (const [key, ind] of Object.entries(WB_INDICATORS)) {
    const url = `https://api.worldbank.org/v2/country/${missing.join(';')}/indicator/${ind}?format=json&per_page=2000&date=${WB_YEAR - 5}:${WB_YEAR}`;
    const raw = await get(url);
    raws.push(raw);
    const rows = (JSON.parse(raw.toString('utf8'))[1] ?? []) as { countryiso3code: string; date: string; value: number | null }[];
    for (const c of missing) {
      // 기준연도 값, 없으면 가장 가까운 앞선 해(결측을 0으로 바꾸지 않는다)
      const own = rows
        .filter((r) => r.countryiso3code === c && r.value !== null)
        .sort((a, b) => Number(b.date) - Number(a.date));
      (existing.countries[c] ??= {})[key] = own[0] ? { value: own[0].value!, year: Number(own[0].date) } : null;
    }
  }
  const text = JSON.stringify({ baseYear: WB_YEAR, indicators: WB_INDICATORS, countries: existing.countries }, null, 1);
  writeFileSync(path, text);
  put({
    id,
    name: 'World Bank World Development Indicators (SP.POP.TOTL, NY.GDP.PCAP.CD, AG.LND.ARBL.HA, AG.LND.FRST.K2)',
    url: 'https://api.worldbank.org/v2/',
    version: 'WDI API v2',
    retrieved: today,
    period: `기준연도 ${WB_YEAR} (값이 없으면 가장 가까운 앞선 해, 국가·지표별 year에 기록)`,
    license: 'CC BY 4.0',
    attribution: 'The World Bank: World Development Indicators.',
    sha256Raw: sha(Buffer.concat(raws)),
    file,
    sha256: sha(text),
    notes: '1인당 GDP는 소득 수준의 참고값이며 개인 가처분소득이 아니다. 경지·삼림 면적은 농장·삼림 생산의 상대 비중으로만 쓴다.',
  });
  console.log(`World Bank: ${missing.length}개국 갱신`);
}

// ------------------------------------------------------------------ NASA POWER

async function power() {
  const id = 'nasa-power-climatology';
  const file = `${id}.json`;
  const path = resolve(OUT, file);
  const existing: { points: Record<string, { lat: number; lon: number; tempC: number[]; precipMm: number[]; elevationM: number }> } =
    existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { points: {} };
  const days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let added = 0;
  let header = '';
  for (const m of EARTH_MARKETS) {
    const key = `${m.climatePoint[0].toFixed(2)},${m.climatePoint[1].toFixed(2)}`;
    if (!force && existing.points[key]) continue;
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR&community=AG&longitude=${m.climatePoint[1]}&latitude=${m.climatePoint[0]}&format=JSON`;
    const raw = await get(url);
    const j = JSON.parse(raw.toString('utf8'));
    const p = j.properties.parameter;
    header = JSON.stringify(j.header?.sources ?? '') + ' ' + JSON.stringify(j.header?.range ?? j.header?.start ?? '');
    existing.points[key] = {
      lat: m.climatePoint[0],
      lon: m.climatePoint[1],
      tempC: months.map((k) => Math.round(p.T2M[k] * 10) / 10),
      // mm/일 평균 → 월 합계
      precipMm: months.map((k, i) => Math.round(p.PRECTOTCORR[k] * days[i])),
      elevationM: Math.round(j.geometry?.coordinates?.[2] ?? 0),
    };
    added++;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (added === 0 && has(id)) return;
  const text = JSON.stringify(existing, null, 1);
  writeFileSync(path, text);
  put({
    id,
    name: 'NASA POWER Climatology API (T2M, PRECTOTCORR), point',
    url: 'https://power.larc.nasa.gov/api/temporal/climatology/point',
    version: 'POWER API v2 (MERRA-2 기반)',
    retrieved: today,
    period: `POWER 기본 기후 평년 기간(응답 정보: ${header || '이전 기록'})`,
    license: 'NASA 공개 자료(출처 표시)',
    attribution: 'These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program.',
    file,
    sha256: sha(text),
    notes: '경제권마다 생산 배후지를 대표하는 한 지점의 월평균 기온(°C)과 월 강수량(mm = mm/일 × 그달 일수)이다. 넓은 지역의 평균이 아니다.',
  });
  console.log(`NASA POWER: ${added}개 지점 추가`);
}

await naturalEarth();
await etopo();
await koppen();
await worldBank();
await power();
console.log(`manifest: ${manifestPath}`);

/**
 * 현실 지구 자료 표를 마크다운으로 만든다(docs/EARTH_DATA.md의 자동 생성 부분).
 *   npx tsx scripts/earth-report.ts > docs/EARTH_TABLES.md
 * 원자료 값·게임 값·수동 참고값을 함께 적는다(§6.1, §11.2).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { earthDefinitions } from '../src/sim/earth/definitions';
import { earthProfileReport, EARTH_PROFILE } from '../src/sim/earth/profile';
import { EARTH_SOURCE_DIR } from './earthSources';

const defs = earthDefinitions();
const rep = earthProfileReport();
const manifest = JSON.parse(readFileSync(resolve(EARTH_SOURCE_DIR, 'manifest.json'), 'utf8')) as {
  records: { id: string; name: string; version: string; retrieved: string; period: string; license: string; sha256: string; sha256Raw?: string; file: string }[];
};
const out: string[] = [];
const fmt = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

out.push(`<!-- scripts/earth-report.ts가 만든 표입니다. 손으로 고치지 마세요. -->`);
out.push(`# 현실 지구 자료 표 (${defs.dataVersion})`);
out.push('');
out.push('## 고정 자료 묶음(data/earth/sources)');
out.push('');
out.push('| id | 자료 | 버전 | 받은 날 | 기간 | 이용조건 | 정규화 파일 SHA-256 |');
out.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of manifest.records) out.push(`| ${r.id} | ${r.name} | ${r.version} | ${r.retrieved} | ${r.period} | ${r.license} | \`${r.sha256.slice(0, 16)}…\` |`);
out.push('');
out.push(`## 나라별 원자료와 게임 값`);
out.push('');
out.push(
  `변환: 게임 인구 = ${rep.scaling.popScale} × (인구[백만] × 포함 비율)^${rep.scaling.popExponent}, 소득 지수 = (1인당 GDP / ${fmt(rep.scaling.incomeRef)})^${rep.scaling.incomeExponent}. 기준연도 ${rep.baseYear}(없으면 가장 가까운 앞선 해).`,
);
out.push('');
out.push('| 나라 | 참여 | 인구(원자료) | 연도 | 1인당 GDP(US$) | 포함 비율 | 게임 인구 | 소득 지수 | 기술 단계(설계) | 비고 |');
out.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
for (const f of rep.countries) {
  const c = defs.countries.find((x) => x.id === f.id)!;
  const note = c.manualRef ? `수동 참고값: ${c.manualRef.source}` : '';
  out.push(
    `| ${f.name} | ${c.participation === 'active' ? '항구국' : '내륙 배후'} | ${fmt(f.population!.value)} | ${f.population!.year} | ${fmt(f.gdpPerCapitaUsd!.value)} | ${f.simShare} | ${fmt(f.gamePopulation, 2)} | ${fmt(f.gameIncome, 2)} | ${c.tech} | ${note} |`,
  );
}
out.push('');
out.push('## 경제권(시장)과 항구');
out.push('');
out.push('| 경제권 | 나라 | 종류 | UN/LOCODE | 크기 | 진입점 | 몫(배후지/경지/삼림/철/원유) | 도시 인구(명) | 시장 담당 인구(명) | 수요 인구(게임 단위) | 기후 지점 | 공장 비중(설계) |');
out.push('| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- |');
for (const m of defs.markets) {
  const s = m.share;
  const city = EARTH_PROFILE.cities[m.id];
  const residentsPerUnit = EARTH_PROFILE.countryPopulations![m.countryId].residentsPerUnit;
  out.push(
    `| ${m.name} | ${m.countryId} | ${m.kind === 'port' ? '항구' : '내륙'} | ${m.port?.locode ?? '-'} | ${m.port?.size ?? '-'} | ${m.port ? m.port.entry.join(', ') : '-'} | ${s.pop}/${s.arable}/${s.forest}/${s.iron ?? 0}/${s.oil ?? 0} | ${city.cityResidents === undefined ? '-' : fmt(city.cityResidents)} | ${fmt(city.population * residentsPerUnit)} | ${fmt(city.population, 2)} | ${m.climateLabel} (${m.climatePoint.join(', ')}) | ${Object.entries(m.factories).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`,
  );
}
out.push('');
out.push('## 수동 입력 참고값(철광석·원유, 반올림 근사)');
out.push('');
out.push('참고한 자료 수준: 철광석 = USGS Mineral Commodity Summaries 2024(2023년 추정), 원유 = EIA 국제 통계 2023(원유·콘덴세이트). **원표를 내려받아 대조하지 않은 작성자 입력 근사값**이다. 생산 분포의 상대 비중으로만 쓰며 화면에 실제 통계로 보이지 않는다. 자료를 갱신할 때 원표와 대조해야 한다.');
out.push('');
out.push('| 나라 | 철광석(Mt/년) | 원유(천 배럴/일) |');
out.push('| --- | ---: | ---: |');
for (const c of defs.countries) if (c.ironOreMt || c.crudeKbd) out.push(`| ${c.name} | ${c.ironOreMt ?? '-'} | ${c.crudeKbd ?? '-'} |`);
out.push('');
out.push('## 운하·해협(게임용 비용·조건)');
out.push('');
out.push('| 통과 지점 | 종류 | 통과료(크기 1/2/3) | 더 걸리는 기간(월) | 선박 제한 | 설명 |');
out.push('| --- | --- | --- | ---: | --- | --- |');
for (const p of defs.passages) out.push(`| ${p.name} | ${p.type === 'canal' ? '운하' : '해협'} | ${p.fee.join('/')} | ${p.delayMonths} | ${p.maxShipSize ?? '없음(사건으로 제한 가능)'} | ${p.note} |`);
out.push('');
out.push('## 배후 연결');
out.push('');
out.push('| 연결 | 수단 | 기간(월) | 부피당 비용 | 월 처리 한도(부피) |');
out.push('| --- | --- | ---: | ---: | ---: |');
for (const l of defs.inlandLinks) out.push(`| ${l.inlandId} ↔ ${l.portId} | ${l.mode} | ${l.months} | ${l.costPerUnit} | ${l.monthlyCapacity} |`);
console.log(out.join('\n'));

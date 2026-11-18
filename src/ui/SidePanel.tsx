import type { ReactNode } from 'react';
import { cellIndex } from '../sim/core/grid';
import { byteToFlow } from '../sim/world/gen/hydrology';
import {
  CLIMATE_ZONES,
  PRECIP_SCALE,
  SEA_ZONE,
  TEMP_SCALE,
  type City,
  type World,
} from '../sim/world/types';

export type Selection = { kind: 'city'; id: string } | { kind: 'cell'; lat: number; lon: number } | null;

export interface CityRoute {
  toId: string;
  /** 현재 조건(봉쇄 반영)의 거리. 닿지 못하면 null */
  distanceKm: number | null;
  /** 봉쇄가 없을 때의 거리 */
  baseDistanceKm: number;
  gates: string[];
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? '북위' : '남위';
  const ew = lon >= 0 ? '동경' : '서경';
  return `${ns} ${Math.abs(lat).toFixed(1)}° · ${ew} ${Math.abs(lon).toFixed(1)}°`;
}

const km = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}km`;
const PORT_SIZE = ['', '소형 항만', '중형 항만', '대형 항만'];
const SEA_NAME = { central: '중앙해', outer: '외해', gate: '관문 해협' } as const;

/** 월별 기온(선)·강수(막대) 그래프 */
function ClimateChart({ temp, precip, month }: { temp: number[]; precip: number[]; month: number }) {
  const W = 300;
  const H = 96;
  const pad = 4;
  const bw = (W - pad * 2) / 12;
  const pMax = Math.max(200, ...precip);
  const tMin = Math.min(-10, ...temp);
  const tMax = Math.max(30, ...temp);
  const ty = (t: number) => pad + (1 - (t - tMin) / (tMax - tMin)) * (H - 22 - pad);
  const line = temp.map((t, m) => `${pad + bw * (m + 0.5)},${ty(t).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="월별 기온과 강수">
      {precip.map((p, m) => {
        const h = (p / pMax) * (H - 22 - pad);
        return (
          <rect
            key={m}
            x={pad + bw * m + 2}
            y={H - 18 - h}
            width={bw - 4}
            height={h}
            rx={2}
            className={m === month ? 'bar bar-on' : 'bar'}
          />
        );
      })}
      {tMin < 0 && <line x1={pad} x2={W - pad} y1={ty(0)} y2={ty(0)} className="zero" />}
      <polyline points={line} className="temp-line" />
      {temp.map((t, m) => (
        <circle key={m} cx={pad + bw * (m + 0.5)} cy={ty(t)} r={m === month ? 3.6 : 2} className="temp-dot" />
      ))}
      {precip.map((_, m) => (
        <text key={m} x={pad + bw * (m + 0.5)} y={H - 5} className={m === month ? 'tick tick-on' : 'tick'}>
          {m + 1}
        </text>
      ))}
    </svg>
  );
}

function Bar({ value, label, note }: { value: number; label: string; note?: string }) {
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <i style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
      </span>
      <span className="meter-note">{note}</span>
    </div>
  );
}

function CityInfo(props: {
  world: World;
  city: City;
  month: number;
  routes: CityRoute[];
  routeTarget: string | null;
  onRouteTarget: (id: string | null) => void;
  blocked: string[];
  onToggleBlock: (gateId: string) => void;
  onSelectCity: (id: string) => void;
  cityExtra?: ReactNode;
}) {
  const { world, city, month, routes } = props;
  const country = world.countries.find((c) => c.id === city.countryId)!;
  const gateway = city.gatewayPortId ? world.cities.find((c) => c.id === city.gatewayPortId) : undefined;
  const links = world.inlandLinks.filter((l) => l.portId === city.id || l.inlandId === city.id);
  const r = city.region;
  const tMin = Math.min(...r.tempMonthlyC);
  const tMax = Math.max(...r.tempMonthlyC);
  const annual = r.precipMonthlyMm.reduce((a, b) => a + b, 0);
  const cityName = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const gateName = (id: string) => world.chokepoints.find((g) => g.id === id)?.name ?? id;
  const sorted = [...routes].sort((a, b) => a.baseDistanceKm - b.baseDistanceKm);
  return (
    <>
      <header className="sel-head">
        <i className="dot" style={{ background: country.color }} />
        <div>
          <h2>{city.name}</h2>
          <p>
            {city.isPort ? (
              <>
                {country.name} · {PORT_SIZE[city.portSize]} · {city.seaName ?? SEA_NAME[city.seaZone]}
                {city.locode && <> · {city.locode}</>}
              </>
            ) : (
              <>
                {country.name} · 바다가 없는 내륙 경제권 · 관문항 {gateway?.name ?? '-'}
              </>
            )}
          </p>
        </div>
      </header>
      <p className="muted">
        {formatLatLon(city.lat, city.lon)} — {city.note}
      </p>
      {links.length > 0 && (
        <div className="notice-inline">
          {links.map((l) => {
            const other = world.cities.find((c) => c.id === (l.portId === city.id ? l.inlandId : l.portId));
            return (
              <p key={l.id} className="small">
                {l.portId === city.id
                  ? `이 항구는 다른 나라(${world.countries.find((c) => c.id === other?.countryId)?.name ?? ''})의 배후 경제권 ${other?.name ?? ''}과도 연결되어 있어요.`
                  : `배는 직접 오지 못해요. 관문항 ${other?.name ?? ''}까지 ${l.mode}로 오가요.`}{' '}
                운송 {Math.round(l.months * 30)}일 · 한 달 최대 {l.monthlyCapacity}(부피) · 부피당 {l.costPerUnit}
              </p>
            );
          })}
          <p className="muted small">게임을 단순하게 하려고 대표 관문항 하나로 이었어요. 실제로 유일한 교역로라는 뜻은 아니에요.</p>
        </div>
      )}
      {props.cityExtra}

      <h3>배후지의 기후</h3>
      <p>
        <b>{CLIMATE_ZONES[r.dominantClimate].name}</b> · 기온 {tMin.toFixed(0)}~{tMax.toFixed(0)}°C · 연 강수{' '}
        {annual.toLocaleString('ko-KR')}mm
      </p>
      <ClimateChart temp={r.tempMonthlyC} precip={r.precipMonthlyMm} month={month} />
      <p className="muted small">막대: 강수량 · 선: 기온 (1~12월)</p>
      {world.mode === 'earth' && (
        <p className="muted small">
          현실 지구: 생산 배후지의 대표 지점 한 곳의 월평균(NASA POWER 평년값)이에요. 넓은 지역의 평균이 아니고, 작물 적합도는 이 값으로 게임 작물 모형이 계산한 값이에요.
        </p>
      )}

      <h3>기르기 좋은 작물</h3>
      {world.catalog.crops.map((crop) => {
        const s = r.crops[crop.id];
        const peak = s.monthlyCoef.indexOf(Math.max(...s.monthlyCoef));
        const note = crop.kind === 'seasonal' && s.suitability > 0.1 ? `수확 ${peak + 1}월` : crop.kind === 'perennial' ? '연중' : '';
        return <Bar key={crop.id} label={crop.name} value={s.suitability} note={note} />;
      })}

      <h3>땅속 자원</h3>
      {world.catalog.resources.map((res) => {
        const v = r.resources[res.id] ?? 0;
        return <Bar key={res.id} label={res.name} value={v / 1500} note={v > 1 ? `지수 ${Math.round(v)}` : '없음'} />;
      })}

      <h3>이 항구에서 떠나는 항로</h3>
      <div className="gates">
        {world.chokepoints.map((g) => (
          <label key={g.id} className={props.blocked.includes(g.id) ? 'gate gate-on' : 'gate'}>
            <input
              type="checkbox"
              checked={props.blocked.includes(g.id)}
              onChange={() => props.onToggleBlock(g.id)}
            />
            {g.name} 봉쇄
            {g.kind === 'link' && (g.fee?.[0] ?? 0) > 0 && <span className="muted small"> (통과료 {g.fee!.join('/')})</span>}
          </label>
        ))}
      </div>
      <p className="muted small">봉쇄는 게임 속 사건이에요. 막으면 배·다른 회사·자동항로가 모두 돌아가는 길을 따라요.</p>
      <table className="routes">
        <tbody>
          {sorted.map((rt) => {
            const longer = rt.distanceKm !== null && rt.distanceKm > rt.baseDistanceKm * 1.02;
            return (
              <tr
                key={rt.toId}
                className={props.routeTarget === rt.toId ? 'on' : ''}
                onClick={() => props.onRouteTarget(props.routeTarget === rt.toId ? null : rt.toId)}
                onDoubleClick={() => props.onSelectCity(rt.toId)}
              >
                <td>{cityName(rt.toId)}</td>
                <td className="num">
                  {rt.distanceKm === null ? <span className="bad">갈 수 없음</span> : km(rt.distanceKm)}
                  {longer && <span className="bad"> (+{km(rt.distanceKm! - rt.baseDistanceKm)})</span>}
                </td>
                <td className="via">{rt.gates.map(gateName).join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">줄을 누르면 그 항로만 강조합니다. 해협을 봉쇄하면 배가 돌아가는 길이 다시 계산됩니다.</p>
    </>
  );
}

function CellInfo({ world, lat, lon, month }: { world: World; lat: number; lon: number; month: number }) {
  const L = world.layers;
  const n = world.grid.width * world.grid.height;
  const i = cellIndex(world.grid, lat, lon);
  const temp: number[] = [];
  const precip: number[] = [];
  for (let m = 0; m < 12; m++) {
    temp.push(L.tempMonthly[m * n + i] * TEMP_SCALE);
    precip.push(L.precipMonthly[m * n + i] * PRECIP_SCALE);
  }
  const isLand = L.continentId[i] > 0;
  // 지도 단위(표시 전용 나라 포함)와 그 단위에 연결된 경제 국가는 따로다
  const country = L.countryId[i] ? (world.mapUnits[L.countryId[i] - 1] ?? null) : null;
  const participation = country?.participation;
  const region = L.cityRegion[i] ? world.cities[L.cityRegion[i] - 1] : null;
  const z = L.seaZone[i];
  const seaName =
    world.mode === 'earth'
      ? z === SEA_ZONE.NON_NAVIGABLE
        ? '운항 범위 밖의 바다(극지·닫힌 내해·해협 차단선)'
        : '바다(운항 가능)'
      : z === SEA_ZONE.CENTRAL
        ? '중앙해'
        : z === SEA_ZONE.NON_NAVIGABLE
          ? '항해할 수 없는 얼음 바다'
          : z >= SEA_ZONE.GATE_BASE
            ? world.chokepoints[z - SEA_ZONE.GATE_BASE].name
            : '외해';
  const flow = byteToFlow(L.riverFlow[i]);
  return (
    <>
      <header className="sel-head">
        <i className="dot" style={{ background: country?.color ?? '#2d5fa5' }} />
        <div>
          <h2>{isLand ? (country?.name ?? '육지') : seaName}</h2>
          <p>{formatLatLon(lat, lon)}</p>
          {isLand && participation === 'display' && (
            <p className="muted small">이번 시나리오에서는 경제 계산을 생략한 지역이에요. 무역이 없다는 뜻은 아니에요.</p>
          )}
          {isLand && participation === 'hinterland' && (
            <p className="muted small">바다가 없는 나라예요. 관문항과 이어진 배후 경제권으로 무역에 참여해요.</p>
          )}
        </div>
      </header>
      {isLand ? (
        <p>
          <b>{CLIMATE_ZONES[L.climateZone[i]].name}</b> · 해발 {L.elevation[i].toLocaleString('ko-KR')}m
          {region && <> · {region.name} 배후지</>}
          {flow >= world.catalog.riverMinFlow && <> · 강이 흐름</>}
        </p>
      ) : (
        <p>
          수심 {Math.abs(L.elevation[i]).toLocaleString('ko-KR')}m · 항해 위험 {Math.round((L.seaRisk[i] / 255) * 100)}%
        </p>
      )}
      <ClimateChart temp={temp} precip={precip} month={month} />
      <p className="muted small">
        기온 {Math.min(...temp).toFixed(0)}~{Math.max(...temp).toFixed(0)}°C · 연 강수{' '}
        {precip.reduce((a, b) => a + b, 0).toLocaleString('ko-KR')}mm
      </p>
      {isLand && (
        <>
          <h3>기르기 좋은 작물</h3>
          {world.catalog.crops.map((crop) => (
            <Bar key={crop.id} label={crop.name} value={L.cropSuitability[crop.id][i] / 255} />
          ))}
          {L.harvestMonth[i] > 0 && <p className="muted small">곡물 수확은 {L.harvestMonth[i]}월에 가장 많습니다.</p>}
        </>
      )}
      {world.catalog.resources.some((r) => L.resourceRichness[r.id][i] > 0) && (
        <>
          <h3>땅속 자원</h3>
          {world.catalog.resources.map((r) => (
            <Bar key={r.id} label={r.name} value={L.resourceRichness[r.id][i] / 255} />
          ))}
        </>
      )}
    </>
  );
}

function WorldSummary({
  world,
  onSelectCity,
  extra,
}: {
  world: World;
  onSelectCity: (id: string) => void;
  extra?: ReactNode;
}) {
  return (
    <>
      <header className="sel-head">
        <div>
          <h2>세계 한눈에 보기</h2>
          <p>지도를 눌러 땅·바다·항구를 살펴보세요.</p>
        </div>
      </header>
      {world.continents.map((cont) => (
        <div key={cont.id}>
          <h3>
            {cont.name}{' '}
            <span className="muted small">
              {cont.latMin < 0 ? `남위 ${Math.abs(cont.latMin).toFixed(0)}°` : `북위 ${cont.latMin.toFixed(0)}°`} ~{' '}
              {cont.latMax < 0 ? `남위 ${Math.abs(cont.latMax).toFixed(0)}°` : `북위 ${cont.latMax.toFixed(0)}°`}
            </span>
          </h3>
          {world.countries
            .filter((c) => c.continent === cont.id)
            .map((c) => (
              <div key={c.id} className="country-row">
                <i className="dot" style={{ background: c.color }} />
                <b>{c.name}</b>
                <span className="ports">
                  {c.cityIds.map((id) => {
                    const city = world.cities.find((x) => x.id === id)!;
                    return (
                      <button key={id} className="link" onClick={() => onSelectCity(id)}>
                        {city.name}
                      </button>
                    );
                  })}
                </span>
              </div>
            ))}
        </div>
      ))}
      {extra}
    </>
  );
}

export function SidePanel(props: {
  world: World;
  selection: Selection;
  month: number;
  routes: CityRoute[];
  routeTarget: string | null;
  onRouteTarget: (id: string | null) => void;
  blocked: string[];
  onToggleBlock: (gateId: string) => void;
  onSelectCity: (id: string) => void;
  onClear: () => void;
  genMs: number | null;
  cityExtra?: ReactNode;
  worldExtra?: ReactNode;
}) {
  const { world, selection } = props;
  const city = selection?.kind === 'city' ? world.cities.find((c) => c.id === selection.id) : undefined;
  return (
    <aside className="panel">
      {selection && (
        <button className="back" onClick={props.onClear}>
          ← 세계 한눈에 보기
        </button>
      )}
      {city ? (
        <CityInfo {...props} city={city} />
      ) : selection?.kind === 'cell' ? (
        <CellInfo world={world} lat={selection.lat} lon={selection.lon} month={props.month} />
      ) : (
        <WorldSummary world={world} onSelectCity={props.onSelectCity} extra={props.worldExtra} />
      )}

      <details className="validation" open={!world.validation.ok}>
        <summary>
          세계 생성 검증 {world.validation.checks.filter((c) => c.ok).length}/{world.validation.checks.length}{' '}
          {world.validation.ok ? '통과' : '— 실패 항목 있음'}
        </summary>
        <ul>
          {world.validation.checks.map((c) => (
            <li key={c.id} className={c.ok ? 'ok' : 'fail'}>
              <b>{c.ok ? '✔' : '✘'} {c.label}</b>
              <span>{c.detail}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          시드 <code>{world.seed}</code> · 지문 <code>{world.hash}</code> · 격자 {world.grid.width}×{world.grid.height}
          {props.genMs !== null && <> · 브라우저에서 {props.genMs}ms에 생성</>}
        </p>
      </details>
    </aside>
  );
}

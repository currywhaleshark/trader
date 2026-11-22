import { fixJosa } from '../sim/core/korean';
import { countryPopulation, formatResidents } from '../sim/economy/population';
import { PopulationDetails } from './PopulationDetails';
import { marketProducts } from '../sim/economy/products';
import { specialtyAvailable, specialtyById } from '../sim/economy/specialties';
import { SpecialtyInfo } from './SpecialtyInfo';
import { explainPrice } from '../sim/economy/market';
import { seasonalCapacity } from '../sim/economy/step';
import type { EconomyContext, EconomyState, SimEvent } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { GoodIcon } from './icons';
import { formatDate, type Simulation } from './useSimulation';

const CATEGORY_NAME = { raw: '원재료', intermediate: '중간재', final: '완제품' } as const;
export const COMPANY_COLORS = ['#7fd4ff', '#ffb86b', '#c9a6ff', '#9be28a'];

export function Spark({ values, base }: { values: number[]; base: number }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 60 18" />;
  const lo = Math.min(base * 0.5, ...values);
  const hi = Math.max(base * 1.5, ...values);
  const y = (v: number) => 17 - ((v - lo) / (hi - lo)) * 16;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 60).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 60 18" aria-hidden>
      <line x1={0} x2={60} y1={y(base)} y2={y(base)} className="spark-base" />
      <polyline points={pts} />
    </svg>
  );
}

/** 값이 왜 그런지 초등학생 말로 설명한다(가격 상승만 알리지 않는다, §12.2). */
export function reasonText(ctx: EconomyContext, state: EconomyState, cityId: string, goodId: string): string {
  return fixJosa(reasonTextRaw(ctx, state, cityId, goodId));
}

function reasonTextRaw(ctx: EconomyContext, state: EconomyState, cityId: string, goodId: string): string {
  const city = state.cities[cityId];
  const g = ctx.goodById[goodId];
  const r = explainPrice(city, goodId);
  const ratio = city.price[goodId] / g.basePrice;
  const industry = city.industries.find((i) => i.goodId === goodId);
  const made = city.last.produced[goodId];
  if (ratio >= 1.2) {
    const used = city.last.consumed[goodId] + city.last.usedAsInput[goodId];
    if (r.netImport > used) return '값이 올라서 배가 물건을 실어 왔어요. 재고가 차면 값이 내릴 거예요.';
    if (!industry) return r.netImport > 0 ? '여기서는 만들지 않아요. 들여온 양이 쓰는 양보다 적어 재고가 줄었어요.' : '여기서는 만들지 않는데, 요즘 들어온 배가 없어요.';
    const cap = seasonalCapacity(ctx, state, cityId, industry);
    if (g.recipe && made < cap * 0.6) {
      const lacking = Object.keys(g.recipe).filter((id) => city.stock[id] < city.target[id] * 0.3);
      if (lacking.length) return `${lacking.map((id) => ctx.goodById[id].name).join('·')}이(가) 모자라 공장이 덜 돌아요.`;
    }
    if (g.source?.kind === 'crop' && made < industry.capacity * 0.5) return '수확철이 아니라 창고의 곡식이 줄고 있어요.';
    if (r.netImport < 0) return '다른 나라로 많이 팔려 나가 재고가 줄었어요.';
    return '만드는 양보다 쓰는 양이 많아 재고가 모자라요.';
  }
  if (ratio <= 0.8) {
    if (industry && g.source?.kind === 'crop' && made > industry.capacity * 1.5) return '수확철이라 한꺼번에 많이 나왔어요.';
    if (industry) return '쓰는 양보다 많이 만들어 재고가 쌓였어요.';
    return '배로 많이 들어와 재고가 넉넉해요.';
  }
  return '재고가 알맞아요.';
}

export function CityMarket({ sim, cityId }: { sim: Simulation; cityId: string }) {
  const { ctx, state } = sim;
  const city = state.cities[cityId];
  const isPort = ctx.portIds.includes(cityId);
  const projects = state.projects.filter((p) => p.cityId === cityId && (isPort || p.kind !== 'port'));
  return (
    <>
      <h3>시장 — {formatDate(ctx.data.startYear, state.month)}</h3>
      <PopulationDetails data={ctx.data} state={state} city={city} />
      <p className="muted small">
        소득 수준 {city.income.toFixed(2)}{isPort && ` · 항만 ${['', '작은', '중간', '큰'][state.portLevel[cityId] ?? 1]} 규모`} ·
        만드는 것: {city.industries.map((i) => ctx.goodById[i.goodId].name).join(', ') || '없음'}
      </p>
      <SpecialtyInfo sim={sim} cityId={city.id} />
      {projects.length > 0 && (
        <ul className="news">
          {projects.map((p) => (
            <li key={p.id}>
              공사 중: {p.kind === 'port' ? '항구 넓히기' : `${ctx.goodById[p.goodId!].name} ${p.kind === 'build' ? '시설 새로 짓기' : '시설 늘리기'}`} —{' '}
              {formatDate(ctx.data.startYear, p.readyMonth)} 완공
              <span className="why">{fixJosa(p.reason)}</span>
            </li>
          ))}
        </ul>
      )}
      <table className="market">
        <thead>
          <tr>
            <th>상품</th>
            <th>값</th>
            <th>재고</th>
            <th>생산</th>
            <th>소비</th>
            <th>무역</th>
          </tr>
        </thead>
        <tbody>
          {(['raw', 'intermediate', 'final'] as const).map((cat) => [
            <tr key={cat} className="cat">
              <td colSpan={6}>{CATEGORY_NAME[cat]}</td>
            </tr>,
            ...marketProducts(ctx, state, cityId)
              .filter((p) => ctx.goodById[p.goodId].category === cat)
              .map((product) => {
                const g = ctx.goodById[product.goodId];
                const ratio = city.price[g.id] / g.basePrice;
                const stockRatio = city.stock[g.id] / city.target[g.id];
                const l = city.last;
                const net = l.imported[g.id] - l.exported[g.id];
                const used = l.consumed[g.id] + l.usedAsInput[g.id];
                return (
                  <tr key={product.id} title={reasonText(ctx, state, cityId, g.id)}>
                    <td>
                      <b className={`good-name cat-${g.category}`}>
                        <GoodIcon id={g.id} size={16} /> {product.name}
                      </b>
                      <span className="why">{product.specialtyId ? `한정 특산품 · ${g.name} 계열과 시세·수요 공유` : reasonText(ctx, state, cityId, g.id)}</span>
                    </td>
                    <td className={ratio >= 1.2 ? 'num high' : ratio <= 0.8 ? 'num low' : 'num'}>
                      {Math.round(city.price[g.id]).toLocaleString('ko-KR')}
                      <Spark values={sim.history.get(`${cityId}|${g.id}`) ?? []} base={g.basePrice} />
                    </td>
                    <td>
                      {product.specialtyId ? <span>{Math.floor(specialtyAvailable(ctx, state, cityId, specialtyById(ctx, product.specialtyId)!) + 1e-9)}개</span> : <span className="stockbar" title={`${Math.round(city.stock[g.id])} / 목표 ${Math.round(city.target[g.id])}`}>
                        <i
                          className={stockRatio < 0.5 ? 'lowstock' : ''}
                          style={{ width: `${Math.min(100, stockRatio * 50)}%` }}
                        />
                      </span>}
                    </td>
                    <td className="num">{product.specialtyId ? '계열 공유' : l.produced[g.id] >= 0.5 ? Math.round(l.produced[g.id]) : '–'}</td>
                    <td className="num">{product.specialtyId ? '계열 공유' : used >= 0.5 ? Math.round(used) : '–'}</td>
                    <td className={net > 0.5 ? 'num imp' : net < -0.5 ? 'num exp' : 'num'}>
                      {product.specialtyId ? '계열 공유' : net > 0.5 ? `수입 ${Math.round(net)}` : net < -0.5 ? `수출 ${Math.round(-net)}` : '–'}
                    </td>
                  </tr>
                );
              }),
          ])}
        </tbody>
      </table>
      <p className="muted small">
        값이 <span className="high">붉으면</span> 평소보다 비싸고 <span className="low">푸르면</span> 싼 것입니다. 재고 막대의
        가운데가 알맞은 양입니다. 수량은 지난 한 달 기준.
      </p>
    </>
  );
}

export function newsText(world: World, ctx: EconomyContext, e: SimEvent): string {
  return fixJosa(newsTextRaw(world, ctx, e));
}

function newsTextRaw(world: World, ctx: EconomyContext, e: SimEvent): string {
  const city = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const when = formatDate(ctx.data.startYear, e.month);
  if (e.type === 'growth' || e.type === 'policy') return `${when} · ${e.text}`;
  if (e.type === 'shortage') {
    return `${when} · ${city(e.cityId)}에서 ${ctx.goodById[e.goodId].name}이(가) 동났습니다. 사려던 양의 ${Math.round(e.ratio * 100)}%를 구하지 못했습니다.`;
  }
  if (e.type === 'modifier') {
    return `${when} · ${city(e.cityId)}: ${e.reason}(으)로 ${ctx.goodById[e.goodId].name} 생산이 ${Math.round(e.factor * 100)}%로 줄었습니다.`;
  }
  return when;
}

export function WorldMarket({
  sim,
  world,
  onSelectCity,
}: {
  sim: Simulation;
  world: World;
  onSelectCity: (id: string) => void;
}) {
  const { ctx, state } = sim;
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  return (
    <>
      <h3>세계 시세 — 어디가 싸고 어디가 비쌀까?</h3>
      <table className="market world-market">
        <thead>
          <tr>
            <th>상품</th>
            <th>가장 싼 곳</th>
            <th>가장 비싼 곳</th>
          </tr>
        </thead>
        <tbody>
          {ctx.goods.map((g) => {
            const markets = ctx.cityIds.filter((id) => state.cities[id].target[g.id] > 0);
            let lo = markets[0];
            let hi = markets[0];
            for (const id of markets) {
              if (state.cities[id].price[g.id] < state.cities[lo].price[g.id]) lo = id;
              if (state.cities[id].price[g.id] > state.cities[hi].price[g.id]) hi = id;
            }
            const price = (id: string) => Math.round(state.cities[id].price[g.id]).toLocaleString('ko-KR');
            return (
              <tr key={g.id}>
                <td>
                  <b className={`good-name cat-${g.category}`}>
                    <GoodIcon id={g.id} size={16} /> {g.name}
                  </b>
                </td>
                <td>
                  <button className="link low" onClick={() => onSelectCity(lo)}>
                    {name(lo)} {price(lo)}
                  </button>
                </td>
                <td>
                  <button className="link high" onClick={() => onSelectCity(hi)}>
                    {name(hi)} {price(hi)}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>무역회사</h3>
      {state.companies.map((c, k) => {
        const fleet = state.ships.filter((s) => s.companyId === c.id);
        return (
          <div key={c.id} className="country-row">
            <i className="dot" style={{ background: COMPANY_COLORS[k % COMPANY_COLORS.length] }} />
            <b>{c.name}</b>
            <span className="muted small" style={{ marginLeft: 'auto' }}>
              배 {fleet.length}척(항해 중 {fleet.filter((s) => s.from !== s.to).length}) · 현금{' '}
              {Math.round(c.cash).toLocaleString('ko-KR')} · {name(c.homeCityId)}에 낸 배당{' '}
              {Math.round(c.paidOut).toLocaleString('ko-KR')}
            </span>
          </div>
        );
      })}

      <h3>나라들의 변화</h3>
      <table className="market">
        <thead>
          <tr>
            <th>나라</th>
            <th>국가 인구</th>
            <th>시장 수요 인구(게임)</th>
            <th>소득</th>
            <th>기술</th>
            <th>공사 중</th>
          </tr>
        </thead>
        <tbody>
          {world.countries.map((k) => {
            const cities = ctx.cityIds.filter((id) => ctx.countryOfCity[id] === k.id);
            const { national, year, market, income: inc } = countryPopulation(ctx.data, state, k.id);
            const first = state.history[0]?.countries[k.id];
            const building = state.projects.filter((p) => cities.includes(p.cityId));
            return (
              <tr key={k.id}>
                <td>
                  <i className="dot" style={{ background: k.color, width: 10, height: 10 }} /> {k.name}
                </td>
                <td className="num">{formatResidents(national)}{year && ` (${year}년)`}</td>
                <td className="num">{formatResidents(market)}</td>
                <td className="num">
                  {inc.toFixed(2)}
                  {first && <span className="why">{inc >= first.income ? '▲' : '▼'} {first.income.toFixed(2)}에서</span>}
                </td>
                <td className="num">{(state.tech[k.id] ?? 0).toFixed(1)}</td>
                <td className="num">{building.length || '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>무역 정책과 유행</h3>
      {(() => {
        const live = state.policies.filter((p) => p.startMonth <= state.month && state.month < p.endMonth);
        const waves = state.cultureWaves.filter((w) => w.startMonth <= state.month && state.month < w.endMonth);
        if (live.length === 0 && waves.length === 0) return <p className="muted small">지금은 특별한 관세나 협정이 없어요.</p>;
        return (
          <ul className="news">
            {live.map((p) => (
              <li key={p.id}>
                <b>{p.kind === 'fta' ? '협정' : p.cause === 'conflict' || p.cause === 'retaliation' ? '갈등' : '관세'}</b> {p.title} —{' '}
                {formatDate(ctx.data.startYear, p.endMonth)}까지
                <span className="why">왜? {fixJosa(p.causes.join(' '))}</span>
              </li>
            ))}
            {waves.map((w) => (
              <li key={w.id}>
                <b>유행</b> {w.title} — {formatDate(ctx.data.startYear, w.endMonth)}까지
                <span className="why">{fixJosa(w.effects.join(' '))}</span>
              </li>
            ))}
          </ul>
        );
      })()}

      <h3>세계 소식</h3>
      {sim.news.length === 0 ? (
        <p className="muted small">아직 큰 소식이 없습니다. 시간을 흘려 보세요.</p>
      ) : (
        <ul className="news">
          {sim.news.slice(0, 10).map((e, k) => (
            <li key={k}>
              {newsText(world, ctx, e)}
              {e.type === 'growth' && <span className="why">왜? {fixJosa(e.causes.join(' '))}</span>}
              {e.type === 'policy' && e.kind !== 'review' && e.causes.length > 0 && <span className="why">왜? {fixJosa(e.causes.join(' '))}</span>}
              {e.type === 'policy' && e.effects.length > 0 && (
                <span className="why">
                  {e.kind === 'review' ? '실제로 달라진 것: ' : '누구에게 어떤 영향? '}
                  {fixJosa(e.effects.join(' / '))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { fixJosa } from '../sim/core/korean';
import { canEnter, netProfit, PLAYER_ID, shipType } from '../sim/economy/player';
import type { World } from '../sim/world/types';
import { logText, ProfitChart, RouteEditor } from './CompanyPanel';
import { GoodIcon, Icon, UI_ICON } from './icons';
import { ShipPic } from './ShipPic';
import { CompanyLogo } from './CompanyLogo';
import { PopulationDetails } from './PopulationDetails';
import { countryPopulation, formatResidents } from '../sim/economy/population';
import { FleetTab } from './FleetTab';
import { OrdersPanel } from './OrdersPanel';
import { WarehousePanel } from './WarehousePanel';
import { marketProducts } from '../sim/economy/products';
import { specialtyAvailable, specialtyById } from '../sim/economy/specialties';
import { SpecialtyInfo } from './SpecialtyInfo';
import { newsText, reasonText, Spark } from './MarketPanel';
import { qty, canSendShipTo, shippingPortForMarket, won } from './tradeModel';
import { formatDate, type Simulation } from './useSimulation';

const CATEGORY_NAME = { raw: '원재료', intermediate: '중간재', final: '완제품' } as const;

/** 화면 가운데에 뜨는 창 틀(제목·탭·닫기) */
function Win(props: {
  icon: ReactNode;
  title: ReactNode;
  extra?: ReactNode;
  tabs?: { id: string; label: string; icon: string }[];
  tab?: string;
  onTab?: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="port-win info-win" role="dialog">
      <header className="port-head">
        {typeof props.icon === 'string' ? <Icon name={props.icon} size={24} /> : props.icon}
        <h2>{props.title}</h2>
        {props.extra}
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={props.onClose} aria-label="닫기">
          <Icon name="x" size={20} />
        </button>
      </header>
      {props.tabs && (
        <nav className="win-tabs" role="tablist">
          {props.tabs.map((t) => (
            <button key={t.id} data-tab={t.id} role="tab" aria-selected={props.tab === t.id} className={props.tab === t.id ? 'on' : ''} onClick={() => props.onTab?.(t.id)}>
              <Icon name={t.icon} size={17} /> {t.label}
            </button>
          ))}
        </nav>
      )}
      <div className="win-body">{props.children}</div>
    </div>
  );
}

export function OrdersWindow({ sim, onCity, onClose }: { sim: Simulation; onCity: (id: string) => void; onClose: () => void }) {
  return <Win icon="clipboard-list" title="도시 발주함" onClose={onClose}><OrdersPanel sim={sim} onCity={onCity} /></Win>;
}

/** 세계 평균 값과 견준 비율 */
function vsWorld(sim: Pick<Simulation, 'ctx' | 'state'>, cityId: string, goodId: string): number {
  const { ctx, state } = sim;
  let sum = 0;
  let n = 0;
  for (const id of ctx.cityIds) {
    if (state.cities[id].target[goodId] > 0) {
      sum += state.cities[id].price[goodId];
      n++;
    }
  }
  return n && sum ? state.cities[cityId].price[goodId] / (sum / n) : 1;
}

// ------------------------------------------------------------------ 항구 정보 창

export function CityWindow(props: {
  sim: Pick<Simulation, 'ctx' | 'state' | 'history'>;
  world: World;
  cityId: string;
  onClose: () => void;
  /** 정박한 내 배의 목적지로 정하고 그 배의 항구 창을 연다 */
  onSendShip: (shipId: string, cityId: string) => void;
  onLens: (goodId: string) => void;
}) {
  const { sim, world, cityId } = props;
  const { ctx, state } = sim;
  const city = state.cities[cityId];
  const wc = world.cities.find((c) => c.id === cityId)!;
  const country = world.countries.find((c) => c.id === wc.countryId);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [cityId]);
  const level = state.portLevel[cityId] ?? wc.portSize;
  const portId = shippingPortForMarket(ctx, cityId);
  const docked = portId ? state.ships.filter((s) => s.companyId === PLAYER_ID && canSendShipTo(sim, s, portId)) : [];
  const projects = state.projects.filter((p) => p.cityId === cityId && (wc.isPort || p.kind !== 'port'));

  return (
    <Win
      icon={wc.isPort ? UI_ICON.port : 'building-store'}
      title={`${wc.name} ${wc.isPort ? '항구' : '내륙 시장'}`}
      extra={
        country && (
          <span className="country-chip">
            <i className="dot" style={{ background: country.color }} />
            {country.name}
          </span>
        )
      }
      onClose={props.onClose}
    >
      <div className="city-stats">
        <div className="stat"><Icon name="users" size={20} /><PopulationDetails data={ctx.data} state={state} city={city} /></div>
        <span className="stat" title="소득 수준(1이 보통)">
          <Icon name="coin" size={20} /> 소득 <b>{city.income.toFixed(2)}</b>
        </span>
        {wc.isPort ? (
          <span className="stat" title="항구 크기">
            <Icon name="anchor" size={20} /> 항구 {['', '작은', '중간', '큰'][level]} 규모
          </span>
        ) : (
          <span className="stat"><Icon name="route" size={20} /> {portId ? `관문항 · ${ctx.cityNames[portId]}` : '이용 가능한 관문항 없음'}</span>
        )}
        <span className="stat" title="이 도시에서 만드는 것">
          <Icon name="building-factory-2" size={20} />
          {city.industries.length ? city.industries.map((i) => <GoodIcon key={i.goodId} id={i.goodId} size={20} label={ctx.goodById[i.goodId].name} />) : '공장 없음'}
        </span>
      </div>
      {ctx.data.cities[cityId]?.role && <p className="city-role small">{ctx.data.cities[cityId].role}</p>}
      <SpecialtyInfo sim={sim} cityId={city.id} />
      {projects.length > 0 && (
        <div className="chips">
          {projects.map((p) => (
            <span key={p.id} className="chip-card" title={fixJosa(p.reason)}>
              <Icon name="crane" size={16} /> {p.kind === 'port' ? '항구 넓히는 중' : `${ctx.goodById[p.goodId!].name} ${p.kind === 'build' ? '공장 짓는 중' : '공장 늘리는 중'}`} ·{' '}
              {formatDate(ctx.data.startYear, p.readyMonth)} 완공
            </span>
          ))}
        </div>
      )}
      {portId && docked.length > 0 && (
        <div className="chips">
          {docked.map((s) => (
            <button key={s.id} className="btn small" onClick={() => props.onSendShip(s.id, portId)}>
              <Icon name={UI_ICON.ship} size={16} /> {fixJosa(`${s.name}을(를) ${wc.isPort ? '여기로' : ctx.cityNames[portId] + '항으로'} 보내기`)}
            </button>
          ))}
        </div>
      )}
      {(['raw', 'intermediate', 'final'] as const).map((cat) => {
        const goods = marketProducts(ctx, state, cityId).filter((p) => ctx.goodById[p.goodId].category === cat);
        if (!goods.length) return null;
        return (
          <section key={cat} className="city-goods">
            <h3>{CATEGORY_NAME[cat]}</h3>
            <div className="tiles">
              {goods.map((product) => {
                const g = ctx.goodById[product.goodId];
                const r = vsWorld(sim, cityId, g.id);
                const stock = city.stock[g.id] / city.target[g.id];
                const net = city.last.imported[g.id] - city.last.exported[g.id];
                return (
                  <button
                    key={product.id}
                    className={['tile', `cat-${g.category}`, open === product.id ? 'on' : ''].join(' ')}
                    onClick={() => {
                      setOpen(open === product.id ? null : product.id);
                      props.onLens(g.id);
                    }}
                  >
                    {r < 0.8 && <span className="tag cheap">싸요</span>}
                    {r > 1.25 && <span className="tag dear">비싸요</span>}
                    {net > 0.5 && <Icon name="arrow-big-down-lines" size={15} style={{ position: 'absolute', top: 6, right: 6, color: '#7fb2e5' }} label="수입" />}
                    {net < -0.5 && <Icon name="arrow-big-up-lines" size={15} style={{ position: 'absolute', top: 6, right: 6, color: '#e2b34a' }} label="수출" />}
                    <GoodIcon id={g.id} size={28} />
                    <span className="tile-name">{product.name}</span>
                    {product.specialtyId && <span className="specialty-tag">한정 특산품 · {Math.floor(specialtyAvailable(ctx, state, cityId, specialtyById(ctx, product.specialtyId)!) + 1e-9)}개</span>}
                    <span className="tile-price">{won(city.price[g.id])}</span>
                    <span className="stock-mini" title="창고(가운데가 알맞은 양)">
                      <i className={stock < 0.5 ? 'low' : ''} style={{ width: `${Math.min(100, stock * 50)}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
            {goods.filter((p) => p.id === open).map((p) => <div key={p.id} className="good-detail">
              <GoodIcon id={p.goodId} size={22} />
              <Spark values={sim.history.get(`${cityId}|${p.goodId}`) ?? []} base={ctx.goodById[p.goodId].basePrice} />
              <span>{p.specialtyId ? `${p.name} · ${ctx.goodById[p.goodId].name} 계열과 시세·수요를 공유해요. ` : ''}{reasonText(ctx, state, cityId, p.goodId)}</span>
            </div>)}
          </section>
        );
      })}
      <p className="muted small">
        <Icon name="arrow-big-down-lines" size={14} /> 수입이 많아요 · <Icon name="arrow-big-up-lines" size={14} /> 수출이 많아요 · 막대는 창고에 있는 양(가운데가 알맞은 양)
      </p>
    </Win>
  );
}

// ------------------------------------------------------------------ 회사 창

export function CompanyWindow(props: { sim: Simulation; world: World; onClose: () => void; onCity: (id: string) => void; initialTab?: string }) {
  const { sim, world } = props;
  const { ctx, state } = sim;
  const p = state.player;
  const [tab, setTab] = useState(props.initialTab ?? 'result');
  const [flash, setFlashState] = useState<{ text: string; ok: boolean } | null>(null);
  const setFlash = (m: string | null, ok = false) => setFlashState(m ? { text: fixJosa(m), ok } : null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlashState(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);
  const fleet = state.ships.filter((s) => s.companyId === PLAYER_ID);
  const home = ctx.data.player.startCityId;
  const last12 = p.ledger.slice(-12);
  const sum = (f: (l: (typeof last12)[number]) => number) => last12.reduce((s, l) => s + f(l), 0);
  const year = sum(netProfit);
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const maxCap = Math.max(...ctx.data.shipTypes.map((t) => t.capacity));
  const maxSpeed = Math.max(...ctx.data.shipTypes.map((t) => t.speedKmPerMonth));

  return (
    <Win
      icon={<CompanyLogo id={sim.settings.companyLogo} />}
      title={p.name}
      extra={
        <span className="money port-cash">
          <Icon name={UI_ICON.money} size={18} /> {won(p.cash)}
        </span>
      }
      tabs={[
        { id: 'result', label: '결과', icon: 'chart-bar' },
        { id: 'fleet', label: '배 현황', icon: 'ship' },
        { id: 'warehouse', label: '회사 창고', icon: 'building-warehouse' },
        { id: 'local', label: '지역 거래', icon: 'building-community' },
        { id: 'ships', label: '배 사기', icon: 'shopping-cart' },
        { id: 'routes', label: '정기 항로', icon: 'route' },
        { id: 'log', label: '기록', icon: 'list' },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={props.onClose}
    >
      {flash && <p className={flash.ok ? 'flash ok' : 'flash'}>{flash.text}</p>}
      {tab === 'result' && (
        <>
          <div className="stat-cards">
            <div className={year >= 0 ? 'stat-card up' : 'stat-card down'}>
              <span>최근 12달 순이익</span>
              <b>
                {year >= 0 ? '+' : ''}
                {won(year)}
              </b>
            </div>
            <div className="stat-card">
              <span>
                <Icon name="ship" size={15} /> 배
              </span>
              <b>{fleet.length}척</b>
            </div>
            <div className="stat-card">
              <span>
                <Icon name="arrows-exchange" size={15} /> 판 횟수
              </span>
              <b>{p.tradeCount}번</b>
            </div>
          </div>
          <ProfitChart ledger={p.ledger} />
          <p className="muted small">막대 하나가 한 달이에요. 초록은 남은 달, 빨강은 밑진 달.</p>
          <div className="money-flow">
            <span className="mf in">
              <Icon name="cash" size={18} /> 판 돈 <b>{won(sum((l) => l.sales))}</b>
            </span>
            <span className="mf out">
              <Icon name="shopping-cart" size={18} /> 산 돈 <b>{won(sum((l) => l.purchases))}</b>
            </span>
            <span className="mf out">
              <Icon name="gas-station" size={18} /> 연료·항만·관세 <b>{won(sum((l) => l.fuel + l.portFees + (l.tariffs ?? 0)))}</b>
            </span>
            <span className="mf out">
              <Icon name="tool" size={18} /> 유지비 <b>{won(sum((l) => l.upkeep))}</b>
            </span>
            <span className="mf out"><Icon name="building-warehouse" size={18} /> 보관료 <b>{won(sum((l) => l.storageFees ?? 0))}</b></span>
          </div>
          {!!p.lifetime.warehouseInvestment && <p className="muted small">창고 시설 투자 누계 {won(p.lifetime.warehouseInvestment)} · 선박 매입처럼 순이익과 별도로 기록해요.</p>}
        </>
      )}
      {tab === 'ships' && (
        <>
          <div className="row">
            <Icon name="anchor" size={18} />
            <span>새 배를 받을 근거지 · <b>{name(home)}</b></span>
          </div>
          <div className="ship-shop">
            {ctx.data.shipTypes.map((t) => {
              const fits = canEnter(ctx, state, t.id, home);
              const afford = p.cash >= t.price;
              return (
                <div key={t.id} className={fits && afford ? 'ship-card2' : 'ship-card2 dim'}>
                  <ShipPic typeId={t.id} width={176} title={t.name} />
                  <div className="sc-head">
                    <b>{t.name}</b>
                    {t.refrigerated && <Icon name="snowflake" size={16} label="냉장" />}
                  </div>
                  <span className="money sc-price">
                    <Icon name={UI_ICON.money} size={16} /> {won(t.price)}
                  </span>
                  <span className="muted small">{t.blurb}</span>
                  <span className="meter-row" title={`싣는 양 ${t.capacity}`}>
                    <Icon name="box" size={15} /> 싣는 양
                    <span className="meter-track">
                      <i style={{ width: `${(t.capacity / maxCap) * 100}%` }} />
                    </span>
                  </span>
                  <span className="meter-row" title={`한 달 ${won(t.speedKmPerMonth)}km`}>
                    <Icon name="gauge" size={15} /> 빠르기
                    <span className="meter-track">
                      <i style={{ width: `${(t.speedKmPerMonth / maxSpeed) * 100}%` }} />
                    </span>
                  </span>
                  <span className="small">
                    한 번에 <b>{won(t.rangeKm)}km</b> · 기항하면 보급
                  </span>
                  <span className="small">
                    유지비 <b>{won(t.upkeepPerMonth)}</b>/달 · {['', '모든', '중간 이상', '큰'][t.size]} 항구
                  </span>
                  <button
                    className="btn primary"
                    disabled={!fits || !afford}
                    onClick={() => {
                      const r = sim.act({ type: 'buyShip', typeId: t.id });
                      setFlash(r.ok ? `${name(home)}에서 ${t.name}을(를) 샀어요.` : (r.error ?? '살 수 없어요.'), r.ok);
                    }}
                  >
                    {!fits ? '항구가 작아요' : !afford ? '돈이 모자라요' : `${won(t.price)}에 사기`}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab === 'fleet' && <FleetTab sim={sim} world={world} setFlash={setFlash} />}
      {tab === 'warehouse' && <WarehousePanel sim={sim} />}
      {tab === 'local' && <OrdersPanel sim={sim} onCity={props.onCity} localOnly />}
      {tab === 'routes' && (
        <div className="panel-like">
          <RouteEditor sim={sim} world={world} setFlash={setFlash} />
        </div>
      )}
      {tab === 'log' &&
        (sim.log.length === 0 ? (
          <p className="muted">아직 기록이 없어요.</p>
        ) : (
          <ul className="log-list">
            {sim.log.slice(0, 30).map((e, k) => (
              <li key={k}>
                <Icon
                  name={e.type === 'arrival' ? 'anchor' : e.type === 'trade' ? (e.side === 'buy' ? 'shopping-cart' : 'cash') : 'info-circle'}
                  size={17}
                />
                {e.type === 'trade' && <GoodIcon id={e.goodId} size={17} />}
                <span>{logText(world, sim, e)}</span>
              </li>
            ))}
          </ul>
        ))}
      {fleet.length > 0 && tab === 'ships' && (
        <p className="muted small">
          가진 배: {fleet.map((s) => `${s.name}(${shipType(ctx, s.typeId).name})`).join(', ')}
        </p>
      )}
    </Win>
  );
}

// ------------------------------------------------------------------ 세계 창

export function WorldWindow(props: { sim: Simulation; world: World; onClose: () => void; onCity: (id: string) => void; onLens: (goodId: string) => void }) {
  const { sim, world } = props;
  const { ctx, state } = sim;
  const [tab, setTab] = useState('prices');
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const live = state.policies.filter((p) => p.startMonth <= state.month && state.month < p.endMonth);
  const waves = state.cultureWaves.filter((w) => w.startMonth <= state.month && state.month < w.endMonth);
  return (
    <Win
      icon="world"
      title="세계"
      tabs={[
        { id: 'prices', label: '어디가 쌀까', icon: 'scale' },
        { id: 'countries', label: '나라들', icon: 'flag' },
        { id: 'news', label: '소식', icon: 'news' },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={props.onClose}
    >
      {tab === 'prices' && (
        <div className="price-rows">
          <p className="small muted">브랜드 평판과 문화 유행을 적용하기 전의 품목 기본 시세예요.</p>
          {ctx.goods.map((g) => {
            const markets = ctx.cityIds.filter((id) => state.cities[id].target[g.id] > 0);
            if (!markets.length) return null;
            let lo = markets[0];
            let hi = markets[0];
            for (const id of markets) {
              if (state.cities[id].price[g.id] < state.cities[lo].price[g.id]) lo = id;
              if (state.cities[id].price[g.id] > state.cities[hi].price[g.id]) hi = id;
            }
            const gap = state.cities[hi].price[g.id] - state.cities[lo].price[g.id];
            return (
              <div key={g.id} className={`price-row cat-${g.category}`}>
                <button className="pr-good" onClick={() => props.onLens(g.id)} title="상품 렌즈로 보기">
                  <GoodIcon id={g.id} size={22} /> {g.name}
                </button>
                <button className="pr-city cheap" onClick={() => props.onCity(lo)}>
                  {name(lo)} <b>{won(state.cities[lo].price[g.id])}</b>
                </button>
                <Icon name="arrow-right" size={16} />
                <button className="pr-city dear" onClick={() => props.onCity(hi)}>
                  {name(hi)} <b>{won(state.cities[hi].price[g.id])}</b>
                </button>
                <span className="pr-gap">차이 {won(gap)}</span>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'countries' && (
        <div className="country-cards">
          {world.countries.map((k) => {
            const cities = ctx.cityIds.filter((id) => ctx.countryOfCity[id] === k.id);
            const { national, year, market, income: inc } = countryPopulation(ctx.data, state, k.id);
            const first = state.history[0]?.countries[k.id];
            const tech = state.tech[k.id] ?? 0;
            return (
              <div key={k.id} className="country-card" style={{ borderColor: k.color }}>
                <b>
                  <i className="dot" style={{ background: k.color }} /> {k.name}
                </b>
                <span>
                  <Icon name="users" size={16} /> 국가 인구 {formatResidents(national)}{year && ` (${year}년)`}
                </span>
                {year && <span className="small">시장 수요 인구(게임) {formatResidents(market)}</span>}
                <span>
                  <Icon name="coin" size={16} /> 소득 {inc.toFixed(2)}{' '}
                  {first && <span className={inc >= first.income ? 'good' : 'bad'}>{inc >= first.income ? '▲' : '▼'}</span>}
                </span>
                <span>
                  <Icon name="cpu" size={16} /> 기술 {tech.toFixed(1)}
                </span>
                {Object.entries(ctx.reputation.premiums[k.id] ?? {}).map(([id, premium], i) =>
                  <span className="small" key={id}>{i ? '보조' : '대표'} 산업 · {ctx.goodById[id]?.name ?? id} · 평판 +{Math.round(premium * 100)}%</span>)}
                {ctx.reputation.unassigned[k.id] && <span className="small muted">대표 산업 없음 · {ctx.reputation.unassigned[k.id]}</span>}
                <span className="muted small">시장 · {cities.map(name).join(', ')}</span>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'news' && (
        <>
          {(live.length > 0 || waves.length > 0) && (
            <div className="news-cards">
              {live.map((p) => (
                <div key={p.id} className={`news-card ${p.kind}`}>
                  <b>
                    <Icon name={p.kind === 'fta' ? 'heart-handshake' : 'receipt-tax'} size={18} /> {p.title}
                  </b>
                  <span className="muted small">{formatDate(ctx.data.startYear, p.endMonth)}까지</span>
                  <span className="small">왜? {fixJosa(p.causes.join(' '))}</span>
                </div>
              ))}
              {waves.map((w) => (
                <div key={w.id} className="news-card culture">
                  <b>
                    <Icon name="movie" size={18} /> {w.title}
                  </b>
                  <span className="muted small">{formatDate(ctx.data.startYear, w.endMonth)}까지</span>
                  <span className="small">{fixJosa(w.effects.join(' '))}</span>
                </div>
              ))}
            </div>
          )}
          {sim.news.length === 0 ? (
            <p className="muted">아직 큰 소식이 없어요. 시간을 흘려 보세요.</p>
          ) : (
            <ul className="log-list">
              {sim.news.slice(0, 15).map((e, k) => (
                <li key={k}>
                  <Icon name={e.type === 'growth' ? 'trending-up' : e.type === 'policy' ? 'receipt-tax' : e.type === 'shortage' ? 'alert-triangle' : 'cloud-storm'} size={17} />
                  <span>
                    {newsText(world, ctx, e)}
                    {(e.type === 'growth' || e.type === 'policy') && e.causes.length > 0 && <span className="why">왜? {fixJosa(e.causes.join(' '))}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Win>
  );
}

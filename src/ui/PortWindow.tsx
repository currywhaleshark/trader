import { useEffect, useMemo, useState } from 'react';
import { fixJosa } from '../sim/core/korean';
import { suggestTrips } from '../sim/economy/advice';
import { quoteBuy, quoteSell } from '../sim/economy/market';
import { canEnter, cargoVolume, isDocked, shipType } from '../sim/economy/player';
import type { Command, Ship } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { HoldSlots } from './Dock';
import { GoodIcon, Icon, UI_ICON } from './icons';
import { qty, tradeRows, voyageTo, won, type TradeRow } from './tradeModel';
import type { Simulation } from './useSimulation';

type Pick = { side: 'buy' | 'sell'; goodId: string } | null;

/** 값 꼬리표: 세계 평균과 비교 */
function priceTag(r: TradeRow): { text: string; cls: string } | null {
  if (r.priceVsWorld < 0.8) return { text: '싸요', cls: 'tag cheap' };
  if (r.priceVsWorld > 1.25) return { text: '비싸요', cls: 'tag dear' };
  return null;
}

/**
 * 항구 창: 왼쪽은 항구 창고(눌러서 싣기), 오른쪽은 내 배 짐칸(눌러서 팔기),
 * 아래는 목적지와 출발. 숫자는 꼭 필요한 것만 크게 보여 준다.
 */
export function PortWindow(props: {
  sim: Simulation;
  world: World;
  ship: Ship;
  dest: string | null;
  onDest: (cityId: string | null) => void;
  /** 창을 잠깐 접고 지도에서 목적지를 고른다 */
  onPickOnMap: () => void;
  /** 고른 상품을 상품 렌즈로(지구본 이름표에 값이 뜬다) */
  onLens?: (goodId: string) => void;
  onClose: () => void;
}) {
  const { sim, world, ship, dest } = props;
  const { ctx, state } = sim;
  const here = ship.to;
  const type = shipType(ctx, ship.typeId);
  const cityName = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const country = world.countries.find((c) => c.id === world.cities.find((x) => x.id === here)?.countryId);
  const [pick, setPick] = useState<Pick>(null);
  const [amount, setAmount] = useState(0);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => setPick(null), [ship.id, here]);

  const rows = useMemo(() => tradeRows(sim, ship, dest), [sim, ship, dest]);
  const voyage = voyageTo(sim, ship, dest);
  const ideas = useMemo(() => (sim.settings.showHints ? suggestTrips(ctx, state, ship).slice(0, 3) : []), [ctx, state, ship, sim.settings.showHints]);
  const free = ship.capacity - cargoVolume(ctx, ship);

  if (!isDocked(ship)) {
    return (
      <div className="port-win small-win" role="dialog" aria-label="항구">
        <header className="port-head">
          <Icon name={UI_ICON.ship} size={22} />
          <h2>{ship.name}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="닫기">
            <Icon name="x" size={20} />
          </button>
        </header>
        <p className="muted">{ship.from === ship.to ? `${cityName(here)}에서 정기 항로 일을 하고 있어요.` : `${cityName(here)}(으)로 가는 중이에요. 도착하면 항구 창이 열려요.`}</p>
      </div>
    );
  }

  const run = (cmd: Command, okText: string) => {
    const r = sim.act(cmd);
    setFlash({ text: fixJosa(r.ok ? okText : (r.error ?? '할 수 없어요.')), ok: r.ok });
    return r.ok;
  };

  // 지금 고른 상품
  const row = pick ? rows.find((r) => r.g.id === pick.goodId) : undefined;
  const max = !row ? 0 : pick!.side === 'buy' ? Math.floor(row.buyable) : Math.floor(row.have * 10) / 10;
  const n = Math.min(amount, max);
  const quote = !row || n <= 0 ? null : pick!.side === 'buy' ? quoteBuy(ctx, state.cities[here], row.g.id, n) : quoteSell(ctx, state.cities[here], row.g.id, n);
  const lots = row ? ship.cargo.filter((l) => l.goodId === row.g.id) : [];
  const avgCost = lots.length ? lots.reduce((s, l) => s + l.unitCost * l.quantity, 0) / lots.reduce((s, l) => s + l.quantity, 0) : 0;

  const choose = (side: 'buy' | 'sell', r: TradeRow) => {
    setPick({ side, goodId: r.g.id });
    props.onLens?.(r.g.id);
    setAmount(side === 'buy' ? Math.floor(r.buyable) : Math.floor(r.have * 10) / 10);
  };

  // 창고에 보일 상품: 이 항구에서 살 수 있는 것 먼저, 1개당 남는 돈 순
  const shelf = rows
    .filter((r) => state.cities[here].stock[r.g.id] >= 1)
    .sort((a, b) => (b.perUnit ?? -1e9) - (a.perUnit ?? -1e9) || a.g.name.localeCompare(b.g.name, 'ko'));
  const hold = rows.filter((r) => r.have > 0);

  return (
    <div className="port-win" role="dialog" aria-label={`${cityName(here)} 항구`}>
      <header className="port-head">
        <Icon name={UI_ICON.port} size={24} />
        <h2>{cityName(here)} 항구</h2>
        {country && (
          <span className="country-chip">
            <i className="dot" style={{ background: country.color }} />
            {country.name}
          </span>
        )}
        <span className="money port-cash">
          <Icon name={UI_ICON.money} size={18} /> {won(state.player.cash)}
        </span>
        <button className="icon-btn" onClick={props.onClose} aria-label="닫기">
          <Icon name="x" size={20} />
        </button>
      </header>

      <div className="port-body">
        <section className="warehouse">
          <h3>
            <Icon name="building-warehouse" size={18} /> 항구 창고 <span className="muted small">눌러서 배에 싣기</span>
          </h3>
          <div className="tiles">
            {shelf.map((r) => {
              const tag = priceTag(r);
              const cant = !r.carry || r.buyable < 1;
              const on = pick?.side === 'buy' && pick.goodId === r.g.id;
              return (
                <button
                  key={r.g.id}
                  className={['tile', `cat-${r.g.category}`, on ? 'on' : '', cant ? 'cant' : ''].join(' ')}
                  onClick={() => choose('buy', r)}
                  title={!r.carry ? '이 배에는 못 실어요' : r.buyable < 1 ? '돈이나 자리가 모자라요' : ''}
                >
                  {tag && <span className={tag.cls}>{tag.text}</span>}
                  <GoodIcon id={r.g.id} size={30} />
                  <span className="tile-name">{r.g.name}</span>
                  <span className="tile-price">{won(r.buyUnit)}</span>
                  {r.perUnit !== null && (
                    <span className={r.perUnit > 0 ? 'badge up' : 'badge down'}>
                      {r.perUnit > 0 ? '+' : ''}
                      {won(r.perUnit)}
                    </span>
                  )}
                  {!r.carry && <Icon name="ban" size={16} style={{ position: 'absolute', right: 6, bottom: 6, color: 'var(--bad)' }} />}
                </button>
              );
            })}
          </div>
          {dest && <p className="muted small">초록 숫자: {cityName(dest)}에 가서 팔면 1개당 남는 돈(연료비 빼기 전)</p>}
        </section>

        <section className="hold">
          <h3>
            <Icon name={UI_ICON.ship} size={18} /> {ship.name}의 짐칸 <span className="muted small">눌러서 팔기</span>
          </h3>
          <HoldSlots sim={sim} ship={ship} size={22} />
          <p className="muted small">
            남은 자리 {qty(free)} / {ship.capacity} {type.refrigerated && '· 냉장 칸'}
          </p>
          <div className="tiles">
            {hold.map((r) => {
              const ls = ship.cargo.filter((l) => l.goodId === r.g.id);
              const cost = ls.reduce((s, l) => s + l.unitCost * l.quantity, 0) / Math.max(1e-9, ls.reduce((s, l) => s + l.quantity, 0));
              const gain = r.sellUnit > 0 ? r.sellUnit - cost : null;
              const on = pick?.side === 'sell' && pick.goodId === r.g.id;
              const boughtHere = ls.every((l) => l.originCityId === here);
              return (
                <button
                  key={r.g.id}
                  className={['tile', `cat-${r.g.category}`, on ? 'on' : '', r.sellUnit <= 0 ? 'cant' : ''].join(' ')}
                  onClick={() => choose('sell', r)}
                  title={r.sellUnit <= 0 ? '이 항구에는 이 상품 시장이 없어요' : ''}
                >
                  <span className="tag count">{qty(r.have)}개</span>
                  <GoodIcon id={r.g.id} size={30} />
                  <span className="tile-name">{r.g.name}</span>
                  <span className="tile-price">{r.sellUnit > 0 ? won(r.sellUnit) : '못 팔아요'}</span>
                  {gain !== null && !boughtHere && (
                    <span className={gain > 0 ? 'badge up' : 'badge down'}>
                      {gain > 0 ? '+' : ''}
                      {won(gain)}
                    </span>
                  )}
                </button>
              );
            })}
            {hold.length === 0 && <p className="muted small empty">비어 있어요. 창고에서 상품을 눌러 실어 보세요.</p>}
          </div>
        </section>
      </div>

      {row && pick && (
        <div className={`port-action ${pick.side}`}>
          <GoodIcon id={row.g.id} size={32} />
          <div className="pa-main">
            <b>
              {row.g.name} {pick.side === 'buy' ? '싣기' : '내려서 팔기'}
            </b>
            {max >= 0.1 ? (
              <>
                <input
                  type="range"
                  min={0}
                  max={max}
                  step={max >= 10 ? 1 : 0.1}
                  value={n}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  aria-label="수량"
                />
                <span className="small">
                  <b>{qty(n)}개</b>
                  {quote && (
                    <>
                      {' '}
                      · {pick.side === 'buy' ? '내는 돈' : '받는 돈'} <b className="money">{won(quote.total)}</b>
                      {pick.side === 'sell' && avgCost > 0 && lots.some((l) => l.originCityId !== here) && (
                        <span className={quote.unitPrice - avgCost > 0 ? 'good' : 'bad'}>
                          {' '}
                          (산 값보다 {quote.unitPrice - avgCost > 0 ? '+' : ''}
                          {won((quote.unitPrice - avgCost) * n)})
                        </span>
                      )}
                    </>
                  )}
                </span>
              </>
            ) : (
              <span className="small bad">
                {pick.side === 'buy' ? (!row.carry ? '이 배에는 못 실어요.' : '돈이나 짐칸 자리가 모자라요.') : '이 항구에서는 팔 수 없어요.'}
              </span>
            )}
          </div>
          <div className="pa-buttons">
            <button
              className="btn primary"
              disabled={n <= 0 || (pick.side === 'sell' && row.sellUnit <= 0)}
              onClick={() => {
                const ok =
                  pick.side === 'buy'
                    ? run({ type: 'trade', shipId: ship.id, goodId: row.g.id, side: 'buy', quantity: n }, `${row.g.name} ${qty(n)}개를 실었어요.`)
                    : run({ type: 'trade', shipId: ship.id, goodId: row.g.id, side: 'sell', quantity: n }, `${row.g.name} ${qty(n)}개를 팔았어요.`);
                if (ok) setPick(null);
              }}
            >
              {pick.side === 'buy' ? '싣기' : '팔기'}
            </button>
            <button className="btn" onClick={() => setPick(null)}>
              그만
            </button>
          </div>
        </div>
      )}

      {flash && <p className={flash.ok ? 'flash ok' : 'flash'}>{flash.text}</p>}

      <footer className="port-go">
        <div className="go-dest">
          <span className="muted small">어디로 갈까요?</span>
          {dest ? (
            <span className="dest-chip">
              <Icon name="map-pin" size={16} /> {cityName(dest)}
              {voyage && (
                <span className="muted small">
                  {' '}
                  · {Math.max(1, Math.round(voyage.months * 30))}일 · 연료 {won(voyage.fuel)}
                </span>
              )}
              <button className="x" onClick={() => props.onDest(null)} aria-label="목적지 지우기">
                ×
              </button>
            </span>
          ) : (
            <span className="muted">아직 안 골랐어요</span>
          )}
          <button className="btn small" onClick={props.onPickOnMap}>
            <Icon name="world" size={16} /> 지도에서 고르기
          </button>
        </div>
        {ideas.length > 0 && (
          <div className="go-ideas">
            <span className="muted small">
              <Icon name="bulb" size={15} /> 힌트
            </span>
            {ideas.map((i) => (
              <button
                key={i.to + i.goodId}
                className={dest === i.to ? 'idea on' : 'idea'}
                onClick={() => {
                  props.onDest(i.to);
                  const r = rows.find((x) => x.g.id === i.goodId);
                  if (r) choose('buy', r);
                }}
                title={fixJosa(i.reason)}
              >
                <GoodIcon id={i.goodId} size={18} />
                <Icon name="arrow-right" size={14} />
                {ctx.cityNames[i.to]}
                <span className="money"> +{won(i.profit)}</span>
              </button>
            ))}
          </div>
        )}
        <button
          className="btn primary go"
          disabled={!dest || (voyage !== null && state.player.cash < voyage.fuel)}
          onClick={() => {
            if (!dest) return;
            if (!canEnter(ctx, state, type.id, dest)) {
              setFlash({ text: `${cityName(dest)} 항구는 이 배가 들어가기엔 작아요.`, ok: false });
              return;
            }
            if (run({ type: 'sail', shipId: ship.id, to: dest }, `${cityName(dest)}(으)로 출발!`)) {
              if (!sim.playing) sim.setPlaying(true);
              props.onClose();
            }
          }}
        >
          <Icon name="sailboat" size={20} />{' '}
          {!dest ? '목적지를 골라 주세요' : voyage && state.player.cash < voyage.fuel ? '연료비가 모자라요' : fixJosa(`${cityName(dest)}(으)로 출발!`)}
        </button>
      </footer>
    </div>
  );
}

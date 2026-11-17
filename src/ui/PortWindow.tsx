import { useEffect, useMemo, useState } from 'react';
import { fixJosa } from '../sim/core/korean';
import { suggestTrips } from '../sim/economy/advice';
import { quoteBuy, quoteSell } from '../sim/economy/market';
import { canEnter, cargoVolume, estimateVoyage, isDocked, shipType } from '../sim/economy/player';
import { explainDestination, explainSource, REASON_NAMES } from '../sim/classroom/reasons';
import type { ChronicleEntry, Command, Ship, TradeReason } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { HoldSlots } from './Dock';
import { GoodIcon, Icon, ReasonIcon, UI_ICON } from './icons';
import { qty, tradeRows, tradeSlider, voyageTo, won, type TradeRow } from './tradeModel';
import type { Simulation } from './useSimulation';

type Pick = { side: 'buy' | 'sell'; goodId: string } | null;

/** 값 꼬리표: 세계 평균과 비교 */
function priceTag(r: TradeRow): { text: string; cls: string } | null {
  if (r.priceVsWorld < 0.8) return { text: '싸요', cls: 'tag cheap' };
  if (r.priceVsWorld > 1.25) return { text: '비싸요', cls: 'tag dear' };
  return null;
}

/** "왜?" 한 줄: 이유 분류 아이콘 + 짧은 이름 + 설명 */
function Why({ reason, label }: { reason: TradeReason; label: string }) {
  return (
    <span className={`why-line why-${reason.category}`}>
      <span className="why-chip">
        <ReasonIcon category={reason.category} size={15} /> {REASON_NAMES[reason.category]}
      </span>
      <span>
        <b>{label}</b> {fixJosa(reason.text)}
      </span>
    </span>
  );
}

/** 팔고 난 뒤 보여 주는 항해 결과: 산 값 → 판 값, 남은 돈, 그리고 왜 */
function TripResult(props: { sim: Simulation; entry: ChronicleEntry; fuel: number; holdEmpty: boolean; onClose: () => void }) {
  const { sim, entry, fuel, holdEmpty } = props;
  const g = sim.ctx.goodById[entry.goodId];
  const name = (id: string) => sim.ctx.cityNames[id] ?? id;
  const income = entry.revenue - entry.tariff;
  const top = Math.max(entry.cost, income, 1);
  const net = entry.profit - (holdEmpty ? fuel : 0);
  return (
    <div className="trip-result" role="dialog" aria-label="거래 결과">
      <header>
        <GoodIcon id={entry.goodId} size={30} />
        <div>
          <b>
            {g.name} {Math.round(entry.quantity).toLocaleString('ko-KR')}개
          </b>
          <span className="muted small">
            {' '}
            {name(entry.fromCityId)} <Icon name="arrow-right" size={13} /> {name(entry.toCityId)}
          </span>
        </div>
        <span className={entry.profit >= 0 ? 'big-profit up' : 'big-profit down'}>
          {entry.profit >= 0 ? '+' : ''}
          {won(entry.profit)}
        </span>
      </header>
      <div className="tr-bars">
        <span className="tr-label">산 값</span>
        <span className="tr-bar cost" style={{ width: `${(entry.cost / top) * 100}%` }} />
        <span className="tr-num">{won(entry.cost)}</span>
        <span className="tr-label">판 값</span>
        <span className="tr-bar income" style={{ width: `${(income / top) * 100}%` }} />
        <span className="tr-num">
          {won(income)}
          {entry.tariff > 0.5 && <span className="muted small"> (관세 {won(entry.tariff)} 냄)</span>}
        </span>
      </div>
      <p className="small">
        {holdEmpty ? (
          <>
            이번 항해 연료비 약 {won(fuel)}까지 빼면{' '}
            <b className={net >= 0 ? 'good' : 'bad'}>
              {net >= 0 ? '+' : ''}
              {won(net)}
            </b>{' '}
            남았어요.
          </>
        ) : (
          <span className="muted">짐을 다 팔고 나면 연료비(약 {won(fuel)})까지 빼서 따져 봐요.</span>
        )}
      </p>
      <div className="tr-why">
        <Why reason={entry.sourceReason} label={`${name(entry.fromCityId)}에서 쌌던 까닭:`} />
        <Why reason={entry.destReason} label={`${name(entry.toCityId)}에서 비쌌던 까닭:`} />
        {entry.policyReason && <Why reason={entry.policyReason} label="관세:" />}
      </div>
      <button className="btn primary" onClick={props.onClose}>
        좋아요
      </button>
    </div>
  );
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
  const [result, setResult] = useState<{ entry: ChronicleEntry; fuel: number; holdEmpty: boolean } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    setPick(null);
    setResult(null);
  }, [ship.id, here]);

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
  // 수량 막대는 늘 1개씩 움직인다. 살 때는 온전한 개수만, 팔 때는 막대 끝 칸이 "실은 것 전부"다
  // (상한 짐은 39.4개처럼 소수로 남는데, 1개씩 움직이는 막대로는 39까지만 갈 수 있어 찌꺼기가 남던 문제)
  const slider = row && pick ? tradeSlider(pick.side, row.buyable, row.have) : null;
  const max = slider?.max ?? 0;
  const n = slider ? slider.quantity(amount) : 0;
  const all = !!row && pick?.side === 'sell' && n >= row.have - 1e-9;
  const quote = !row || n <= 0 ? null : pick!.side === 'buy' ? quoteBuy(ctx, state.cities[here], row.g.id, n) : quoteSell(ctx, state.cities[here], row.g.id, n);
  const lots = row ? ship.cargo.filter((l) => l.goodId === row.g.id) : [];
  const avgCost = lots.length ? lots.reduce((s, l) => s + l.unitCost * l.quantity, 0) / lots.reduce((s, l) => s + l.quantity, 0) : 0;

  const choose = (side: 'buy' | 'sell', r: TradeRow) => {
    setPick({ side, goodId: r.g.id });
    props.onLens?.(r.g.id);
    setAmount(tradeSlider(side, r.buyable, r.have).max);
  };

  // 창고에 보일 상품: 이 항구에서 살 수 있는 것 먼저, 1개당 남는 돈 순
  const shelf = rows
    .filter((r) => state.cities[here].stock[r.g.id] >= 1)
    .sort((a, b) => (b.perUnit ?? -1e9) - (a.perUnit ?? -1e9) || a.g.name.localeCompare(b.g.name, 'ko'));
  const hold = rows.filter((r) => r.have > 0);

  // 첫 거래를 하기 전에는 "다음에 누를 곳"을 반짝여 알려 준다
  const sellable = hold.filter((r) => r.sellUnit > 0 && ship.cargo.some((l) => l.goodId === r.g.id && l.originCityId !== here));
  const coach: 'ideas' | 'shelf' | 'load' | 'go' | 'hold' | 'sell' | null =
    state.player.tradeCount > 0
      ? null
      : sellable.length > 0
        ? pick?.side === 'sell'
          ? 'sell'
          : 'hold'
        : hold.length === 0
          ? !dest
            ? 'ideas'
            : pick?.side === 'buy'
              ? 'load'
              : 'shelf'
          : dest
            ? 'go'
            : 'ideas';
  const coachTile = coach === 'shelf' ? shelf.find((r) => r.carry && r.buyable >= 1 && (r.perUnit ?? 0) > 0)?.g.id : coach === 'hold' ? sellable[0]?.g.id : undefined;

  // 고른 상품이 왜 싼지/비싼지
  let why: { reason: TradeReason; label: string } | null = null;
  if (row && pick) {
    if (pick.side === 'buy') {
      if (row.priceVsWorld < 0.8) why = { reason: explainSource(ctx, state, here, row.g.id), label: '왜 여기서 쌀까?' };
      else if (dest && (row.perUnit ?? 0) > 0) why = { reason: explainDestination(ctx, state, dest, row.g.id), label: `왜 ${cityName(dest)}에서 비쌀까?` };
    } else if (row.sellUnit > 0) {
      why = { reason: explainDestination(ctx, state, here, row.g.id, lots[0]?.brandCountryId), label: '왜 여기서 비쌀까?' };
    }
  }

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
                  className={['tile', `cat-${r.g.category}`, on ? 'on' : '', cant ? 'cant' : '', coachTile === r.g.id ? 'coach' : ''].join(' ')}
                  onClick={() => choose('buy', r)}
                  title={!r.carry ? '이 배에는 못 실어요' : r.buyable < 1 ? '돈이나 자리가 모자라요' : ''}
                >
                  {tag && <span className={tag.cls}>{tag.text}</span>}
                  {tag?.cls === 'tag cheap' && (
                    <span className="tile-why" title={fixJosa(explainSource(ctx, state, here, r.g.id).text)}>
                      <ReasonIcon category={explainSource(ctx, state, here, r.g.id).category} size={14} />
                    </span>
                  )}
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
                  className={['tile', `cat-${r.g.category}`, on ? 'on' : '', r.sellUnit <= 0 ? 'cant' : '', coachTile === r.g.id ? 'coach' : ''].join(' ')}
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
            {why && <Why reason={why.reason} label={why.label} />}
            {max >= 1 ? (
              <>
                <input
                  type="range"
                  min={0}
                  max={max}
                  step={1}
                  value={Math.min(amount, max)}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  aria-label="수량"
                />
                <span className="small">
                  <b>{all ? `전부 ${qty(n)}개` : `${qty(n)}개`}</b>
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
              className={coach === 'load' || coach === 'sell' ? 'btn primary coach' : 'btn primary'}
              disabled={n <= 0 || (pick.side === 'sell' && row.sellUnit <= 0)}
              onClick={() => {
                if (pick.side === 'buy') {
                  if (run({ type: 'trade', shipId: ship.id, goodId: row.g.id, side: 'buy', quantity: n }, `${row.g.name} ${qty(n)}개를 실었어요.`)) setPick(null);
                  return;
                }
                const before = state.player.chronicle.length;
                const r = sim.act({ type: 'trade', shipId: ship.id, goodId: row.g.id, side: 'sell', quantity: n });
                if (!r.ok) {
                  setFlash({ text: fixJosa(r.error ?? '팔 수 없어요.'), ok: false });
                  return;
                }
                setPick(null);
                // 방금 판 거래의 연대기 한 줄로 결과 카드를 띄운다(같은 항구에서 산 것을 되판 경우는 빼고)
                const chron = r.state?.player.chronicle ?? [];
                const entry = chron.length > 0 && chron.length >= before ? chron[chron.length - 1] : null;
                if (entry && entry.fromCityId !== entry.toCityId) {
                  const fuel = ship.typeId ? estimateVoyage(ctx, ship.typeId, entry.fromCityId, entry.toCityId).fuel : 0;
                  const left = (r.state?.ships.find((x) => x.id === ship.id)?.cargo.length ?? 1) === 0;
                  setResult({ entry, fuel, holdEmpty: left });
                } else {
                  setFlash({ text: fixJosa(`${row.g.name} ${qty(n)}개를 팔았어요.`), ok: true });
                }
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
      {result && <TripResult sim={sim} entry={result.entry} fuel={result.fuel} holdEmpty={result.holdEmpty} onClose={() => setResult(null)} />}

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
          <div className={coach === 'ideas' ? 'go-ideas coach-zone' : 'go-ideas'}>
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
          className={coach === 'go' ? 'btn primary go coach' : 'btn primary go'}
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

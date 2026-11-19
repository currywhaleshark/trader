import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fixJosa } from '../sim/core/korean';
import { cargoVolume, PLAYER_ID, SHIP_NAME_MAX, shipType } from '../sim/economy/player';
import type { Ship, ShipRecord } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { HoldSlots } from './Dock';
import { Icon } from './icons';
import { shipStatus } from './shipStatus';
import { ShipPic } from './ShipPic';
import { won } from './tradeModel';
import type { Simulation } from './useSimulation';

const PORT_SIZE = ['', '모든', '중간 이상', '큰'];

/** 화면에서 읽기만 한다(이력이 없는 예전 저장의 배는 플레이어가 시작한 달부터로 본다) */
function shipRecord(ship: Ship, startMonth: number): ShipRecord {
  return ship.record ?? { since: startMonth, distanceKm: 0, voyages: 0, sales: 0, purchases: 0, fuel: 0, fees: 0, upkeep: 0 };
}

/** 선령: 산 뒤 지난 달 수를 "n년 m개월"로 */
function ageText(months: number): string {
  const m = Math.max(0, Math.floor(months));
  if (m < 1) return '새 배(이번 달)';
  const y = Math.floor(m / 12);
  const r = m % 12;
  return [y > 0 ? `${y}년` : '', r > 0 ? `${r}개월` : ''].filter(Boolean).join(' ');
}

/** 이 배로 오간 돈의 합: 판 돈 − 산 돈 − 연료 − 항만·관세·통과료 − 유지비 */
function shipNet(ship: Ship, startMonth: number): number {
  const r = shipRecord(ship, startMonth);
  return r.sales - r.purchases - r.fuel - r.fees - r.upkeep;
}

/** 배 모델을 크게 보는 창 */
function ShipViewer({ sim, ship, onClose }: { sim: Simulation; ship: Ship; onClose: () => void }) {
  const t = shipType(sim.ctx, ship.typeId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="ship-viewer" role="dialog" aria-label={`${ship.name} 크게 보기`} onClick={onClose}>
      <div className="ship-viewer-box" onClick={(e) => e.stopPropagation()}>
        <header className="planner-head">
          <h2>{ship.name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className="ship-viewer-pic">
          <ShipPic typeId={ship.typeId} width={720} title={t.name} />
        </div>
        <p>
          <b>{t.name}</b> · {t.blurb}
        </p>
        <p className="muted small">
          싣는 양 {t.capacity} · 한 달 {won(t.speedKmPerMonth)}km · 연료 1000km당 {won(t.fuelPer1000Km)} · 유지비 {won(t.upkeepPerMonth)}/달 · {PORT_SIZE[t.size]} 항구
          {t.refrigerated ? ' · 냉장 화물칸' : ''}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** 배 한 척의 현황 카드: 모델·이름 바꾸기·상태·제원·이력·이 배로 오간 돈 */
function ShipCard({ sim, world, ship, onView, setFlash }: { sim: Simulation; world: World; ship: Ship; onView: () => void; setFlash: (m: string | null, ok?: boolean) => void }) {
  const { ctx, state } = sim;
  const t = shipType(ctx, ship.typeId);
  const rec = shipRecord(ship, state.player.startMonth);
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const st = shipStatus(sim, ship, name);
  const route = state.player.routes.find((r) => r.id === ship.routeId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ship.name ?? '');
  const used = cargoVolume(ctx, ship);
  const cargoCost = ship.cargo.reduce((s, l) => s + l.unitCost * l.quantity, 0);
  const net = shipNet(ship, state.player.startMonth);
  const save = () => {
    const r = sim.act({ type: 'renameShip', shipId: ship.id, name: draft });
    if (r.ok) {
      setEditing(false);
      setFlash(fixJosa(`배 이름을 ${draft.replace(/\s+/g, ' ').trim()}(으)로 바꿨어요.`), true);
    } else setFlash(r.error ?? '바꿀 수 없어요.', false);
  };
  return (
    <div className="fleet-card">
      <button className="fleet-pic" onClick={onView} title="크게 보기" aria-label={`${ship.name} 크게 보기`}>
        <ShipPic typeId={ship.typeId} width={220} title={t.name} />
        <span className="fleet-zoom">
          <Icon name="zoom-in" size={16} /> 크게 보기
        </span>
      </button>
      <div className="fleet-name">
        {editing ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={SHIP_NAME_MAX}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                  setDraft(ship.name ?? '');
                }
              }}
              aria-label="새 배 이름"
            />
            <button className="btn small primary" type="submit">
              저장
            </button>
            <button
              className="btn small"
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(ship.name ?? '');
              }}
            >
              취소
            </button>
          </form>
        ) : (
          <>
            <b>{ship.name}</b>
            <button
              className="btn small"
              onClick={() => {
                setDraft(ship.name ?? '');
                setEditing(true);
              }}
            >
              <Icon name="pencil" size={15} /> 이름 바꾸기
            </button>
          </>
        )}
      </div>
      <span className="muted small">
        {t.name} · {route ? `정기 항로 「${route.name}」` : '직접 운항'}
      </span>
      <span className={`ship-state ${st.kind}`}>{fixJosa(st.text)}</span>

      <div className="fleet-hold">
        <HoldSlots sim={sim} ship={ship} size={16} />
        <span className="small muted">
          짐칸 {Math.round((used / ship.capacity) * 100)}% ({Math.round(used)} / {ship.capacity})
        </span>
      </div>

      <dl className="fleet-facts">
        <dt>선령</dt>
        <dd>{ageText(state.month - rec.since)}</dd>
        <dt>항해 거리</dt>
        <dd>{won(rec.distanceKm)}km</dd>
        <dt>항해 횟수</dt>
        <dd>{rec.voyages}번</dd>
        <dt>빠르기</dt>
        <dd>한 달 {won(t.speedKmPerMonth)}km</dd>
        <dt>연료</dt>
        <dd>1000km당 {won(t.fuelPer1000Km)}</dd>
        <dt>유지비</dt>
        <dd>{won(t.upkeepPerMonth)}/달</dd>
        <dt>들어가는 항구</dt>
        <dd>{PORT_SIZE[t.size]} 항구</dd>
        <dt>지금 팔면</dt>
        <dd>{won(t.price * t.resaleShare)}</dd>
      </dl>

      <dl className="fleet-money">
        <dt>판 돈</dt>
        <dd className="good">+{won(rec.sales)}</dd>
        <dt>산 돈</dt>
        <dd>−{won(rec.purchases)}</dd>
        <dt>연료</dt>
        <dd>−{won(rec.fuel)}</dd>
        <dt>항만·관세·통과료</dt>
        <dd>−{won(rec.fees)}</dd>
        <dt>유지비</dt>
        <dd>−{won(rec.upkeep)}</dd>
        <dt>
          <b>이 배로 남긴 돈</b>
        </dt>
        <dd className={net >= 0 ? 'good' : 'high'}>
          <b>
            {net >= 0 ? '+' : '−'}
            {won(Math.abs(net))}
          </b>
        </dd>
      </dl>
      {cargoCost > 0 && <span className="muted small">지금 실은 짐을 산 값 {won(cargoCost)}은 팔 때 돌아와요.</span>}
    </div>
  );
}

/** 우리 회사 창의 「배 현황」 탭 */
export function FleetTab({ sim, world, setFlash }: { sim: Simulation; world: World; setFlash: (m: string | null, ok?: boolean) => void }) {
  const { ctx, state } = sim;
  const ships = state.ships.filter((s) => s.companyId === PLAYER_ID);
  const [viewing, setViewing] = useState<string | null>(null);
  const upkeep = ships.reduce((s, x) => s + shipType(ctx, x.typeId).upkeepPerMonth, 0);
  const distance = ships.reduce((s, x) => s + shipRecord(x, state.player.startMonth).distanceKm, 0);
  const shown = ships.find((s) => s.id === viewing);
  return (
    <>
      <div className="stat-row fleet-summary">
        <span>
          <Icon name="ship" size={16} /> 배 <b>{ships.length}척</b>
        </span>
        <span>
          <Icon name="tool" size={16} /> 유지비 합계 <b>{won(upkeep)}/달</b>
        </span>
        <span>
          <Icon name="route" size={16} /> 모두 합한 항해 거리 <b>{won(distance)}km</b>
        </span>
      </div>
      {ships.length === 0 && <p className="muted">배가 없어요. 「배 사기」에서 배를 사 주세요.</p>}
      <div className="fleet-grid">
        {ships.map((s) => (
          <ShipCard key={s.id} sim={sim} world={world} ship={s} onView={() => setViewing(s.id)} setFlash={setFlash} />
        ))}
      </div>
      {shown && <ShipViewer sim={sim} ship={shown} onClose={() => setViewing(null)} />}
    </>
  );
}

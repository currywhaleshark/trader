import { useEffect, useState } from 'react';
import { cargoVolume, isDocked, PLAYER_ID, shipType } from '../sim/economy/player';
import type { Ship } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { GoodIcon, Icon, UI_ICON } from './icons';
import { won } from './tradeModel';
import type { Simulation } from './useSimulation';
import { shipStatus } from './shipStatus';
import { ShipPic } from './ShipPic';
import { CompanyLogo } from './CompanyLogo';

/** 짐칸 칸 수(배 크기와 상관없이 같은 칸 수로 "얼마나 찼나"를 보여 준다) */
export const SLOTS = 6;

/** 짐칸 칸마다 들어 있는 상품(빈 칸은 null). 반쯤 찬 칸은 part < 1 */
export function holdSlots(sim: Simulation, ship: Ship): { goodId: string | null; part: number }[] {
  const per = ship.capacity / SLOTS;
  const out: { goodId: string | null; part: number }[] = [];
  // 같은 상품끼리 모아 부피 순으로
  const vol = new Map<string, number>();
  for (const l of ship.cargo) vol.set(l.goodId, (vol.get(l.goodId) ?? 0) + l.quantity * sim.ctx.goodById[l.goodId].volume);
  const lots = [...vol.entries()].sort((a, b) => b[1] - a[1]);
  let k = 0;
  let left = lots[0]?.[1] ?? 0;
  for (let s = 0; s < SLOTS; s++) {
    let room = per;
    let main: string | null = null;
    let mainVol = 0;
    while (room > 1e-6 && k < lots.length) {
      const take = Math.min(room, left);
      if (take > mainVol) {
        mainVol = take;
        main = lots[k][0];
      }
      room -= take;
      left -= take;
      if (left <= 1e-6) {
        k++;
        left = lots[k]?.[1] ?? 0;
      }
    }
    out.push({ goodId: main, part: main ? Math.min(1, (per - room) / per) : 0 });
  }
  return out;
}

export function HoldSlots({ sim, ship, size = 18 }: { sim: Simulation; ship: Ship; size?: number }) {
  return (
    <span className="slots" aria-label={`짐칸 ${Math.round((cargoVolume(sim.ctx, ship) / ship.capacity) * 100)}% 참`}>
      {holdSlots(sim, ship).map((s, i) => (
        <span key={i} className={s.goodId ? (s.part < 0.99 ? 'slot part' : 'slot full') : 'slot'}>
          {s.goodId && <GoodIcon id={s.goodId} size={size} />}
        </span>
      ))}
    </span>
  );
}

/** 화면 아래 "내 배" 줄: 배마다 카드 하나. 정박한 배를 누르면 항구 창이 열린다. */
export function Dock(props: {
  sim: Simulation;
  world: World;
  selectedShipId: string | null;
  /** 첫 거래 전: 「항구 열기」를 반짝여 알려 준다 */
  coach?: boolean;
  /** 튜토리얼: 회사 창(돈 칸)을 반짝인다 */
  coachCompany?: boolean;
  onOpen: (shipId: string) => void;
  /** 현금 칸을 누르면 회사 창 */
  onCompany?: () => void;
}) {
  const { sim, world } = props;
  // 달이 바뀌기 전에도 항해 막대가 움직이게 가끔 다시 그린다
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!sim.playing) return;
    const t = setInterval(() => setTick((v) => v + 1), 400);
    return () => clearInterval(t);
  }, [sim.playing]);
  const ships = sim.state.ships.filter((s) => s.companyId === PLAYER_ID);
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const now = sim.now();
  return (
    <div className="dock" role="toolbar" aria-label="내 배">
      <button className={props.coachCompany ? 'dock-cash coach' : 'dock-cash'} title="우리 회사: 결과·배 사기·정기 항로" onClick={props.onCompany}>
        <CompanyLogo id={sim.settings.companyLogo} />
        <b>{won(sim.state.player.cash)}</b>
        <span className="small muted dock-name">{sim.state.player.name}</span>
      </button>
      {ships.map((s) => {
        const docked = isDocked(s);
        const sailing = s.from !== s.to;
        const progress = sailing ? Math.min(1, Math.max(0, (now - s.departedAt) / Math.max(0.01, s.arrivesAt - s.departedAt))) : 0;
        const days = sailing ? Math.max(0, Math.round((s.arrivesAt - now) * 30)) : 0;
        const st = shipStatus(sim, s, name);
        const cls = ['dock-ship', s.id === props.selectedShipId ? 'on' : '', docked ? 'docked' : ''].join(' ');
        return (
          <button key={s.id} className={cls} onClick={() => props.onOpen(s.id)}>
            <span className="dock-top">
              <ShipPic typeId={s.typeId} width={52} />
              <b title={shipType(sim.ctx, s.typeId).name}>{s.name}</b>
            </span>
            {sailing ? (
              <span className="dock-where">
                <Icon name="arrow-right" size={15} /> {name(s.to)} · {days < 1 ? '곧 도착' : `${days}일`}
                <span className="fill">
                  <i style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
              </span>
            ) : (
              <span className="dock-where" title={st.detail || undefined}>
                <Icon name={UI_ICON.port} size={15} /> {name(s.to)}
                {docked ? (
                  <span className={props.coach ? 'dock-go coach' : 'dock-go'}>항구 열기</span>
                ) : (
                  <span className={`ship-state ${st.kind}`}>{st.short}</span>
                )}
              </span>
            )}
            <HoldSlots sim={sim} ship={s} />
          </button>
        );
      })}
      {ships.length === 0 && <span className="muted small">배가 없어요. 「결과·회사」에서 배를 사 주세요.</span>}
    </div>
  );
}

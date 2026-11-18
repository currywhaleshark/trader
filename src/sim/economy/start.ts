import { scenarioById, startScenario } from '../classroom/scenarios';
import { applySettings, type GameSettings } from '../classroom/settings';
import type { World } from '../world/types';
import type { EconomyData } from './data';
import { createPlayer, emptyLedger, PLAYER_ID } from './player';
import { createEconomy } from './setup';
import { stepMonth } from './step';
import type { EconomyContext, EconomyState } from './types';

/**
 * 게임 시작용 경제: 세계 경제를 warmupMonths 동안 먼저 돌려 도시마다 값과 재고가 달라진 뒤,
 * 플레이어 회사를 새로 세운다. (모든 도시가 기준가인 0개월째에는 남는 거래가 없기 때문)
 * 달력은 data.startYear + warmup 기간부터 시작한다.
 */
export function createGame(
  world: World,
  data: EconomyData,
  seed: string,
  settings?: GameSettings,
): { ctx: EconomyContext; state: EconomyState } {
  const { ctx, state: s0 } = createEconomy(world, settings ? applySettings(data, settings) : data, seed);
  let state = s0;
  for (let m = 0; m < data.warmupMonths; m++) state = stepMonth(ctx, state).state;
  const fresh = createPlayer(ctx);
  state.player = { ...fresh.player, ledger: [emptyLedger(state.month)], startMonth: state.month };
  state.ships = [
    ...state.ships.filter((s) => s.companyId !== PLAYER_ID),
    { ...fresh.ship, departedAt: state.month, arrivesAt: state.month, record: { ...fresh.ship.record!, since: state.month } },
  ];
  if (settings && scenarioById(settings.scenarioId)) startScenario(state, settings.scenarioId, settings.disabledTriggers);
  return { ctx, state };
}

export { PLAYER_ID };

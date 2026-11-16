/**
 * 수업 시나리오를 자동 플레이어로 끝까지 돌리고 리포트를 출력한다(교사 미리보기·밸런싱용).
 *   npm run lesson -- --scenario first-trade [--seed abc]
 */
import { buildReport, reportToText } from '../src/sim/classroom/report';
import { scenarioById, SCENARIOS } from '../src/sim/classroom/scenarios';
import { DEFAULT_SETTINGS } from '../src/sim/classroom/settings';
import { botCommands, botFleet, botVoyages } from '../src/sim/economy/bot';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { applyCommand } from '../src/sim/economy/player';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import { makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const k = args.indexOf(name);
  return k >= 0 ? args[k + 1] : fallback;
};
const scenarioId = value('--scenario', 'first-trade');
const def = scenarioById(scenarioId);
if (!def) throw new Error(`시나리오 없음: ${scenarioId} (있는 것: ${SCENARIOS.map((s) => s.id).join(', ')})`);
const settings = { ...DEFAULT_SETTINGS, ...def.settings, scenarioId, seed: value('--seed', DEFAULT_SETTINGS.seed) };

const { world } = generateWorld(makeConfig({ seed: settings.seed }));
let { ctx, state } = createGame(world, DEFAULT_ECONOMY, settings.seed, settings);
const opt = { buyShips: ['small', 'medium'], keepCashPerShip: 25000 };
const started = Date.now();
for (let m = 0; m < def.months; m++) {
  state = structuredClone(state);
  for (const phase of [botCommands, botFleet, botVoyages]) for (const cmd of phase(ctx, state, opt)) applyCommand(ctx, state, cmd);
  const r = stepMonth(ctx, state);
  state = r.state;
  for (const e of r.events) {
    if (e.type === 'scenario') console.log(`[${ctx.data.startYear + Math.floor(state.month / 12)}.${(state.month % 12) + 1}] ${e.kind}: ${e.text}`);
  }
}
console.log(`\n(${def.months}개월, ${Date.now() - started}ms)\n`);
console.log(reportToText(buildReport(ctx, state)));

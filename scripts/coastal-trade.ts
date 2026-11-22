/** Small-ship starter trade audit, including actual arrival sales and monthly upkeep. */
import { readFileSync } from 'node:fs';
import { suggestTrips } from '../src/sim/economy/advice';
import { applyCommand, cargoOf, estimateVoyage, isDocked, PLAYER_ID } from '../src/sim/economy/player';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import { economyDataFor } from '../src/sim/modes';
import { unpackWorld } from '../src/sim/world/serialize';
import { EARTH_START_PORT_IDS } from '../src/sim/earth/definitions';
import { DEFAULT_SETTINGS } from '../src/sim/classroom/settings';

const meta = JSON.parse(readFileSync('public/world/earth/earth.json', 'utf8'));
const bin = readFileSync('public/world/earth/earth.bin');
const world = unpackWorld(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['earth-1'];
for (const seed of seeds) {
  const game = createGame(world, economyDataFor('earth'), seed, { ...DEFAULT_SETTINGS, mode: 'earth', seed, scenarioId: 'earth-free' });
  for (const port of EARTH_START_PORT_IDS) {
    let state = structuredClone(game.state);
    const ctx = game.ctx;
    let ship = state.ships.find((s) => s.companyId === PLAYER_ID)!;
    ship.from = ship.to = port;
    const initial = state.player.cash;
    const trips = [];
    for (let k = 0; k < 12 && trips.filter((t) => 'actual' in t).length < 6; k++) {
      const ideas = suggestTrips(ctx, state, ship, ctx.portIds.length).filter((i) => estimateVoyage(ctx, ship.typeId!, ship.to, i.to, state).distanceKm <= 3500);
      const idea = ideas[0];
      if (!idea) {
        trips.push({ from: ship.to, wait: true });
        state = stepMonth(ctx, state).state;
        ship = state.ships.find((s) => s.companyId === PLAYER_ID)!;
        continue;
      }
      const from = ship.to;
      const before = state.player.cash;
      for (const cmd of [
        { type: 'trade' as const, shipId: ship.id, goodId: idea.goodId, side: 'buy' as const, quantity: idea.quantity },
        { type: 'sail' as const, shipId: ship.id, to: idea.to },
      ]) {
        const result = applyCommand(ctx, state, cmd);
        if (!result.ok) throw new Error(result.error);
      }
      for (let m = 0; m < 24 && !isDocked(ship); m++) {
        state = stepMonth(ctx, state).state;
        ship = state.ships.find((s) => s.companyId === PLAYER_ID)!;
      }
      const sale = applyCommand(ctx, state, { type: 'trade', shipId: ship.id, goodId: idea.goodId, side: 'sell', quantity: cargoOf(ship, idea.goodId) });
      if (!sale.ok) throw new Error(sale.error);
      trips.push({ from, to: idea.to, good: idea.goodId, expected: Math.round(idea.profit), actual: Math.round(state.player.cash - before) });
    }
    console.log(JSON.stringify({ seed, port, profit: Math.round(state.player.cash - initial), trips }));
  }
}

/**
 * 저장 파일을 불러와 몇 달 더 돌려 본다(버그 재현용).
 *   npx tsx scripts/replay-save.ts <저장파일.json> [개월=24]
 * 플레이어 배의 도착·거래·알림과 달마다 연료·매매를 찍는다.
 */
import fs from 'node:fs';
import { applySettings } from '../src/sim/classroom/settings';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import { makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

const file = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const months = Number(process.argv[3] ?? 24);
const { world } = generateWorld(makeConfig({ seed: file.settings.seed }));
const eco = createGame(world, applySettings(DEFAULT_ECONOMY, file.settings), file.settings.seed);
let s = file.state;
const startFuel = s.player.lifetime.fuel;
const startCash = s.player.cash;
for (let m = 0; m < months; m++) {
  const out = stepMonth(eco.ctx, s);
  s = out.state;
  const l = s.player.ledger[s.player.ledger.length - 1];
  const lines = out.events
    .filter((e) => 'shipId' in e && e.shipId?.startsWith('p'))
    .map((e) => (e.type === 'trade' ? `${e.side} ${e.goodId} ${e.quantity.toFixed(1)}` : e.type === 'arrival' ? `도착 ${e.cityId}` : e.type === 'notice' ? `알림: ${e.text.slice(0, 70)}` : e.type));
  console.log(`${s.month} 연료 ${Math.round(l?.fuel ?? 0)} 판매 ${Math.round(l?.sales ?? 0)} 구매 ${Math.round(l?.purchases ?? 0)} | ${lines.join(' / ')}`);
}
const p1 = s.ships.find((x: { id: string }) => x.id === 'p1');
console.log(`\n${months}개월: 연료 ${Math.round(s.player.lifetime.fuel - startFuel)} · 현금 변화 ${Math.round(s.player.cash - startCash)} · 짐 ${JSON.stringify(p1?.cargo.map((c: { goodId: string; quantity: number }) => `${c.goodId}:${c.quantity.toFixed(2)}`))} · 기다림 ${p1?.routeWaiting}`);

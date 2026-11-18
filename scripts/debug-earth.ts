/** 현실 지구 진단(개발용): 통과 지점 양 끝의 바다 구역과 몇몇 항로의 경유지를 보여 준다. */
import { latToY, lonToX } from '../src/sim/core/grid';
import { labelComponents } from '../src/sim/core/gridSearch';
import { buildEarth } from '../src/sim/earth/buildEarth';
import { findSeaRoute, navGridOf } from '../src/sim/world/seaRoutes';
import { loadEarthSources } from './earthSources';

const { world } = buildEarth(loadEarthSources());
const g = world.grid;
const nav = navGridOf(world);
const { labels, sizes } = labelComponents(g, nav.mask, 4);
const at = (lat: number, lon: number) => latToY(g, lat) * g.width + lonToX(g, lon);
const show = (name: string, lat: number, lon: number) => {
  const c = at(lat, lon);
  console.log(`${name} (${lat},${lon}) zone=${world.layers.seaZone[c]} comp=${labels[c]} size=${sizes[labels[c]] ?? '-'}`);
};
for (const p of world.chokepoints) {
  const a = p.path![0];
  const b = p.path![p.path!.length - 1];
  show(`${p.id}.a`, a[0], a[1]);
  show(`${p.id}.b`, b[0], b[1]);
}
show('red sea mid', 20, 38.5);
for (const [la, lo] of [[14.25,42.25],[14.75,41.75],[14.25,41.75],[13.75,42.25],[15.25,41.25],[-33.75,-72.25],[-33.75,-72.75],[-33.25,-72.25]]) show('cand', la, lo);
show('med mid', 34, 20);
show('gulf of aden', 12.5, 48);
const args = process.argv.slice(2);
for (let k = 0; k + 1 < args.length; k += 2) {
  const A = world.cities.find((c) => c.id === args[k])!;
  const B = world.cities.find((c) => c.id === args[k + 1])!;
  const r = findSeaRoute(nav, A.seaCell, B.seaCell);
  console.log(`${A.id}->${B.id}: ${r ? Math.round(r.distanceKm) : '-'}km gates=${r?.gates.map((i) => world.chokepoints[i].id).join(',')}`);
}

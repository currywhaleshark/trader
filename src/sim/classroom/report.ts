import { fixJosa } from '../core/korean';
import { netProfit, PLAYER_ID } from '../economy/player';
import type { ChronicleEntry, EconomyContext, EconomyState, YearRecord } from '../economy/types';
import { REASON_NAMES, type ReasonCategory } from './reasons';
import { goalProgress, isOnceGoal, scenarioById } from './scenarios';

/**
 * 수업 리포트(M5). 학생의 거래 연대기와 나라별 연간 기록만으로 만든다(순수 함수).
 * "얼마 벌었나"보다 "왜 무역이 생겼나", "나라들이 서로 무엇을 기대고 있나"를 앞에 둔다.
 */
export interface ClassReport {
  title: string;
  period: { from: string; to: string; months: number };
  scenario?: { title: string; goals: { text: string; done: boolean; when?: string; progress: string }[] };
  company: { cash: number; ships: number; trades: number; sales: number; profit: number; tariffs: number };
  routes: { text: string; count: number; quantity: number; profit: number }[];
  reasons: { category: ReasonCategory; name: string; count: number; examples: string[] }[];
  interdependence: string[];
  mutual: string[];
  myRole: string[];
  worldChanges: string[];
  questions: string[];
}

const won = (v: number) => Math.round(v).toLocaleString('ko-KR');

function dateOf(ctx: EconomyContext, month: number): string {
  return `${ctx.data.startYear + Math.floor(month / 12)}년 ${(month % 12) + 1}월`;
}

interface Dependence {
  country: string;
  goodId: string;
  /** 쓰는 양 가운데 외국산 비율 */
  foreignShare: number;
  /** 외국산 가운데 가장 큰 공급국과 그 비율 */
  source: string;
  sourceShare: number;
  value: number;
}

/** 기간 안의 연간 기록으로 나라별 수입 의존도를 구한다 */
function dependences(ctx: EconomyContext, years: YearRecord[]): Dependence[] {
  const out: Dependence[] = [];
  if (years.length === 0) return out;
  const countries = Object.keys(years[0].countries);
  for (const k of countries) {
    for (const g of ctx.goods) {
      let used = 0;
      const from: Record<string, number> = {};
      for (const y of years) {
        const c = y.countries[k];
        if (!c) continue;
        used += c.used?.[g.id] ?? 0;
        for (const [o, q] of Object.entries(c.importsByGood?.[g.id] ?? {})) if (o !== k) from[o] = (from[o] ?? 0) + q;
      }
      const foreign = Object.values(from).reduce((s, v) => s + v, 0);
      if (used <= 0 || foreign <= 0) continue;
      const [source, q] = Object.entries(from).sort((a, b) => b[1] - a[1])[0];
      out.push({
        country: k,
        goodId: g.id,
        foreignShare: Math.min(1, foreign / used),
        source,
        sourceShare: q / foreign,
        value: Math.min(foreign, used) * g.basePrice,
      });
    }
  }
  return out;
}

export function buildReport(ctx: EconomyContext, state: EconomyState): ClassReport {
  const p = state.player;
  const chron = p.chronicle;
  const cn = (k: string) => ctx.countryNames[k] ?? k;
  const city = (id: string) => ctx.cityNames[id] ?? id;
  const good = (id: string) => ctx.goodById[id]?.name ?? id;
  const startYear = ctx.data.startYear + Math.floor(p.startMonth / 12);
  const years = state.history.filter((h) => h.year >= startYear);

  // ---- 시나리오 목표
  let scenario: ClassReport['scenario'];
  const sc = state.scenario;
  const def = sc ? scenarioById(sc.id) : undefined;
  if (sc && def) {
    scenario = {
      title: def.title,
      goals: def.goals.map((g) => {
        const pr = goalProgress(ctx, state, g);
        const done = sc.goalsDone[g.id] !== undefined || pr.ratio >= 1;
        return {
          text: g.text,
          done,
          when: done ? dateOf(ctx, sc.goalsDone[g.id] ?? state.month) : undefined,
          progress: isOnceGoal(g.check) ? (done ? '완료' : '아직') : `${won(pr.value)} / ${won(pr.target)}`,
        };
      }),
    };
  }

  // ---- 항로
  const routeMap = new Map<string, { text: string; count: number; quantity: number; profit: number }>();
  for (const e of chron) {
    const key = `${e.goodId}|${e.fromCityId}|${e.toCityId}`;
    const r = routeMap.get(key) ?? { text: `${good(e.goodId)}: ${city(e.fromCityId)} → ${city(e.toCityId)}`, count: 0, quantity: 0, profit: 0 };
    r.count++;
    r.quantity += e.quantity;
    r.profit += e.profit;
    routeMap.set(key, r);
  }
  const routes = [...routeMap.values()].sort((a, b) => b.count - a.count || b.profit - a.profit).slice(0, 5);

  // ---- 무역이 생긴 이유
  // 연대기는 최근 것만 남지만, 이유별 통계는 처음부터 누적돼 있다
  const byCat = new Map<ReasonCategory, { count: number; examples: string[] }>();
  for (const [cat, r] of Object.entries(p.reasonStats ?? {})) byCat.set(cat as ReasonCategory, { count: r.count, examples: [...r.examples] });
  const reasons = [...byCat.entries()]
    .filter(([cat]) => cat !== 'market' || byCat.size === 1)
    .map(([category, r]) => ({ category, name: REASON_NAMES[category], count: r.count, examples: r.examples.map(fixJosa) }))
    .sort((a, b) => b.count - a.count);

  // ---- 상호 의존
  const deps = dependences(ctx, years.length > 0 ? years : state.history.slice(-1));
  const strong = deps.filter((d) => d.foreignShare >= 0.4 && d.sourceShare >= 0.4).sort((a, b) => b.value - a.value);
  const interdependence = strong.slice(0, 6).map((d) =>
    fixJosa(`${cn(d.country)}은(는) 쓰는 ${good(d.goodId)}의 ${Math.round(d.foreignShare * 100)}%를 다른 나라에서 사 와요. 그 가운데 ${Math.round(d.sourceShare * 100)}%가 ${cn(d.source)}산이에요.`),
  );
  const mutual: string[] = [];
  const seen = new Set<string>();
  for (const a of strong) {
    for (const b of strong) {
      if (a.country !== b.source || b.country !== a.source) continue;
      const key = [a.country, b.country].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      if (mutual.length >= 4) break;
      mutual.push(fixJosa(`${cn(a.country)}와(과) ${cn(b.country)}은(는) 서로가 필요해요: ${cn(a.country)}은(는) ${cn(a.source)}의 ${good(a.goodId)}을(를), ${cn(b.country)}은(는) ${cn(b.source)}의 ${good(b.goodId)}을(를) 사요.`));
    }
  }

  // ---- 내 역할
  const myRole: string[] = [];
  const shortageTrips = chron.filter((e) => e.destReason.category === 'shortage' || e.destReason.category === 'season');
  if (shortageTrips.length > 0) {
    const q = shortageTrips.reduce((s, e) => s + e.quantity, 0);
    myRole.push(fixJosa(`가뭄·흉작이나 수확철이 아니어서 모자란 도시에 ${won(q)}개를 실어 날랐어요(${shortageTrips.length}번).`));
  }
  const cross = chron.filter((e) => ctx.continentOfCity[e.fromCityId] !== ctx.continentOfCity[e.toCityId]);
  if (cross.length > 0) myRole.push(`두 대륙 사이를 ${cross.length}번 오가며 물건을 날랐어요.`);
  const destCountries = new Set(chron.map((e) => ctx.countryOfCity[e.toCityId]));
  if (destCountries.size > 0) myRole.push(fixJosa(`${[...destCountries].map(cn).join('·')}에 물건을 팔았어요.`));
  const losses = chron.filter((e) => e.profit < 0);
  if (losses.length > 0) {
    const worst = losses.reduce((a, b) => (b.profit < a.profit ? b : a));
    myRole.push(fixJosa(`가장 크게 밑진 거래: ${good(worst.goodId)}을(를) ${city(worst.fromCityId)}에서 ${city(worst.toCityId)}로 옮겨 ${won(-worst.profit)} 손해. 도착했을 때 값이 이미 내려가 있었을 수 있어요.`));
  }

  // ---- 세계의 변화
  const worldChanges: string[] = [];
  if (years.length >= 2) {
    const head = years[0];
    const tail = years[years.length - 1];
    for (const k of Object.keys(head.countries)) {
      for (const g of ctx.goods) {
        const a = head.countries[k].netTrade[g.id] ?? 0;
        const b = tail.countries[k]?.netTrade[g.id] ?? 0;
        const scale = Math.max(Math.abs(a), Math.abs(b));
        if (scale > 30 && Math.sign(a) !== Math.sign(b) && Math.min(Math.abs(a), Math.abs(b)) > scale * 0.15) {
          worldChanges.push(fixJosa(`${cn(k)}은(는) ${good(g.id)}을(를) ${a > 0 ? '팔던' : '사던'} 나라에서 ${b > 0 ? '파는' : '사는'} 나라로 바뀌었어요.`));
        }
      }
    }
  }
  for (const pol of state.policies) {
    if (pol.startMonth >= p.startMonth) worldChanges.push(fixJosa(`${dateOf(ctx, pol.startMonth)}: ${pol.title}`));
  }
  for (const w of state.cultureWaves) {
    if (w.startMonth >= p.startMonth) worldChanges.push(fixJosa(`${dateOf(ctx, w.startMonth)}: ${w.title}`));
  }

  // ---- 질문
  const questions = [
    '내가 가장 많이 한 거래는 어느 나라와 어느 나라 사이였나요? 두 나라는 무엇이 달랐나요?',
    '한 나라가 어떤 물건을 갑자기 팔지 않게 되면, 그 물건을 사던 나라에는 무슨 일이 생길까요?',
  ];
  const top = reasons[0]?.category;
  if (top === 'climate' || top === 'season') questions.push('기후나 계절이 같은 두 나라 사이에도 무역이 생길까요? 생긴다면 왜일까요?');
  else if (top === 'industry') questions.push('공장이 없는 나라가 공장을 지으면, 그 나라와 무역하던 나라에는 어떤 일이 생길까요?');
  else if (top === 'resource') questions.push('땅속 자원이 없는 나라는 어떻게 그 자원을 구할까요?');
  else questions.push('관세는 그 나라의 생산자·소비자·무역회사에게 각각 어떤 영향을 줄까요?');
  if (mutual.length === 0) questions.push('서로 꼭 필요한 물건을 사고파는 두 나라를 찾아볼 수 있나요?');

  const fleet = state.ships.filter((s) => s.companyId === PLAYER_ID).length;
  return {
    title: `${p.name}의 무역 리포트`,
    period: { from: dateOf(ctx, p.startMonth), to: dateOf(ctx, state.month), months: state.month - p.startMonth },
    scenario,
    company: {
      cash: p.cash,
      ships: fleet,
      trades: p.tradeCount,
      sales: p.lifetime.sales,
      profit: netProfit(p.lifetime),
      tariffs: p.lifetime.tariffs ?? 0,
    },
    routes,
    reasons,
    interdependence,
    mutual,
    myRole,
    worldChanges: worldChanges.slice(0, 12),
    questions,
  };
}

/** 인쇄·복사용 글 */
export function reportToText(r: ClassReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.title}`, `${r.period.from} ~ ${r.period.to} (${r.period.months}개월)`, '');
  if (r.scenario) {
    lines.push(`## 시나리오: ${r.scenario.title}`);
    for (const g of r.scenario.goals) lines.push(`- [${g.done ? 'x' : ' '}] ${g.text} (${g.done ? g.when : g.progress})`);
    lines.push('');
  }
  lines.push('## 회사', `현금 ${won(r.company.cash)} · 배 ${r.company.ships}척 · 거래 ${r.company.trades}번 · 순이익 ${won(r.company.profit)} · 낸 관세 ${won(r.company.tariffs)}`, '');
  if (r.routes.length) {
    lines.push('## 주로 다닌 항로');
    for (const x of r.routes) lines.push(`- ${x.text} — ${x.count}번, ${won(x.quantity)}개, 남은 돈 ${won(x.profit)}(연료·유지비 빼기 전)`);
    lines.push('');
  }
  lines.push('## 무역은 왜 생겼을까?');
  for (const x of r.reasons) {
    lines.push(`- ${x.name}: ${x.count}번`);
    for (const e of x.examples) lines.push(`  - ${e}`);
  }
  lines.push('', '## 나라들은 서로 기대고 있어요');
  for (const s of [...r.interdependence, ...r.mutual]) lines.push(`- ${s}`);
  lines.push('', '## 내가 한 일');
  for (const s of r.myRole) lines.push(`- ${s}`);
  if (r.worldChanges.length) {
    lines.push('', '## 그동안 세계는');
    for (const s of r.worldChanges) lines.push(`- ${s}`);
  }
  lines.push('', '## 생각해 볼 질문');
  r.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  return lines.join('\n');
}

export type { ChronicleEntry };

import { MONTH_COLORS, PRECIP_STOPS, SUIT_STOPS, TEMP_STOPS, type LayerId } from '../render/baseLayer';
import { CLIMATE_ZONES, type World } from '../sim/world/types';

type Stop = [number, number, number, number];

function Gradient({ stops, unit, labels }: { stops: Stop[]; unit: string; labels?: string[] }) {
  const min = stops[0][0];
  const max = stops[stops.length - 1][0];
  const css = stops
    .map((s) => `rgb(${s[1]},${s[2]},${s[3]}) ${(((s[0] - min) / (max - min)) * 100).toFixed(1)}%`)
    .join(', ');
  const ticks = labels ?? stops.filter((_, k) => k % 2 === 0 || k === stops.length - 1).map((s) => `${s[0]}${unit}`);
  return (
    <div className="legend-gradient">
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${css})` }} />
      <div className="legend-ticks">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function Chips({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="legend-chips">
      {items.map((it) => (
        <span key={it.label} className="chip">
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function Legend({ world, layer }: { world: World; layer: LayerId }) {
  switch (layer) {
    case 'terrain':
      return (
        <Chips
          items={[
            { color: '#3a803e', label: '숲·초지' },
            { color: '#d6be8a', label: '메마른 땅' },
            { color: '#96846f', label: '산지' },
            { color: '#f0f4f8', label: '눈' },
            { color: '#468ccd', label: '강' },
          ]}
        />
      );
    case 'countries':
      return <Chips items={world.countries.map((c) => ({ color: c.color, label: c.name }))} />;
    case 'climate':
      return (
        <Chips
          items={CLIMATE_ZONES.filter((z) => z.id > 0 && (world.stats.climateShare[z.id] ?? 0) > 0.002).map((z) => ({
            color: z.color,
            label: z.name,
          }))}
        />
      );
    case 'temperature':
      return <Gradient stops={TEMP_STOPS} unit="°C" />;
    case 'precipitation':
      return <Gradient stops={PRECIP_STOPS} unit="mm" />;
    case 'crops':
      return <Gradient stops={SUIT_STOPS} unit="" labels={['기르기 어려움', '보통', '기르기 좋음']} />;
    case 'harvest':
      return (
        <Chips
          items={MONTH_COLORS.map((c, m) => ({ color: `rgb(${c[0]},${c[1]},${c[2]})`, label: `${m + 1}월` }))}
        />
      );
    case 'resources':
      return (
        <Chips
          items={world.catalog.resources.map((r) => ({
            color: r.kind === 'oil' ? '#231928' : '#b94123',
            label: r.name,
          }))}
        />
      );
    case 'sea':
      return (
        <Chips
          items={[
            { color: '#2d5fa5', label: '외해' },
            { color: '#2896a0', label: '중앙해' },
            { color: '#f09628', label: '관문 해협' },
            { color: '#7a2a4a', label: '붉을수록 항해 위험' },
          ]}
        />
      );
  }
}

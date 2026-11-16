import { densifyPath, type LatLon } from '../sim/core/sphere';
import type { RasterImage } from './baseLayer';

/**
 * 바탕 그림(등장방형) 위에 항로·항구·경위선을 그려 한 장의 캔버스로 만든다.
 * 3D 지구본은 이 캔버스를 텍스처로, 2D 지도는 그대로 화면에 쓴다(같은 데이터, 두 표현).
 */
export interface RouteOverlay {
  points: LatLon[];
  color: string;
  width: number;
  dashed?: boolean;
}

export interface CityOverlay {
  lat: number;
  lon: number;
  /** 항만 규모 1~3 */
  size: number;
  color: string;
  selected: boolean;
}

export interface ComposeOptions {
  /** globe: 구에 입혔을 때 원이 되도록 고위도에서 표식을 가로로 늘린다 */
  mode: 'globe' | 'flat';
  routes: RouteOverlay[];
  cities: CityOverlay[];
  marker: LatLon | null;
  graticule: boolean;
}

export function composeMap(
  base: RasterImage,
  target: HTMLCanvasElement,
  width: number,
  opt: ComposeOptions,
): HTMLCanvasElement {
  const height = width / 2;
  target.width = width;
  target.height = height;
  const ctx = target.getContext('2d')!;

  const src = document.createElement('canvas');
  src.width = base.width;
  src.height = base.height;
  src.getContext('2d')!.putImageData(new ImageData(base.data as Uint8ClampedArray<ArrayBuffer>, base.width, base.height), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);

  const unit = width / 2880; // 선 굵기 기준
  const X = (lon: number) => ((lon + 180) / 360) * width;
  const Y = (lat: number) => ((90 - lat) / 180) * height;

  if (opt.graticule) {
    ctx.lineWidth = Math.max(1, unit * 1.5);
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.strokeStyle = lat === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.14)';
      ctx.setLineDash(lat === 0 ? [unit * 14, unit * 10] : []);
      ctx.beginPath();
      ctx.moveTo(0, Y(lat));
      ctx.lineTo(width, Y(lat));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    for (let lon = -150; lon <= 180; lon += 30) {
      ctx.beginPath();
      ctx.moveTo(X(lon), Y(80));
      ctx.lineTo(X(lon), Y(-80));
      ctx.stroke();
    }
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const route of opt.routes) {
    const pts = densifyPath(route.points, 1);
    // 경도를 이어 붙여(±180° 넘김) 세 번 그리면 좌우 경계에서도 끊기지 않는다
    const xs: number[] = [];
    let prev = pts[0][1];
    let acc = pts[0][1];
    for (const p of pts) {
      let d = p[1] - prev;
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      acc += d;
      prev = p[1];
      xs.push(acc);
    }
    for (const shift of [-360, 0, 360]) {
      const draw = (style: string, w: number) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = w;
        ctx.setLineDash(route.dashed ? [unit * 12, unit * 10] : []);
        ctx.beginPath();
        for (let k = 0; k < pts.length; k++) {
          const x = X(xs[k] + shift);
          const y = Y(pts[k][0]);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      if (route.width >= 3) draw('rgba(10,20,40,0.55)', (route.width + 2.5) * unit);
      draw(route.color, route.width * unit);
    }
  }
  ctx.setLineDash([]);

  const ellipse = (lat: number, lon: number, r: number) => {
    const stretch = opt.mode === 'globe' ? 1 / Math.max(0.25, Math.cos((lat * Math.PI) / 180)) : 1;
    for (const shift of [-360, 0, 360]) {
      ctx.beginPath();
      ctx.ellipse(X(lon + shift), Y(lat), r * stretch, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };
  for (const c of opt.cities) {
    const r = (5 + c.size * 2.2) * unit * (c.selected ? 1.5 : 1);
    ctx.fillStyle = c.color;
    ctx.strokeStyle = c.selected ? '#ffffff' : 'rgba(15,20,35,0.9)';
    ctx.lineWidth = (c.selected ? 4 : 2.2) * unit;
    ellipse(c.lat, c.lon, r);
  }
  if (opt.marker) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * unit;
    ellipse(opt.marker[0], opt.marker[1], 9 * unit);
  }
  return target;
}

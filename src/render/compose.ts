import { densifyPath, type LatLon } from '../sim/core/sphere';
import type { RasterImage } from './baseLayer';

/**
 * 바탕 그림(등장방형) 위에 얹는 항로·항구·경위선.
 * 2D 지도는 drawOverlays로 화면에 바로 그리고, 3D 지구본은 같은 자료로 구면 위에 도형을 만든다.
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
  routes: RouteOverlay[];
  cities: CityOverlay[];
  marker: LatLon | null;
  graticule: boolean;
  /** disc: 나라 색 원(2D 지도) · ring: 3D 항구 모델 둘레의 고리(지구본) */
  cityStyle?: 'disc' | 'ring';
}

/** 바탕 그림(RGBA)을 캔버스 한 장으로 옮긴다 */
export function drawBase(base: RasterImage, target: HTMLCanvasElement): HTMLCanvasElement {
  target.width = base.width;
  target.height = base.height;
  target.getContext('2d')!.putImageData(new ImageData(base.data as Uint8ClampedArray<ArrayBuffer>, base.width, base.height), 0, 0);
  return target;
}

/**
 * 항로·항구·경위선을 벡터로 그린다. X·Y는 경도·위도를 그릴 좌표로 바꾸는 함수,
 * unit은 굵기 기준(1/8도가 몇 픽셀인가). 화면 좌표로 바로 그리므로 확대해도 또렷하다.
 * 경도는 -540°~540°까지 이어 그린다(좌우로 이어지는 지도).
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  X: (lon: number) => number,
  Y: (lat: number) => number,
  unit: number,
  opt: ComposeOptions,
): void {
  if (opt.graticule) {
    ctx.lineWidth = Math.max(1, unit * 1.5);
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.strokeStyle = lat === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.14)';
      ctx.setLineDash(lat === 0 ? [unit * 14, unit * 10] : []);
      ctx.beginPath();
      ctx.moveTo(X(-540), Y(lat));
      ctx.lineTo(X(540), Y(lat));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    for (let lon = -540; lon <= 540; lon += 30) {
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
    for (const shift of [-360, 0, 360]) {
      ctx.beginPath();
      ctx.arc(X(lon + shift), Y(lat), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };
  for (const c of opt.cities) {
    if (opt.cityStyle === 'ring') {
      if (c.size === 0) continue; // 내륙 도시는 3D 모델만으로 충분하다(고리는 항구 표시)
      // 3D 항구 모델을 가리지 않게 땅바닥에 나라 색 고리만 둘러 준다
      const r = (11 + c.size * 2.5) * unit * (c.selected ? 1.35 : 1);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.strokeStyle = c.selected ? '#ffffff' : c.color;
      ctx.lineWidth = (c.selected ? 5 : 3) * unit;
      ellipse(c.lat, c.lon, r);
      continue;
    }
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
}

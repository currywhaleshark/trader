import { wrapLon } from '../sim/core/sphere';
import { drawOverlays, type ComposeOptions } from './compose';

export interface MapLabel {
  lat: number;
  lon: number;
  text: string;
  emphasis: boolean;
}

/**
 * 2D 세계지도(등장방형). 지구본과 같은 캔버스를 평면에 그린다.
 * 좌우로 끝없이 이어지며(경도 경계 없음), 끌어서 이동하고 휠·핀치로 확대한다.
 * WebGL이 필요 없어 저사양 기기의 대체 화면으로도 쓴다.
 */
export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private source: HTMLCanvasElement | null = null;
  private overlay: ComposeOptions | null = null;
  private labels: MapLabel[] = [];
  private ships: readonly { lat: number; lon: number; color: string }[] = [];
  private centerLon = 0;
  private centerLat = 0;
  private zoom = 1;
  private pointers = new Map<number, [number, number]>();
  private downAt: [number, number] | null = null;
  private moved = 0;
  private pinchDist = 0;
  private raf = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly onPick: (lat: number, lon: number) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grab';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setSource(canvas: HTMLCanvasElement): void {
    this.source = canvas;
    this.requestDraw();
  }

  /** 항로·항구 표식(화면 해상도로 바로 그려 확대해도 또렷하다) */
  setOverlay(overlay: ComposeOptions): void {
    this.overlay = overlay;
    this.requestDraw();
  }

  setLabels(labels: MapLabel[]): void {
    this.labels = labels;
    this.requestDraw();
  }

  setShips(ships: readonly { lat: number; lon: number; color: string }[]): void {
    this.ships = ships;
    this.requestDraw();
  }

  lookAt(lat: number, lon: number): void {
    this.centerLon = wrapLon(lon);
    this.centerLat = lat;
    this.requestDraw();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }

  /** 화면 1px당 각도의 역수: 1도가 몇 CSS 픽셀인가 */
  private get pxPerDeg(): number {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return Math.max(w / 360, h / 180) * this.zoom;
  }

  private clampView(): void {
    const h = this.container.clientHeight || 1;
    const halfSpan = h / 2 / this.pxPerDeg;
    const limit = Math.max(0, 90 - halfSpan);
    this.centerLat = Math.max(-limit, Math.min(limit, this.centerLat));
    this.centerLon = wrapLon(this.centerLon);
  }

  private toLatLon(x: number, y: number): [number, number] {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const ppd = this.pxPerDeg;
    return [this.centerLat - (y - h / 2) / ppd, wrapLon(this.centerLon + (x - w / 2) / ppd)];
  }

  private readonly onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.pointers.size === 1) {
      this.downAt = [e.clientX, e.clientY];
      this.moved = 0;
      this.canvas.style.cursor = 'grabbing';
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (this.pinchDist > 0) this.setZoom(this.zoom * (d / this.pinchDist));
      this.pinchDist = d;
      this.moved = 99;
      return;
    }
    const dx = e.clientX - prev[0];
    const dy = e.clientY - prev[1];
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.centerLon -= dx / this.pxPerDeg;
    this.centerLat += dy / this.pxPerDeg;
    this.clampView();
    this.requestDraw();
  };

  private readonly onUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.canvas.style.cursor = 'grab';
    if (!had || !this.downAt || this.pointers.size > 0) return;
    if (this.moved < 6 && e.type === 'pointerup') {
      const rect = this.canvas.getBoundingClientRect();
      const [lat, lon] = this.toLatLon(e.clientX - rect.left, e.clientY - rect.top);
      if (Math.abs(lat) <= 90) this.onPick(lat, lon);
    }
    this.downAt = null;
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
  };

  private setZoom(z: number): void {
    this.zoom = Math.max(1, Math.min(8, z));
    this.clampView();
    this.requestDraw();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.clampView();
    this.draw();
  }

  private requestDraw(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const dpr = this.canvas.width / w;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1526';
    ctx.fillRect(0, 0, w, h);
    if (!this.source) return;
    const ppd = this.pxPerDeg;
    const mapW = 360 * ppd;
    const mapH = 180 * ppd;
    const top = h / 2 - (90 - this.centerLat) * ppd;
    const left = w / 2 - (this.centerLon + 180) * ppd;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (let k = -1; k <= 1; k++) {
      const x = left + k * mapW;
      if (x > w || x + mapW < 0) continue;
      ctx.drawImage(this.source, x, top, mapW + 0.5, mapH);
    }
    if (this.overlay) {
      const lon0 = this.centerLon;
      const lat0 = this.centerLat;
      // 화면 가운데 경도를 기준으로 펼친다: 보이는 범위는 늘 ±180° 안이다
      drawOverlays(
        ctx,
        (lon) => w / 2 + (lon - lon0) * ppd,
        (lat) => h / 2 - (lat - lat0) * ppd,
        ppd / 8,
        this.overlay,
      );
    }
    for (const ship of this.ships) {
      const x = w / 2 + wrapLon(ship.lon - this.centerLon) * ppd;
      const y = h / 2 - (ship.lat - this.centerLat) * ppd;
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = ship.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0a1222';
      ctx.stroke();
    }
    ctx.font = '600 13px system-ui, "Malgun Gothic", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // 겹치는 이름표는 강조한 것부터 그리고, 이미 그린 이름표와 겹치면 건너뛴다(확대하면 다시 보인다)
    const placed: [number, number, number, number][] = [];
    const ordered = [...this.labels].sort((a, b) => Number(b.emphasis) - Number(a.emphasis));
    for (const label of ordered) {
      const x = w / 2 + wrapLon(label.lon - this.centerLon) * ppd;
      const y = h / 2 - (label.lat - this.centerLat) * ppd;
      if (x < -80 || x > w + 80 || y < -20 || y > h + 20) continue;
      ctx.font = `${label.emphasis ? 700 : 600} ${label.emphasis ? 15 : 13}px system-ui, "Malgun Gothic", sans-serif`;
      const box: [number, number, number, number] = [x + 7, y - 18, x + 11 + ctx.measureText(label.text).width, y];
      if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      ctx.strokeStyle = 'rgba(8,14,28,0.85)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(label.text, x + 9, y - 9);
      ctx.fillStyle = label.emphasis ? '#fff3b0' : '#ffffff';
      ctx.fillText(label.text, x + 9, y - 9);
    }
  }
}

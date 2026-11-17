import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { latLonToVec3 } from '../sim/core/sphere';
import { lowpolyMaterial } from './lowpoly/kit';
import { buildPort, buildTown } from './lowpoly/ports';
import { buildShip } from './lowpoly/ships';

/** 지구본에 세울 항구 도시 */
export interface GlobePort {
  id: string;
  lat: number;
  lon: number;
  /** 부두가 향할 바다 쪽 점 */
  seaLat: number;
  seaLon: number;
  level: 1 | 2 | 3;
  countryColor: string;
}

/** 지구본에 세울 내륙 도시 */
export interface GlobeTown {
  id: string;
  lat: number;
  lon: number;
  size: 1 | 2;
  countryColor: string;
}

/** 지구본 위 이름표(항구 이름과, 상품 렌즈를 켰을 때의 값 꼬리표) */
export interface GlobeLabel {
  id: string;
  lat: number;
  lon: number;
  text: string;
  badge?: string;
  tone?: 'cheap' | 'dear' | 'plain';
  emphasis?: boolean;
}

/** 지구본에 띄울 배 */
export interface GlobeShip {
  id: string;
  lat: number;
  lon: number;
  /** 뱃머리가 향하는 점 */
  headLat: number;
  headLon: number;
  /** 'small' | 'medium' | 'bulk' | 'container' | 'reefer' | 'npc' */
  kind: string;
  /** 굴뚝(회사) 색 */
  funnel: string;
  /** 눌러서 고를 수 있는 배(내 배) */
  pickable?: boolean;
}

/** 멀리서도 보이도록 실제보다 크게 그린다. 카메라 거리 3.4(기본)일 때의 크기 */
const SHIP_SIZE = 0.04;
const PORT_SIZE = 0.06;
const TOWN_SIZE = 0.05;

/**
 * 3D 지구본. 시뮬레이션 데이터를 모른다 — 등장방형 캔버스를 구에 입히고,
 * 그 위에 로우폴리 항구·배 모델을 세운다. 누른 지점(또는 배)만 알려준다.
 */
export class GlobeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
  private readonly controls: OrbitControls;
  private readonly globe: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private texture: THREE.CanvasTexture | null = null;
  private frame = 0;
  private downAt: [number, number] | null = null;

  private readonly portGroup = new THREE.Group();
  private readonly shipGroup = new THREE.Group();
  private readonly ports = new Map<string, { mesh: THREE.Mesh; key: string }>();
  private readonly towns = new Map<string, { mesh: THREE.Mesh; key: string }>();
  private readonly ships = new Map<string, { mesh: THREE.Mesh; key: string }>();
  /** 같은 모양(선종·굴뚝 색, 항구 규모·나라 색)은 형상을 함께 쓴다 */
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private readonly marker: THREE.Mesh;
  private selectedShip: string | null = null;
  private readonly labelLayer: HTMLDivElement;
  private labels: { v: THREE.Vector3; el: HTMLButtonElement }[] = [];
  private labelKey = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly onPick: (lat: number, lon: number) => void,
    private readonly onPickShip?: (id: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.scene.add(this.globe);

    // 대기 테두리
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 64, 32),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader:
          'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'varying vec3 vN; void main(){ float k = pow(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(0.45, 0.72, 1.0, 1.0) * clamp(k, 0.0, 1.0) * 1.6; }',
      }),
    );
    this.scene.add(halo);

    // 조명: 하늘·땅 반사광 + 카메라를 따라다니는 해(어디를 봐도 모델이 밝게 보인다)
    this.scene.add(new THREE.HemisphereLight('#f4f1ea', '#5d6b7d', 1.5));
    const sun = new THREE.DirectionalLight('#ffffff', 2.0);
    sun.position.set(0.6, 1.2, 1);
    this.camera.add(sun);
    this.scene.add(this.camera);

    this.scene.add(this.portGroup, this.shipGroup);

    // 고른 배 표시: 배 밑의 금색 고리
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 24),
      new THREE.MeshBasicMaterial({ color: '#ffd166', side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);

    const start = latLonToVec3(8, -2);
    this.camera.position.set(start[0] * 3.4, start[1] * 3.4, start[2] * 3.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 1.12;
    this.controls.maxDistance = 6;

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);

    // 이름표 층: 캔버스 위에 HTML로 얹는다(글자가 또렷하고, 눌러서 항구를 고를 수 있다)
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'globe-labels';
    container.appendChild(this.labelLayer);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();  }

  /** 새 그림으로 교체(레이어·월·선택이 바뀔 때) */
  setTexture(canvas: HTMLCanvasElement): void {
    if (this.texture && this.texture.image === canvas) {
      this.texture.needsUpdate = true;
      return;
    }
    this.texture?.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.wrapS = THREE.RepeatWrapping;
    this.texture = tex;
    this.globe.material.map = tex;
    this.globe.material.needsUpdate = true;
  }

  private geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** 위치(up)와 뱃머리 방향 점으로 모델의 자세를 정한다: +x 앞, +y 위 */
  private place(obj: THREE.Object3D, lat: number, lon: number, headLat: number, headLon: number, lift: number): void {
    const up = new THREE.Vector3(...latLonToVec3(lat, lon));
    const head = new THREE.Vector3(...latLonToVec3(headLat, headLon));
    const fwd = head.sub(up.clone().multiplyScalar(head.dot(up)));
    if (fwd.lengthSq() < 1e-12) fwd.set(0, 1, 0).sub(up.clone().multiplyScalar(up.y));
    if (fwd.lengthSq() < 1e-12) fwd.set(1, 0, 0);
    fwd.normalize();
    const side = new THREE.Vector3().crossVectors(fwd, up);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, up, side));
    obj.position.copy(up).multiplyScalar(1 + lift);
  }

  /** 항구 도시 모델(규모·나라 색이 바뀌면 다시 짓는다) */
  setPorts(ports: readonly GlobePort[]): void {
    const keep = new Set<string>();
    for (const p of ports) {
      keep.add(p.id);
      const key = `${p.id}|${p.level}|${p.countryColor}`;
      let e = this.ports.get(p.id);
      if (!e || e.key !== key) {
        if (e) this.portGroup.remove(e.mesh);
        const geo = this.geometry(`port|${key}`, () => buildPort({ cityId: p.id, level: p.level, countryColor: p.countryColor }));
        e = { mesh: new THREE.Mesh(geo, lowpolyMaterial()), key };
        e.mesh.userData.cityId = p.id;
        this.portGroup.add(e.mesh);
        this.ports.set(p.id, e);
      }
      this.place(e.mesh, p.lat, p.lon, p.seaLat, p.seaLon, 0.0006);
    }
    for (const [id, e] of this.ports) {
      if (!keep.has(id)) {
        this.portGroup.remove(e.mesh);
        this.ports.delete(id);
      }
    }
  }

  /** 내륙 도시 모델(배치는 고정, 나라 색이 바뀌면 다시 짓는다) */
  setTowns(towns: readonly GlobeTown[]): void {
    const keep = new Set<string>();
    for (const t of towns) {
      keep.add(t.id);
      const key = `${t.id}|${t.size}|${t.countryColor}`;
      let e = this.towns.get(t.id);
      if (!e || e.key !== key) {
        if (e) this.portGroup.remove(e.mesh);
        const geo = this.geometry(`town|${key}`, () => buildTown({ townId: t.id, size: t.size, countryColor: t.countryColor }));
        e = { mesh: new THREE.Mesh(geo, lowpolyMaterial()), key };
        this.portGroup.add(e.mesh);
        this.towns.set(t.id, e);
      }
      // 내륙 도시는 북쪽을 앞으로 둔다
      this.place(e.mesh, t.lat, t.lon, t.lat + 1, t.lon, 0.0006);
    }
    for (const [id, e] of this.towns) {
      if (!keep.has(id)) {
        this.portGroup.remove(e.mesh);
        this.towns.delete(id);
      }
    }
  }

  /** 배 모델(자주 불러도 가볍다: 자세만 바꾼다) */
  setShips(ships: readonly GlobeShip[]): void {
    const keep = new Set<string>();
    for (const s of ships) {
      keep.add(s.id);
      const key = `${s.kind}|${s.funnel}`;
      let e = this.ships.get(s.id);
      if (!e || e.key !== key) {
        if (e) this.shipGroup.remove(e.mesh);
        const geo = this.geometry(`ship|${key}`, () => buildShip({ kind: s.kind, funnel: s.funnel }));
        e = { mesh: new THREE.Mesh(geo, lowpolyMaterial()), key };
        e.mesh.userData.shipId = s.id;
        this.shipGroup.add(e.mesh);
        this.ships.set(s.id, e);
      }
      e.mesh.userData.pickable = !!s.pickable;
      this.place(e.mesh, s.lat, s.lon, s.headLat, s.headLon, 0.0004);
    }
    for (const [id, e] of this.ships) {
      if (!keep.has(id)) {
        this.shipGroup.remove(e.mesh);
        this.ships.delete(id);
      }
    }
  }

  /** 이름표(내용이 같으면 다시 만들지 않는다) */
  setLabels(list: readonly GlobeLabel[]): void {
    const key = JSON.stringify(list);
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.labelLayer.replaceChildren();
    this.labels = list.map((l) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `globe-label${l.emphasis ? ' on' : ''}${l.tone ? ` ${l.tone}` : ''}`;
      const name = document.createElement('span');
      name.textContent = l.text;
      el.appendChild(name);
      if (l.badge) {
        const b = document.createElement('b');
        b.textContent = l.badge;
        el.appendChild(b);
      }
      el.addEventListener('click', () => this.onPick(l.lat, l.lon));
      this.labelLayer.appendChild(el);
      return { v: new THREE.Vector3(...latLonToVec3(l.lat, l.lon)), el };
    });
  }

  private placeLabels(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const camDir = this.camera.position.clone().normalize();
    const horizon = 1 / this.camera.position.length();
    for (const l of this.labels) {
      const facing = l.v.dot(camDir);
      if (facing < horizon + 0.05) {
        l.el.style.display = 'none';
        continue;
      }
      const p = l.v.clone().project(this.camera);
      l.el.style.display = '';
      l.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -150%)`;
      // 가장자리로 갈수록 흐리게
      l.el.style.opacity = String(Math.min(1, (facing - horizon) * 6));
    }
  }

  /** 고른 배(금색 고리로 표시). null이면 표시 없음 */
  selectShip(id: string | null): void {
    this.selectedShip = id;
  }

  /** 지정한 위경도가 화면 중앙에 오도록 돌린다 */
  lookAt(lat: number, lon: number): void {
    const v = latLonToVec3(lat, lon);
    const d = this.camera.position.length();
    this.camera.position.set(v[0] * d, v[1] * d, v[2] * d);
    this.controls.update();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.texture?.dispose();
    this.globe.geometry.dispose();
    this.globe.material.dispose();
    for (const g of this.geoCache.values()) g.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }

  private readonly onDown = (e: PointerEvent) => {
    this.downAt = [e.clientX, e.clientY];
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return; // 끌기는 회전
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const globeHit = this.raycaster.intersectObject(this.globe)[0];
    // 배가 먼저: 작은 배도 누르기 쉽게 화면에서 가까운(반지름 16px) 배를 고른다. 지구 뒤편 배는 제외
    if (this.onPickShip) {
      const camDir = this.camera.position.clone().normalize();
      let best: string | null = null;
      let bestPx = 16;
      for (const [id, s] of this.ships) {
        if (!s.mesh.userData.pickable) continue;
        if (s.mesh.position.clone().normalize().dot(camDir) < 1 / this.camera.position.length()) continue;
        const v = s.mesh.position.clone().project(this.camera);
        const px = Math.hypot(((v.x - ndc.x) / 2) * rect.width, ((v.y - ndc.y) / 2) * rect.height);
        if (px < bestPx) {
          bestPx = px;
          best = id;
        }
      }
      if (best) {
        this.onPickShip(best);
        return;
      }
    }
    if (!globeHit) return;
    const p = globeHit.point.normalize();
    this.onPick((Math.asin(p.y) * 180) / Math.PI, (Math.atan2(-p.z, p.x) * 180) / Math.PI);
  };

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    // 세로로 긴 화면에서도 지구본이 잘리지 않게
    this.camera.fov = w / h < 1 ? 38 / Math.max(0.55, w / h) : 38;
    this.camera.updateProjectionMatrix();
  }

  private readonly loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    this.controls.update();
    const dist = this.camera.position.length();
    // 가까이 갈수록 천천히 돌게
    this.controls.rotateSpeed = 0.12 + 0.14 * (dist - 1);
    // 모델 크기: 멀리서는 실제보다 크게(보이도록), 다가갈수록 작아지되 화면에서는 점점 크게 보인다
    const f = Math.pow(Math.max(0.05, dist - 1) / 2.4, 0.6);
    for (const e of this.ships.values()) e.mesh.scale.setScalar(SHIP_SIZE * f);
    for (const e of this.ports.values()) e.mesh.scale.setScalar(PORT_SIZE * Math.max(0.45, f));
    for (const e of this.towns.values()) e.mesh.scale.setScalar(TOWN_SIZE * Math.max(0.45, f));
    const sel = this.selectedShip ? this.ships.get(this.selectedShip) : undefined;
    this.marker.visible = !!sel;
    if (sel) {
      this.marker.position.copy(sel.mesh.position);
      this.marker.quaternion.copy(sel.mesh.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      this.marker.scale.setScalar(SHIP_SIZE * f);
    }
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  };
}

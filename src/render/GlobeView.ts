import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { latLonToVec3 } from '../sim/core/sphere';

/**
 * 3D 지구본. 시뮬레이션 데이터를 모른다 — 등장방형 캔버스 한 장을 구에 입혀 보여주고,
 * 클릭한 지점의 위경도만 알려준다.
 */
export class GlobeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
  private readonly controls: OrbitControls;
  private readonly globe: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private texture: THREE.CanvasTexture | null = null;
  private readonly shipPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private static readonly MAX_SHIPS = 256;
  private frame = 0;
  private downAt: [number, number] | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onPick: (lat: number, lon: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
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

    // 선박: 점 하나씩. 지구본 표면 바로 위에 놓아 뒷면의 배는 가려진다.
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const dctx = dot.getContext('2d')!;
    dctx.fillStyle = '#0a1222';
    dctx.beginPath();
    dctx.arc(16, 16, 15, 0, Math.PI * 2);
    dctx.fill();
    dctx.fillStyle = '#ffffff';
    dctx.beginPath();
    dctx.arc(16, 16, 10.5, 0, Math.PI * 2);
    dctx.fill();
    const shipGeo = new THREE.BufferGeometry();
    shipGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GlobeView.MAX_SHIPS * 3), 3));
    shipGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GlobeView.MAX_SHIPS * 3), 3));
    shipGeo.setDrawRange(0, 0);
    this.shipPoints = new THREE.Points(
      shipGeo,
      new THREE.PointsMaterial({
        size: 11,
        sizeAttenuation: false,
        vertexColors: true,
        map: new THREE.CanvasTexture(dot),
        alphaTest: 0.5,
        transparent: true,
      }),
    );
    this.shipPoints.frustumCulled = false;
    this.scene.add(this.shipPoints);

    const start = latLonToVec3(8, -2);
    this.camera.position.set(start[0] * 3.4, start[1] * 3.4, start[2] * 3.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = 6;

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

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

  /** 선박 위치 갱신(자주 불러도 가볍다) */
  setShips(ships: readonly { lat: number; lon: number; color: string }[]): void {
    const geo = this.shipPoints.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const n = Math.min(ships.length, GlobeView.MAX_SHIPS);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = latLonToVec3(ships[i].lat, ships[i].lon);
      pos.setXYZ(i, v[0] * 1.006, v[1] * 1.006, v[2] * 1.006);
      c.set(ships[i].color);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.setDrawRange(0, n);
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
    this.renderer.dispose();
    el.remove();
  }

  private readonly onDown = (e: PointerEvent) => {
    this.downAt = [e.clientX, e.clientY];
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return; // 끌기는 회전
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.globe)[0];
    if (!hit) return;
    const p = hit.point.normalize();
    const lat = (Math.asin(p.y) * 180) / Math.PI;
    const lon = (Math.atan2(-p.z, p.x) * 180) / Math.PI;
    this.onPick(lat, lon);
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
    // 가까이 갈수록 천천히 돌게
    this.controls.rotateSpeed = 0.12 + 0.14 * (this.camera.position.length() - 1);
    this.renderer.render(this.scene, this.camera);
  };
}

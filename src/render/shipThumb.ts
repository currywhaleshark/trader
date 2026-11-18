import * as THREE from 'three';
import { lowpolyMaterial } from './lowpoly/kit';
import { buildShip } from './lowpoly/ships';

/**
 * 지구본의 로우폴리 배 모델을 작은 그림(투명 배경 PNG)으로 한 번 찍어 둔다.
 * 화면 아래 배 카드·배 사기·정기 항로처럼 배가 여러 번 보이는 곳에서 <img>로 쓴다.
 * 그림 하나에 WebGL 문맥 하나를 잠깐 쓰고, 한동안 쓰지 않으면 문맥을 돌려준다.
 * WebGL을 쓸 수 없으면 null(부르는 쪽이 아이콘으로 대신한다).
 */
const cache = new Map<string, string | null>();
let renderer: THREE.WebGLRenderer | null | undefined;
let idle = 0;

const W = 240;
const H = 120;

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer !== undefined) return renderer;
  try {
    const r =new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    renderer = r;
  } catch {
    renderer = null;
  }
  return renderer;
}

function releaseLater(): void {
  clearTimeout(idle);
  idle = window.setTimeout(() => {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
    renderer = undefined;
  }, 3000);
}

/** kind: 배 종류 id('small'·'medium'·'bulk'·'container'·'reefer'), funnel: 굴뚝 색(회사 색) */
export function shipThumbnail(kind: string, funnel: string): string | null {
  const key = `${kind}|${funnel}`;
  if (cache.has(key)) return cache.get(key)!;
  const r = getRenderer();
  if (!r) {
    cache.set(key, null);
    return null;
  }
  const geo = buildShip({ kind, funnel });
  const mesh = new THREE.Mesh(geo, lowpolyMaterial());
  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight('#f4f1ea', '#5d6b7d', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(1.2, 2, 1.5);
  scene.add(sun);
  // 뱃머리(+x)를 오른쪽으로, 오른쪽 앞 비스듬한 위에서 본다. 모양에 맞춰 화면을 채운다.
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(22, W / H, 0.01, 20);
  camera.position.set(center.x + 0.55, center.y + 0.7, center.z + 2.1);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  // 화면을 채우도록 거리 맞추기: 멀리서 다가가다가 상자 꼭짓점이 화면 가장자리에 닿기 직전에 멈춘다
  const corners = [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => new THREE.Vector3(i ? box.max.x : box.min.x, j ? box.max.y : box.min.y, k ? box.max.z : box.min.z))));
  const dir = camera.position.clone().sub(center).normalize();
  const fitsAt = (dist: number) => {
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.updateMatrixWorld();
    return corners.every((c) => {
      const p = c.clone().project(camera);
      return Math.abs(p.x) <= 0.98 && Math.abs(p.y) <= 0.94;
    });
  };
  let dist = 8;
  while (dist > 0.3 && fitsAt(dist * 0.95)) dist *= 0.95;
  fitsAt(dist);
  r.render(scene, camera);
  const url = r.domElement.toDataURL('image/png');
  geo.dispose();
  cache.set(key, url);
  releaseLater();
  return url;
}

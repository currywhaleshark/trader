import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lowpolyMaterial } from '../render/lowpoly/kit';
import { buildPort, buildTown } from '../render/lowpoly/ports';
import { buildShip } from '../render/lowpoly/ships';

/** 개발용: 로우폴리 배·항구 모델을 한자리에 늘어놓고 돌려 본다(/models.html) */
const host = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9eef3');
scene.add(new THREE.HemisphereLight('#f4f1ea', '#7d8a99', 1.4));
const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(2, 4, 3);
scene.add(sun);

const sea = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: '#7fb4d9', roughness: 1 }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.001;
scene.add(sea);

const mat = lowpolyMaterial();
const kinds = ['small', 'medium', 'bulk', 'container', 'reefer', 'npc'];
kinds.forEach((kind, i) => {
  const mesh = new THREE.Mesh(buildShip({ kind, funnel: kind === 'npc' ? '#7fd4ff' : '#ffd166' }), mat);
  mesh.position.set(-3 + i * 1.2, 0, -1.2);
  mesh.rotation.y = 0.5;
  scene.add(mesh);
});
([1, 2, 3] as const).forEach((level, i) => {
  const mesh = new THREE.Mesh(buildPort({ cityId: `preview-${level}`, level, countryColor: '#5b8def' }), mat);
  mesh.scale.setScalar(2);
  mesh.position.set(-3.9 + i * 2.6, 0, 1.4);
  scene.add(mesh);
});
([1, 2] as const).forEach((size, i) => {
  const mesh = new THREE.Mesh(buildTown({ townId: `preview-town-${size}`, size, countryColor: '#5b8def', river: size === 1 }), mat);
  mesh.scale.setScalar(2);
  mesh.position.set(3.9, 0, -1.6 + i * 2.6);
  scene.add(mesh);
});

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(0, 4.2, 5.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.1);
controls.update();

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

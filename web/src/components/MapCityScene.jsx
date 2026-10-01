import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Website landscape only. Office operations and health indicators stay in Live City.
export default function MapCityScene({ homes, theme, title, selected, onSelect, resetKey, onFallback }) {
  const host = useRef(null), current = useRef(null);
  current.current = { onSelect, onFallback };
  const shape = homes.map(home => home.id + ':' + home.label + ':' + home.summary).join('|');
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { current.current.onFallback(); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', `${title}. Drag to explore; select a source house for topics.`);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#edf2ed');
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 150);
    const rows = Math.max(2, Math.ceil(homes.length / 3)), length = 9 + rows * 4.5;
    const middle = length / 2 - 4;
    camera.position.set(19, 25, middle + 27);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, middle); controls.maxPolarAngle = Math.PI * .44;
    controls.minDistance = 9; controls.maxDistance = 65; controls.enableDamping = false;
    scene.add(new THREE.HemisphereLight('#f8fbff', '#789083', 2.6));
    const sun = new THREE.DirectionalLight('#fff5e5', 2.2); sun.position.set(-12, 24, 8); scene.add(sun);
    const geometries = [], materials = [], textures = [], picks = [];
    const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .85, ...extra }); materials.push(m); return m; };
    const earth = mat(theme.ground), road = mat('#bdc6c4'), walk = mat('#e5e3d8'), wall = mat('#f2ece0'), roof = mat('#627978');
    const leaf = mat(theme.leaves), trunk = mat('#977b60'), water = mat(theme.water, { roughness: .25 }), flower = mat(theme.flowers);
    function mesh(geometry, material, x, y, z) {
      geometries.push(geometry); const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); scene.add(object); return object;
    }
    const box = (x, y, z, w, h, d, material) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
    const ball = (x, y, z, radius, material) => mesh(new THREE.IcosahedronGeometry(radius, 1), material, x, y, z);
    box(0, -.35, middle, 24, .6, length + 7, earth);
    // One readable boulevard, short side streets, and a pedestrian civic square.
    box(0, .005, middle, 2, .06, length + 3, road);
    box(0, .04, -3, 15, .1, 5.4, walk);
    function label(text, x, y, z, color = '#264842', width = 4.2) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffffee'; ctx.beginPath(); ctx.roundRect(0, 0, 512, 96, 20); ctx.fill();
      ctx.fillStyle = color; ctx.font = '600 33px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 49, 480);
      const texture = new THREE.CanvasTexture(canvas); textures.push(texture);
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: false }); materials.push(material);
      const sprite = new THREE.Sprite(material); sprite.position.set(x, y, z); sprite.scale.set(width, width * 96 / 512, 1); scene.add(sprite);
    }
    // Low civic buildings share proportions and materials; their purpose is legible.
    [['Topics', -5], ['Your city', 0], ['Saved posts', 5]].forEach(([name, x], index) => {
      box(x, .8, -3, 3.4, 1.5 + (index === 1 ? .4 : 0), 2.2, wall);
      box(x, 1.65 + (index === 1 ? .4 : 0), -3, 3.6, .2, 2.5, roof);
      box(x, .7, -1.87, .7, 1.25, .06, mat('#7397a0'));
      label(name, x, 2.65, -3, '#315750', 3.8);
    });
    function tree(x, z, index) {
      box(x, .65, z, .14, 1.3, .14, trunk);
      if (['pines', 'alpine'].includes(theme.feature)) mesh(new THREE.ConeGeometry(.65, 1.8, 7), leaf, x, 1.8, z);
      else if (theme.feature === 'coast') {
        for (let a = 0; a < 5; a++) { const blade = box(x + Math.cos(a * 1.26) * .3, 1.5, z + Math.sin(a * 1.26) * .3, 1.3, .09, .23, leaf); blade.rotation.y = -a * 1.26; }
      } else ball(x, 1.55, z, .6 + (index % 3) * .08, leaf);
      if (theme.feature === 'orchard') ball(x + .3, 1.55, z + .35, .13, flower);
    }
    homes.forEach((home, index) => {
      const col = index % 3, row = Math.floor(index / 3), x = [-6.7, -2.9, 5.2][col], z = 2.2 + row * 4.5;
      box(col === 2 ? 3.5 : -3.5, .01, z + 1.55, 6.7, .06, .7, walk);
      const pad = box(x, .12, z, 3.1, .18, 2.9, home.id === selected ? mat('#c0d8d0') : walk);
      const house = box(x, .83, z, 2.2, 1.3, 1.85, wall);
      const cap = mesh(new THREE.ConeGeometry(1.78, .85, 4), roof, x, 1.87, z); cap.rotation.y = Math.PI / 4;
      box(x, .67, z + .94, .44, 1.08, .07, trunk);
      for (const offset of [-.66, .66]) box(x + offset, .95, z + .94, .4, .45, .07, water);
      for (const object of [pad, house, cap]) { object.userData.sourceId = home.id; picks.push(object); }
      label(home.label, x, 2.85, z, home.id === selected ? '#006b55' : '#34514b', 3.2);
      if (home.summary) label(home.summary, x, 2.35, z, '#55756a', 3.2);
    });
    // Landscape stays around the streets so decorations never obscure a doorway.
    for (let i = 0; i < rows * 3 + 4; i++) tree(i % 2 ? 10 : -10, -4 + i * (length + 5) / (rows * 3 + 4), i);
    if (['pond', 'coast', 'creek'].includes(theme.feature)) {
      if (theme.feature === 'pond') { const pool = mesh(new THREE.CircleGeometry(2, 40), water, 7, .12, length - 2); pool.rotation.x = -Math.PI / 2; pool.scale.y = .7; }
      else for (let i = 0; i < 12; i++) { const pool = mesh(new THREE.CircleGeometry(theme.feature === 'coast' ? 2.5 : .9, 16), water, 9.4 + (theme.feature === 'creek' ? Math.sin(i * .8) * .6 : 0), .03, -5 + i * (length + 7) / 11); pool.rotation.x = -Math.PI / 2; }
    }
    if (['hills', 'alpine', 'rocks'].includes(theme.feature)) for (let i = 0; i < 4; i++) {
      const hill = mesh(new THREE.ConeGeometry(1.6, 2.5 + (i % 2), 6), mat(theme.feature === 'rocks' ? '#a0aaa1' : '#9aa99a'), -7 + i * 4.5, 1.1, length + 1.2);
      if (theme.feature === 'alpine') mesh(new THREE.ConeGeometry(.65, 1, 6), mat('#f3f8f6'), hill.position.x, 2.4 + (i % 2) * .5, hill.position.z);
    }
    if (['flowers', 'beds', 'grove'].includes(theme.feature)) for (let i = 0; i < 18; i++) {
      const x = -7.5 + (i % 9) * 1.8, z = length + .6 + Math.floor(i / 9) * .6;
      if (theme.feature === 'beds') box(x, .15, z, 1.4, .24, .42, trunk);
      ball(x, .35, z, .2, flower);
    }
    const render = () => renderer.render(scene, camera);
    function resize() { const w = element.clientWidth || 600, h = element.clientHeight || 460; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); controls.update(); render(); }
    const observer = new ResizeObserver(resize); observer.observe(element); controls.addEventListener('change', render); resize();
    const ray = new THREE.Raycaster(); let start = null;
    const down = event => { start = [event.clientX, event.clientY]; };
    const up = event => {
      if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(picks)[0]; if (hit) current.current.onSelect(hit.object.userData.sourceId);
    };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    return () => { observer.disconnect(); controls.dispose(); renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); renderer.domElement.remove(); };
  }, [shape, theme, selected, title, resetKey]);
  return <div ref={host} className="map-city-scene" />;
}

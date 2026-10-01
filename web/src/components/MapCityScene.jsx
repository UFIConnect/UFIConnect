import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CITY_NATURE } from '../local/cityNature';
import { CITY_DOWNTOWN } from '../local/cityDowntown';

// Decorative city simulation. It never represents measured traffic or member activity.
export default function MapCityScene({ homes, cities, overview, motion, theme, title, selected, onSelect, onCitySelect, onCivicSelect, resetKey, onFallback }) {
  const host = useRef(null), current = useRef(null), wake = useRef(null);
  current.current = { motion, onSelect, onCitySelect, onCivicSelect, onFallback };
  const shape = JSON.stringify(overview ? cities.map(city => [city.id, city.label, city.sources]) : homes);
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch { current.current.onFallback(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.domElement.setAttribute('aria-label', overview ? 'All 16 nature cities connected to UFI downtown. Drag to explore or select a city or building.' : title + '. Select a source house for topics.');
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9f0f2');
    const world = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 500);
    const rows = Math.max(2, Math.ceil(homes.length / 3));
    const length = 9 + rows * 4.5, middle = length / 2 - 4;
    const target = new THREE.Vector3(0, overview ? -3 : 0, overview ? 0 : middle);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target); controls.maxPolarAngle = Math.PI * .46;
    controls.minDistance = overview ? 20 : 8; controls.maxDistance = overview ? 200 : 65;
    controls.enableDamping = true; controls.dampingFactor = .08;
    scene.add(new THREE.HemisphereLight('#f8fbff', '#84968c', 1.8));
    const sun = new THREE.DirectionalLight('#fff3df', 1.6); sun.position.set(-30, 60, 30); scene.add(sun);
    const geometries = new Map(), materials = new Map(), textures = [], records = [], animations = [], batches = [];
    const matrix = new THREE.Matrix4();
    function geometry(kind) {
      if (!geometries.has(kind)) geometries.set(kind, kind === 'box' ? new THREE.BoxGeometry(1, 1, 1)
        : kind === 'cone' ? new THREE.ConeGeometry(1, 1, 7)
        : kind === 'roof' ? new THREE.ConeGeometry(1, 1, 4)
        : kind === 'ring' ? new THREE.RingGeometry(.83, 1, 28)
        : new THREE.IcosahedronGeometry(1, 1));
      return geometries.get(kind);
    }
    function material(color, glow = false) {
      const key = color + ':' + glow;
      if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .7, flatShading: true, ...(glow ? { emissive: color, emissiveIntensity: .35 } : {}) }));
      return materials.get(key);
    }
    function group(x = 0, z = 0, scale = 1, moving = false) {
      const item = new THREE.Group(); item.position.set(x, 0, z); item.scale.setScalar(scale);
      item.userData.moving = moving; world.add(item); return item;
    }
    function form(parent, kind, color, x, y, z, w, h, d, pick = null, moving = false, glow = false) {
      const node = new THREE.Object3D(); node.position.set(x, y, z); node.scale.set(w, h, d); parent.add(node);
      records.push({ node, geometry: geometry(kind), material: material(color, glow), pick, moving: moving || parent.userData.moving });
      return node;
    }
    const box = (parent, color, x, y, z, w, h, d, pick) => form(parent, 'box', color, x, y, z, w, h, d, pick);
    const ball = (parent, color, x, y, z, r, moving = false) => form(parent, 'ball', color, x, y, z, r, r, r, null, moving);
    function label(parent, text, x, y, z, width = 4.2, color = '#294c4b') {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 92;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.fillStyle = '#fffffff0'; ctx.beginPath(); ctx.roundRect(1, 1, 510, 90, 20); ctx.fill();
      ctx.fillStyle = color; ctx.font = '600 32px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 47, 480);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false }); materials.set('label:' + textures.length, mat);
      const sprite = new THREE.Sprite(mat); parent.updateWorldMatrix(true, false);
      sprite.position.copy(parent.localToWorld(new THREE.Vector3(x, y, z)));
      const scale = parent.getWorldScale(new THREE.Vector3()).x;
      sprite.scale.set(width * scale, width * scale * 92 / 512, 1); sprite.renderOrder = 2; scene.add(sprite);
    }
    function tree(parent, landscape, x, z, index) {
      box(parent, '#947356', x, .65, z, .17, 1.3, .17);
      const pine = ['pines', 'alpine'].includes(landscape.feature);
      const crown = form(parent, pine ? 'cone' : 'ball', landscape.leaves, x, 1.7, z, .7, pine ? 1.9 : .75, .7, null, true);
      animations.push(time => { crown.rotation.z = Math.sin(time * 1.4 + index) * .065; crown.rotation.x = Math.cos(time + index) * .035; });
      if (landscape.feature === 'coast') {
        crown.scale.set(.8, .16, .8);
        for (let i = 0; i < 4; i++) { const leaf = box(parent, landscape.leaves, x, 1.68, z, 1.85, .09, .25); leaf.rotation.y = i * Math.PI / 4; }
      }
      if (landscape.feature === 'orchard') ball(parent, landscape.flowers, x + .35, 1.6, z + .32, .16);
    }
    function pond(parent, landscape, x, z, radius) {
      const pool = ball(parent, landscape.water, x, .04, z, radius); pool.scale.y = .06;
      for (let i = 0; i < 3; i++) {
        const ring = form(parent, 'ring', '#d8f6f4', x, .12 + i * .003, z, radius, radius, 1, null, true);
        ring.rotation.x = -Math.PI / 2;
        animations.push(time => { const size = radius * (.2 + ((time * .17 + i / 3) % 1) * .7); ring.scale.set(size, size * .75, 1); });
      }
    }
    function neighborhood(parent, cityHomes, landscape, name, compact = false, cityId = '') {
      const countRows = Math.max(2, Math.ceil(cityHomes.length / 3)), depth = 9 + countRows * 4.5, mid = depth / 2 - 4;
      const cityPick = compact ? { city: cityId } : null;
      box(parent, landscape.ground, 0, -.35, mid, 24, .6, depth + 7, cityPick);
      box(parent, '#aab8b9', 0, .02, mid, 2, .07, depth + 2);
      box(parent, '#e6e4db', 0, .05, -3, 17, .1, 4.2);
      for (let z = -5; z < depth - 2; z += 2.8) box(parent, '#f4f0d3', 0, .065, z, .1, .025, 1.25);
      if (!compact) {
        [['Sources', -5], ['Your city', 0], ['Collection', 5]].forEach(([name, x], i) => {
          const pick = { civic: i === 0 ? 'sources' : i === 1 ? 'topics' : 'collection' };
          box(parent, '#eae8df', x, 1.05, -3, 3.4, 2, 2.4, pick);
          box(parent, '#66838b', x, 2.1, -3, 3.65, .2, 2.65, pick);
          box(parent, '#709da8', x, .8, -1.76, 1, 1.5, .06);
          label(parent, name, x, 3.15, -3, 3.5);
        });
      }
      cityHomes.forEach((home, index) => {
        const x = [-6.7, -2.9, 5.2][index % 3], z = 2.2 + Math.floor(index / 3) * 4.5;
        const pick = { source: home.id, ...(compact ? { city: cityId } : {}) };
        box(parent, '#e8e3d7', x, .13, z, 3.1, .18, 2.8, pick);
        box(parent, home.id === selected && !compact ? '#d1e2d9' : '#f1ebdd', x, .85, z, 2.15, 1.4, 1.85, pick);
        const roof = form(parent, 'roof', '#657b80', x, 1.98, z, 1.77, .86, 1.77, pick); roof.rotation.y = Math.PI / 4;
        box(parent, '#977559', x, .68, z + .94, .45, 1.1, .06);
        [-.65, .65].forEach(offset => form(parent, 'box', '#e7c484', x + offset, 1.0, z + .95, .4, .48, .06, null, false, true));
        box(parent, '#e4e1d6', x / 2, .07, z + 1.65, Math.abs(x) + 1, .04, .65);
        if (!compact) {
          label(parent, home.label, x, 3.1, z, 3.2);
          if (home.summary) label(parent, home.summary, x, 2.57, z, 3.2, '#55746d');
        }
      });
      for (let i = 0; i < (compact ? 8 : 16); i++) tree(parent, landscape, i % 2 ? 10.2 : -10.2, -4 + i * (depth + 2) / (compact ? 8 : 16), i);
      if (['pond', 'coast', 'creek'].includes(landscape.feature)) {
        if (landscape.feature === 'pond') pond(parent, landscape, 7, depth - 2, 2.1);
        else for (let i = 0; i < 7; i++) pond(parent, landscape, 9.5 + Math.sin(i) * .55, -5 + i * (depth + 5) / 6, landscape.feature === 'coast' ? 2.5 : 1.2);
      }
      if (['hills', 'alpine', 'rocks'].includes(landscape.feature)) for (let i = 0; i < 3; i++) {
        form(parent, landscape.feature === 'rocks' ? 'ball' : 'cone', '#91a198', -5 + i * 5, 1.0, depth + .4, 2, 3 + i % 2, 2);
        if (landscape.feature === 'alpine') form(parent, 'cone', '#f3f7f1', -5 + i * 5, 2.4 + (i % 2) * .5, depth + .4, .8, 1.2, .8);
      }
      if (['flowers', 'beds', 'grove'].includes(landscape.feature)) for (let i = 0; i < 12; i++) {
        const x = -7 + i % 6 * 2.7, z = depth - 1 + Math.floor(i / 6) * .9;
        if (landscape.feature === 'beds') box(parent, '#9d8063', x, .1, z, 1.8, .2, .6);
        ball(parent, landscape.flowers, x, .35, z, .3);
      }
      if (compact) label(parent, name, 0, 4.1, -2, 14);
    }
    const central = group();
    if (overview) {
      box(central, '#ccd8c8', 0, -.8, 0, 102, .7, 102);
      box(central, '#e1e6db', 0, -.15, 0, 47, .3, 47);
      for (const side of [-1, 1]) {
        box(central, '#a2b2b8', side * 26, .02, 0, 3.6, .1, 56);
        box(central, '#a2b2b8', 0, .02, side * 26, 56, .1, 3.6);
        box(central, '#f0e7cb', side * 23.8, .06, 0, .6, .12, 48);
        box(central, '#f0e7cb', 0, .06, side * 23.8, 48, .12, .6);
        for (let p = -24; p < 25; p += 4) {
          box(central, '#f7efd3', side * 26, .09, p, .13, .03, 1.9);
          box(central, '#f7efd3', p, .09, side * 26, 1.9, .03, .13);
        }
      }
      box(central, '#b3bec0', 0, .02, 0, 3.2, .08, 48);
      box(central, '#b3bec0', 0, .02, 0, 48, .08, 3.2);
      const slots = [];
      for (let row = -2; row <= 2; row++) for (let col = -2; col <= 2; col++) if (Math.abs(row) === 2 || Math.abs(col) === 2) slots.push([col * 19, row * 19]);
      cities.forEach((city, i) => {
        const [x, z] = slots[i], parent = group(x, z - 3, .58);
        neighborhood(parent, city.sources.slice(0, 6).map(id => ({ id })), CITY_NATURE[city.id], city.label, true, city.id);
        if (Math.abs(x) === 38) box(central, '#abb9ba', Math.sign(x) * 32, .025, z, 12, .1, 1.8);
        else box(central, '#abb9ba', x, .025, Math.sign(z) * 32, 1.8, .1, 12);
      });
      const positions = [[-12, -12], [0, -13], [12, -12], [-13, 0], [13, 0], [-12, 12], [0, 13], [12, 12]];
      CITY_DOWNTOWN.forEach((building, index) => {
        const [x, z] = positions[index], pick = { civic: building.id };
        box(central, '#ece7dd', x, .16, z, 7.8, .3, 6.8, pick);
        box(central, building.color, x, building.height / 2, z, 5.4, building.height, 4.8, pick);
        box(central, '#e5eced', x, building.height + .15, z, 5.7, .3, 5.1, pick);
        for (let floor = 1; floor < building.height; floor += 1.1) for (let window = -1; window <= 1; window++) form(central, 'box', '#d7eef0', x + window * 1.3, floor, z + 2.43, .75, .48, .08, null, false, true);
        if (index % 2 === 0) box(central, '#758d8c', x, building.height + .8, z, 3.1, 1, 2.7, pick);
        label(central, building.label, x, building.height + 2, z, 10.5);
      });
      box(central, '#f6f6ef', 0, 4.3, 0, 4.6, 8.6, 4.6, { civic: 'feed' });
      box(central, '#507da3', 0, 9.1, 0, 3.8, 1, 3.8);
      box(central, '#086ef9', -1.2, 11.5, 0, .75, 3, .75);
      box(central, '#178cff', 1.2, 11.5, 0, .75, 3, .75);
      box(central, '#086ef9', 0, 10.1, 0, 3.1, .75, .75);
      label(central, 'UFIConnect', 0, 14.1, 0, 11);
      for (const side of [-1, 1]) for (let i = -3; i <= 3; i++) tree(central, CITY_NATURE.people, side * 21, i * 6, i);
      pond(central, CITY_NATURE.science, 5, 5, 2.2);
    } else neighborhood(central, homes, theme, title);
    // Cars and pedestrians follow continuous closed routes, never teleport across the scene.
    function route(time, radiusX, radiusZ, centerZ = 0, offset = 0) {
      const progress = ((time + offset) % 1 + 1) % 1, side = Math.floor(progress * 4), t = progress * 4 - side;
      return side === 0 ? [-radiusX + 2 * radiusX * t, centerZ - radiusZ, Math.PI / 2]
        : side === 1 ? [radiusX, centerZ - radiusZ + 2 * radiusZ * t, 0]
        : side === 2 ? [radiusX - 2 * radiusX * t, centerZ + radiusZ, -Math.PI / 2]
        : [-radiusX, centerZ + radiusZ - 2 * radiusZ * t, Math.PI];
    }
    const traffic = overview ? 32 : 8;
    for (let i = 0; i < traffic; i++) {
      const car = group(0, 0, overview ? 1 : .68, true);
      box(car, ['#4d8dba', '#e5b675', '#faf2da', '#b98489'][i % 4], 0, .34, 0, .95, .48, 1.85);
      box(car, '#93bac5', 0, .67, -.08, .78, .4, 1);
      box(car, '#343e43', 0, .17, -.57, 1.1, .25, .22); box(car, '#343e43', 0, .17, .57, 1.1, .25, .22);
      const radius = 26 + (i % 2 ? .9 : -.9);
      animations.push(time => {
        const position = overview ? route(time * (i % 2 ? -.013 : .013), radius, radius, 0, i / traffic)
          : route(time * (i % 2 ? -.035 : .035), .55, (length + 1) / 2, middle, i / traffic);
        car.position.set(position[0], .08, position[1]); car.rotation.y = position[2] + (i % 2 ? Math.PI : 0);
      });
    }
    for (let i = 0; i < (overview ? 42 : 18); i++) {
      const walker = group(0, 0, overview ? 1 : .8, true);
      box(walker, ['#b78278', '#507996', '#c8b170', '#6b9b85'][i % 4], 0, .66, 0, .3, .55, .22);
      ball(walker, '#ccac90', 0, 1.08, 0, .18);
      const left = box(walker, '#55616a', -.09, .25, 0, .1, .45, .12), right = box(walker, '#55616a', .09, .25, 0, .1, .45, .12);
      animations.push(time => {
        const pos = overview ? route(time * .008, i % 2 ? 22 : 18, i % 2 ? 22 : 18, 0, i / 42)
          : route(time * .015, 1.65 + i % 2 * .45, length / 2, middle, i / 18);
        walker.position.set(pos[0], .1 + Math.abs(Math.sin(time * 5 + i)) * .035, pos[1]); walker.rotation.y = pos[2];
        left.rotation.x = Math.sin(time * 5 + i) * .45; right.rotation.x = -left.rotation.x;
      });
    }
    for (let i = 0; i < (overview ? 10 : 4); i++) {
      const bird = group(0, 0, overview ? .6 : .3, true);
      const left = box(bird, '#72858c', -.45, 0, 0, .9, .08, .28), right = box(bird, '#72858c', .45, 0, 0, .9, .08, .28);
      animations.push(time => {
        const angle = time * .14 + i * .6;
        bird.position.set(Math.cos(angle) * (overview ? 39 : 12), (overview ? 13 : 6) + Math.sin(time * .6 + i), (overview ? 0 : middle) + Math.sin(angle) * (overview ? 30 : 8));
        bird.rotation.y = -angle; left.rotation.z = Math.sin(time * 7 + i) * .4; right.rotation.z = -left.rotation.z;
      });
    }
    for (let i = 0; i < (overview ? 6 : 2); i++) {
      const cloud = group(0, 0, overview ? 2.1 : 1, true);
      for (let j = 0; j < 3; j++) { const puff = ball(cloud, '#fafbf6', j * 1.1, 0, 0, .9); puff.scale.y = .3; }
      animations.push(time => { cloud.position.set(Math.sin(time * .016 + i * 1.4) * (overview ? 42 : 15), overview ? 14 + i % 3 : 7, (overview ? 0 : middle) + Math.cos(i * 1.6) * (overview ? 39 : 12)); });
    }
    animations.forEach(animate => animate(0));
    world.updateMatrixWorld(true);
    // Shared geometry/material instances keep the 16-city overview inexpensive to draw.
    const grouped = new Map();
    for (const record of records) {
      const key = record.geometry.uuid + ':' + record.material.uuid;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(record);
    }
    const pickMeshes = [];
    for (const members of grouped.values()) {
      const instanced = new THREE.InstancedMesh(members[0].geometry, members[0].material, members.length);
      const moving = members.map((item, index) => ({ ...item, index })).filter(item => item.moving);
      members.forEach((item, index) => instanced.setMatrixAt(index, item.node.matrixWorld));
      instanced.userData.targets = members.map(item => item.pick);
      if (moving.length) { instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instanced.frustumCulled = false; }
      if (members.some(item => item.pick)) pickMeshes.push(instanced);
      scene.add(instanced); batches.push({ instanced, moving });
    }
    let frameId = 0, time = 0, last = 0, lastPaint = 0, inView = true, disposed = false;
    function requestFrame() { if (!disposed && !frameId && inView && !document.hidden) frameId = requestAnimationFrame(frame); }
    function frame(now) {
      frameId = 0;
      if (disposed || !inView || document.hidden) { last = 0; return; }
      const playing = current.current.motion !== 'paused';
      if (playing && now - lastPaint < (current.current.motion === 'calm' ? 32 : 15)) { requestFrame(); return; }
      lastPaint = now;
      const delta = last ? Math.min((now - last) / 1000, .05) : 0; last = now;
      if (playing) {
        time += delta * (current.current.motion === 'calm' ? .4 : 1);
        animations.forEach(animate => animate(time));
        for (const batch of batches) if (batch.moving.length) {
          for (const item of batch.moving) { item.node.updateWorldMatrix(true, false); matrix.copy(item.node.matrixWorld); batch.instanced.setMatrixAt(item.index, matrix); }
          batch.instanced.instanceMatrix.needsUpdate = true;
        }
      }
      controls.update(); renderer.render(scene, camera);
      if (playing) requestFrame();
    }
    let framing = 1;
    function resize() {
      const w = element.clientWidth || 680, h = element.clientHeight || 580;
      const nextFraming = Math.max(1, h / w) * (w < 500 ? 1.12 : 1);
      if (nextFraming !== framing) {
        camera.position.sub(controls.target).multiplyScalar(nextFraming / framing).add(controls.target);
        framing = nextFraming;
        controls.maxDistance = Math.max(controls.maxDistance, camera.position.distanceTo(controls.target) * 1.3);
      }
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); requestFrame();
    }
    // Match framing to the canvas aspect, including narrow phone screens.
    const width = element.clientWidth || 680, height = element.clientHeight || 580;
    framing = Math.max(1, height / width) * (width < 500 ? 1.12 : 1);
    camera.position.copy(overview ? new THREE.Vector3(72, 88, 94).multiplyScalar(framing)
      : new THREE.Vector3(20 * framing, 25 * framing, middle + 28 * framing));
    controls.maxDistance = Math.max(controls.maxDistance, camera.position.distanceTo(target) * 1.3);
    controls.update();
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element); resize();
    const visibility = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; if (!inView) { cancelAnimationFrame(frameId); frameId = 0; last = 0; } else requestFrame(); });
    visibility.observe(element);
    const visible = () => { if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; last = 0; } else requestFrame(); };
    document.addEventListener('visibilitychange', visible);
    controls.addEventListener('change', requestFrame); wake.current = requestFrame;
    const ray = new THREE.Raycaster(); let start = null;
    const down = event => { start = [event.clientX, event.clientY]; };
    const up = event => {
      const origin = start; start = null;
      if (!origin || Math.hypot(event.clientX - origin[0], event.clientY - origin[1]) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const found = ray.intersectObjects(pickMeshes).map(hit => hit.object.userData.targets[hit.instanceId]).find(Boolean);
      if (found?.city) current.current.onCitySelect(found.city, found.source);
      else if (found?.source) current.current.onSelect(found.source);
      else if (found?.civic) current.current.onCivicSelect(found.civic);
    };
    const contextLost = event => { event.preventDefault(); current.current.onFallback(); };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    return () => {
      disposed = true; wake.current = null; cancelAnimationFrame(frameId);
      resizeObserver.disconnect(); visibility.disconnect(); document.removeEventListener('visibilitychange', visible);
      controls.removeEventListener('change', requestFrame); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      batches.forEach(({ instanced }) => instanced.dispose());
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
      scene.clear(); world.clear(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [shape, overview, theme, title, selected, resetKey]);
  useEffect(() => { wake.current?.(); }, [motion]);
  return <div ref={host} className={'map-city-scene' + (overview ? ' map-city-scene--all' : '')} />;
}

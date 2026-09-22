import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const stateColor = state => ({ working: '#75ddb0', inactive: '#8f9da6', attention: '#ffb75e', unobserved: '#526976' }[state] || '#526976');
const lerp = (a, b, t) => a + (b - a) * t;
function dayProgress(phase, start, end) { return Math.max(0, Math.min(1, (phase - start) / (end - start))); }

export default function CityScene3D({ city, motion, speed, motionScope, homeFilter, area, zoom, resetKey, onEnter, onSelectAgent, onFallback }) {
  const host = useRef(null), runtime = useRef(null), current = useRef(null), savedCamera = useRef(null);
  const [hover, setHover] = useState('');
  current.current = { city, motion, speed, motionScope, homeFilter, onEnter, onSelectAgent, onFallback,
    homes: new Map(city.homes.map(home => [home.id, home])), districts: new Map(city.districts.map(district => [district.id, district])) };
  // Polling changes live status without destroying the camera or animation clock.
  const geometryKey = `${city.width}:${city.height}:${city.homes.map(home => `${home.id}:${home.x}:${home.y}`).join('|')}`;
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
    catch { current.current.onFallback(); return undefined; }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d1b26');
    scene.fog = new THREE.Fog('#0d1b26', 260, 540);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', '3D city. Drag to orbit, scroll or pinch to zoom, and click a building or home to enter.');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = 0;
    element.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(43, 1, .1, 1000);
    const extent = Math.max(city.width, city.height) / 10;
    const initialDirection = new THREE.Vector3(.72, .86, .9).normalize();
    const screenRight = new THREE.Vector3().crossVectors(camera.up, initialDirection).normalize();
    const screenUp = new THREE.Vector3().crossVectors(initialDirection, screenRight);
    const cityTop = Math.max(6, ...city.districts.map(district => district.height / 6 + 9));
    const cityCorners = [-1, 1].flatMap(x => [-1, 1].flatMap(z => [-1.25, cityTop].map(y =>
      new THREE.Vector3(x * (city.width / 20 + 4), y, z * (city.height / 20 + 4)))));
    // Fit every corner in both axes, including the narrow horizontal field of view on phones.
    const fitDistance = aspect => {
      const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), horizontal = vertical * aspect;
      return Math.max(...cityCorners.map(point => point.dot(initialDirection) +
        Math.max(Math.abs(point.dot(screenRight)) / horizontal, Math.abs(point.dot(screenUp)) / vertical))) * 1.1;
    };
    let fittedDistance = savedCamera.current?.fitDistance || fitDistance(1);
    camera.position.copy(initialDirection).multiplyScalar(fitDistance(1));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0); controls.enableDamping = true; controls.dampingFactor = .09;
    controls.minDistance = 25; controls.maxDistance = Math.max(extent * 3.5, fittedDistance * 3.5);
    controls.maxPolarAngle = Math.PI * .45;
    controls.listenToKeyEvents(renderer.domElement); controls.update(); controls.saveState();
    if (savedCamera.current) {
      camera.position.copy(savedCamera.current.position); controls.target.copy(savedCamera.current.target); controls.update();
    }
    scene.add(new THREE.HemisphereLight('#d8efff', '#223b29', 2.4));
    const sun = new THREE.DirectionalLight('#fff1d2', 3.2);
    sun.position.set(-75, 130, 45); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -100; sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110; sun.shadow.camera.far = 360; sun.shadow.normalBias = .12;
    scene.add(sun);
    const materials = new Map(), shapes = new Map(), textures = [], picks = [], fleet = [], homes = [], markers = [];
    const material = (color, glow = false) => {
      const key = `${color}:${glow}`;
      if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .08, ...(glow ? { emissive: color, emissiveIntensity: .35 } : {}) }));
      return materials.get(key);
    };
    const boxShape = (w, h, d) => {
      const key = `${w}:${h}:${d}`;
      if (!shapes.has(key)) shapes.set(key, new THREE.BoxGeometry(w, h, d));
      return shapes.get(key);
    };
    const wx = x => x / 10 - city.width / 20, wz = z => z / 10 - city.height / 20;
    function box(x, y, z, w, h, d, color, parent = scene, interactive) {
      const mesh = new THREE.Mesh(boxShape(w, h, d), material(color));
      mesh.position.set(x, y, z); mesh.castShadow = h > 1; mesh.receiveShadow = true;
      if (interactive) { mesh.userData.destination = interactive; picks.push(mesh); }
      parent.add(mesh); return mesh;
    }
    function label(text, x, y, z, color = '#c6d5dd') {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#142532'; ctx.beginPath(); ctx.roundRect(0, 0, 512, 80, 18); ctx.fill();
      ctx.fillStyle = color; ctx.font = '600 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText(text, 256, 49, 485);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
      const mat = new THREE.SpriteMaterial({ map: texture, depthWrite: false }); materials.set(`label-${text}`, mat);
      const sprite = new THREE.Sprite(mat); sprite.position.set(x, y, z); sprite.scale.set(19, 3, 1); scene.add(sprite);
    }
    function street(x1, z1, x2, z2, wide = 2.6) {
      const length = Math.hypot(x2 - x1, z2 - z1);
      if (!length) return;
      const mesh = box((x1 + x2) / 2, .24, (z1 + z2) / 2, wide, .14, length, '#283a47');
      mesh.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      if (wide < 2) return;
      for (let distance = 1; distance < length; distance += 2.3) {
        const mark = box(lerp(x1, x2, distance / length), .33, lerp(z1, z2, distance / length), .08, .02, .7, '#c5c6ad');
        mark.rotation.y = mesh.rotation.y;
      }
    }
    function tree(x, z) {
      box(x, 1.15, z, .35, 2.3, .35, '#786b50');
      const geometry = shapes.get('tree') || new THREE.IcosahedronGeometry(1.4, 0); shapes.set('tree', geometry);
      const crown = new THREE.Mesh(geometry, material('#527f58')); crown.position.set(x, 3, z); crown.castShadow = true; scene.add(crown);
    }
    box(0, -.65, 0, city.width / 10 + 8, 1.2, city.height / 10 + 8, '#25473d');
    city.blocks.forEach(block => {
      box(wx(block.x), .05, wz(block.y), 32, .25, 30, '#688078');
      box(wx(block.x), .21, wz(block.y), 29.7, .1, 27.7, '#3e5c50');
      [-1, 1].forEach(side => [-115, -20, 108].forEach(dy => tree(wx(block.x + side * 84), wz(block.y + dy))));
    });
    for (let col = 0; col <= 4; col++) street(wx(80 + col * 360), wz(40), wx(80 + col * 360), wz(city.height - 40), col === 2 ? 4.4 : 2.6);
    for (let row = 0; row <= city.blocks.length / 4; row++) street(wx(40), wz(80 + row * 340), wx(1560), wz(80 + row * 340));
    street(wx(40), wz(city.bottom + 160), wx(1560), wz(city.bottom + 160));
    const ring = [[40, 40], [1560, 40], [1560, city.height - 40], [40, city.height - 40], [40, 40]];
    ring.slice(1).forEach(([x, z], i) => street(wx(ring[i][0]), wz(ring[i][1]), wx(x), wz(z), 4.4));
    city.districts.forEach((district, index) => {
      const x = wx(district.x), z = wz(district.y), h = district.height / 6;
      const destination = { kind: 'building', id: district.id, label: district.label };
      street(x, wz(district.y + 38), x, wz(district.streetY), 1.2);
      box(x, .5, z, 15, .6, 12, '#819194');
      box(x, h / 2 + .8, z, 11, h, 8, ['#5c7183', '#65868c', '#778099'][index % 3], scene, destination);
      box(x, h + 1.2, z, 11.7, .55, 8.7, '#b0bdc0');
      box(x + 2, h + 2.5, z - 1, 5, 2.4, 4, '#4e6475', scene, destination);
      for (let level = 2; level < h; level += 2.5) {
        box(x, level + 1, z + 4.03, 9, .7, .08, district.color);
        box(x + 5.53, level + 1, z, .08, .7, 6.5, district.color);
      }
      const beacon = box(x + 2, h + 4.1, z - 1, .8, .8, .8, district.color);
      markers.push({ mesh: beacon, district: district.id });
      label(district.label, x, h + 7, z, '#ecf4f7');
    });
    const roofShape = new THREE.ConeGeometry(4.3, 2.3, 4); shapes.set('roof', roofShape);
    const personShape = new THREE.SphereGeometry(.36, 8, 6); shapes.set('person', personShape);
    function curve(points, y = .8) {
      const result = new THREE.CurvePath();
      points.slice(1).forEach(([x, z], i) => {
        if (x === points[i][0] && z === points[i][1]) return;
        result.add(new THREE.LineCurve3(new THREE.Vector3(wx(points[i][0]), y, wz(points[i][1])), new THREE.Vector3(wx(x), y, wz(z))));
      });
      return result;
    }
    function car(color) {
      const group = new THREE.Group();
      box(0, .35, 0, .8, .5, 1.7, color, group);
      box(0, .72, -.1, .65, .35, .85, '#c7dfdf', group);
      box(0, .33, .85, .62, .12, .04, '#fff2bb', group);
      scene.add(group); return group;
    }
    city.homes.forEach(home => {
      const x = wx(home.x), z = wz(home.y), group = new THREE.Group(); scene.add(group);
      const destination = { kind: 'home', id: home.id, key: home.primaryKey, label: home.name };
      const side = home.x < city.blocks[home.block].x ? -1 : 1;
      street(x, wz(home.y + 20), wx(city.blocks[home.block].x + side * 180), wz(home.y + 20), 1);
      box(x, .55, z, 7, .5, 6, '#839782', group);
      box(x, 2.1, z, 5.7, 3.1, 4.6, ['#bdc8b9', '#adbcca', '#c9bba5'][home.index % 3], group, destination);
      const roof = new THREE.Mesh(roofShape, material(['#526678', '#6b6963', '#687f80'][home.index % 3]));
      roof.position.set(x, 4.65, z); roof.rotation.y = Math.PI / 4; roof.castShadow = true; roof.userData.destination = destination; picks.push(roof); group.add(roof);
      box(x, 1.6, z + 2.34, .9, 2, .1, '#415455', group);
      [-1.7, 1.7].forEach(dx => box(x + dx, 2.3, z + 2.34, .8, .9, .1, '#f8d998', group));
      const light = box(x + 3, 1.1, z + 2, .45, .55, .45, stateColor(home.homeState), group);
      markers.push({ mesh: light, home: home.id });
      homes.push({ group, id: home.id, corners: [-4, 4].flatMap(dx => [-4, 4].flatMap(dz => [0, 6].map(y => new THREE.Vector3(x + dx, y, z + dz)))) });
      const walker = new THREE.Group();
      const head = new THREE.Mesh(personShape, material('#e7c7a7')); head.position.y = 1.35; walker.add(head);
      box(0, .7, 0, .45, .8, .35, home.color || '#77bad1', walker); scene.add(walker);
      fleet.push({ id: home.id, index: home.index, car: car(home.color || '#79bad3'), walker, commute: curve(home.commutePoints), lunch: curve(home.lunchPoints) });
    });
    city.cafes.forEach((cafe, index) => {
      const x = wx(cafe.x), z = wz(cafe.y);
      box(x, .18, z, 30, .25, 11.8, '#4f7254');
      box(x, 1.7, z, 8.5, 3, 4.8, '#b5af94'); box(x, 3.5, z, 9.5, .65, 5.5, '#7b8d89');
      box(x, 2.4, z + 3.1, 9, .22, 2, ['#c5a277', '#85ae98', '#c0b486', '#8dafba'][index]);
      street(x, z + 3.5, x, wz(cafe.streetY), 1);
      [-10, 10].forEach(dx => {
        box(x + dx, 1.1, z, 2.5, .2, 2.5, '#c0a575');
        box(x + dx, .55, z, .3, 1, .3, '#6b6c5e');
        [-1.8, 1.8].forEach(dz => box(x + dx, .5, z + dz, 1, .8, .8, '#929e80'));
        tree(x + dx, z - 4);
      });
      label(cafe.label, x, 6, z, '#e0ecce');
    });
    const highwayCurve = curve(ring), highwayCars = Array.from({ length: 16 }, (_, index) => ({ car: car(['#d3e1db', '#dfbf76', '#799bcb', '#8bb8ad'][index % 4]), index }));
    const selection = new THREE.Mesh(new THREE.RingGeometry(8, 8.5, 40), new THREE.MeshBasicMaterial({ color: '#8de8d3', side: THREE.DoubleSide }));
    shapes.set('selection', selection.geometry); materials.set('selection', selection.material); selection.rotation.x = -Math.PI / 2; selection.visible = false; scene.add(selection);
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down;
    const pick = event => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(picks).find(hit => hit.object.visible && hit.object.parent.visible)?.object.userData.destination;
    };
    const onDown = event => { down = [event.clientX, event.clientY]; };
    const onUp = event => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const target = pick(event); down = null;
      if (target?.kind === 'building') current.current.onEnter(target.id);
      if (target?.kind === 'home') {
        const key = current.current.homes.get(target.id)?.primaryKey;
        if (key) current.current.onSelectAgent(key);
      }
    };
    const onMove = event => {
      if (event.buttons) return;
      const target = pick(event); setHover(target?.kind === 'home' ? current.current.homes.get(target.id)?.name || '' : target?.label || ''); renderer.domElement.style.cursor = target ? 'pointer' : 'grab';
      selection.visible = Boolean(target);
      const position = target?.kind === 'building' ? current.current.city.byId[target.id] : current.current.homes.get(target?.id);
      if (position) { selection.position.set(wx(position.x), .4, wz(position.y)); selection.scale.setScalar(target.kind === 'home' ? .5 : 1); }
    };
    const onLost = event => { event.preventDefault(); current.current.onFallback(); };
    renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp); renderer.domElement.addEventListener('pointermove', onMove); renderer.domElement.addEventListener('webglcontextlost', onLost);
    const resize = () => {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      camera.aspect = rect.width / rect.height;
      const distance = fitDistance(camera.aspect);
      camera.position.sub(controls.target).multiplyScalar(distance / fittedDistance).add(controls.target);
      fittedDistance = distance;
      controls.position0.copy(initialDirection).multiplyScalar(distance);
      controls.maxDistance = Math.max(extent * 3.5, distance * 3.5);
      camera.far = Math.max(1000, controls.maxDistance + extent * 2);
      scene.fog.near = Math.max(260, distance + extent * .2); scene.fog.far = Math.max(540, distance + extent * 3);
      camera.updateProjectionMatrix(); controls.update(); renderer.setSize(rect.width, rect.height);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    let frame, last = performance.now(), elapsed = 0, lastRender = 0;
    const visibleFrustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
    function positionTraveler(mesh, route, progress, reverse = false) {
      const point = route.getPointAt(Math.max(0, Math.min(1, progress))), direction = route.getTangentAt(Math.max(0, Math.min(.9999, progress)));
      mesh.position.copy(point); mesh.rotation.y = Math.atan2(direction.x, direction.z) + (reverse ? Math.PI : 0);
    }
    const animate = now => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min((now - last) / 1000, .1); last = now;
      const live = current.current;
      if (!document.hidden && live.motion === 'active') elapsed += delta * live.speed;
      if (document.hidden || now - lastRender < 32) return; lastRender = now;
      homes.forEach(({ group, id }) => { group.visible = live.homeFilter === 'all' || live.homes.get(id)?.homeState === live.homeFilter; });
      markers.forEach(({ mesh, home, district }) => {
        const color = home ? stateColor(live.homes.get(home)?.homeState) : ['degraded', 'unavailable'].includes(live.districts.get(district)?.state) ? '#ffb75e' : live.districts.get(district)?.color || '#6e8490';
        mesh.material = material(color, true);
      });
      fleet.forEach(vehicle => {
        const resident = live.homes.get(vehicle.id);
        const visible = live.homeFilter === 'all' || resident?.homeState === live.homeFilter;
        const moving = live.motionScope === 'all' || resident?.homeState === 'working';
        const phase = moving ? ((elapsed + vehicle.index * 13.7) % (64 + vehicle.index % 7 * 4)) / (64 + vehicle.index % 7 * 4) : 0;
        const commute = phase < .68 ? dayProgress(phase, .08, .24) : 1 - dayProgress(phase, .68, .88);
        vehicle.car.visible = visible; positionTraveler(vehicle.car, vehicle.commute, commute, phase >= .68);
        vehicle.walker.visible = visible && moving && phase >= .36 && phase <= .65;
        const lunch = phase < .55 ? dayProgress(phase, .36, .46) : 1 - dayProgress(phase, .55, .65);
        positionTraveler(vehicle.walker, vehicle.lunch, lunch, phase >= .55);
      });
      highwayCars.forEach(({ car: vehicle, index }) => positionTraveler(vehicle, highwayCurve, ((elapsed + index * 5) % 64) / 64));
      controls.update(); renderer.render(scene, camera);
      visibleFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      renderer.domElement.dataset.motionTime = elapsed.toFixed(2);
      renderer.domElement.dataset.homes = String(homes.length);
      renderer.domElement.dataset.visibleHomes = String(homes.filter(home => home.group.visible).length);
      renderer.domElement.dataset.framedHomes = String(homes.filter(home => home.group.visible && home.corners.every(point => visibleFrustum.containsPoint(point))).length);
      renderer.domElement.dataset.rendered = 'true';
    };
    runtime.current = { camera, controls, renderer, zoom: savedCamera.current?.zoom || 1, rotate(angle) { const vector = camera.position.clone().sub(controls.target); vector.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle); camera.position.copy(controls.target).add(vector); controls.update(); } };
    frame = requestAnimationFrame(animate);
    return () => {
      savedCamera.current = { position: camera.position.clone(), target: controls.target.clone(), zoom: runtime.current?.zoom || 1, fitDistance: fittedDistance };
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('webglcontextlost', onLost);
      textures.forEach(texture => texture.dispose()); shapes.forEach(shape => shape.dispose()); materials.forEach(mat => mat.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); runtime.current = null;
    };
  }, [geometryKey]);
  useEffect(() => {
    const state = runtime.current; if (!state) return;
    const direction = state.camera.position.clone().sub(state.controls.target).multiplyScalar(state.zoom / zoom);
    state.camera.position.copy(state.controls.target).add(direction); state.zoom = zoom; state.controls.update();
  }, [zoom]);
  useEffect(() => {
    const state = runtime.current; if (!state) return;
    state.controls.reset(); state.zoom = 1;
    if (area !== 'all') {
      const [left, top, width, height] = (area === 'homes' ? current.current.city.homesView : current.current.city.buildingsView).split(' ').map(Number);
      const target = new THREE.Vector3((left + width / 2 - current.current.city.width / 2) / 10, 0, (top + height / 2 - current.current.city.height / 2) / 10);
      const offset = state.camera.position.clone().sub(state.controls.target).multiplyScalar(.82);
      state.controls.target.copy(target); state.camera.position.copy(target).add(offset); state.controls.update();
    }
  }, [resetKey, area]);
  return <div className="lc-3d-wrap">
    <div ref={host} className="lc-3d-scene" />
    <div className="lc-3d-navigation"><button type="button" aria-label="Rotate city left" onClick={() => runtime.current?.rotate(-Math.PI / 8)}>↶</button><button type="button" aria-label="Rotate city right" onClick={() => runtime.current?.rotate(Math.PI / 8)}>↷</button><span>{hover || 'Drag to orbit · Pinch or scroll to zoom'}</span></div>
  </div>;
}

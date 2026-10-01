import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CITY_NATURE } from '../local/cityNature';
import { CITY_DOWNTOWN } from '../local/cityDowntown';

// Decorative city simulation. It never represents measured traffic or member activity.
export default function MapCityScene({ homes, cities, overview, motion, theme, title, selected, onSelect, onCitySelect, onCivicSelect, resetKey, onFallback }) {
  const host = useRef(null), current = useRef(null), wake = useRef(null), renderBudget = useRef({ lightweight: false, illustrated: false });
  current.current = { motion, onSelect, onCitySelect, onCivicSelect, onFallback };
  const shape = JSON.stringify(overview ? cities.map(city => [city.id, city.label, city.sources]) : homes);
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch { current.current.onFallback(); return; }
    // Start at full practical quality. Slow devices can lower pixel density without
    // dropping cities, interactions, or animation objects from the model.
    const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    let pixelRatio = maxPixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.domElement.setAttribute('aria-label', overview ? 'All 16 nature cities connected to UFI downtown. Drag to explore or select a city or building.' : title + '. Select a source house for topics.');
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfecf2');
    scene.fog = new THREE.Fog('#dfecf2', overview ? 240 : 110, overview ? 410 : 210);
    let environmentTarget = null;
    if (!renderBudget.current.lightweight) {
      const environment = new RoomEnvironment();
      const environmentGenerator = new THREE.PMREMGenerator(renderer);
      environmentTarget = environmentGenerator.fromScene(environment, .035);
      environment.dispose(); environmentGenerator.dispose();
    }
    scene.environment = environmentTarget?.texture || null;
    scene.environmentIntensity = .3;
    const world = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 500);
    const rows = Math.max(2, Math.ceil(homes.length / 3));
    const length = 9 + rows * 4.5, middle = length / 2 - 4;
    const target = new THREE.Vector3(0, overview ? -3 : 0, overview ? 0 : middle);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target); controls.maxPolarAngle = Math.PI * .46;
    controls.minDistance = overview ? 20 : 8; controls.maxDistance = overview ? 200 : 65;
    controls.enableDamping = true; controls.dampingFactor = .08;
    scene.add(new THREE.HemisphereLight('#eaf6ff', '#8b9d77', .85));
    const sun = new THREE.DirectionalLight('#fff1d5', 2.1);
    sun.position.set(-44, 72, 36); sun.castShadow = true;
    const shadowExtent = overview ? 71 : 31;
    const shadowSize = Math.min(renderer.capabilities.maxTextureSize, overview && (element.clientWidth || 680) >= 700 ? 4096 : 2048);
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 190 });
    sun.shadow.normalBias = .06; sun.shadow.bias = -.00015; sun.shadow.radius = 3;
    sun.target.position.set(0, 0, overview ? 0 : middle);
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#b6dbff', .38); fill.position.set(40, 25, -35); scene.add(fill);
    const geometries = new Map(), materials = new Map(), colors = new Map(), textures = [], records = [], animations = [], batches = [];
    const waterColors = new Set(Object.values(CITY_NATURE).map(item => item.water));
    const glassColors = new Set(['#d7eef0', '#93bac5', '#709da8', '#8db6c8']);
    const matrix = new THREE.Matrix4();
    function geometry(kind) {
      if (!geometries.has(kind)) geometries.set(kind, kind === 'box' ? new THREE.BoxGeometry(1, 1, 1)
        : kind === 'roundbox' ? new RoundedBoxGeometry(1, 1, 1, overview ? 1 : 2, .055)
        : kind === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 1, overview ? 8 : 16)
        : kind === 'wheel' ? new THREE.TorusGeometry(1, .17, 4, overview ? 8 : 16)
        : kind === 'cone' ? new THREE.ConeGeometry(1, 1, overview ? 6 : 10)
        : kind === 'roof' ? new THREE.ConeGeometry(1, 1, 4)
        : kind === 'ring' ? new THREE.RingGeometry(.83, 1, overview ? 16 : 28)
        : new THREE.IcosahedronGeometry(1, overview ? 1 : 2));
      return geometries.get(kind);
    }
    function material(color, glow = false) {
      // Instance colors preserve every city's palette without one draw call per
      // paint color. Only genuinely different surface types need a material.
      const key = color === 'contact' ? 'contact' : glow ? 'glow' : glassColors.has(color) ? 'glass' : waterColors.has(color) ? 'water' : 'matte';
      if (!materials.has(key)) {
        if (key === 'contact') {
          materials.set(key, new THREE.MeshBasicMaterial({ color: '#2c4850', transparent: true, opacity: .15, depthWrite: false }));
          return materials.get(key);
        }
        const glass = key === 'glass', water = key === 'water';
        const surface = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: glass ? .18 : water ? .22 : .77,
          metalness: glass ? .32 : water ? .22 : .035, ...(glow ? { emissive: '#fff1cf', emissiveIntensity: .12 } : {}) });
        surface.userData.citySurface = key; materials.set(key, surface);
      }
      return materials.get(key);
    }
    function group(x = 0, z = 0, scale = 1, moving = false) {
      const item = new THREE.Group(); item.position.set(x, 0, z); item.scale.setScalar(scale);
      item.userData.moving = moving; world.add(item); return item;
    }
    function form(parent, kind, color, x, y, z, w, h, d, pick = null, moving = false, glow = false) {
      const node = new THREE.Object3D(); node.position.set(x, y, z); node.scale.set(w, h, d); parent.add(node);
      if (!colors.has(color)) colors.set(color, new THREE.Color(color === 'contact' ? '#ffffff' : color));
      records.push({ node, geometry: geometry(kind), material: material(color, glow), color: colors.get(color), pick,
        moving: moving || parent.userData.moving, shadow: h > .16 && kind !== 'ring' && !glow });
      return node;
    }
    const box = (parent, color, x, y, z, w, h, d, pick) => form(parent, 'box', color, x, y, z, w, h, d, pick);
    const roundedBox = (parent, color, x, y, z, w, h, d, pick) => form(parent, 'roundbox', color, x, y, z, w, h, d, pick);
    const ball = (parent, color, x, y, z, r, moving = false) => form(parent, 'ball', color, x, y, z, r, r, r, null, moving);
    function cylinder(parent, color, x, y, z, radius, height, pick = null) {
      return form(parent, 'cylinder', color, x, y, z, radius, height, radius, pick);
    }
    function beam(parent, color, from, to, width = .07, depth = width) {
      const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
      const node = box(parent, color, (start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2, width, start.distanceTo(end), depth);
      node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
      return node;
    }
    function streetLight(parent, x, z, phase = 0) {
      cylinder(parent, '#637887', x, 1.45, z, .055, 2.9);
      box(parent, '#637887', x + .28, 2.88, z, .65, .08, .1);
      form(parent, 'roundbox', '#fff0ba', x + .54, 2.82, z, .32, .08, .22, null, false, true);
      const signal = form(parent, 'ball', '#90ddb9', x, 1.2, z + .075, .07, .1, .03, null, true, true);
      animations.push(time => { signal.scale.y = .075 + .025 * Math.sin(time * 1.1 + phase); });
    }
    function bench(parent, x, z, rotation = 0) {
      const seat = new THREE.Group(); seat.position.set(x, 0, z); seat.rotation.y = rotation; parent.add(seat);
      box(seat, '#a98b64', 0, .44, 0, 1.15, .11, .44);
      box(seat, '#a98b64', 0, .78, -.2, 1.15, .42, .07);
      for (const offset of [-.42, .42]) box(seat, '#667777', offset, .23, 0, .09, .43, .38);
    }
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
      cylinder(parent, '#947356', x, .65, z, .095, 1.3);
      const pine = ['pines', 'alpine'].includes(landscape.feature);
      const crown = form(parent, pine ? 'cone' : 'ball', landscape.leaves, x, 1.7, z, .7, pine ? 1.9 : .75, .7, null, true);
      animations.push(time => { crown.rotation.z = Math.sin(time * 1.4 + index) * .065; crown.rotation.x = Math.cos(time + index) * .035; });
      if (pine) form(parent, 'cone', landscape.leaves, x, 2.23, z, .53, 1.35, .53);
      else if (landscape.feature !== 'coast') {
        ball(parent, landscape.leaves, x - .35, 1.55, z + .14, .53);
        ball(parent, landscape.leaves, x + .33, 1.75, z - .12, .49);
      }
      if (landscape.feature === 'coast') {
        crown.scale.set(.8, .16, .8);
        for (let i = 0; i < 4; i++) { const leaf = box(parent, landscape.leaves, x, 1.68, z, 1.85, .09, .25); leaf.rotation.y = i * Math.PI / 4; }
      }
      if (['orchard', 'grove'].includes(landscape.feature)) {
        ball(parent, landscape.flowers, x + .35, 1.6, z + .32, .16);
        ball(parent, landscape.flowers, x - .28, 1.89, z + .27, .13);
      }
    }
    function pond(parent, landscape, x, z, radius) {
      const bank = ball(parent, '#c8c3aa', x, -.03, z, radius * 1.12); bank.scale.y = .09;
      const pool = ball(parent, landscape.water, x, .04, z, radius); pool.scale.y = .06;
      for (let i = 0; i < 3; i++) {
        const ring = form(parent, 'ring', '#d8f6f4', x, .12 + i * .003, z, radius, radius, 1, null, true);
        ring.rotation.x = -Math.PI / 2;
        animations.push(time => { const size = radius * (.2 + ((time * .17 + i / 3) % 1) * .7); ring.scale.set(size, size * .75, 1); });
      }
    }
    function fountain(parent, x, z, radius = 1.5) {
      cylinder(parent, '#d9ddd6', x, .18, z, radius, .36);
      cylinder(parent, '#82baca', x, .38, z, radius * .88, .06);
      cylinder(parent, '#bdc7c8', x, .7, z, .18, .6);
      cylinder(parent, '#e5e9e3', x, .98, z, .5, .13);
      for (let i = 0; i < 24; i++) {
        const drop = ball(parent, '#c7eff7', x, 1, z, .075, true);
        const angle = i * Math.PI * 2 / 8;
        animations.push(time => {
          const progress = (time * .65 + i / 24) % 1;
          drop.position.set(x + Math.cos(angle) * progress * radius * .82, .45 + 2.3 * (1 - progress) * progress + (1 - progress) * .55, z + Math.sin(angle) * progress * radius * .82);
          drop.scale.set(.055, .075 + .09 * progress, .055);
        });
      }
      for (let i = 0; i < 2; i++) {
        const ripple = form(parent, 'ring', '#def7f8', x, .426, z, 1, 1, 1, null, true);
        ripple.rotation.x = -Math.PI / 2;
        animations.push(time => { const size = radius * (.18 + ((time * .25 + i / 2) % 1) * .65); ripple.scale.set(size, size, 1); });
      }
    }
    function neighborhood(parent, cityHomes, landscape, name, compact = false, cityId = '') {
      const countRows = Math.max(2, Math.ceil(cityHomes.length / 3)), depth = 9 + countRows * 4.5, mid = depth / 2 - 4;
      const cityPick = compact ? { city: cityId } : null;
      roundedBox(parent, '#d0d5bc', 0, -.61, mid, 24.3, .85, depth + 7.3, cityPick);
      roundedBox(parent, landscape.ground, 0, -.28, mid, 24, .6, depth + 7, cityPick);
      box(parent, '#76888e', 0, .045, mid, 2, .07, depth + 2);
      for (const side of [-1, 1]) box(parent, '#d9d8ca', side * 1.18, .075, mid, .35, .1, depth + 2);
      box(parent, '#e6e4db', 0, .05, -3, 17, .1, 4.2);
      for (let z = -5; z < depth - 2; z += 2.8) box(parent, '#f4f0d3', 0, .065, z, .1, .025, 1.25);
      if (!compact) {
        [['Sources', -5], ['Your city', 0], ['Collection', 5]].forEach(([name, x], i) => {
          const pick = { civic: i === 0 ? 'sources' : i === 1 ? 'topics' : 'collection' };
          roundedBox(parent, '#eae8df', x, 1.05, -3, 3.4, 2, 2.4, pick);
          box(parent, '#66838b', x, 2.1, -3, 3.65, .2, 2.65, pick);
          box(parent, '#709da8', x, .8, -1.76, 1, 1.5, .06);
          for (const offset of [-1.08, 1.08]) box(parent, '#8db6c8', x + offset, 1.15, -1.78, .66, .76, .06);
          box(parent, '#a6b8aa', x, 2.31, -3.05, 2.9, .22, 1.7);
          label(parent, name, x, 3.15, -3, 3.5);
        });
      }
      cityHomes.forEach((home, index) => {
        const x = [-6.7, -2.9, 5.2][index % 3], z = 2.2 + Math.floor(index / 3) * 4.5;
        const pick = { source: home.id, ...(compact ? { city: cityId } : {}) };
        roundedBox(parent, '#e8e3d7', x, .13, z, 3.1, .18, 2.8, pick);
        roundedBox(parent, home.id === selected && !compact ? '#c0ded1' : ['#f1ebdd', '#e6e7df', '#e3d5c0'][index % 3], x, .85, z, 2.15, 1.4, 1.85, pick);
        const roof = form(parent, 'roof', ['#657b80', '#846c62', '#647a72'][index % 3], x, 1.98, z, 1.77, .86, 1.77, pick); roof.rotation.y = Math.PI / 4;
        box(parent, '#d4b89d', x - .58, 2.21, z - .22, .22, .68, .25);
        const panel = box(parent, '#486e83', x + .52, 2.13, z + .34, .75, .06, .67); panel.rotation.z = -.28;
        box(parent, '#f7f0e3', x, 1.59, z + .94, 2.35, .13, .16);
        box(parent, '#977559', x, .68, z + .94, .45, 1.1, .06);
        [-.65, .65].forEach(offset => {
          box(parent, '#f7f0e3', x + offset, 1.0, z + .953, .55, .63, .08);
          form(parent, 'box', '#e7c484', x + offset, 1.0, z + 1.002, .4, .48, .04, null, false, true);
          box(parent, '#f7f0e3', x + offset, 1.0, z + 1.031, .035, .47, .03);
        });
        box(parent, '#8db6c8', x + 1.085, 1, z, .04, .47, .5);
        roundedBox(parent, '#cbbfa7', x, .21, z + 1.07, .76, .17, .43);
        ball(parent, landscape.leaves, x - 1.1, .43, z + 1.13, .29);
        ball(parent, landscape.flowers, x + 1.1, .36, z + 1.13, .23);
        box(parent, '#e4e1d6', x / 2, .07, z + 1.65, Math.abs(x) + 1, .04, .65);
        if (index % 3 === 0) streetLight(parent, 1.65, z + 1.5, index);
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
      if (!compact) {
        fountain(parent, 5, depth - 1.5, 1.35);
        bench(parent, 3.25, depth - 1.5, Math.PI / 2);
        bench(parent, 7, depth - 1.5, -Math.PI / 2);
      }
      if (compact) label(parent, name, 0, 4.1, -2, 14);
    }
    const central = group(), cityPortals = [];
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
        cityPortals.push({ x, z, horizontal: Math.abs(x) === 38 });
      });
      const positions = [[-12, -12], [0, -13], [12, -12], [-13, 0], [13, 0], [-12, 12], [0, 13], [12, 12]];
      CITY_DOWNTOWN.forEach((building, index) => {
        const [x, z] = positions[index], pick = { civic: building.id };
        roundedBox(central, '#ece7dd', x, .16, z, 7.8, .3, 6.8, pick);
        roundedBox(central, building.color, x, building.height / 2, z, 5.4, building.height, 4.8, pick);
        roundedBox(central, '#e5eced', x, building.height + .15, z, 5.7, .3, 5.1, pick);
        for (let floor = 1; floor < building.height; floor += 1.1) {
          box(central, '#c1d0ce', x, floor + .43, z, 5.49, .095, 4.89);
          for (let window = -1; window <= 1; window++) {
            for (const side of [-1, 1]) {
              form(central, 'box', '#d7eef0', x + window * 1.3, floor, z + side * 2.43, .88, .67, .08, null, false, true);
              form(central, 'box', '#8db6c8', x + side * 2.72, floor, z + window * 1.15, .08, .67, .74);
            }
          }
        }
        roundedBox(central, '#b4c2bc', x, .65, z + 2.67, 2.3, .12, .95);
        box(central, '#8db6c8', x, .95, z + 2.45, 1.28, 1.6, .09);
        if (index % 2 === 0) {
          roundedBox(central, '#758d8c', x, building.height + .8, z, 3.1, 1, 2.7, pick);
          box(central, '#aec397', x, building.height + 1.33, z, 2.8, .12, 2.4);
          for (const side of [-1, 1]) ball(central, CITY_NATURE.people.leaves, x + side, building.height + 1.57, z - .7, .37);
        } else {
          for (const offset of [-.85, .85]) {
            const solar = box(central, '#486e83', x + offset, building.height + .43, z, 1.35, .09, 2.6); solar.rotation.x = -.18;
          }
        }
        bench(central, x - 2.7, z + 3, 0);
        for (const side of [-1, 1]) {
          roundedBox(central, '#d1c7b5', x + side * 3.1, .43, z - 2.45, .8, .4, .8);
          ball(central, '#8faa83', x + side * 3.1, .94, z - 2.45, .55);
        }
        label(central, building.label, x, building.height + 2, z, 10.5);
      });
      roundedBox(central, '#f6f6ef', 0, 4.3, 0, 4.6, 8.6, 4.6, { civic: 'feed' });
      roundedBox(central, '#507da3', 0, 9.1, 0, 3.8, 1, 3.8);
      for (let floor = 1; floor < 8; floor++) {
        for (const side of [-1, 1]) {
          box(central, '#709da8', side * 2.32, floor, 0, .08, .53, 3.65);
          box(central, '#709da8', 0, floor, side * 2.32, 3.65, .53, .08);
        }
      }
      box(central, '#086ef9', -1.2, 11.5, 0, .75, 3, .75);
      box(central, '#178cff', 1.2, 11.5, 0, .75, 3, .75);
      box(central, '#086ef9', 0, 10.1, 0, 3.1, .75, .75);
      label(central, 'UFIConnect', 0, 14.1, 0, 11);
      for (const side of [-1, 1]) for (let i = -3; i <= 3; i++) {
        tree(central, CITY_NATURE.people, side * 21, i * 6, i);
        streetLight(central, side * 23.5, i * 7, i);
        streetLight(central, i * 7, side * 23.5, i + 3);
      }
      fountain(central, 5.5, 5.5, 2.25);
      fountain(central, -5.5, -5.5, 1.65);
      // Real sidewalks and crossings give pedestrian routes a visible purpose.
      for (const side of [-1, 1]) {
        box(central, '#dedccf', side * 18, .055, 0, 1, .1, 37);
        box(central, '#dedccf', 0, .055, side * 18, 37, .1, 1);
        for (let i = -3; i <= 3; i++) {
          box(central, '#f7f2e4', i * .48, .092, side * 26, .23, .025, 3.3);
          box(central, '#f7f2e4', side * 26, .092, i * .48, 3.3, .025, .23);
        }
      }
    } else neighborhood(central, homes, theme, title);
    // Cars and pedestrians follow continuous closed routes, never teleport across the scene.
    function route(time, radiusX, radiusZ, centerZ = 0, offset = 0) {
      const progress = ((time + offset) % 1 + 1) % 1, side = Math.floor(progress * 4), t = progress * 4 - side;
      return side === 0 ? [-radiusX + 2 * radiusX * t, centerZ - radiusZ, Math.PI / 2]
        : side === 1 ? [radiusX, centerZ - radiusZ + 2 * radiusZ * t, 0]
        : side === 2 ? [radiusX - 2 * radiusX * t, centerZ + radiusZ, -Math.PI / 2]
        : [-radiusX, centerZ + radiusZ - 2 * radiusZ * t, Math.PI];
    }
    // Arc-length paths keep transit at a consistent speed through rounded corners.
    function loopPath(radius, corner = 2.1) {
      const path = new THREE.CurvePath();
      const points = [[-radius + corner, -radius], [radius - corner, -radius], [radius, -radius + corner], [radius, radius - corner],
        [radius - corner, radius], [-radius + corner, radius], [-radius, radius - corner], [-radius, -radius + corner]];
      const corners = [[radius, -radius], [radius, radius], [-radius, radius], [-radius, -radius]];
      const point = ([x, z]) => new THREE.Vector3(x, 0, z);
      for (let i = 0; i < 8; i += 2) {
        path.add(new THREE.LineCurve3(point(points[i]), point(points[i + 1])));
        path.add(new THREE.QuadraticBezierCurve3(point(points[i + 1]), point(corners[i / 2]), point(points[(i + 2) % 8])));
      }
      path.updateArcLengths(); return path;
    }
    if (overview) {
      const transitPath = loopPath(29.8), transitLength = transitPath.getLength();
      const firstStation = transitPath.curves[0].getLength() / (2 * transitLength);
      for (const side of [-1, 1]) {
        box(central, '#bfc9bd', side * 29.8, .03, 0, 1.65, .06, 55.8);
        box(central, '#bfc9bd', 0, .03, side * 29.8, 55.8, .06, 1.65);
        for (const corner of [-1, 1]) cylinder(central, '#bfc9bd', side * 27.7, .03, corner * 27.7, 2.7, .06);
      }
      for (const radius of [29.43, 30.17]) {
        const points = loopPath(radius).getSpacedPoints(180);
        for (let i = 1; i < points.length; i++) beam(central, '#88999d', [points[i - 1].x, .11, points[i - 1].z], [points[i].x, .11, points[i].z], .045, .045);
      }
      const stops = [[0, -29.8, 0], [29.8, 0, Math.PI / 2], [0, 29.8, 0], [-29.8, 0, Math.PI / 2]];
      stops.forEach(([x, z, rotation]) => {
        const stop = group(x, z); stop.rotation.y = rotation;
        roundedBox(stop, '#e4e1d8', 0, .2, 1.3, 5, .35, 1.4);
        roundedBox(stop, '#8db6c8', 0, 1.32, 1.8, 4.1, 1.8, .08);
        box(stop, '#e6ede7', 0, 2.31, 1.3, 4.5, .12, 1.5);
        bench(stop, 0, 1.45);
        streetLight(stop, 2.9, 1.5);
      });
      for (let train = 0; train < 3; train++) for (let carriage = 0; carriage < 2; carriage++) {
        const tram = group(0, 0, 1, true);
        roundedBox(tram, '#e8eee8', 0, .73, 0, 1.18, 1.25, 3.35);
        roundedBox(tram, '#4b9298', 0, .32, 0, 1.2, .45, 3.4);
        roundedBox(tram, '#93bac5', 0, .96, 1.63, 1.02, .68, .055);
        for (const side of [-1, 1]) for (const offset of [-1.05, 0, 1.05]) box(tram, '#93bac5', side * .603, .99, offset, .045, .58, .76);
        box(tram, '#5b727b', 0, 1.45, 0, .5, .13, 1.3);
        cylinder(tram, 'contact', 0, .065, 0, 1, .014).scale.set(.77, .014, 1.85);
        const position = new THREE.Vector3(), tangent = new THREE.Vector3();
        animations.push(time => {
          // Each circuit pauses briefly at four stations, then smoothly accelerates.
          const clock = time * .061 + train * 4 / 3;
          const station = Math.floor(clock), portion = clock - station;
          const travel = Math.max(0, Math.min(1, (portion - .12) / .88));
          const eased = travel * travel * (3 - 2 * travel);
          const phase = ((firstStation + (station + eased) / 4 - carriage * 3.75 / transitLength) % 1 + 1) % 1;
          transitPath.getPointAt(phase, position); transitPath.getTangentAt(phase, tangent);
          tram.position.set(position.x, .02, position.z); tram.rotation.y = Math.atan2(tangent.x, tangent.z);
        });
      }
      cityPortals.forEach(({ x, z, horizontal }, index) => {
        const shuttle = group(0, 0, .62, true);
        roundedBox(shuttle, index % 2 ? '#e8b86d' : '#dceadf', 0, .52, 0, 1.15, .92, 1.9);
        box(shuttle, '#93bac5', 0, .72, .96, .86, .42, .055);
        box(shuttle, '#425660', 0, .17, -.57, 1.25, .25, .22);
        box(shuttle, '#425660', 0, .17, .57, 1.25, .25, .22);
        cylinder(shuttle, 'contact', 0, .06, 0, 1, .015).scale.set(.8, .015, 1.2);
        animations.push(time => {
          const cycle = (time * .06 + index / cityPortals.length) % 1;
          const outbound = cycle < .5, portion = outbound ? cycle * 2 : (1 - cycle) * 2;
          const t = Math.max(0, Math.min(1, (portion - .12) / .76));
          const direction = Math.sign(horizontal ? x : z);
          const along = direction * (27 + t * 9);
          shuttle.position.set(horizontal ? along : x + (outbound ? .3 : -.3), .08, horizontal ? z + (outbound ? -.3 : .3) : along);
          shuttle.rotation.y = (horizontal ? Math.PI / 2 : 0) + (direction * (outbound ? 1 : -1) < 0 ? Math.PI : 0);
        });
      });
    }
    const traffic = overview ? 32 : 8;
    for (let i = 0; i < traffic; i++) {
      const car = group(0, 0, overview ? 1 : .68, true);
      roundedBox(car, ['#4d8dba', '#e5b675', '#faf2da', '#b98489'][i % 4], 0, .34, 0, .95, .48, 1.85);
      roundedBox(car, '#93bac5', 0, .67, -.08, .78, .4, 1);
      box(car, '#343e43', 0, .17, -.57, 1.1, .25, .22); box(car, '#343e43', 0, .17, .57, 1.1, .25, .22);
      cylinder(car, 'contact', 0, .045, 0, 1, .012).scale.set(.68, .012, 1.08);
      for (const side of [-1, 1]) {
        form(car, 'box', '#fff0ba', side * .3, .42, .94, .18, .12, .035, null, false, true);
        form(car, 'box', '#df8976', side * .3, .42, -.94, .18, .12, .035, null, false, true);
      }
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
      const leftArm = box(walker, '#ccac90', -.2, .65, 0, .085, .44, .11), rightArm = box(walker, '#ccac90', .2, .65, 0, .085, .44, .11);
      animations.push(time => {
        const pos = overview ? route(time * .008, i % 2 ? 22 : 18, i % 2 ? 22 : 18, 0, i / 42)
          : route(time * .015, 1.65 + i % 2 * .45, length / 2, middle, i / 18);
        walker.position.set(pos[0], .1 + Math.abs(Math.sin(time * 5 + i)) * .035, pos[1]); walker.rotation.y = pos[2];
        left.rotation.x = Math.sin(time * 5 + i) * .45; right.rotation.x = -left.rotation.x;
        leftArm.rotation.x = -left.rotation.x * .65; rightArm.rotation.x = left.rotation.x * .65;
      });
    }
    for (let i = 0; i < (overview ? 10 : 4); i++) {
      const bike = group(0, 0, overview ? .95 : .7, true);
      const wheels = [-.46, .46].map(z => {
        const wheel = form(bike, 'wheel', '#4e6067', 0, .35, z, .3, .3, .3); wheel.rotation.y = Math.PI / 2;
        beam(bike, '#b8c9c8', [-.06, .35, z], [.06, .35, z], .055);
        return wheel;
      });
      beam(bike, '#ce9f6e', [0, .36, -.46], [0, .8, -.12], .06);
      beam(bike, '#ce9f6e', [0, .8, -.12], [0, .35, .46], .06);
      beam(bike, '#ce9f6e', [0, .35, -.46], [0, .38, .09], .06);
      beam(bike, '#ce9f6e', [0, .38, .09], [0, .9, .36], .06);
      beam(bike, '#ce9f6e', [0, .8, -.12], [0, .9, .36], .06);
      const torso = roundedBox(bike, i % 2 ? '#6894aa' : '#c7a36c', 0, 1.09, -.025, .32, .45, .25); torso.rotation.x = .27;
      ball(bike, '#cdb194', 0, 1.44, .075, .17);
      ball(bike, '#f0e9d8', 0, 1.52, .075, .17).scale.y = .1;
      beam(bike, '#cdb194', [-.18, 1.12, .05], [-.18, .94, .36], .075);
      beam(bike, '#cdb194', [.18, 1.12, .05], [.18, .94, .36], .075);
      const leftLeg = box(bike, '#526373', -.12, .7, -.03, .11, .45, .12), rightLeg = box(bike, '#526373', .12, .7, -.03, .11, .45, .12);
      animations.push(time => {
        const pos = overview ? route(time * .017, 22.6, 22.6, 0, i / 10) : route(time * .026, 1.38, length / 2, middle, i / 4);
        bike.position.set(pos[0], .12, pos[1]); bike.rotation.y = pos[2];
        wheels.forEach(wheel => { wheel.rotation.z = time * 5; });
        leftLeg.rotation.x = Math.sin(time * 6 + i) * .46; rightLeg.rotation.x = -leftLeg.rotation.x;
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
      // Static city shadows are cached. Moving instances use inexpensive contact
      // shadows, avoiding a full-city depth render on every animation frame.
      const key = record.geometry.uuid + ':' + record.material.uuid + ':' + record.moving;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(record);
    }
    const pickMeshes = [];
    for (const members of grouped.values()) {
      const instanced = new THREE.InstancedMesh(members[0].geometry, members[0].material, members.length);
      const moving = members.map((item, index) => ({ ...item, index })).filter(item => item.moving);
      members.forEach((item, index) => { instanced.setMatrixAt(index, item.node.matrixWorld); instanced.setColorAt(index, item.color); });
      instanced.userData.targets = members.map(item => item.pick);
      instanced.castShadow = !members[0].moving && members.some(item => item.shadow);
      instanced.receiveShadow = members[0].material.type !== 'MeshBasicMaterial';
      if (moving.length) { instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instanced.frustumCulled = false; }
      if (members.some(item => item.pick)) pickMeshes.push(instanced);
      scene.add(instanced); batches.push({ instanced, moving });
    }
    let lightweight = false, illustrated = false;
    function useResponsiveMaterials() {
      if (lightweight) return;
      lightweight = true; renderBudget.current.lightweight = true;
      // Software GPUs can spend hundreds of milliseconds shading tiny physical
      // surfaces. Keep the complete model and activity, but use vertex lighting
      // when measured frame cost says the physical shaders cannot keep up.
      scene.environment = null; renderer.shadowMap.enabled = false;
      if (!geometries.has('responsiveBall')) geometries.set('responsiveBall', new THREE.IcosahedronGeometry(1, 0));
      for (const { instanced } of batches) {
        // Tiny overview bevels and leaf facets contribute subpixel work. The
        // simpler meshes keep silhouettes, colors, roof details, and all picks.
        if (overview && instanced.geometry === geometries.get('roundbox')) instanced.geometry = geometry('box');
        if (overview && instanced.geometry === geometries.get('ball')) instanced.geometry = geometries.get('responsiveBall');
        const previous = instanced.material, surface = previous.userData.citySurface;
        if (!surface) continue;
        const key = 'responsive:' + surface;
        if (!materials.has(key)) {
          const surfaceMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff',
            ...(surface === 'glow' ? { emissive: '#fff1cf', emissiveIntensity: .12 } : {}) });
          surfaceMaterial.userData.citySurface = surface; materials.set(key, surfaceMaterial);
        }
        instanced.material = materials.get(key); instanced.receiveShadow = false; instanced.castShadow = false;
      }
    }
    function useIllustratedMaterials() {
      if (illustrated) return;
      useResponsiveMaterials(); illustrated = true; renderBudget.current.illustrated = true;
      // Last-resort software-GPU tier: bake soft directional shading once. This
      // retains dimensional surfaces without lighting every vertex every frame.
      for (const item of geometries.values()) {
        const normals = item.getAttribute('normal'); if (!normals) continue;
        const shades = new Float32Array(normals.count * 3);
        for (let i = 0; i < normals.count; i++) {
          const x = normals.getX(i), y = normals.getY(i), z = normals.getZ(i);
          const shade = .53 + .26 * Math.max(y, 0) + .2 * Math.max(-.45 * x + .78 * y + .42 * z, 0);
          shades.fill(shade, i * 3, i * 3 + 3);
        }
        item.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
      }
      for (const { instanced } of batches) {
        const surface = instanced.material.userData.citySurface; if (!surface) continue;
        const key = 'illustrated:' + surface;
        if (!materials.has(key)) materials.set(key, new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true }));
        instanced.material = materials.get(key);
      }
    }
    if (renderBudget.current.lightweight) useResponsiveMaterials();
    if (renderBudget.current.illustrated) useIllustratedMaterials();
    const movingRoots = world.children.filter(item => item.userData.moving);
    let frameId = 0, time = 0, last = 0, lastPaint = 0, inView = true, disposed = false;
    let sampledFrames = 0, sampledTime = 0, fastWindows = 0;
    function adaptResolution(elapsed) {
      if (elapsed <= 0 || current.current.motion === 'paused') return;
      sampledFrames++; sampledTime += Math.min(elapsed, 150);
      if (sampledFrames < 12 && sampledTime < 1000) return;
      const average = sampledTime / sampledFrames;
      sampledFrames = 0; sampledTime = 0;
      let nextRatio = pixelRatio;
      if (average > 50 && lightweight) useIllustratedMaterials();
      else if (average > 55) useResponsiveMaterials();
      if (average > 35) { nextRatio = Math.max(Math.min(lightweight ? .65 : .85, maxPixelRatio), pixelRatio - .2); fastWindows = 0; }
      else if (average < 21) { if (++fastWindows >= 4) { nextRatio = Math.min(maxPixelRatio, pixelRatio + .1); fastWindows = 0; } }
      else fastWindows = 0;
      if (Math.abs(nextRatio - pixelRatio) > .01) {
        pixelRatio = nextRatio; renderer.setPixelRatio(pixelRatio);
        renderer.setSize(element.clientWidth || 680, element.clientHeight || 580);
      }
    }
    function requestFrame() { if (!disposed && !frameId && inView && !document.hidden) frameId = requestAnimationFrame(frame); }
    function frame(now) {
      frameId = 0;
      if (disposed || !inView || document.hidden) { last = 0; return; }
      const playing = current.current.motion !== 'paused';
      if (playing && now - lastPaint < (current.current.motion === 'calm' ? 32 : 15)) { requestFrame(); return; }
      lastPaint = now;
      const elapsed = last ? now - last : 0;
      const delta = Math.min(elapsed / 1000, .05); last = now;
      if (playing) {
        adaptResolution(elapsed);
        time += delta * (current.current.motion === 'calm' ? .4 : 1);
        animations.forEach(animate => animate(time));
        // Compute an animated vehicle or person hierarchy once, not once per part.
        movingRoots.forEach(item => item.updateMatrixWorld(true));
        for (const batch of batches) if (batch.moving.length) {
          for (const item of batch.moving) {
            if (!item.node.parent.userData.moving) item.node.updateWorldMatrix(false, false);
            matrix.copy(item.node.matrixWorld); batch.instanced.setMatrixAt(item.index, matrix);
          }
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
    controls.addEventListener('change', requestFrame); wake.current = () => { last = 0; requestFrame(); };
    const ray = new THREE.Raycaster(); let start = null;
    const down = event => {
      if (start || !event.isPrimary || event.button !== 0) { start = null; return; }
      start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    };
    const up = event => {
      const origin = start; start = null;
      if (!origin || origin.pointerId !== event.pointerId || !event.isPrimary || event.button !== 0 || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const found = ray.intersectObjects(pickMeshes).map(hit => hit.object.userData.targets[hit.instanceId]).find(Boolean);
      if (found?.city) current.current.onCitySelect(found.city, found.source);
      else if (found?.source) current.current.onSelect(found.source);
      else if (found?.civic) current.current.onCivicSelect(found.civic);
    };
    const cancelPick = () => { start = null; };
    const move = event => {
      if (start && (start.pointerId !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6)) start = null;
    };
    const contextLost = event => { event.preventDefault(); current.current.onFallback(); };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', cancelPick);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    return () => {
      disposed = true; wake.current = null; cancelAnimationFrame(frameId);
      resizeObserver.disconnect(); visibility.disconnect(); document.removeEventListener('visibilitychange', visible);
      controls.removeEventListener('change', requestFrame); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', cancelPick);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      batches.forEach(({ instanced }) => instanced.dispose());
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
      sun.shadow.map?.dispose(); sun.shadow.mapPass?.dispose(); environmentTarget?.dispose(); scene.environment = null;
      scene.clear(); world.clear(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [shape, overview, theme, title, selected, resetKey]);
  useEffect(() => { wake.current?.(); }, [motion]);
  return <div ref={host} className={'map-city-scene' + (overview ? ' map-city-scene--all' : '')} />;
}

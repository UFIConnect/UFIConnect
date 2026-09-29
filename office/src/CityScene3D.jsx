import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCityGrid, cityJourney } from './city-streets.mjs';

// Scene units are a tenth of the street map's coordinates; a home is roughly 5.6 units wide.
const STATE_COLOR = { working: '#5ee0a6', inactive: '#a3b1ba', attention: '#ffb454', unobserved: '#4f6472' };
const stateColor = state => STATE_COLOR[state] || STATE_COLOR.unobserved;
const WALLS = ['#e7e0d3', '#d6dde2', '#cdbba5', '#e9dcc8', '#bcc8cd', '#dccabb'];
const ROOFS = ['#484d55', '#6d4c3d', '#56646d', '#83553f', '#5d5a55'];
const DOORS = ['#5a3b2a', '#2f4a5c', '#7a2f2d', '#3f5140'];
// Entrance viewpoints as [angle from the door's facing (positive leans toward the street), reach, height],
// tried in order. Each frames the whole house front with its door, from the lawn rather than over the street.
const ENTRANCE_VIEWS = [[.45, 10, 6.2], [-.45, 10, 6.2], [.85, 10, 6.8], [-.85, 10, 6.8], [0, 10.5, 7.5], [.45, 11, 9.5], [-.45, 11, 9.5], [0, 12, 12.5]];
// Offsets around the camera, in its own right/up axes, that must also see the door: a clear cone,
// so no tree or pole sits right in front of the lens.
const ENTRANCE_CONE = [[0, 0], [1.8, 0], [-1.8, 0], [0, 1.4], [0, -1.4]];
const CARS = ['#d9dde0', '#2d3a46', '#a8b3bb', '#8b2f2f', '#2f5b8b', '#e2c16c', '#1f2226', '#4f7d64'];
const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => 1 - (1 - clamp01(value)) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;
const dayProgress = (phase, start, end) => clamp01((phase - start) / (end - start));
function seeded(seed) { let state = (seed >>> 0) || 1; return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296; }

function canvasTexture(size, draw, repeat = [1, 1]) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(...repeat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
function speckle(ctx, size, base, tones, count, random, radius = 1.6) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = tones[Math.floor(random() * tones.length)];
    ctx.globalAlpha = .25 + random() * .45;
    ctx.fillRect(random() * size, random() * size, radius * (.5 + random()), radius * (.5 + random()));
  }
  ctx.globalAlpha = 1;
}
// Facade tiles are 4 bays by 4 floors. The emissive map lights a stable subset of windows at night.
function facadeTextures(style, seed) {
  const random = seeded(seed), lit = Array.from({ length: 16 }, () => random() < .48);
  const palette = [
    { wall: '#2b475c', glass: ['#35556c', '#4c7189'], frame: '#9fb4c2', inset: 3 },
    { wall: '#c8c1b4', glass: ['#243748', '#34506a'], frame: '#8e877b', inset: 14 },
    { wall: '#1d2830', glass: ['#26343f', '#3b5263'], frame: '#62737f', inset: 5 },
  ][style];
  const map = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = palette.wall; ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const x = col * 64 + palette.inset, y = row * 64 + palette.inset + 4, w = 64 - palette.inset * 2, h = 64 - palette.inset * 2 - 8;
      const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
      gradient.addColorStop(0, palette.glass[1]); gradient.addColorStop(1, palette.glass[0]);
      ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = palette.frame; ctx.fillRect(x + w / 2 - 1, y, 2, h);
    }
    ctx.fillStyle = palette.frame; for (let row = 0; row <= 4; row++) ctx.fillRect(0, row * 64 - 2, size, 4);
  });
  const emissiveMap = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    lit.forEach((on, index) => {
      if (!on) return;
      const col = index % 4, row = Math.floor(index / 4);
      ctx.fillStyle = random() < .5 ? '#ffd9a3' : '#fff1d6';
      ctx.fillRect(col * 64 + palette.inset, row * 64 + palette.inset + 4, 64 - palette.inset * 2, 64 - palette.inset * 2 - 8);
    });
  });
  return { map, emissiveMap, glass: style !== 1 };
}
function labelTexture(text, accent) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(11,23,33,.86)'; ctx.beginPath(); ctx.roundRect(4, 8, 504, 80, 40); ctx.fill();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(48, 48, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#eef5f8'; ctx.font = '600 34px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(text, 76, 50, 410);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
// A gable roof with its ridge along x; the front and back slopes face the street and yard.
function gableGeometry() {
  const p = [-.5, 0, .5, .5, 0, .5, .5, 1, 0, -.5, 1, 0, -.5, 0, -.5, .5, 0, -.5];
  const geometry = new THREE.BufferGeometry();
  const faces = [[0, 1, 2], [0, 2, 3], [5, 4, 3], [5, 3, 2], [1, 5, 2], [4, 0, 3], [0, 4, 5], [0, 5, 1]];
  const positions = [], uvs = [];
  for (const face of faces) for (const index of face) {
    positions.push(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
    uvs.push(p[index * 3] + .5, p[index * 3 + 1] + Math.abs(p[index * 3 + 2]));
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}
// Fit points in both screen axes and centre them, including the narrow field of view on phones.
function fitView(points, direction, fov, aspect, margin = 1.06) {
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, direction).normalize();
  const screenUp = new THREE.Vector3().crossVectors(direction, right);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2)), tanH = tanV * aspect;
  const target = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length || 1);
  const relative = new THREE.Vector3();
  const required = () => Math.max(...points.map(point => {
    relative.subVectors(point, target);
    return relative.dot(direction) + Math.max(Math.abs(relative.dot(right)) / tanH, Math.abs(relative.dot(screenUp)) / tanV);
  })) * margin;
  let distance = required();
  for (let pass = 0; pass < 5; pass++) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of points) {
      relative.subVectors(point, target);
      const depth = distance - relative.dot(direction);
      const x = relative.dot(right) / (depth * tanH), y = relative.dot(screenUp) / (depth * tanV);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    target.addScaledVector(right, (minX + maxX) / 2 * distance * tanH).addScaledVector(screenUp, (minY + maxY) / 2 * distance * tanV);
    distance = required();
  }
  return { target, distance };
}
const viewDirection = aspect => aspect < .9
  ? new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(12))
  : new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(53), THREE.MathUtils.degToRad(36));

export default function CityScene3D({ city, edges = [], motion, speed, motionScope, homeFilter, area, zoom, resetKey, selectedHomeId, onEnter, onSelectAgent, onFallback }) {
  const host = useRef(null), runtime = useRef(null), current = useRef(null), savedCamera = useRef(null);
  const [hover, setHover] = useState('');
  const [night, setNight] = useState(false);
  current.current = { city, edges, motion, speed, motionScope, homeFilter, selectedHomeId, night, onEnter, onSelectAgent, onFallback,
    homes: new Map(city.homes.map(home => [home.id, home])), districts: new Map(city.districts.map(district => [district.id, district])) };
  // Polling changes live status without destroying the camera or animation clock.
  const geometryKey = `${city.width}:${city.height}:${city.homes.map(home => `${home.id}:${home.x}:${home.y}`).join('|')}:${edges.map(edge => `${edge.from}>${edge.to}`).join(',')}`;
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { current.current.onFallback(); return undefined; }
    const compact = Math.min(window.innerWidth, window.innerHeight) < 700;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 1.75));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .86;
    renderer.domElement.setAttribute('aria-label', '3D city. Drag to orbit, scroll or pinch to zoom, and click a building or home to enter.');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = 0;
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Scene units are a tenth of the map; the scene is centred on the whole region, towns included.
    const W = city.width / 10, H = city.height / 10, CX = city.minX + city.width / 2, CZ = city.minY + city.height / 2;
    const wx = x => (x - CX) / 10, wz = z => (z - CZ) / 10;
    const textures = [], geometries = [], materialsList = [];
    const keep = (list, item) => { list.push(item); return item; };
    const standard = options => keep(materialsList, new THREE.MeshStandardMaterial(options));
    const basic = options => keep(materialsList, new THREE.MeshBasicMaterial(options));

    // Sky, sun and image-based lighting. The same sky renders the reflections in glass towers.
    const sky = new Sky(); sky.scale.setScalar(4500); scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms.turbidity.value = 3.2; skyUniforms.rayleigh.value = 1.25; skyUniforms.mieCoefficient.value = .004; skyUniforms.mieDirectionalG.value = .82;
    if (skyUniforms.cloudCoverage) { skyUniforms.cloudCoverage.value = .32; skyUniforms.cloudDensity.value = .35; }
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(sky.geometry, sky.material));
    envScene.children[0].scale.setScalar(4500);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let environment = null;
    const sunDirection = new THREE.Vector3();
    const sun = new THREE.DirectionalLight('#fff0d9', 2.5);
    sun.castShadow = true; sun.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048);
    const shadowSpan = Math.max(W, H) * .62;
    Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, near: 1, far: 600 });
    sun.shadow.bias = -.0004; sun.shadow.normalBias = .05; sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    const hemisphere = new THREE.HemisphereLight('#bcd4ea', '#4a5738', .5); scene.add(hemisphere);
    scene.fog = new THREE.Fog('#c9d6df', 300, 1400);
    const dayFog = new THREE.Color('#c9d6df'), nightFog = new THREE.Color('#0c1522');
    const daySun = new THREE.Color('#fff0d9'), moon = new THREE.Color('#9db6ff');
    function applyLighting(amount, refreshEnvironment) {
      const elevation = lerp(34, -7, amount), azimuth = 205;
      sunDirection.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
      skyUniforms.sunPosition.value.copy(sunDirection);
      const light = amount < .5 ? sunDirection : new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(120));
      sun.position.copy(light).multiplyScalar(260); sun.target.position.set(0, 0, 0);
      sun.color.copy(daySun).lerp(moon, amount); sun.intensity = lerp(2.5, .5, amount);
      hemisphere.intensity = lerp(.5, .24, amount);
      scene.fog.color.copy(dayFog).lerp(nightFog, amount);
      renderer.toneMappingExposure = lerp(.86, .78, amount);
      if (refreshEnvironment) {
        environment?.dispose();
        environment = pmrem.fromScene(envScene, 0, .1, 5000);
        scene.environment = environment.texture;
        scene.environmentIntensity = lerp(.42, .12, amount);
      }
    }
    applyLighting(current.current.night ? 1 : 0, true);
    let lighting = current.current.night ? 1 : 0;

    // Ground, the paved urban core and green blocks.
    const grass = keep(textures, canvasTexture(256, (ctx, size) => speckle(ctx, size, '#5b7c46', ['#6c8e52', '#4e6d3c', '#7a9a5c', '#4a6338'], 2600, seeded(3)), [220, 220]));
    const lawnTexture = keep(textures, canvasTexture(256, (ctx, size) => speckle(ctx, size, '#628748', ['#739a57', '#577a40', '#81a863'], 2200, seeded(7)), [3, 3]));
    const asphalt = keep(textures, canvasTexture(256, (ctx, size) => speckle(ctx, size, '#3b4046', ['#474d54', '#30353a', '#555b61'], 3800, seeded(11), 1.2), [1, 1]));
    const concrete = keep(textures, canvasTexture(256, (ctx, size) => {
      speckle(ctx, size, '#bdbab1', ['#c9c6bd', '#aeaba2', '#b5b2a9'], 1800, seeded(13));
      ctx.strokeStyle = 'rgba(90,88,80,.35)'; ctx.lineWidth = 2;
      for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
    }, [1, 1]));
    const siding = keep(textures, canvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(0,0,0,.09)'; for (let y = 0; y < size; y += 16) ctx.fillRect(0, y, size, 3);
    }, [2, 2]));
    const shingles = keep(textures, canvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
      const random = seeded(19);
      for (let y = 0; y < size; y += 12) for (let x = (y / 12) % 2 ? -8 : 0; x < size; x += 16) {
        ctx.fillStyle = `rgba(0,0,0,${.05 + random() * .12})`; ctx.fillRect(x, y, 15, 11);
      }
    }, [3, 2]));
    const ground = new THREE.Mesh(keep(geometries, new THREE.PlaneGeometry(3000, 3000)), standard({ map: grass, roughness: .96 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.03; ground.receiveShadow = true; scene.add(ground);

    // Flat pieces are merged by material so the whole street network costs a handful of draw calls.
    const flat = { asphalt: [], concrete: [], white: [], yellow: [], lawn: [] };
    function slab(kind, cx, cz, sizeX, sizeZ, y, rotation = 0, uvScale = 4, thickness = 0) {
      const geometry = thickness ? new THREE.BoxGeometry(sizeX, thickness, sizeZ) : new THREE.PlaneGeometry(sizeX, sizeZ).rotateX(-Math.PI / 2);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sizeX / uvScale, uv.getY(i) * sizeZ / uvScale);
      geometry.rotateY(rotation).translate(cx, y + (thickness ? thickness / 2 : 0), cz);
      flat[kind].push(geometry);
    }
    // Downtown is paved; each town gets its own paved core.
    const downtown = city.downtown;
    slab('concrete', wx(downtown.width / 2), wz(downtown.height / 2), downtown.width / 10 - 5, downtown.height / 10 - 5, 0, 0, 3);
    city.towns.forEach(town => slab('concrete', wx(town.x), wz(town.y), (town.right - town.left) / 10 + 4, (town.bottom - town.top) / 10 + 4, 0, 0, 3));
    const avenueX = downtown.avenueX, streetZ = downtown.streetY;
    const avenueWidth = col => col === 2 ? 4.4 : 2.6;
    const top = downtown.top, bottom = downtown.bottom, left = downtown.left, right = downtown.right;
    avenueX.forEach((x, col) => slab('asphalt', wx(x), wz((top + bottom) / 2), avenueWidth(col), (bottom - top) / 10, .05));
    streetZ.forEach(z => slab('asphalt', wx((left + right) / 2), wz(z), (right - left) / 10, 2.6, .051));
    // Highway ring with rounded corners, matching the route its traffic follows.
    const ringRadius = 4, ringWidth = 4.8;
    const [x0, x1, z0, z1] = [wx(left), wx(right), wz(top), wz(bottom)];
    slab('asphalt', (x0 + x1) / 2, z0, x1 - x0 - ringRadius * 2, ringWidth, .052);
    slab('asphalt', (x0 + x1) / 2, z1, x1 - x0 - ringRadius * 2, ringWidth, .052);
    slab('asphalt', x0, (z0 + z1) / 2, ringWidth, z1 - z0 - ringRadius * 2, .052);
    slab('asphalt', x1, (z0 + z1) / 2, ringWidth, z1 - z0 - ringRadius * 2, .052);
    for (const [cx, cz, start] of [[x0 + ringRadius, z0 + ringRadius, Math.PI], [x1 - ringRadius, z0 + ringRadius, Math.PI * 1.5], [x1 - ringRadius, z1 - ringRadius, 0], [x0 + ringRadius, z1 - ringRadius, Math.PI / 2]]) {
      const corner = new THREE.RingGeometry(ringRadius - ringWidth / 2, ringRadius + ringWidth / 2, 12, 1, start, Math.PI / 2).rotateX(-Math.PI / 2).translate(cx, .052, cz);
      corner.deleteAttribute('uv'); corner.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(corner.attributes.position.count * 2), 2));
      flat.asphalt.push(corner);
    }
    // Lane markings stop at junctions, where zebra crossings take over.
    const nearJunction = (value, list, gap) => list.some(item => Math.abs(value - item) < gap);
    avenueX.forEach((x, col) => {
      for (let z = top + 30; z < bottom - 30; z += 26) {
        if (nearJunction(z, streetZ, 26)) continue;
        if (col === 2) { slab('yellow', wx(x) - .12, wz(z), .1, 1.8, .07); slab('yellow', wx(x) + .12, wz(z), .1, 1.8, .07); slab('white', wx(x) - 1.15, wz(z), .1, 1, .07); slab('white', wx(x) + 1.15, wz(z), .1, 1, .07); }
        else slab('white', wx(x), wz(z), .12, 1.1, .07);
      }
    });
    streetZ.forEach(z => {
      for (let x = left + 30; x < right - 30; x += 26) if (!nearJunction(x, avenueX, 30)) slab('white', wx(x), wz(z), 1.1, .12, .071);
      avenueX.forEach((x, col) => {
        if (z <= top + 20 || z >= bottom - 20) return;
        const half = avenueWidth(col) / 2;
        for (const side of [-1, 1]) {
          for (let stripe = -2; stripe <= 2; stripe++) slab('white', wx(x) + side * (half + 1), wz(z) + stripe * .48, 1.2, .26, .072);
          for (let stripe = -2; stripe <= 2; stripe++) slab('white', wx(x) + stripe * (half / 2.6) * .98, wz(z) + side * (1.3 + 1), .26, 1.2, .072);
        }
      });
    });
    for (let x = left + 50; x < right - 50; x += 32) { slab('white', wx(x), z0 - .8, 1.4, .12, .072); slab('white', wx(x), z0 + .8, 1.4, .12, .072); slab('white', wx(x), z1 - .8, 1.4, .12, .072); slab('white', wx(x), z1 + .8, 1.4, .12, .072); }
    for (let z = top + 50; z < bottom - 50; z += 32) { slab('white', x0 - .8, wz(z), .12, 1.4, .072); slab('white', x0 + .8, wz(z), .12, 1.4, .072); slab('white', x1 - .8, wz(z), .12, 1.4, .072); slab('white', x1 + .8, wz(z), .12, 1.4, .072); }
    // Town streets, spurs, the beltway and its connectors into downtown, with centre markings between junctions.
    const OUTER_WIDTH = { 'town-avenue': 2.4, 'town-street': 2.4, spur: 3, connector: 3.4, beltway: 4.4 };
    const outerRoads = city.segments.filter(segment => OUTER_WIDTH[segment.kind]);
    const outerJunctions = city.junctions.map(([px, pz]) => [wx(px), wz(pz)]);
    outerRoads.forEach(({ a, b, kind }) => {
      const width = OUTER_WIDTH[kind], horizontal = a[1] === b[1];
      const [ax, az, bx, bz] = [wx(a[0]), wz(a[1]), wx(b[0]), wz(b[1])], length = Math.hypot(bx - ax, bz - az);
      slab('asphalt', (ax + bx) / 2, (az + bz) / 2, horizontal ? length + width : width, horizontal ? width : length + width, .049);
      const dash = kind === 'beltway' ? 'yellow' : 'white';
      for (let t = 3; t < length - 3; t += 2.6) {
        const px = lerp(ax, bx, t / length), pz = lerp(az, bz, t / length);
        if (outerJunctions.some(([jx, jz]) => Math.hypot(jx - px, jz - pz) < width + 1.2)) continue;
        slab(dash, px, pz, horizontal ? 1.1 : .12, horizontal ? .12 : 1.1, .07);
      }
    });
    // Lawns are raised above the curb.
    city.blocks.forEach(block => slab('lawn', wx(block.x), wz(block.y), block.lawn[0] / 10, block.lawn[1] / 10, 0, 0, 10, .22));

    const picks = [], markers = [], labels = [], buildingGroups = [];
    // Stage buildings: podium, tower, setback crown, rooftop plant and a lit sign in the district colour.
    const facades = [0, 1, 2].map(style => facadeTextures(style, 29 + style * 7));
    facades.forEach(facade => { textures.push(facade.map, facade.emissiveMap); });
    const windowMaterials = [];
    city.districts.forEach((district, index) => {
      const x = wx(district.x), z = wz(district.y), h = district.height / 4.6;
      const destination = { kind: 'building', id: district.id, label: district.label };
      const facade = facades[index % 3];
      const faceMaterial = (width, height) => {
        const map = facade.map.clone(), emissiveMap = facade.emissiveMap.clone();
        map.repeat.set(width / 6, height / 7.5); emissiveMap.repeat.copy(map.repeat); map.needsUpdate = emissiveMap.needsUpdate = true;
        textures.push(map, emissiveMap);
        const material = standard({ map, emissiveMap, emissive: '#ffffff', emissiveIntensity: 0, roughness: facade.glass ? .28 : .74, metalness: facade.glass ? .55 : .06 });
        windowMaterials.push(material); return material;
      };
      const roofMaterial = standard({ color: '#8d9496', roughness: .9 });
      // Each building is one group so it can rise out of the ground when the city opens.
      const group = new THREE.Group(); scene.add(group);
      const add = (geometry, material, px, py, pz, pickable = true) => {
        const mesh = new THREE.Mesh(keep(geometries, geometry), material);
        mesh.position.set(px, py, pz); mesh.castShadow = mesh.receiveShadow = true;
        if (pickable) { mesh.userData.destination = destination; picks.push(mesh); }
        group.add(mesh); return mesh;
      };
      slab('concrete', x, z + .4, 17, 14.6, .22, 0, 3, .06);
      const podiumSide = faceMaterial(10, 3), podiumFront = faceMaterial(13, 3);
      add(new THREE.BoxGeometry(13, 3, 10), [podiumSide, podiumSide, roofMaterial, roofMaterial, podiumFront, podiumFront], x, 1.78, z);
      const shaftH = Math.max(6, h - 3), side = faceMaterial(8, shaftH), front = faceMaterial(11, shaftH);
      add(new THREE.BoxGeometry(11, shaftH, 8), [side, side, roofMaterial, roofMaterial, front, front], x, 3.28 + shaftH / 2, z - .4);
      const crownH = Math.max(2, h * .16), crownSide = faceMaterial(5.6, crownH), crownFront = faceMaterial(8, crownH);
      add(new THREE.BoxGeometry(8, crownH, 5.6), [crownSide, crownSide, roofMaterial, roofMaterial, crownFront, crownFront], x, 3.28 + shaftH + crownH / 2, z - .4);
      const roofTop = 3.28 + shaftH + crownH;
      add(new THREE.BoxGeometry(2.2, 1.1, 1.6), standard({ color: '#9aa3a6', roughness: .7, metalness: .3 }), x - 2, roofTop + .55, z - 1.4, false);
      add(new THREE.CylinderGeometry(.08, .08, 3.2, 6), standard({ color: '#c4cacc', metalness: .6, roughness: .4 }), x + 2.4, roofTop + 1.6, z - .6, false);
      const beacon = add(new THREE.SphereGeometry(.34, 12, 8), basic({ color: district.color }), x + 2.4, roofTop + 3.3, z - .6, false);
      markers.push({ mesh: beacon, district: district.id });
      // Accent band and lobby entrance facing the street.
      add(new THREE.BoxGeometry(13.1, .22, 10.1), basic({ color: district.color }), x, 3.2, z, false).castShadow = false;
      add(new THREE.BoxGeometry(4.2, 2.3, .5), standard({ color: '#9fc7dd', roughness: .08, metalness: .8, transparent: true, opacity: .82 }), x, 1.43, z + 5.1);
      add(new THREE.BoxGeometry(5.4, .16, 1.6), standard({ color: '#d9dcdc', roughness: .5 }), x, 2.66, z + 5.5, false);
      const sign = new THREE.Mesh(keep(geometries, new THREE.PlaneGeometry(6.4, 1.2)), basic({ map: keep(textures, labelTexture(district.short || district.label, district.color)), transparent: true }));
      sign.position.set(x, 3.95, z + 5.02); group.add(sign);
      // Parking garage with its arrival lane and bays.
      add(new THREE.BoxGeometry(16.4, 2.2, 3.2), standard({ color: '#6f7f86', roughness: .85 }), x, 1.32, wz(district.y + 107));
      add(new THREE.BoxGeometry(16.8, .28, 3.6), standard({ color: '#aab5b6', roughness: .8 }), x, 2.56, wz(district.y + 107), false);
      district.bays.forEach(([px]) => add(new THREE.BoxGeometry(1.2, 1.4, .06), basic({ color: '#10202a' }), wx(px), .95, wz(district.y + 123.3)));
      district.arrivalRoad.slice(1).forEach(([px, pz], i) => {
        const [ax, az] = district.arrivalRoad[i], dx = px - ax, dz = pz - az;
        slab('asphalt', wx((ax + px) / 2), wz((az + pz) / 2), Math.abs(dx) / 10 + 2.6, Math.abs(dz) / 10 + 2.6, .235);
      });
      slab('concrete', x, wz((district.y + 38 + district.streetY) / 2), 1.6, Math.abs(district.streetY - district.y - 38) / 10, .245);
      district.accessRoutes.forEach(route => {
        const [[ax, az], [bx]] = route.points;
        const arrow = new THREE.Mesh(keep(geometries, new THREE.PlaneGeometry(Math.abs(bx - ax) / 10, .3).rotateX(-Math.PI / 2)), basic({ color: route.color }));
        arrow.position.set(wx((ax + bx) / 2), .26, wz(az)); scene.add(arrow);
        const tag = new THREE.Sprite(keep(materialsList, new THREE.SpriteMaterial({ map: keep(textures, labelTexture(route.label, route.color)), depthWrite: false })));
        tag.position.set(wx((ax + bx) / 2), 3.6, wz(az) + 1.6); tag.scale.set(9, 1.7, 1); scene.add(tag);
      });
      const label = new THREE.Sprite(keep(materialsList, new THREE.SpriteMaterial({ map: keep(textures, labelTexture(district.label, district.color)), depthWrite: false })));
      label.position.set(x, roofTop + 5.4, z); label.scale.set(15, 2.8, 1); label.renderOrder = 3; scene.add(label);
      labels.push({ mesh: label, height: roofTop + 5.4 });
      buildingGroups.push({ group, index, height: roofTop + 4 });
    });

    // Instanced city furniture: trees, street lamps, utility poles, homes, cars and people.
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), euler = new THREE.Euler(), color = new THREE.Color();
    const compose = (px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1) => matrix.compose(position.set(px, py, pz), quaternion.setFromEuler(euler.set(0, ry, 0)), scale.set(sx, sy, sz));
    const instanced = (geometry, material, count, shadow = true) => {
      const mesh = new THREE.InstancedMesh(keep(geometries, geometry), material, Math.max(1, count));
      mesh.count = count; mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh); return mesh;
    };
    // Trees line the blocks, shade the cafes and fill the countryside beyond the highway.
    const trees = [];
    city.blocks.forEach(block => block.trees.forEach(([px, pz]) => trees.push([wx(px), wz(pz), block.kind === 'town' ? .9 : 1])));
    city.cafes.forEach(cafe => [-12, 12].forEach(dx => trees.push([wx(cafe.x) + dx, wz(cafe.y) - 4, 1.1])));
    // Woods fill the countryside between downtown and the towns, clear of every road and lot.
    // They cast no shadows, so the far larger region renders as fast as downtown alone.
    const woods = [];
    const countryside = seeded(41);
    const builtUp = [[wx(0) - 3, wz(0) - 3, wx(downtown.width) + 3, wz(downtown.height) + 3],
      ...city.towns.map(town => [wx(town.left) - 5, wz(town.top) - 5, wx(town.right) + 5, wz(town.bottom) + 5])];
    const roadLines = [...outerRoads, ...city.segments.filter(segment => segment.kind === 'ring')].map(({ a, b }) => [wx(a[0]), wz(a[1]), wx(b[0]), wz(b[1])]);
    const nearRoad = (px, pz) => roadLines.some(([ax, az, bx, bz]) => px > Math.min(ax, bx) - 4.5 && px < Math.max(ax, bx) + 4.5 && pz > Math.min(az, bz) - 4.5 && pz < Math.max(az, bz) + 4.5);
    for (let i = 0; i < 2600 && woods.length < 800; i++) {
      const px = (countryside() - .5) * (W + 40), pz = (countryside() - .5) * (H + 40);
      const size = .8 + countryside() * .9, conifer = countryside() < .35;
      if (builtUp.some(([x0, z0, x1, z1]) => px > x0 && px < x1 && pz > z0 && pz < z1) || nearRoad(px, pz)) continue;
      woods.push([px, pz, size, conifer]);
    }
    const trunkMaterial = standard({ color: '#6e5a45', roughness: .9 });
    const leafMaterial = standard({ color: '#ffffff', roughness: .85, flatShading: true });
    const treeRandom = seeded(53);
    function plant(list, shadow) {
      const trunks = instanced(new THREE.CylinderGeometry(.16, .24, 2.2, 6), trunkMaterial, list.length, shadow);
      const broadleaf = list.filter(tree => !tree[3]), conifers = list.filter(tree => tree[3]);
      const crowns = instanced(new THREE.IcosahedronGeometry(1.45, 1), leafMaterial, broadleaf.length, shadow);
      const pines = instanced(new THREE.ConeGeometry(1.25, 3.6, 7), leafMaterial, conifers.length, shadow);
      list.forEach(([px, pz, size], i) => { compose(px, 1.1 * size, pz, 0, size, size, size); trunks.setMatrixAt(i, matrix); });
      broadleaf.forEach(([px, pz, size], i) => {
        compose(px, 3.05 * size, pz, treeRandom() * 6, size * (.9 + treeRandom() * .25), size * (.85 + treeRandom() * .3), size * (.9 + treeRandom() * .25));
        crowns.setMatrixAt(i, matrix); crowns.setColorAt(i, color.set(['#4f7f45', '#5d8c4b', '#46723f', '#6a9552'][i % 4]));
      });
      conifers.forEach(([px, pz, size], i) => { compose(px, 3.4 * size, pz, 0, size, size, size); pines.setMatrixAt(i, matrix); pines.setColorAt(i, color.set(['#3d6445', '#46704c'][i % 2])); });
      return [trunks, crowns, pines];
    }
    const treeMeshes = [...plant(trees, true), ...plant(woods, false)];

    // Street lamps light every avenue and street; they glow at night.
    const lamps = [];
    avenueX.forEach((x, col) => { for (let z = top + 40; z < bottom - 40; z += 70) if (!nearJunction(z, streetZ, 30)) [-1, 1].forEach(side => lamps.push([wx(x) + side * (avenueWidth(col) / 2 + .55), wz(z), side > 0 ? Math.PI : 0])); });
    streetZ.forEach(z => { for (let x = left + 60; x < right - 60; x += 70) if (!nearJunction(x, avenueX, 36)) [-1, 1].forEach(side => lamps.push([wx(x), wz(z) + side * 1.85, side > 0 ? Math.PI / 2 : -Math.PI / 2])); });
    outerRoads.forEach(({ a, b, kind }) => {
      const width = OUTER_WIDTH[kind], horizontal = a[1] === b[1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 40, n = 0; t < length - 30; t += 90, n++) {
        const px = lerp(wx(a[0]), wx(b[0]), t / length), pz = lerp(wz(a[1]), wz(b[1]), t / length), side = n % 2 ? 1 : -1;
        if (outerJunctions.some(([jx, jz]) => Math.hypot(jx - px, jz - pz) < 4)) continue;
        lamps.push(horizontal ? [px, pz + side * (width / 2 + .55), side > 0 ? Math.PI / 2 : -Math.PI / 2] : [px + side * (width / 2 + .55), pz, side > 0 ? Math.PI : 0]);
      }
    });
    const lampPoles = instanced(new THREE.CylinderGeometry(.06, .08, 3.4, 6), standard({ color: '#3c4449', metalness: .6, roughness: .45 }), lamps.length);
    const lampHeadMaterial = basic({ color: '#fff4d6' });
    const lampHeads = instanced(new THREE.BoxGeometry(.5, .14, .26), lampHeadMaterial, lamps.length, false);
    const glowMaterial = basic({ color: '#ffc877', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const lampGlows = instanced(new THREE.CircleGeometry(1.35, 20).rotateX(-Math.PI / 2), glowMaterial, lamps.length, false);
    lamps.forEach(([px, pz, ry], i) => {
      compose(px, 1.7, pz); lampPoles.setMatrixAt(i, matrix);
      const reachX = Math.cos(ry) * .45, reachZ = -Math.sin(ry) * .45;
      compose(px + reachX, 3.38, pz + reachZ, ry); lampHeads.setMatrixAt(i, matrix);
      compose(px + reachX * 2, .09, pz + reachZ * 2); lampGlows.setMatrixAt(i, matrix);
    });

    // Utility grid: poles and overhead lines connect the stage buildings and every home.
    const grid = buildCityGrid(city, current.current.edges);
    const polePoints = [];
    const addPole = (px, pz, dx, dz) => { if (!polePoints.some(pole => Math.hypot(pole[0] - px, pole[1] - pz) < 1.2)) polePoints.push([px, pz, Math.atan2(dx, dz)]); };
    const sampleLine = (points, spacing = 8) => {
      const world = points.map(([px, pz]) => [wx(px), wz(pz)]), samples = [];
      world.slice(1).forEach(([bx, bz], i) => {
        const [ax, az] = world[i], length = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.round(length / spacing));
        for (let step = 0; step <= steps; step++) {
          const t = step / steps, px = lerp(ax, bx, t), pz = lerp(az, bz, t);
          if (!samples.length || Math.hypot(samples.at(-1)[0] - px, samples.at(-1)[1] - pz) > .5) samples.push([px, pz, bx - ax, bz - az]);
        }
      });
      samples.forEach(([px, pz, dx, dz]) => addPole(px, pz, dx, dz));
      return samples;
    };
    const wireVertices = [], wireColors = [], wireSpans = [];
    const addWire = (a, b, heightA, heightB, owner, lateral = 0, sag = .35) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1, nx = -dz / length * lateral, nz = dx / length * lateral;
      const start = wireVertices.length / 3;
      for (let step = 0; step < 6; step++) {
        for (const t of [step / 6, (step + 1) / 6]) {
          wireVertices.push(lerp(a[0], b[0], t) + nx, lerp(heightA, heightB, t) - Math.sin(t * Math.PI) * sag, lerp(a[1], b[1], t) + nz);
          wireColors.push(.16, .18, .2);
        }
      }
      wireSpans.push({ owner, start, count: 12 });
    };
    const linkPaths = grid.links.map((link, index) => {
      const samples = sampleLine(link.points);
      const lateral = (link.lane - 1) * .38, height = 5.25;
      samples.slice(1).forEach((sample, i) => addWire(samples[i], sample, height, height, `link:${index}`, lateral));
      const curve = new THREE.CurvePath();
      samples.slice(1).forEach((sample, i) => {
        const [ax, az] = samples[i], dx = sample[0] - ax, dz = sample[1] - az, length = Math.hypot(dx, dz) || 1;
        curve.add(new THREE.LineCurve3(new THREE.Vector3(ax - dz / length * lateral, height, az + dx / length * lateral), new THREE.Vector3(sample[0] - dz / length * lateral, height, sample[1] + dx / length * lateral)));
      });
      return { ...link, curve, color: new THREE.Color(city.byId[link.from]?.color || '#9fd3ff') };
    });
    grid.feeders.forEach(feeder => {
      const samples = sampleLine(feeder.points, 7);
      samples.slice(1).forEach((sample, i) => addWire(samples[i], sample, 5.25, 5.25, 'feeder', 0));
    });
    // Trunk lines strung in pairs carry power out to every town.
    grid.trunks.forEach(trunk => {
      const samples = sampleLine(trunk.points, 10);
      samples.slice(1).forEach((sample, i) => { addWire(samples[i], sample, 5.3, 5.3, 'trunk', -.4, .5); addWire(samples[i], sample, 5.3, 5.3, 'trunk', .4, .5); });
    });
    const homeWires = new Map();
    grid.drops.forEach(drop => {
      const home = current.current.homes.get(drop.homeId); if (!home) return;
      const pole = [wx(drop.pole[0]), wz(drop.pole[1])];
      addPole(pole[0], pole[1], 0, 1);
      const eave = home.index % 3 === 0 ? 5.6 : 3.4;
      homeWires.set(drop.homeId, wireSpans.length);
      addWire(pole, [wx(drop.house[0]), wz(drop.house[1])], 5.05, eave, `home:${drop.homeId}`, 0, .25);
    });
    const wireGeometry = keep(geometries, new THREE.BufferGeometry());
    wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireVertices, 3));
    const wireColorAttribute = new THREE.Float32BufferAttribute(wireColors, 3);
    wireGeometry.setAttribute('color', wireColorAttribute);
    scene.add(new THREE.LineSegments(wireGeometry, keep(materialsList, new THREE.LineBasicMaterial({ vertexColors: true }))));
    const poles = instanced(new THREE.CylinderGeometry(.09, .12, 5.6, 6), standard({ color: '#6b5846', roughness: .95 }), polePoints.length);
    const crossarms = instanced(new THREE.BoxGeometry(1.5, .1, .1), standard({ color: '#5a4a3b', roughness: .95 }), polePoints.length);
    const transformers = instanced(new THREE.CylinderGeometry(.24, .24, .6, 8), standard({ color: '#8e979b', metalness: .5, roughness: .5 }), Math.ceil(polePoints.length / 6));
    polePoints.forEach(([px, pz, angle], i) => {
      compose(px, 2.8, pz); poles.setMatrixAt(i, matrix);
      compose(px, 5.3, pz, angle + Math.PI / 2); crossarms.setMatrixAt(i, matrix);
      if (i % 6 === 0) { compose(px + .28, 4.3, pz); transformers.setMatrixAt(i / 6, matrix); }
    });
    const pulseMaterial = basic({ color: '#ffffff', transparent: true, opacity: .95, depthWrite: false, blending: THREE.AdditiveBlending });
    const pulsesPerLink = 4;
    const pulses = instanced(new THREE.SphereGeometry(.2, 10, 8), pulseMaterial, linkPaths.length * pulsesPerLink, false);

    // Homes. Each part is one instanced mesh; per-home transforms carry build-in, filters and doors.
    const homeList = city.homes, count = homeList.length;
    const wallMaterial = standard({ map: siding, roughness: .88 });
    const roofMaterial = standard({ map: shingles, roughness: .82 });
    const foundations = instanced(new THREE.BoxGeometry(1, 1, 1), standard({ color: '#9c9c96', roughness: .95 }), count);
    const bodies = instanced(new THREE.BoxGeometry(1, 1, 1), wallMaterial, count);
    const roofs = instanced(gableGeometry(), roofMaterial, count);
    const chimneys = instanced(new THREE.BoxGeometry(.62, 1.7, .62), standard({ color: '#8a6f5e', roughness: .9 }), count);
    const doorGeometry = new THREE.BoxGeometry(1, 2, .1).translate(.5, 1, 0);
    const doors = instanced(doorGeometry, standard({ color: '#ffffff', roughness: .6 }), count);
    const doorwayMaterial = basic({ color: '#4a3a2e' });
    const doorways = instanced(new THREE.BoxGeometry(1.06, 2.06, .04), doorwayMaterial, count, false);
    const porches = instanced(new THREE.BoxGeometry(1.9, .24, 1.3), standard({ color: '#b7b4ab', roughness: .9 }), count);
    const walkways = instanced(new THREE.BoxGeometry(1, .04, 1), standard({ color: '#c9c6bc', roughness: .95 }), count);
    const driveways = instanced(new THREE.BoxGeometry(1, .04, 1), standard({ color: '#a7a59e', roughness: .95 }), count);
    const hedges = instanced(new THREE.BoxGeometry(1, 1, 1), standard({ color: '#3f6a3c', roughness: .95, flatShading: true }), count);
    const porchLights = instanced(new THREE.SphereGeometry(.16, 10, 8), basic({ color: '#ffffff' }), count, false);
    const windowsPerHome = 6;
    const windowPanes = instanced(new THREE.BoxGeometry(1, 1, 1), basic({ color: '#ffffff' }), count * windowsPerHome, false);
    const homeState = homeList.map(home => ({
      id: home.id, index: home.index, x: wx(home.house.x), z: wz(home.house.y), w: home.house.width / 10, d: home.house.depth / 10,
      floors: home.index % 3 === 0 ? 2 : 1, rise: 0, door: 0, visible: true, lit: -1, stateColor: '',
      front: [wx(home.commutePoints[0][0]), wz(home.commutePoints[0][1])], junction: [wx(home.junction[0]), wz(home.junction[1])],
      corners: [],
    }));
    homeState.forEach((state, i) => {
      const home = homeList[i];
      bodies.setColorAt(i, color.set(WALLS[(home.index * 7) % WALLS.length]));
      roofs.setColorAt(i, color.set(ROOFS[(home.index * 3) % ROOFS.length]));
      doors.setColorAt(i, color.set(DOORS[home.index % DOORS.length]));
      state.wallH = state.floors === 2 ? 5.1 : 3.0;
      state.corners = [-1, 1].flatMap(dx => [-1, 1].flatMap(dz => [0, state.wallH + 2.4].map(y => new THREE.Vector3(state.x + dx * (state.w / 2 + .4), y, state.z + dz * (state.d / 2 + .4)))));
    });
    function writeHome(i) {
      const s = homeState[i], rise = s.visible ? ease(s.rise) : 0, v = Math.max(rise, .0001), hide = s.visible && rise > 0 ? 1 : 0;
      const baseY = .22;
      compose(s.x, baseY + .18, s.z, 0, (s.w + .5) * hide, .36 * v, (s.d + .5) * hide); foundations.setMatrixAt(i, matrix);
      compose(s.x, baseY + .36 + s.wallH * v / 2, s.z, 0, s.w * hide, s.wallH * v, s.d * hide); bodies.setMatrixAt(i, matrix);
      const roofBase = baseY + .36 + s.wallH * v;
      compose(s.x, roofBase, s.z, 0, (s.w + .8) * hide, 2.1 * v, (s.d + .9) * hide); roofs.setMatrixAt(i, matrix);
      compose(s.x + s.w * .26, roofBase + 1.2 * v, s.z - s.d * .18, 0, hide, v, hide); chimneys.setMatrixAt(i, matrix);
      const doorZ = s.z + s.d / 2 + .06;
      // Front doors swing inward, revealing the hall behind the doorway (lit at night).
      compose(s.x - .5, baseY + .36, doorZ, s.door * 1.35, hide, v, hide); doors.setMatrixAt(i, matrix);
      compose(s.x, baseY + .36 + 1.03 * v, doorZ - .06, 0, hide, v, hide); doorways.setMatrixAt(i, matrix);
      compose(s.x, baseY + .12, doorZ + .6, 0, hide, 1, hide); porches.setMatrixAt(i, matrix);
      const walkLength = Math.max(.4, s.front[1] - (doorZ + 1.2));
      compose(s.x, baseY + .02, doorZ + 1.2 + walkLength / 2, 0, 1.05 * hide, 1, walkLength * hide); walkways.setMatrixAt(i, matrix);
      const driveEnd = s.junction[0] - Math.sign(s.junction[0] - s.x) * 1.3, driveLength = Math.abs(driveEnd - s.x);
      compose((s.x + driveEnd) / 2, baseY + .02, s.front[1], 0, driveLength * hide, 1, 2.3 * hide); driveways.setMatrixAt(i, matrix);
      // A low hedge closes the lot on the side away from the driveway.
      const inward = -Math.sign(s.junction[0] - s.x);
      compose(s.x + inward * (s.w / 2 + 1.2), baseY + .45 * v, s.z + .6, 0, .7 * hide, .9 * v, (s.d + 2.4) * hide); hedges.setMatrixAt(i, matrix);
      compose(s.x + .95, baseY + .36 + 2.2 * v, doorZ + .08, 0, hide, hide, hide); porchLights.setMatrixAt(i, matrix);
      const windowY = baseY + .36 + 1.75 * v, upperY = baseY + .36 + 3.95 * v;
      const panes = [[-1.65, windowY, 1.1], [1.65, windowY, 1.1], [0, upperY, s.floors === 2 ? 1 : 0], [-1.65, upperY, s.floors === 2 ? 1 : 0], [1.65, upperY, s.floors === 2 ? 1 : 0]];
      panes.forEach(([dx, py, width], p) => { compose(s.x + dx, py, s.z + s.d / 2 + .03, 0, width * 1.05 * hide, 1 * v * (width ? 1 : 0), .06 * hide); windowPanes.setMatrixAt(i * windowsPerHome + p, matrix); });
      compose(s.x + s.w / 2 + .03, windowY, s.z, 0, .06 * hide, v, 1.2 * hide); windowPanes.setMatrixAt(i * windowsPerHome + 5, matrix);
    }
    const homeMeshes = [foundations, bodies, roofs, chimneys, doors, doorways, porches, walkways, driveways, hedges, porchLights, windowPanes];
    const markHomesDirty = () => homeMeshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    homeState.forEach((_, i) => writeHome(i));
    [bodies, roofs, doors].forEach(mesh => { if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; });
    bodies.userData.homes = roofs.userData.homes = true;

    // Cafes and gardens along the southern boulevard.
    city.cafes.forEach((cafe, index) => {
      const x = wx(cafe.x), z = wz(cafe.y);
      slab('lawn', x, z, 31, 12.5, 0, 0, 10, .2);
      slab('concrete', x, z + .6, 20, 5.5, .21, 0, 3, .04);
      const pavilion = new THREE.Mesh(keep(geometries, new THREE.BoxGeometry(8.6, 3, 4.8)), standard({ color: ['#c8b89a', '#a9bda9', '#c7b99a', '#a8bcc6'][index], roughness: .8 }));
      pavilion.position.set(x, 1.72, z - .6); pavilion.castShadow = pavilion.receiveShadow = true; scene.add(pavilion);
      const awning = new THREE.Mesh(keep(geometries, new THREE.BoxGeometry(9.4, .18, 2.2)), standard({ color: ['#c0664a', '#4f8a6d', '#c89b4a', '#4f7d99'][index], roughness: .7 }));
      awning.position.set(x, 3, z + 2.4); awning.rotation.x = .18; awning.castShadow = true; scene.add(awning);
      [-7.5, -4.5, 4.5, 7.5].forEach(dx => {
        const umbrella = new THREE.Mesh(keep(geometries, new THREE.ConeGeometry(1.25, .6, 10)), standard({ color: ['#f1ede4', '#d9785a'][Math.abs(dx) > 5 ? 0 : 1], roughness: .7 }));
        umbrella.position.set(x + dx, 2.3, z + 1.3); umbrella.castShadow = true; scene.add(umbrella);
        const table = new THREE.Mesh(keep(geometries, new THREE.CylinderGeometry(.6, .6, .1, 12)), standard({ color: '#7b6c5a' }));
        table.position.set(x + dx, .95, z + 1.3); scene.add(table);
      });
      const label = new THREE.Sprite(keep(materialsList, new THREE.SpriteMaterial({ map: keep(textures, labelTexture(cafe.label, '#e9d8a6')), depthWrite: false })));
      label.position.set(x, 6.4, z); label.scale.set(12, 2.25, 1); scene.add(label);
    });

    // Each town's name hangs above it, on the side away from downtown.
    city.towns.forEach(town => {
      const label = new THREE.Sprite(keep(materialsList, new THREE.SpriteMaterial({ map: keep(textures, labelTexture(town.name, '#8de8d3')), depthWrite: false })));
      const [px, pz] = town.side === 'top' ? [town.x, town.top - 60] : town.side === 'bottom' ? [town.x, town.bottom + 60] : town.side === 'left' ? [town.left - 20, town.top - 40] : [town.right + 20, town.top - 40];
      label.position.set(wx(px), 12, wz(pz)); label.scale.set(32, 6, 1); label.renderOrder = 3; scene.add(label);
      labels.push({ mesh: label, height: 12 });
    });

    for (const [kind, parts] of Object.entries(flat)) {
      if (!parts.length) continue;
      const geometry = keep(geometries, mergeGeometries(parts.map(part => part.index ? part.toNonIndexed() : part)));
      parts.forEach(part => part.dispose());
      const material = {
        asphalt: standard({ map: asphalt, roughness: .92 }),
        concrete: standard({ map: concrete, roughness: .95 }),
        white: standard({ color: '#eceadf', roughness: .7 }),
        yellow: standard({ color: '#e6c24f', roughness: .7 }),
        lawn: standard({ map: lawnTexture, roughness: .95 }),
      }[kind];
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true; mesh.castShadow = kind === 'lawn'; scene.add(mesh);
    }

    // Traffic: every resident's car, the highway fleet and pedestrians.
    function curve(points, y = 0) {
      const result = new THREE.CurvePath();
      points.slice(1).forEach(([px, pz], i) => {
        if (px === points[i][0] && pz === points[i][1]) return;
        result.add(new THREE.LineCurve3(new THREE.Vector3(wx(points[i][0]), y, wz(points[i][1])), new THREE.Vector3(wx(px), y, wz(pz))));
      });
      return result;
    }
    const highway = new THREE.CurvePath();
    {
      const r = ringRadius, inset = .9, a = x0 + inset, b = x1 - inset, c = z0 + inset, d = z1 - inset;
      const v = (px, pz) => new THREE.Vector3(px, 0, pz);
      highway.add(new THREE.LineCurve3(v(a + r, c), v(b - r, c))); highway.add(new THREE.QuadraticBezierCurve3(v(b - r, c), v(b, c), v(b, c + r)));
      highway.add(new THREE.LineCurve3(v(b, c + r), v(b, d - r))); highway.add(new THREE.QuadraticBezierCurve3(v(b, d - r), v(b, d), v(b - r, d)));
      highway.add(new THREE.LineCurve3(v(b - r, d), v(a + r, d))); highway.add(new THREE.QuadraticBezierCurve3(v(a + r, d), v(a, d), v(a, d - r)));
      highway.add(new THREE.LineCurve3(v(a, d - r), v(a, c + r))); highway.add(new THREE.QuadraticBezierCurve3(v(a, c + r), v(a, c), v(a + r, c)));
    }
    const fleet = homeList.map((home, i) => ({ id: home.id, index: home.index, home: homeState[i], color: CARS[(home.index * 5) % CARS.length],
      commute: curve(home.commutePoints), returning: curve(home.returnPoints), lunch: curve(home.lunchPoints) }));
    const highwayCars = Array.from({ length: 18 }, (_, index) => ({ index, color: CARS[(index * 3 + 1) % CARS.length] }));
    const carCount = fleet.length + highwayCars.length;
    const carBodies = instanced(new THREE.BoxGeometry(.82, .42, 1.8), standard({ color: '#ffffff', roughness: .32, metalness: .55 }), carCount);
    const carCabins = instanced(new THREE.BoxGeometry(.7, .36, .95), standard({ color: '#1d2a33', roughness: .1, metalness: .8 }), carCount);
    const wheels = instanced(new THREE.CylinderGeometry(.19, .19, .14, 10).rotateZ(Math.PI / 2), standard({ color: '#191b1d', roughness: .8 }), carCount * 4);
    const headlightMaterial = basic({ color: '#fff6dc' }), taillightMaterial = basic({ color: '#ff3b30' });
    const headlights = instanced(new THREE.BoxGeometry(.18, .1, .04), headlightMaterial, carCount * 2, false);
    const taillights = instanced(new THREE.BoxGeometry(.18, .1, .04), taillightMaterial, carCount * 2, false);
    [...fleet, ...highwayCars].forEach((car, i) => carBodies.setColorAt(i, color.set(car.color)));
    const people = homeList.length;
    const walkerBodies = instanced(new THREE.CylinderGeometry(.2, .22, .95, 8), standard({ color: '#ffffff', roughness: .8 }), people);
    const walkerHeads = instanced(new THREE.SphereGeometry(.18, 10, 8), standard({ color: '#d8b494', roughness: .7 }), people);
    homeList.forEach((home, i) => walkerBodies.setColorAt(i, color.set(home.color || '#6fa8c7')));
    const carParts = [
      [carBodies, 1, [[0, .42, 0]]], [carCabins, 1, [[0, .78, -.1]]],
      [wheels, 4, [[-.42, .19, .56], [.42, .19, .56], [-.42, .19, -.56], [.42, .19, -.56]]],
      [headlights, 2, [[-.26, .46, .91], [.26, .46, .91]]], [taillights, 2, [[-.26, .5, -.91], [.26, .5, -.91]]],
    ];
    const carMatrix = new THREE.Matrix4(), partMatrix = new THREE.Matrix4(), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    function placeCar(slot, px, pz, heading, visible) {
      carMatrix.compose(position.set(px, groundAt(px, pz), pz), quaternion.setFromEuler(euler.set(0, heading, 0)), scale.set(1, 1, 1));
      for (const [mesh, per, offsets] of carParts) offsets.forEach((offset, part) => {
        mesh.setMatrixAt(slot * per + part, visible ? partMatrix.makeTranslation(...offset).premultiply(carMatrix) : hidden);
      });
    }
    const tangent = new THREE.Vector3(), point = new THREE.Vector3();
    // Driveways and paths sit on the raised lawns; streets are at road level.
    const raised = [...city.blocks.map(block => [wx(block.x), wz(block.y), block.lawn[0] / 20, block.lawn[1] / 20]), ...city.cafes.map(cafe => [wx(cafe.x), wz(cafe.y), 15.5, 6.25])];
    const groundAt = (px, pz) => raised.some(([bx, bz, hx, hz]) => Math.abs(px - bx) < hx && Math.abs(pz - bz) < hz) ? .24 : .05;
    function along(route, progress) {
      const t = clamp01(progress);
      route.getPointAt(t, point); route.getTangentAt(Math.min(t, .9999), tangent);
      return [point.x, point.z, Math.atan2(tangent.x, tangent.z)];
    }

    // Selection ring and hover feedback.
    const ringMaterial = basic({ color: '#8de8d3', transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false });
    const selection = new THREE.Mesh(keep(geometries, new THREE.RingGeometry(.92, 1, 48).rotateX(-Math.PI / 2)), ringMaterial);
    selection.visible = false; selection.renderOrder = 2; scene.add(selection);
    const chosen = new THREE.Mesh(selection.geometry, basic({ color: '#ffe08a', transparent: true, opacity: .95, side: THREE.DoubleSide, depthWrite: false }));
    chosen.visible = false; chosen.renderOrder = 2; scene.add(chosen);

    // Camera framing: the whole city is centred in the view on every screen shape.
    const camera = new THREE.PerspectiveCamera(40, 1, .5, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .08; controls.minDistance = 8;
    controls.maxPolarAngle = Math.PI * .47; controls.screenSpacePanning = false;
    controls.listenToKeyEvents(renderer.domElement);
    const cityPoints = [
      ...[-1, 1].flatMap(sx => [-1, 1].map(sz => new THREE.Vector3(sx * (W / 2 - 1.5), 0, sz * (H / 2 - 1.5)))),
      ...city.districts.flatMap(district => [-1, 1].map(side => new THREE.Vector3(wx(district.x) + side * 6.5, district.height / 4.6 + 6, wz(district.y)))),
      ...homeState.flatMap(state => state.corners),
    ];
    const areaPoints = selectedArea => selectedArea === 'homes' ? homeState.flatMap(state => state.corners)
      : selectedArea === 'services' ? city.districts.flatMap(district => [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [0, district.height / 4.6 + 5].map(y => new THREE.Vector3(wx(district.x) + sx * 7, y, wz(district.y) + sz * 7)))))
        : cityPoints;
    const framing = { area: 'all', framed: true, base: 1 };
    function frame(selectedArea = framing.area, animate = false) {
      const direction = viewDirection(camera.aspect);
      const { target, distance } = fitView(areaPoints(selectedArea), direction, camera.fov, camera.aspect);
      framing.area = selectedArea; framing.framed = true; framing.base = distance;
      // Haze starts beyond the city, so distant countryside fades while the city stays crisp.
      scene.fog.near = distance * 1.25; scene.fog.far = distance * 5;
      const destination = target.clone().addScaledVector(direction, distance / (runtime.current?.zoom || 1));
      controls.maxDistance = Math.max(distance * 2.6, 60);
      if (animate) fly(destination, target, 900); else { camera.position.copy(destination); controls.target.copy(target); controls.update(); }
    }
    let flight = null;
    function fly(toPosition, toTarget, duration) {
      if (current.current.motion === 'reduced') { camera.position.copy(toPosition); controls.target.copy(toTarget); controls.update(); flight = null; return; }
      flight = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition, toTarget, start: performance.now(), duration };
    }
    controls.addEventListener('start', () => { flight = null; framing.framed = false; });

    // Picking homes (instanced) and buildings.
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down;
    const pickables = [...picks, bodies, roofs];
    const pick = event => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      for (const hit of raycaster.intersectObjects(pickables, false)) {
        if (hit.object.userData.homes) {
          const state = homeState[hit.instanceId];
          if (state?.visible) return { kind: 'home', id: state.id, label: current.current.homes.get(state.id)?.name || '' };
        } else if (hit.object.userData.destination) return hit.object.userData.destination;
      }
      return null;
    };
    const selectedAt = { id: '', time: 0 }, entrance = { view: '' };
    function enterHome(id) {
      const index = homeState.findIndex(state => state.id === id); if (index < 0) return;
      if (selectedAt.id === id && performance.now() - selectedAt.time < 3000) return;
      const state = homeState[index], doorZ = state.z + state.d / 2;
      selectedAt.id = id; selectedAt.time = performance.now();
      framing.framed = false;
      // Try viewpoints in front of the door, nearest and lowest first, and fly to the first one
      // with a clear line of sight: street trees, poles and the neighbouring homes never block the entrance.
      const street = Math.sign(state.junction[0] - state.x) || 1;
      const target = new THREE.Vector3(state.x, 1.9, doorZ + .3);
      let best = null; entrance.view = 'blocked';
      for (const [view, [angle, reach, height]] of ENTRANCE_VIEWS.entries()) {
        const heading = angle * street;
        const position = new THREE.Vector3(target.x + Math.sin(heading) * reach, height, target.z + Math.cos(heading) * reach);
        best ||= position;
        if (clearView(target, position, index)) { best = position; entrance.view = String(view); break; }
      }
      fly(best, target, 1400);
    }
    const blockers = [...treeMeshes, bodies, roofs, chimneys, poles, crossarms, ...picks];
    const sight = new THREE.Raycaster(), sightDirection = new THREE.Vector3(), sightStart = new THREE.Vector3(), sightEnd = new THREE.Vector3();
    const lensRight = new THREE.Vector3(), lensUp = new THREE.Vector3(), worldUp = new THREE.Vector3(0, 1, 0);
    function clearView(target, position, home) {
      lensRight.subVectors(target, position).cross(worldUp).normalize();
      lensUp.subVectors(target, position).cross(lensRight).normalize().negate();
      // Rays from the doorstep and the top of the door to each point of the cone around the lens.
      return [-.4, .7].every(lift => ENTRANCE_CONE.every(([right, up]) => {
        sightStart.copy(target).setY(target.y + lift);
        sightEnd.copy(position).addScaledVector(lensRight, right).addScaledVector(lensUp, up);
        const length = sightDirection.subVectors(sightEnd, sightStart).length();
        sightDirection.divideScalar(length);
        sight.set(sightStart.addScaledVector(sightDirection, .9), sightDirection); sight.far = length - .9 + 1;
        return !sight.intersectObjects(blockers, false).some(hit => hit.object.visible && !(hit.object.userData.homes && hit.instanceId === home));
      }));
    }
    const onDown = event => { down = [event.clientX, event.clientY]; };
    const onUp = event => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) { down = null; return; }
      const target = pick(event); down = null;
      if (target?.kind === 'building') current.current.onEnter(target.id);
      if (target?.kind === 'home') {
        enterHome(target.id);
        const key = current.current.homes.get(target.id)?.primaryKey;
        if (key) current.current.onSelectAgent(key);
      }
    };
    const onMove = event => {
      if (event.buttons) return;
      const target = pick(event);
      setHover(target?.label || ''); renderer.domElement.style.cursor = target ? 'pointer' : 'grab';
      selection.visible = Boolean(target);
      if (target?.kind === 'building') { const d = current.current.city.byId[target.id]; selection.position.set(wx(d.x), .3, wz(d.y)); selection.scale.setScalar(9.5); }
      if (target?.kind === 'home') { const s = homeState.find(item => item.id === target.id); selection.position.set(s.x, .3, s.z + .8); selection.scale.setScalar(5); }
    };
    const onLost = event => { event.preventDefault(); current.current.onFallback(); };
    renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp); renderer.domElement.addEventListener('pointermove', onMove); renderer.domElement.addEventListener('webglcontextlost', onLost);

    const resize = () => {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
      if (framing.framed) frame(framing.area);
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    {
      const rect = element.getBoundingClientRect(); camera.aspect = rect.width && rect.height ? rect.width / rect.height : 1.6; camera.updateProjectionMatrix();
      renderer.setSize(rect.width || 800, rect.height || 500);
      if (savedCamera.current) {
        camera.position.copy(savedCamera.current.position); controls.target.copy(savedCamera.current.target);
        Object.assign(framing, savedCamera.current.framing); controls.maxDistance = Math.max(framing.base * 2.6, 60); controls.update();
      } else frame('all');
    }

    let frameId, last = performance.now(), elapsed = savedCamera.current?.elapsed || 0, lastRender = 0, frameCost = 0;
    const built = performance.now(), buildSkip = Boolean(savedCamera.current) || current.current.motion === 'reduced';
    const visibleFrustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
    let edgeSignature = '';
    const animate = now => {
      frameId = requestAnimationFrame(animate);
      const delta = Math.max(0, Math.min((now - last) / 1000, .1)); last = now;
      const live = current.current;
      if (!document.hidden && live.motion === 'active') elapsed += delta * live.speed;
      // A frame waits at least as long as the last one took, so slow devices keep time for taps and scrolling.
      if (document.hidden || now - lastRender < Math.max(32, frameCost * 2)) return;
      const frameStart = performance.now();
      const renderDelta = Math.min((now - lastRender) / 1000, .25); lastRender = now;

      // Day and night blend smoothly; the sky's reflections refresh once the change settles.
      const targetLighting = live.night ? 1 : 0;
      if (lighting !== targetLighting) {
        // About one second on any device, independent of frame rate.
        const step = renderDelta * 1.1 || .04;
        lighting = live.motion === 'reduced' || Math.abs(targetLighting - lighting) <= step ? targetLighting : lighting + Math.sign(targetLighting - lighting) * step;
        applyLighting(lighting, lighting === targetLighting);
      }
      windowMaterials.forEach(material => { material.emissiveIntensity = lerp(.02, .95, lighting); });
      glowMaterial.opacity = lerp(0, .34, lighting);
      lampHeadMaterial.color.setRGB(lerp(.75, 1.6, lighting), lerp(.73, 1.4, lighting), lerp(.68, 1, lighting));
      headlightMaterial.color.setRGB(lerp(.9, 2, lighting), lerp(.88, 1.9, lighting), lerp(.8, 1.5, lighting));
      doorwayMaterial.color.set(lighting > .5 ? '#e0a45c' : '#4a3a2e');

      // Build-in: blocks first, then homes rise in a wave from the city centre.
      let homesChanged = false;
      homeState.forEach((state, i) => {
        const home = live.homes.get(state.id);
        const visible = live.homeFilter === 'all' || home?.homeState === live.homeFilter;
        const delay = .25 + Math.hypot(state.x, state.z) / Math.max(W, H) * 1.4;
        const rise = buildSkip ? 1 : clamp01((now - built) / 1000 / .7 - delay / .7);
        const phase = ((elapsed + state.index * 13.7) % (64 + state.index % 7 * 4)) / (64 + state.index % 7 * 4);
        const moving = live.motionScope === 'all' || home?.homeState === 'working';
        const journey = cityJourney(moving ? phase : 0);
        // A visited home's door swings open as the camera arrives, stays open a few seconds, then closes.
        const sinceVisit = (now - selectedAt.time) / 1000;
        const recentlyEntered = selectedAt.id === state.id ? ease((sinceVisit - 1) / .8) * clamp01(6.5 - sinceVisit) : 0;
        const door = Math.min(1, Math.max(moving ? journey.doorOpen : 0, recentlyEntered));
        if (visible !== state.visible || rise !== state.rise || Math.abs(door - state.door) > .01) {
          state.visible = visible; state.rise = rise; state.door = door; writeHome(i); homesChanged = true;
        }
        state.journey = journey; state.moving = moving; state.phase = phase;
        const atHome = !moving || journey.home;
        const lit = lighting > .5 && atHome ? 1 : 0;
        const status = home?.homeState || 'unobserved';
        if (lit !== state.lit || status !== state.stateColor) {
          state.lit = lit; state.stateColor = status;
          for (let p = 0; p < windowsPerHome; p++) windowPanes.setColorAt(i * windowsPerHome + p, color.set(lit ? (p % 2 ? '#ffd490' : '#ffe2ae') : lighting > .5 ? '#1c2833' : '#8fa6b5'));
          porchLights.setColorAt(i, color.set(stateColor(status)));
          windowPanes.instanceColor.needsUpdate = porchLights.instanceColor.needsUpdate = true;
          const wire = homeWires.get(state.id);
          if (wire != null) {
            const span = wireSpans[wire], tone = color.set(status === 'working' ? '#3fd08f' : status === 'attention' ? '#f0a33a' : '#2a2f33');
            for (let v = span.start; v < span.start + span.count; v++) wireColorAttribute.setXYZ(v, tone.r, tone.g, tone.b);
            wireColorAttribute.needsUpdate = true;
          }
        }
      });
      if (homesChanged) markHomesDirty();
      buildingGroups.forEach(({ group, index, height }) => {
        const rise = buildSkip ? 1 : ease(((now - built) / 1000 - index * .06) / .9);
        group.position.y = -(1 - rise) * height;
      });

      markers.forEach(({ mesh, district }) => {
        const state = live.districts.get(district);
        mesh.material.color.set(['degraded', 'unavailable'].includes(state?.state) ? '#ffb75e' : state?.color || '#6e8490');
      });

      // Grid lines take the colour of stage links with recent observed work.
      const signature = live.edges.map(edge => `${edge.from}>${edge.to}:${edge.active ? 1 : 0}`).join('|');
      if (signature !== edgeSignature) {
        edgeSignature = signature;
        linkPaths.forEach((link, index) => {
          link.active = Boolean(live.edges.find(edge => edge.from === link.from && edge.to === link.to)?.active);
          const tone = link.active ? link.color : color.set('#2a2f33');
          wireSpans.forEach(span => { if (span.owner !== `link:${index}`) return; for (let v = span.start; v < span.start + span.count; v++) wireColorAttribute.setXYZ(v, tone.r, tone.g, tone.b); });
        });
        wireColorAttribute.needsUpdate = true;
      }
      const flowing = live.motion !== 'reduced';
      linkPaths.forEach((link, index) => {
        const show = flowing && (link.active || live.motionScope === 'all');
        for (let p = 0; p < pulsesPerLink; p++) {
          const slot = index * pulsesPerLink + p;
          if (!show) { pulses.setMatrixAt(slot, hidden); continue; }
          const progress = ((elapsed * (link.active ? .09 : .045) + p / pulsesPerLink) % 1);
          link.curve.getPointAt(progress, point);
          compose(point.x, point.y, point.z, 0, link.active ? 1 : .6, link.active ? 1 : .6, link.active ? 1 : .6); pulses.setMatrixAt(slot, matrix);
          pulses.setColorAt(slot, link.active ? link.color : color.set('#7d8b94'));
        }
      });
      pulses.instanceMatrix.needsUpdate = true; if (pulses.instanceColor) pulses.instanceColor.needsUpdate = true;

      // Residents: leave home, commute, lunch at the cafe, return and walk back inside.
      let parked = 0;
      fleet.forEach((vehicle, i) => {
        const state = vehicle.home, journey = state.journey, visible = state.visible && state.rise > .95;
        const commute = journey.returning ? dayProgress(state.phase, .68, .88) : dayProgress(state.phase, .08, .24);
        const [cx, cz, heading] = along(journey.returning ? vehicle.returning : vehicle.commute, state.moving ? commute : 0);
        placeCar(i, cx, cz, heading, visible && journey.carVisible);
        if (!journey.carVisible && state.visible) parked++;
        let walker = null;
        if (state.moving && journey.walkerVisible) {
          const lunch = state.phase < .55 ? dayProgress(state.phase, .36, .46) : 1 - dayProgress(state.phase, .55, .65);
          const [px, pz, h] = along(vehicle.lunch, lunch); walker = [px, pz, h + (state.phase >= .55 ? Math.PI : 0)];
        } else if (state.moving && journey.homeWalk) {
          // Between the car on the driveway and the front door, which opens as they pass.
          const door = [state.x, state.z + state.d / 2 + .5], car = [state.front[0] + .9, state.front[1] - .3];
          const [from, to] = journey.homeWalk.leaving ? [door, car] : [car, door];
          const t = journey.homeWalk.progress;
          walker = [lerp(from[0], to[0], t), lerp(from[1], to[1], t), Math.atan2(to[0] - from[0], to[1] - from[1])];
        }
        if (walker && visible) {
          const bob = Math.abs(Math.sin(elapsed * 9 + i)) * .05, floor = groundAt(walker[0], walker[1]);
          compose(walker[0], floor + .48 + bob, walker[1], walker[2]); walkerBodies.setMatrixAt(i, matrix);
          compose(walker[0], floor + 1.14 + bob, walker[1], walker[2]); walkerHeads.setMatrixAt(i, matrix);
        } else { walkerBodies.setMatrixAt(i, hidden); walkerHeads.setMatrixAt(i, hidden); }
      });
      highwayCars.forEach((car, index) => {
        const [cx, cz, heading] = along(highway, ((elapsed + index * 3.6) % 64) / 64);
        placeCar(fleet.length + index, cx, cz, heading, true);
      });
      [carBodies, carCabins, wheels, headlights, taillights, walkerBodies, walkerHeads].forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });

      // Selection: highlight the chosen home; the camera glides to its entrance.
      const selected = live.selectedHomeId && homeState.find(state => state.id === live.selectedHomeId);
      chosen.visible = Boolean(selected && selected.visible);
      if (selected) { chosen.position.set(selected.x, .3, selected.z + .8); chosen.scale.setScalar(5.4 + Math.sin(now / 320) * .25); }
      if (flight) {
        const t = ease((now - flight.start) / flight.duration);
        camera.position.lerpVectors(flight.fromPosition, flight.toPosition, t); controls.target.lerpVectors(flight.fromTarget, flight.toTarget, t);
        if (t >= 1) flight = null;
      }
      labels.forEach(({ mesh }) => { mesh.material.opacity = clamp01((camera.position.distanceTo(mesh.position) - 12) / 20); });
      controls.update(); renderer.render(scene, camera);
      frameCost = performance.now() - frameStart;

      camera.updateMatrixWorld();
      visibleFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const dataset = renderer.domElement.dataset;
      dataset.motionTime = elapsed.toFixed(2);
      dataset.homes = String(homeState.length);
      dataset.visibleHomes = String(homeState.filter(state => state.visible).length);
      dataset.parkedCars = String(parked);
      dataset.framedHomes = String(homeState.filter(state => state.visible && state.corners.every(corner => visibleFrustum.containsPoint(corner))).length);
      dataset.lighting = lighting >= .5 ? 'night' : 'day';
      dataset.gridLinks = String(linkPaths.length);
      dataset.activeGridLinks = String(linkPaths.filter(link => link.active).length);
      dataset.entranceView = entrance.view;
      dataset.openDoors = String(homeState.filter(state => state.door > .5).length);
      dataset.rendered = 'true';
    };
    runtime.current = {
      camera, controls, renderer, zoom: savedCamera.current?.zoom || 1,
      rotate(angle) { flight = null; const vector = camera.position.clone().sub(controls.target); vector.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle); camera.position.copy(controls.target).add(vector); controls.update(); },
      frame, enterHome,
      zoomTo(value) {
        const direction = camera.position.clone().sub(controls.target).normalize();
        const distance = camera.position.distanceTo(controls.target) * (this.zoom / value);
        this.zoom = value; camera.position.copy(controls.target).addScaledVector(direction, distance); controls.update();
      },
    };
    frameId = requestAnimationFrame(animate);
    return () => {
      savedCamera.current = { position: camera.position.clone(), target: controls.target.clone(), zoom: runtime.current?.zoom || 1, framing: { ...framing }, elapsed };
      cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('webglcontextlost', onLost);
      textures.forEach(texture => texture.dispose()); geometries.forEach(geometry => geometry.dispose()); materialsList.forEach(material => material.dispose());
      scene.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
      sky.geometry.dispose(); sky.material.dispose(); environment?.dispose(); pmrem.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); runtime.current = null;
    };
  }, [geometryKey]);
  useEffect(() => { runtime.current?.zoomTo(zoom); }, [zoom]);
  // Selecting an agent anywhere glides to its home's front door, which opens as the camera arrives.
  useEffect(() => { if (selectedHomeId) runtime.current?.enterHome(selectedHomeId); }, [selectedHomeId]);
  useEffect(() => {
    const state = runtime.current; if (!state) return;
    state.zoom = 1;
    state.frame(area === 'homes' ? 'homes' : area === 'services' ? 'services' : 'all', resetKey > 0);
  }, [resetKey, area]);
  return <div className="lc-3d-wrap">
    <div ref={host} className="lc-3d-scene" />
    <div className="lc-3d-navigation">
      <button type="button" aria-label="Rotate city left" onClick={() => runtime.current?.rotate(-Math.PI / 8)}>↶</button>
      <button type="button" aria-label="Rotate city right" onClick={() => runtime.current?.rotate(Math.PI / 8)}>↷</button>
      <button type="button" className="lc-3d-lighting" aria-label="Night lighting" aria-pressed={night} title={night ? 'Show daylight' : 'Show the city at night'} onClick={() => setNight(value => !value)}>{night ? '☀' : '☾'}</button>
      <span>{hover || 'Drag to orbit · Pinch or scroll to zoom · Click a home to visit'}</span>
    </div>
  </div>;
}

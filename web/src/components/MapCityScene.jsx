import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CITY_NATURE } from '../local/cityNature';
import { CITY_DOWNTOWN } from '../local/cityDowntown';
import { CITY_SITES, CITY_ARCHITECTURE, CITY_RAMPS, CITY_TOP_EXITS, CITY_SIDE_EXITS, CITY_LOCAL_LINKS, CITY_END_ROADS, CITY_END_JUNCTIONS, CITY_HIGHWAY_LINKS, CITY_HIGHWAY_KINDS, CITY_AIRPORT, CITY_SHOPPING, CITY_LANDMARKS, CITY_HIGHWAY_PIERS, CITY_GROUND_ROADS, cityCollectorPoints, citySegmentDistance, cityHighwayJourney, cityRoadPoint, cityRoadPoints, cityDriveOrigin, cityDriveWaypoints } from '../local/cityEngineering.mjs';

// Decorative city simulation. It never represents measured traffic or member activity.
export default function MapCityScene({ homes, cities, overview, focusLandmark = '', motion, quality = 'auto', theme, title, cityId, selected, onSelect, onCitySelect, onCivicSelect, resetKey, onFallback, driving = false, drivePaused = false, driveDestination = '', onDriveArrival }) {
  const host = useRef(null), current = useRef(null), wake = useRef(null), renderBudget = useRef({ lightweight: false, illustrated: false });
  current.current = { motion, onSelect, onCitySelect, onCivicSelect, onFallback, driving, drivePaused, driveDestination, onDriveArrival };
  const shape = JSON.stringify(overview ? cities.map(city => [city.id, city.label, city.sources]) : homes);
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch { current.current.onFallback(); return; }
    // Start at full practical quality. Slow devices can lower pixel density without
    // dropping cities, interactions, or animation objects from the model.
    const maxPixelRatio = Math.min(window.devicePixelRatio || 1, renderer.capabilities.maxTextureSize / Math.max(element.clientWidth || 680, element.clientHeight || 580));
    let pixelRatio = maxPixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .78;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.domElement.setAttribute('aria-label', overview ? 'All 16 nature cities connected to UFI downtown. Drag to explore or select a city or building.' : title + '. Select a source house for topics.');
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#d9e7ed');
    scene.fog = new THREE.Fog('#d9e7ed', overview ? 600 : 160, overview ? 1000 : 290);
    const sky = new Sky(); sky.scale.setScalar(300);
    Object.assign(sky.material.uniforms.turbidity, { value: 3 });
    sky.material.uniforms.rayleigh.value = 1.5;
    sky.material.uniforms.mieCoefficient.value = .004;
    sky.material.uniforms.mieDirectionalG.value = .82;
    sky.material.uniforms.sunPosition.value.set(-60, 110, 60);
    sky.material.uniforms.showSunDisc.value = false;
    let environmentTarget = null;
    if (quality === 'maximum' || !renderBudget.current.lightweight) {
      const environmentGenerator = new THREE.PMREMGenerator(renderer);
      if (quality === 'maximum') {
        const environment = new THREE.Scene(); environment.add(sky);
        environmentTarget = environmentGenerator.fromScene(environment, .03);
        environment.remove(sky);
      } else {
        const environment = new RoomEnvironment(); environmentTarget = environmentGenerator.fromScene(environment, .035); environment.dispose();
      }
      environmentGenerator.dispose();
    }
    scene.environment = environmentTarget?.texture || null;
    scene.environmentIntensity = quality === 'maximum' ? .08 : .4;
    const world = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 800);
    const rows = Math.max(2, Math.ceil(homes.length / 3));
    const length = 9 + rows * 6, middle = length / 2 - 4;
    const focused = overview && CITY_LANDMARKS.find(item => item.id === focusLandmark);
    const target = focused ? new THREE.Vector3(focused.focus[0], 0, focused.focus[1]) : new THREE.Vector3(0, overview ? -3 : 0, overview ? 15 : middle);
    renderer.domElement.dataset.focusLandmark = focused?.id || '';
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target); controls.maxPolarAngle = Math.PI * .46;
    controls.minDistance = overview ? 20 : 8; controls.maxDistance = overview ? 300 : 65;
    controls.enableDamping = true; controls.dampingFactor = .08;
    scene.add(new THREE.HemisphereLight('#eaf6ff', '#8b9d77', .35));
    const sun = new THREE.DirectionalLight('#fff1d5', 2.8);
    sun.position.set(-60, 110, 60); sun.castShadow = true;
    const shadowExtent = overview ? 150 : 40;
    const shadowSize = Math.min(renderer.capabilities.maxTextureSize, 4096);
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 300 });
    sun.shadow.normalBias = .06; sun.shadow.bias = -.00015; sun.shadow.radius = 3;
    sun.target.position.set(0, 0, overview ? 0 : middle);
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#b6dbff', .2); fill.position.set(40, 25, -35); scene.add(fill);
    const geometries = new Map(), materials = new Map(), colors = new Map(), textures = [], records = [], animations = [], batches = [], labels = [];
    const waterColors = new Set(Object.values(CITY_NATURE).map(item => item.water));
    const glassColors = new Set(['#d7eef0', '#93bac5', '#709da8', '#8db6c8']);
    const matrix = new THREE.Matrix4();
    function geometry(kind) {
      if (kind === 'hill' && !geometries.has(kind)) {
        const hill = new THREE.PlaneGeometry(1, 1, 24, 24); hill.rotateX(-Math.PI / 2);
        const positions = hill.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), z = positions.getZ(i), radius = x * x + z * z;
          const height = Math.pow(Math.max(0, 1 - radius * 4), 2) * (.92 + .08 * Math.sin(x * 17 + z * 11));
          positions.setY(i, height);
        }
        hill.computeVertexNormals(); geometries.set(kind, hill);
      }
      if (!geometries.has(kind)) geometries.set(kind, kind === 'box' ? new THREE.BoxGeometry(1, 1, 1)
        : kind === 'roundbox' ? new RoundedBoxGeometry(1, 1, 1, overview ? 3 : 5, .035)
        : kind === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 1, overview ? 16 : 32)
        : kind === 'wheel' ? new THREE.TorusGeometry(1, .17, 4, overview ? 8 : 16)
        : kind === 'cone' ? new THREE.ConeGeometry(1, 1, overview ? 6 : 10)
        : kind === 'roof' ? new THREE.ConeGeometry(1, 1, 4)
        : kind === 'ring' ? new THREE.RingGeometry(.83, 1, overview ? 16 : 28)
        : new THREE.IcosahedronGeometry(1, 2));
      return geometries.get(kind);
    }
    function material(color, glow = false) {
      // Instance colors preserve every city's palette without one draw call per
      // paint color. Only genuinely different surface types need a material.
      const asphalt = ['#68777c', '#59666c', '#76888e', '#78868a'].includes(color);
      const steel = ['#637887', '#88999d', '#a2adb0', '#77888a'].includes(color);
      const key = color === 'contact' ? 'contact' : color === '#6dbece' ? 'lake' : glow ? 'glow' : glassColors.has(color) ? 'glass' : waterColors.has(color) ? 'water' : asphalt ? 'asphalt' : steel ? 'steel' : 'matte';
      if (!materials.has(key)) {
        if (key === 'contact') {
          materials.set(key, new THREE.MeshBasicMaterial({ color: '#2c4850', transparent: true, opacity: .15, depthWrite: false }));
          return materials.get(key);
        }
        const glass = key === 'glass', water = key === 'water' || key === 'lake';
        const surface = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: glass ? .09 : water ? .14 : steel ? .32 : asphalt ? .95 : .72,
          metalness: glass ? .12 : water ? .03 : steel ? .75 : .015,
          clearcoat: glass || water ? 1 : 0, clearcoatRoughness: .12,
          ...(glow ? { emissive: '#fff1cf', emissiveIntensity: .12 } : {}) });
        if (key === 'lake') surface.vertexColors = true;
        if (asphalt) {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const data = ctx.createImageData(128, 128);
            for (let i = 0; i < data.data.length; i += 4) {
              const shade = 210 + ((i * 16807 >>> 3) % 45);
              data.data[i] = data.data[i + 1] = data.data[i + 2] = shade; data.data[i + 3] = 255;
            }
            ctx.putImageData(data, 0, 0);
            const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(8, 8); texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); textures.push(texture);
            surface.map = texture; surface.bumpMap = texture; surface.bumpScale = .012;
          }
        }
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
    function roadPiece(parent, from, to, width, color = '#68777c', thickness = .12) {
      const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
      const node = box(parent, color, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2, width, thickness, Math.hypot(dx, dy, dz));
      node.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ');
      return node;
    }
    function roadRibbon(parent, points, width, color, thickness = .08) {
      const vertices = [], indices = [], uvs = []; let distance = 0;
      const closed = Math.hypot(points[0][0] - points.at(-1)[0], points[0][2] - points.at(-1)[2]) < .001;
      for (let i = 0; i < points.length; i++) {
        const before = points[i ? i - 1 : closed ? points.length - 2 : 0], after = points[i + 1 < points.length ? i + 1 : closed ? 1 : i];
        const dx = after[0] - before[0], dz = after[2] - before[2], length = Math.hypot(dx, dz) || 1;
        const nx = dz / length * width / 2, nz = -dx / length * width / 2, [x, y, z] = points[i];
        vertices.push(x + nx, y, z + nz, x - nx, y, z - nz, x + nx, y - thickness, z + nz, x - nx, y - thickness, z - nz);
        if (i) distance += Math.hypot(x - points[i - 1][0], z - points[i - 1][2]);
        uvs.push(0, distance / 8, width / 8, distance / 8, 0, distance / 8, width / 8, distance / 8);
        if (i) {
          const a = (i - 1) * 4, b = i * 4;
          indices.push(a, a + 1, b, a + 1, b + 1, b, a + 2, b + 2, a + 3, a + 3, b + 2, b + 3,
            a, b, a + 2, a + 2, b, b + 2, a + 1, a + 3, b + 1, a + 3, b + 3, b + 1);
        }
      }
      const road = new THREE.BufferGeometry(); road.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      road.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      road.setIndex(indices); road.computeVertexNormals();
      const key = 'alignment:' + geometries.size; geometries.set(key, road);
      return form(parent, key, color, 0, 0, 0, 1, 1, 1);
    }
    function offsetAlignment(points, offset, rise = 0) {
      return points.map(([x, y, z], i) => {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz) || 1;
        return [x + dz / length * offset, y + rise, z - dx / length * offset];
      });
    }
    function roadBarrier(parent, points, width, color, thickness, junctions) {
      let span = [];
      for (const point of points) {
        if (junctions.some(junction => Math.hypot(point[0] - junction[0], point[2] - junction[2]) < 6)) {
          if (span.length > 1) roadRibbon(parent, span, width, color, thickness);
          span = [];
        } else span.push(point);
      }
      if (span.length > 1) roadRibbon(parent, span, width, color, thickness);
    }
    function landscapeLake(parent) {
      const center = new THREE.Vector3(-23, .035, 90);
      const boundary = [[-62, 90], [-55, 79], [-39, 76], [-24, 80], [-12, 76], [5, 83], [18, 89], [12, 100], [-5, 105], [-19, 100], [-34, 106], [-51, 103]];
      const shoreline = new THREE.CatmullRomCurve3(boundary.map(([x, z]) => new THREE.Vector3(x, .035, z)), true, 'centripetal').getPoints(128).slice(0, -1);
      const shore = new THREE.Shape();
      shoreline.forEach((point, i) => {
        const x = center.x + (point.x - center.x) * 1.09, z = center.z + (point.z - center.z) * 1.09;
        if (i) shore.lineTo(x, -z); else shore.moveTo(x, -z);
      }); shore.closePath();
      const beach = new THREE.ShapeGeometry(shore); beach.rotateX(-Math.PI / 2);
      geometries.set('lakeShore', beach); form(parent, 'lakeShore', '#c9c3a7', 0, .018, 0, 1, 1, 1);
      const vertices = [center.x, center.y, center.z], indices = [], shades = [];
      const deep = new THREE.Color('#397e95'), shallow = new THREE.Color('#b1ded5'); shades.push(deep.r, deep.g, deep.b);
      const rings = 12, segments = shoreline.length;
      for (let ring = 1; ring <= rings; ring++) for (let i = 0; i < segments; i++) {
        const t = ring / rings, point = center.clone().lerp(shoreline[i], t), shade = deep.clone().lerp(shallow, Math.pow(t, 4));
        vertices.push(point.x, center.y, point.z); shades.push(shade.r, shade.g, shade.b);
        const here = 1 + (ring - 1) * segments + i, next = 1 + (ring - 1) * segments + (i + 1) % segments;
        if (ring === 1) indices.push(0, next, here);
        else { const previous = here - segments, previousNext = next - segments; indices.push(previous, previousNext, here, previousNext, next, here); }
      }
      const lake = new THREE.BufferGeometry(); lake.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      lake.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3)); lake.setIndex(indices); lake.computeVertexNormals();
      geometries.set('landscapeLake', lake); form(parent, 'landscapeLake', '#6dbece', 0, 0, 0, 1, 1, 1);
      // Shore planting and a promenade keep the water inside the landscape.
      roadRibbon(parent, [[-63, .07, 72], [-40, .07, 69], [-17, .07, 70], [8, .07, 78]], .8, '#d5cfbc');
      for (let i = 0; i < shoreline.length; i += 12) {
        const edge = center.clone().lerp(shoreline[i], 1.16);
        tree(parent, CITY_NATURE.science, edge.x, edge.z, i);
      }
      bench(parent, -37, 68.3); bench(parent, -12, 70.5);
    }
    function airport(parent) {
      const travel = { civic: 'airport' };
      // Parallel taxiway, threshold markings, terminal apron and service access.
      roadRibbon(parent, [[-133, .07, 87], [-65, .07, 87]], 4.7, '#c9c9bb');
      roadRibbon(parent, [[-132, .11, 87], [-66, .11, 87]], 3.7, '#59666c');
      roadRibbon(parent, [[-132, .12, 85.3], [-66, .12, 85.3]], .07, '#f5f1dd');
      roadRibbon(parent, [[-132, .12, 88.7], [-66, .12, 88.7]], .07, '#f5f1dd');
      for (let x = -126; x <= -72; x += 5) box(parent, '#f5f1dd', x, .13, 87, 2.1, .015, .1);
      for (const x of [-128, -70]) for (let stripe = -3; stripe <= 3; stripe++) box(parent, '#f5f1dd', x, .13, 87 + stripe * .42, 2.7, .015, .19);
      roadRibbon(parent, [[-128, .11, 77], [-77, .11, 77]], 1.6, '#76888e');
      for (const x of [-126, -80]) roadRibbon(parent, [[x, .11, 77], [x + 2, .11, 79], [x + 2, .11, 85], [x + 4, .11, 87]], 1.65, '#76888e');
      roundedBox(parent, '#c1c9c5', -95, .09, 72, 26, .16, 8);
      roundedBox(parent, '#d9d8cc', -91, 1.15, 64, 13, 2.1, 4.8, travel);
      for (let x = -96; x <= -86; x += 1.3) box(parent, '#93bac5', x, 1.3, 66.43, 1, 1.18, .07);
      box(parent, '#e6e5da', -91, 2.3, 64, 13.5, .18, 5.3, travel);
      for (const x of [-97, -85]) cylinder(parent, '#b2bdba', x, 1.2, 66.6, .1, 2.4);
      box(parent, '#e6e5da', -91, 2.4, 66.4, 13.5, .12, 1.3);
      for (let x = -96; x <= -86; x += 2) {
        const solar = box(parent, '#486e83', x, 2.49, 63.4, 1.5, .07, 2); solar.rotation.x = -.15;
      }
      roundedBox(parent, '#c9ceca', -108, 1.15, 71, 5.8, 2.2, 5);
      box(parent, '#7d9097', -108, 2.3, 71, 6.2, .18, 5.4);
      box(parent, '#8ba5ab', -108, 1.1, 73.54, 4.9, 1.75, .06);
      cylinder(parent, '#c6cec8', -80, 2, 68, .65, 4);
      roundedBox(parent, '#93bac5', -80, 4.1, 68, 2.1, 1.35, 2.1, travel);
      box(parent, '#e0e4dd', -80, 4.83, 68, 2.45, .14, 2.45);
      cylinder(parent, '#77888a', -80, 5.35, 68, .045, .95);
      for (const x of [-101, -91]) {
        const plane = new THREE.Group(); plane.position.set(x, .11, 73); plane.rotation.y = Math.PI / 2; parent.add(plane);
        roundedBox(plane, '#e9efed', 0, .58, 0, .52, .56, 3.8);
        const wing = box(plane, '#d3dedc', 0, .45, -.2, 4.7, .11, .82); wing.rotation.y = -.15;
        box(plane, '#d3dedc', 0, .79, -1.47, 1.7, .08, .45);
        box(plane, '#567e96', 0, 1.08, -1.57, .1, .9, .64);
        box(plane, '#93bac5', 0, .85, 1.28, .4, .16, .45);
        for (const side of [-1, 1]) {
          form(plane, 'ball', '#d1ddda', side * 1.22, .28, -.04, .23, .23, .65);
          cylinder(plane, '#343e43', side * .45, .15, -.65, .13, .1).rotation.z = Math.PI / 2;
        }
        for (let z = -.95; z <= .8; z += .35) for (const side of [-1, 1]) box(plane, '#709da8', side * .266, .65, z, .025, .09, .14);
      }
      const road = [[CITY_AIRPORT.junction[0], .12, CITY_AIRPORT.junction[1]], [-90, .12, 60]];
      roadRibbon(parent, road, 1.8, '#68777c');
      roadRibbon(parent, offsetAlignment(road, 1.2, .01), .5, '#dedccf');
      for (let z = 59; z < 65; z += 1.1) box(parent, '#dedccf', -101, .1, z, 3.4, .1, .7);
      label(parent, 'Airport', -91, 4.5, 64, 12, '#294c4b', 2, travel);
    }
    function shoppingCenter(parent) {
      const shop = { civic: 'shopping' };
      // Low retail wings flank a glazed atrium. Parking and deliveries face the
      // arterial approach, keeping the building and access clear of the lake.
      roundedBox(parent, '#d4d2c5', 43, .09, 93, 31, .18, 12);
      for (const x of [34, 52]) {
        roundedBox(parent, '#d9c6ad', x, 1.55, 94, 10.5, 2.9, 8, shop);
        box(parent, '#dddccf', x, 3.08, 94, 11, .18, 8.5);
        for (let dx = -3.8; dx <= 3.8; dx += 1.9) {
          box(parent, '#93bac5', x + dx, 1.24, 89.96, 1.6, 1.95, .08, shop);
          box(parent, '#567e96', x + dx, 2.49, 89.9, 1.6, .34, .1);
        }
        box(parent, '#eae6d6', x, 2.84, 89.5, 11, .12, 1.4);
        for (const dx of [-4.9, 4.9]) cylinder(parent, '#88999d', x + dx, 1.4, 89.1, .08, 2.8);
        for (const dx of [-2.5, 2.5]) box(parent, '#77888a', x + dx, 3.48, 96, 1.5, .7, 1.4);
        for (let dx = -3; dx <= 3; dx += 2) box(parent, '#486e83', x + dx, 3.24, 92, 1.5, .07, 2.5);
      }
      roundedBox(parent, '#93bac5', 43, 2.1, 93.5, 6, 4.05, 9, shop);
      box(parent, '#dce2de', 43, 4.17, 93.5, 6.5, .16, 9.5);
      for (const x of [40.2, 42, 44, 45.8]) box(parent, '#a2adb0', x, 2.12, 88.96, .09, 3.9, .1);
      box(parent, '#709da8', 43, 1.1, 88.85, 2.8, 2.1, .1, shop);
      box(parent, '#e6e2d6', 43, 2.8, 88.2, 4.2, .14, 1.5);
      roadRibbon(parent, [[29, .12, 85], [61, .12, 85]], 5, '#68777c');
      roadRibbon(parent, [[27, .14, 88.8], [61, .14, 88.8]], .85, '#dedccf');
      for (let x = 30; x <= 60; x += 2.8) {
        box(parent, '#eeeade', x, .14, 83.1, .06, .015, 2.1);
        box(parent, '#eeeade', x, .14, 86.9, .06, .015, 2.1);
      }
      for (let z = 85; z <= 88; z += .5) box(parent, '#f5f1dd', 43, .155, z, 2.5, .015, .22);
      for (const x of [30.9, 36.5, 50.5, 56.1]) {
        roundedBox(parent, x < 40 ? '#8da6aa' : '#ba9277', x, .5, 83.2, 1.3, .68, 2);
        box(parent, '#93bac5', x, .91, 83.2, 1.08, .36, 1.05);
      }
      for (const x of [27, 60]) { tree(parent, CITY_NATURE.design, x, 89, 1); bench(parent, x, 91); }
      const access = [[CITY_SHOPPING.junction[0], .12, CITY_SHOPPING.junction[1]], [64, .12, 83]];
      roadRibbon(parent, access, 1.85, '#68777c');
      roadRibbon(parent, offsetAlignment(access, 1.2, .025), .5, '#dedccf');
      roadRibbon(parent, [[64, .12, 83], [64, .12, 85], [59, .12, 85]], 1.85, '#68777c');
      label(parent, 'Shopping center', 43, 5.6, 94, 14, '#294c4b', 2, shop);
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
    function label(parent, text, x, y, z, width = 4.2, color = '#294c4b', priority = 0, pick = null) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.fillStyle = '#fffffff5'; ctx.beginPath(); ctx.roundRect(1, 1, 510, 94, 18); ctx.fill();
      ctx.fillStyle = color; ctx.font = '600 48px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 48, 472);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false }); materials.set('label:' + textures.length, mat);
      const sprite = new THREE.Sprite(mat); parent.updateWorldMatrix(true, false);
      sprite.position.copy(parent.localToWorld(new THREE.Vector3(x, y, z)));
      const scale = parent.getWorldScale(new THREE.Vector3()).x;
      sprite.scale.set(width * scale, width * scale * 96 / 512, 1); sprite.renderOrder = 2;
      sprite.userData.labelWidth = width * scale; sprite.userData.priority = priority;
      sprite.userData.target = pick;
      scene.add(sprite); labels.push(sprite);
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
        for (let branch = 0; branch < 4; branch++) {
          const angle = branch * Math.PI / 2 + index * .7;
          const end = [x + Math.cos(angle) * .58, 1.5 + branch % 2 * .45, z + Math.sin(angle) * .58];
          beam(parent, '#75624d', [x, .85, z], end, .045);
          ball(parent, landscape.leaves, end[0], end[1], end[2], .36 + branch % 2 * .09);
        }
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
      const countRows = Math.max(2, Math.ceil(cityHomes.length / 3)), depth = 9 + countRows * 6, mid = depth / 2 - 4;
      const cityPick = compact ? { city: cityId } : null;
      if (!compact) {
        box(parent, landscape.ground, 0, -.3, mid, 44, .6, depth + 24);
        roundedBox(parent, '#d0d5bc', 0, -.61, mid, 32.3, .85, depth + 7.3, cityPick);
        roundedBox(parent, landscape.ground, 0, -.28, mid, 32, .6, depth + 7, cityPick);
      }
      box(parent, '#76888e', 0, .045, mid, 3.2, .07, depth + 2);
      // Graded foundations, kerbs, gutters and a connected street grid.
      for (const side of [-1, 1]) {
        box(parent, '#728489', side * 1.64, .065, mid, .1, .04, depth + 2);
        for (let z = -4; z < depth; z += 6) box(parent, '#40525a', side * 1.64, .095, z, .14, .025, .35);
      }
      for (const side of [-1, 1]) box(parent, '#d9d8ca', side * 1.93, .075, mid, .48, .1, depth + 2);
      box(parent, '#e6e4db', 0, .05, -3, 24, .1, 4.2);
      for (let z = -5; z < depth - 2; z += 2.8) box(parent, '#f4f0d3', 0, .065, z, .1, .025, 1.25);
      if (!compact) {
        [['Sources', -10], ['Your city', -4.5], ['Collection', 7.7]].forEach(([name, x], i) => {
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
        const x = [-10, -4.5, 7.7][index % 3], z = 2.5 + Math.floor(index / 3) * 6;
        const architecture = CITY_ARCHITECTURE[cityId] || CITY_ARCHITECTURE.community;
        const office = architecture.typology === 'office', campus = architecture.typology === 'campus';
        const floors = Math.max(1, architecture.floors + (office ? [-1, 0, -2, 1][index % 4] : index % 2 - 1)), height = floors * .9 + .5;
        const frontage = office || campus ? 1.31 : .94;
        const pick = { source: home.id, ...(compact ? { city: cityId } : {}) };
        roundedBox(parent, '#e8e3d7', x, .13, z, 3.1, .18, 2.8, pick);
        roundedBox(parent, home.id === selected && !compact ? '#c0ded1' : architecture.facade, x, .25 + height / 2, z, 2.15, height, 1.85, pick);
        // A wider street-level plinth supports the narrower office volume.
        if (office || campus) {
          roundedBox(parent, architecture.facade, x, 1, z, 3, 1.5, 2.6, pick);
          for (const side of [-1, 1]) {
            box(parent, '#93bac5', x + side * .82, 1.04, z + frontage + .01, .9, .82, .045);
            box(parent, '#e2e0d5', x + side * 1.4, 1, z + 1.25, .14, 1.6, .14);
          }
          box(parent, '#e2e0d5', x, 1.79, z + 1.34, 3.15, .16, .35);
        }
        for (const side of [-1, 1]) for (const end of [-1, 1]) box(parent, '#c5c7bc', x + side * 1.045, .25 + height / 2, z + end * .91, .09, height, .09);
        for (let floor = 0; floor < floors; floor++) {
          const y = .9 + floor * .9;
          for (const side of [-1, 1]) {
            box(parent, '#93bac5', x, y, z + side * .934, 1.68, .55, .04);
            box(parent, '#e0ded4', x, y + .31, z + side * .97, 2.18, .07, .14);
            for (const offset of [-.58, 0, .58]) box(parent, '#77888a', x + offset, y, z + side * .962, .04, .58, .025);
          }
          box(parent, '#93bac5', x + 1.085, y, z, .04, .55, 1.28);
        }
        if (architecture.roof === 'pitched') {
          const roof = form(parent, 'roof', '#7b786c', x, height + .62, z, 1.77, .82, 1.77, pick); roof.rotation.y = Math.PI / 4;
          box(parent, '#d4b89d', x - .58, height + .84, z - .22, .22, .66, .25);
        } else {
          box(parent, '#e4e5dc', x, height + .3, z, 2.3, .15, 2);
          for (const side of [-1, 1]) box(parent, '#c3cac6', x + side * 1.08, height + .49, z, .08, .35, 1.96);
          box(parent, '#92a1a2', x - .55, height + .53, z - .4, .55, .35, .55);
          if (architecture.roof === 'solar') {
            const panel = box(parent, '#486e83', x + .3, height + .52, z + .1, 1.05, .07, 1.25); panel.rotation.x = -.15;
            for (const offset of [-.31, 0, .31]) box(parent, '#93bac5', x + .3 + offset, height + .56, z + .1, .02, .01, 1.22);
          } else { box(parent, landscape.leaves, x + .3, height + .45, z + .35, .8, .17, .6); }
        }
        if (architecture.roof === 'terrace' && !office) for (let floor = 1; floor < floors; floor++) {
          const y = .55 + floor * .9;
          box(parent, '#e4e1d6', x, y, z + 1.1, 2.45, .11, .45);
          beam(parent, '#77888a', [x - 1.16, y + .43, z + 1.32], [x + 1.16, y + .43, z + 1.32], .045);
          for (const side of [-1, 1]) box(parent, '#77888a', x + side * 1.16, y + .22, z + 1.3, .04, .43, .04);
        }
        box(parent, '#f7f0e3', x, 1.59, z + frontage, 2.35, .13, .25);
        box(parent, office ? '#709da8' : '#977559', x, .68, z + frontage, .45, 1.1, .06);
        [-.65, .65].forEach(offset => {
          box(parent, '#f7f0e3', x + offset, 1.0, z + frontage + .013, .55, .63, .08);
          form(parent, 'box', office || campus ? '#93bac5' : '#e7c484', x + offset, 1.0, z + frontage + .062, .4, .48, .04, null, false, !office && !campus);
          box(parent, '#f7f0e3', x + offset, 1.0, z + frontage + .091, .035, .47, .03);
        });
        box(parent, '#8db6c8', x + 1.085, 1, z, .04, .47, .5);
        roundedBox(parent, '#cbbfa7', x, .21, z + frontage + .13, .76, .17, .43);
        ball(parent, landscape.leaves, x - 1.1, .43, z + 1.13, .29);
        ball(parent, landscape.flowers, x + 1.1, .36, z + 1.13, .23);
        box(parent, '#e4e1d6', x / 2, .07, z + 1.65, Math.abs(x) + 1, .04, .65);
        if (index % 3 === 0) streetLight(parent, 2.4, z + 1.5, index);
        if (!compact) {
          label(parent, home.label, x, height + 1.5, z, 3.2, '#294c4b', 1, { source: home.id });
          if (home.summary) label(parent, home.summary, x, height + .97, z, 3.2, '#55746d');
        }
      });
      for (let row = 0; row < countRows; row++) {
        bench(parent, -7.25, 2.7 + row * 6);
        ball(parent, landscape.leaves, -7.25, .35, 1.65 + row * 6, .45);
        const z = 4.7 + row * 6;
        box(parent, '#78868a', 0, .075, z, 27, .04, 1.3);
        for (const side of [-1, 1]) box(parent, '#d9d8ca', 0, .11, z + side * .8, 27, .09, .32);
        for (const side of [-1, 1]) for (let stripe = -2; stripe <= 2; stripe++) box(parent, '#ececde', side * 2.2, .105, z + stripe * .2, .65, .02, .09);
      }
      for (let i = 0; i < (compact ? 8 : 16); i++) tree(parent, landscape, i % 2 ? 14.2 : -14.2, -4 + i * (depth + 2) / (compact ? 8 : 16), i);
      if (['pond', 'coast', 'creek'].includes(landscape.feature)) {
        if (landscape.feature === 'pond') pond(parent, landscape, 7, depth - 2, 2.1);
        else for (let i = 0; i < 7; i++) pond(parent, landscape, 9.5 + Math.sin(i) * .55, -5 + i * (depth + 5) / 6, landscape.feature === 'coast' ? 2.5 : 1.2);
      }
      if (['pond', 'creek', 'coast'].includes(landscape.feature)) {
        const z = landscape.feature === 'pond' ? depth - 2 : depth / 2;
        // A supported boardwalk bridges the water instead of floating paving.
        box(parent, '#c5b99e', 9.2, .62, z, 4.3, .16, .85);
        for (const x of [7.4, 8.5, 9.9, 11]) {
          cylinder(parent, '#9ba8a6', x, .26, z, .095, .65);
          for (const side of [-1, 1]) cylinder(parent, '#77888a', x, 1.03, z + side * .4, .025, .85);
        }
        for (const side of [-1, 1]) {
          beam(parent, '#77888a', [7.05, 1.43, z + side * .4], [11.35, 1.43, z + side * .4], .05);
          beam(parent, '#637887', [7.3, .46, z + side * .3], [11.1, .46, z + side * .3], .1);
        }
      }
      if (['hills', 'alpine', 'rocks'].includes(landscape.feature)) for (let i = 0; i < 3; i++) {
        form(parent, landscape.feature === 'rocks' ? 'ball' : 'hill', landscape.feature === 'rocks' ? '#91a198' : landscape.ground, -5 + i * 5, landscape.feature === 'rocks' ? .7 : -.03, depth + (compact ? 0 : 4), landscape.feature === 'rocks' ? 2 : 7, 2.5 + i % 2, landscape.feature === 'rocks' ? 2 : 5.5);
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
      if (compact) label(parent, name, 0, (CITY_ARCHITECTURE[cityId]?.floors || 2) * .9 + 2, -2, 14, '#294c4b', 2, { city: cityId });
    }
    const central = group(), cityPortals = [];
    if (overview) {
      // Valley survey: varied boundaries and a graded corridor for roads and plots.
      const vertices = [], indices = [], columns = 96, terrainRows = 48;
      for (let col = 0; col <= columns; col++) {
        const x = -147 + col * 294 / columns, north = -60 + 5 * Math.sin(x * .035), south = 103 + 5 * Math.cos(x * .027);
        for (let row = 0; row <= terrainRows; row++) {
          const z = north + (south - north) * row / terrainRows, fringe = Math.max(0, Math.abs(row / terrainRows - .5) * 2 - .82) / .18;
          vertices.push(x, -.17 + fringe * Math.max(0, Math.sin(x / 12) * Math.cos(z / 13)) * 2, z);
          if (col && row) { const a = (col - 1) * (terrainRows + 1) + row - 1, b = col * (terrainRows + 1) + row - 1; indices.push(a, a + 1, b, a + 1, b + 1, b); }
        }
      }
      const terrain = new THREE.BufferGeometry(); terrain.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      terrain.setIndex(indices); terrain.computeVertexNormals(); geometries.set('terrain', terrain);
      form(central, 'terrain', '#829c75', 0, 0, 0, 1, 1, 1);
      const arterial = cityRoadPoints('arterial');
      roadRibbon(central, arterial, 4.3, '#c5c7b9', .12);
      roadRibbon(central, arterial.map(([x, y, z]) => [x, y + .03, z]), 3.6, '#68777c', .1);
      for (const side of [-1, 1]) roadRibbon(central, cityRoadPoints('arterial', side * 2.35, .12), .65, '#dedccf', .12);
      roadRibbon(central, cityRoadPoints('promenade', 0, .1), 1.5, '#dedccf', .12);
      roadRibbon(central, cityRoadPoints('promenade', 1.7, .09), .75, '#b9cbb3', .1);
      for (let i = 0; i < 384; i += 5) roadPiece(central, [arterial[i][0], .13, arterial[i][2]], [arterial[i + 1][0], .13, arterial[i + 1][2]], .1, '#f7efd3', .018);
      // Downtown lanes pass between civic blocks and join the main road.
      for (const side of [-1, 1]) {
        const position = .5 + side * 3.6 / 232, outer = cityRoadPoint('arterial', position);
        const street = [[side * 3.6, .1, -17.4], [outer[0], .1, outer[1]]];
        roadRibbon(central, street, 1.56, '#76888e');
        for (const edge of [-1, 1]) roadRibbon(central, offsetAlignment(street, edge * .96, .02), .3, '#dedccf');
      }
      roadRibbon(central, [[-16.2, .1, -9], [16.2, .1, -9]], 1.56, '#76888e');
      for (const side of [-1, 1]) roadRibbon(central, [[-16.2, .12, -9 + side * .96], [16.2, .12, -9 + side * .96]], .3, '#dedccf');
      cities.forEach((city, i) => {
        const site = CITY_SITES[i], { x, z, rotation, entrance, junction } = site;
        const parent = group(x - Math.sin(rotation) * 6.5 * .58, z - Math.cos(rotation) * 6.5 * .58, .58);
        parent.rotation.y = rotation;
        neighborhood(parent, city.sources.slice(0, 6).map(id => ({ id })), CITY_NATURE[city.id], city.label, true, city.id);
        const collector = cityCollectorPoints(site);
        roadRibbon(central, collector, 1.85, '#68777c');
        for (const side of [-1, 1]) roadRibbon(central, offsetAlignment(collector, side * 1.2, .025), .38, '#dad9cb', .1);
        cylinder(central, '#68777c', junction[0], .11, junction[1], 2.2, .08);
        const nx = Math.sin(rotation), nz = Math.cos(rotation);
        // Stop lines and crossings sit on the collector approach, clear of the arterial.
        for (let stripe = -2; stripe <= 2; stripe++) {
          const marking = box(central, '#f2eee1', junction[0] + nx * 3 + nz * stripe * .3, .16, junction[1] + nz * 3 - nx * stripe * .3, .15, .015, 1.6);
          marking.rotation.y = rotation + Math.PI / 2;
        }
        streetLight(central, junction[0] + nx * 4 + nz * 1.6, junction[1] + nz * 4 - nx * 1.6, i);
        cityPortals.push(site);
      });
      // Green corridors between neighborhood branches retain walking paths and ponds.
      for (let i = 0; i < 7; i++) for (const side of [-1, 1]) {
        const position = .5 + [-92, -64, -36, 0, 36, 64, 92][i] / 232, [x, z] = cityRoadPoint('arterial', position, side < 0 ? 39 : -29);
        const park = group(x, z);
        pond(park, CITY_NATURE.science, 0, 0, 1.8);
        for (let treeIndex = 0; treeIndex < 4; treeIndex++) tree(park, CITY_NATURE.technology, -3 + treeIndex * 2, treeIndex % 2 ? 3 : -3, treeIndex);
        box(park, '#d5cfbc', 0, .05, -4.1, 8, .08, .8); bench(park, -2, -3.7); bench(park, 2, -3.7);
      }
      landscapeLake(group(0, -10));
      airport(central);
      shoppingCenter(central);
      // Divided expressway: continuous swept deck, shoulders, barriers and pier spans.
      for (const kind of CITY_HIGHWAY_KINDS) {
        const highway = cityRoadPoints(kind, 0, 2.9);
        const junctions = [...CITY_END_JUNCTIONS.filter(item => item.kind === kind).map(item => item.points[0]), ...(kind === 'highway' ? [...CITY_HIGHWAY_LINKS.map(link => link[0]), ...CITY_TOP_EXITS.map(exit => exit.points[0])] : [...CITY_HIGHWAY_LINKS.map(link => link.at(-1)), ...CITY_RAMPS.map(ramp => ramp[0])])];
        roadRibbon(central, highway, 7.6, '#59666c', .3);
        roadBarrier(central, cityRoadPoints(kind, 0, 3.22), .38, '#c3c6b9', .32, junctions);
        for (const side of [-1, 1]) {
          const barrier = cityRoadPoints(kind, side * 3.55, 3.5);
          roadBarrier(central, barrier, .12, '#a2adb0', .14, junctions);
          for (let i = 0; i < 384; i += 3) if (!junctions.some(point => Math.hypot(point[0] - barrier[i][0], point[2] - barrier[i][2]) < 6)) box(central, '#88999d', barrier[i][0], 3.2, barrier[i][2], .06, .6, .06);
          roadRibbon(central, cityRoadPoints(kind, side * 3.25, 3.065), .07, '#e4e3d8', .015);
          const markings = cityRoadPoints(kind, side * 1.9, 3.065);
          for (let i = 0; i < 384; i += 4) roadPiece(central, markings[i], markings[i + 1], .08, '#e4e3d8', .015);
        }
        for (const [x, , z] of CITY_HIGHWAY_PIERS[kind]) {
          const support = group(x, z), a = cityRoadPoint(kind, .5 + x / 260), b = cityRoadPoint(kind, .5 + x / 260 + .001); support.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
          box(support, '#aeb8b8', 0, 1.17, 0, .85, 2.65, .85);
          box(support, '#bfc4bf', 0, 2.52, 0, 6.8, .35, .95);
          box(support, '#c5c9bd', 0, -.12, 0, 1.8, .3, 1.8);
        }
      }
      for (const road of CITY_END_ROADS) {
        const junctions = [...CITY_END_JUNCTIONS.filter(item => item.side === road.side).map(item => item.points.at(-1)), ...CITY_SIDE_EXITS.filter(exit => exit.side === road.side).map(exit => exit.points[0])];
        roadRibbon(central, road.points, 3.4, '#59666c', .3);
        for (const side of [-1, 1]) {
          const barrier = offsetAlignment(road.points, side * 1.55, .6);
          roadBarrier(central, barrier, .12, '#a2adb0', .14, junctions);
          roadRibbon(central, offsetAlignment(road.points, side * 1.4, .165), .07, '#e4e3d8', .015);
          for (let i = 0; i < barrier.length; i += 3) if (!junctions.some(point => Math.hypot(point[0] - barrier[i][0], point[2] - barrier[i][2]) < 6)) box(central, '#88999d', barrier[i][0], 3.2, barrier[i][2], .06, .6, .06);
        }
        for (let i = 0; i + 1 < road.points.length; i += 4) roadPiece(central, road.points[i].map((value, axis) => axis === 1 ? value + .165 : value), road.points[i + 1].map((value, axis) => axis === 1 ? value + .165 : value), .08, '#e4e3d8', .015);
        for (let i = 4; i < road.points.length; i += 8) {
          const [x, , z] = road.points[i];
          box(central, '#aeb8b8', x, 1.17, z, .85, 2.65, .85);
          box(central, '#bfc4bf', x, 2.52, z, 2.8, .35, .95);
          box(central, '#c5c9bd', x, -.12, z, 1.8, .3, 1.8);
        }
      }
      for (const junction of CITY_END_JUNCTIONS) {
        roadRibbon(central, junction.points, 3.4, '#59666c', .3);
        const [x, y, z] = junction.points.at(-1);
        cylinder(central, '#59666c', x, y - .15, z, 2.1, .3);
        const stop = junction.points[0], direction = junction.side;
        for (const side of [-1, 1]) box(central, '#e4e3d8', stop[0] + direction * 4, 3.07, stop[2] + side * .7, .12, .015, 1.2);
      }
      for (const road of CITY_LOCAL_LINKS) {
        roadRibbon(central, road, 1.85, '#68777c');
        for (const side of [-1, 1]) roadRibbon(central, offsetAlignment(road, side * 1.2, .025), .38, '#dad9cb', .1);
        for (let i = 0; i + 1 < road.length; i += 8) roadPiece(central, road[i].map((value, axis) => axis === 1 ? value + .05 : value), road[i + 1].map((value, axis) => axis === 1 ? value + .05 : value), .065, '#eeeade', .015);
      }
      [...CITY_HIGHWAY_LINKS, ...CITY_RAMPS, ...CITY_TOP_EXITS.map(exit => exit.points), ...CITY_SIDE_EXITS.map(exit => exit.points)].forEach(ramp => {
        roadRibbon(central, ramp, 2.45, '#59666c', .22);
        for (const side of [-1, 1]) {
          const barrier = offsetAlignment(ramp, side * 1.12, .45);
          roadRibbon(central, barrier, .1, '#a2adb0', .15);
          for (let i = 0; i < barrier.length; i += 4) box(central, '#88999d', barrier[i][0], barrier[i][1] - .25, barrier[i][2], .05, .4, .05);
        }
        for (let i = 8; i < ramp.length - 8; i += 8) {
          const [x, y, z] = ramp[i]; if (y < .45 || CITY_GROUND_ROADS.some(([a, b]) => citySegmentDistance([x, z], a, b) < 2)) continue;
          box(central, '#aeb8b8', x, (y - .37) / 2, z, .55, y - .07, .55);
          box(central, '#c5c9bd', x, -.14, z, 1.4, .28, 1.4);
        }
      });
      for (const exit of CITY_TOP_EXITS) {
        const [x, y, z] = exit.points[0];
        for (const side of [-1, 1]) cylinder(central, '#77888a', x + side, y + 1.4, z, .055, 2.8);
        box(central, '#416d62', x, y + 2.6, z, 2.8, 1, .15);
        label(central, exit.label + ' exit', x, y + 3.5, z, 7, '#294c4b', 1, { city: exit.id });
      }
      const civic = group(0, -6, .6);
      const positions = [[-14, -10], [-1, -13], [13, -11], [-18, 4], [15, 2], [-13, 15], [0, 14], [13, 12]];
      CITY_DOWNTOWN.forEach((building, index) => {
        const [x, z] = positions[index], pick = { civic: building.id };
        roundedBox(civic, '#ece7dd', x, .16, z, 7.8, .3, 6.8, pick);
        roundedBox(civic, building.color, x, building.height / 2, z, 5.4, building.height, 4.8, pick);
        roundedBox(civic, '#e5eced', x, building.height + .15, z, 5.7, .3, 5.1, pick);
        for (let floor = 1; floor < building.height; floor += 1.1) {
          box(civic, '#c1d0ce', x, floor + .43, z, 5.49, .095, 4.89);
          for (let window = -1; window <= 1; window++) {
            for (const side of [-1, 1]) {
              form(civic, 'box', '#d7eef0', x + window * 1.3, floor, z + side * 2.43, .88, .67, .08, null, false, true);
              form(civic, 'box', '#8db6c8', x + side * 2.72, floor, z + window * 1.15, .08, .67, .74);
            }
          }
        }
        roundedBox(civic, '#b4c2bc', x, .65, z + 2.67, 2.3, .12, .95);
        box(civic, '#8db6c8', x, .95, z + 2.45, 1.28, 1.6, .09);
        if (index % 2 === 0) {
          roundedBox(civic, '#758d8c', x, building.height + .8, z, 3.1, 1, 2.7, pick);
          box(civic, '#aec397', x, building.height + 1.33, z, 2.8, .12, 2.4);
          for (const side of [-1, 1]) ball(civic, CITY_NATURE.people.leaves, x + side, building.height + 1.57, z - .7, .37);
        } else {
          for (const offset of [-.85, .85]) {
            const solar = box(civic, '#486e83', x + offset, building.height + .43, z, 1.35, .09, 2.6); solar.rotation.x = -.18;
          }
        }
        bench(civic, x - 2.7, z + 3, 0);
        for (const side of [-1, 1]) {
          roundedBox(civic, '#d1c7b5', x + side * 3.1, .43, z - 2.45, .8, .4, .8);
          ball(civic, '#8faa83', x + side * 3.1, .94, z - 2.45, .55);
        }
        label(civic, building.label, x, building.height + 2, z, 10.5);
      });
      roundedBox(civic, '#f6f6ef', 0, 4.3, 0, 4.6, 8.6, 4.6, { civic: 'feed' });
      roundedBox(civic, '#507da3', 0, 9.1, 0, 3.8, 1, 3.8);
      for (let floor = 1; floor < 8; floor++) {
        for (const side of [-1, 1]) {
          box(civic, '#709da8', side * 2.32, floor, 0, .08, .53, 3.65);
          box(civic, '#709da8', 0, floor, side * 2.32, 3.65, .53, .08);
        }
      }
      box(civic, '#086ef9', -1.2, 11.5, 0, .75, 3, .75);
      box(civic, '#178cff', 1.2, 11.5, 0, .75, 3, .75);
      box(civic, '#086ef9', 0, 10.1, 0, 3.1, .75, .75);
      label(civic, 'UFIConnect', 0, 14.1, 0, 11, '#165986', 3, { civic: 'feed' });
      for (let i = 0; i < 32; i++) {
        const position = i / 31, [x, z] = cityRoadPoint('promenade', position, 3.7);
        tree(civic, CITY_NATURE.people, x, z, i);
        if (i % 2 === 0) { const [lx, lz] = cityRoadPoint('promenade', position, .95); streetLight(civic, lx, lz, i); }
      }
      fountain(civic, -23, 13, 2.25); fountain(civic, 23, 13, 1.65);
    } else neighborhood(central, homes, theme, title, false, cityId);
    // Traffic follows the surveyed alignments; pedestrians and trams return along their corridors.
    function route(time, radiusX, radiusZ, centerZ = 0, offset = 0) {
      const progress = ((time + offset) % 1 + 1) % 1, side = Math.floor(progress * 4), t = progress * 4 - side;
      return side === 0 ? [-radiusX + 2 * radiusX * t, centerZ - radiusZ, Math.PI / 2]
        : side === 1 ? [radiusX, centerZ - radiusZ + 2 * radiusZ * t, 0]
        : side === 2 ? [radiusX - 2 * radiusX * t, centerZ + radiusZ, -Math.PI / 2]
        : [-radiusX, centerZ + radiusZ - 2 * radiusZ * t, Math.PI];
    }
    // Arc-length paths keep transit at a consistent speed through rounded corners.
    function alignmentPath(kind, offset = 0) {
      const path = new THREE.CurvePath(), points = kind.startsWith('journey-') ? offsetAlignment(cityHighwayJourney(Number(kind.slice(8))), offset, 0) : cityRoadPoints(kind, offset, 0);
      for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i - 1]), new THREE.Vector3(...points[i])));
      path.updateArcLengths(); return path;
    }
    if (overview) {
      const transitPath = alignmentPath('transit'), transitLength = transitPath.getLength();
      roadRibbon(central, cityRoadPoints('transit', 0, .07), 1.65, '#bfc9bd', .08);
      for (const offset of [-.37, .37]) roadRibbon(central, cityRoadPoints('transit', offset, .14), .055, '#88999d', .05);
      const stops = [.05, .35, .65, .95].map(phase => {
        const point = transitPath.getPointAt(phase), tangent = transitPath.getTangentAt(phase);
        return [point.x, point.z, Math.atan2(tangent.x, tangent.z) - Math.PI / 2];
      });
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
          const clock = time * .024 + train * 2 / 3, cycle = clock % 2, outbound = cycle < 1;
          const phase = Math.max(.02, Math.min(.98, (outbound ? cycle : 2 - cycle) + (outbound ? -1 : 1) * carriage * 3.75 / transitLength));
          transitPath.getPointAt(phase, position); transitPath.getTangentAt(phase, tangent);
          if (!outbound) tangent.negate();
          tram.position.set(position.x, .02, position.z); tram.rotation.y = Math.atan2(tangent.x, tangent.z);
        });
      }
      cityPortals.forEach(({ entrance, junction }, index) => {
        const shuttle = group(0, 0, .62, true);
        roundedBox(shuttle, index % 2 ? '#e8b86d' : '#dceadf', 0, .52, 0, 1.15, .92, 1.9);
        box(shuttle, '#93bac5', 0, .72, .96, .86, .42, .055);
        box(shuttle, '#425660', 0, .17, -.57, 1.25, .25, .22); box(shuttle, '#425660', 0, .17, .57, 1.25, .25, .22);
        const dx = entrance[0] - junction[0], dz = entrance[1] - junction[1], distance = Math.hypot(dx, dz);
        animations.push(time => {
          const cycle = (time * .06 + index / cityPortals.length) % 1, outbound = cycle < .5, portion = outbound ? cycle * 2 : (1 - cycle) * 2;
          const t = Math.max(0, Math.min(1, (portion - .12) / .76)), lane = outbound ? .3 : -.3;
          shuttle.position.set(junction[0] + dx * t + dz / distance * lane, .14, junction[1] + dz * t - dx / distance * lane);
          shuttle.rotation.y = Math.atan2(dx, dz) + (outbound ? 0 : Math.PI);
        });
      });
    }
    const traffic = overview ? 48 : 8;
    const highwayTrafficPaths = overview ? [alignmentPath('journey-0', -.55), alignmentPath('journey-1', .55), alignmentPath('highway', -.9), alignmentPath('highway', .9), alignmentPath('highway-return', -.9), alignmentPath('highway-return', .9)] : [];
    for (let i = 0; i < traffic; i++) {
      const car = group(0, 0, overview ? 1 : .68, true);
      roundedBox(car, ['#4d8dba', '#e5b675', '#faf2da', '#b98489'][i % 4], 0, .34, 0, .95, .48, 1.85);
      roundedBox(car, '#93bac5', 0, .67, -.08, .78, .4, 1);
      for (const side of [-1, 1]) for (const z of [-.57, .57]) {
        const wheel = cylinder(car, '#343e43', side * .48, .19, z, .18, .11); wheel.rotation.z = Math.PI / 2;
      }
      cylinder(car, 'contact', 0, .045, 0, 1, .012).scale.set(.68, .012, 1.08);
      for (const side of [-1, 1]) {
        form(car, 'box', '#fff0ba', side * .3, .42, .94, .18, .12, .035, null, false, true);
        form(car, 'box', '#df8976', side * .3, .42, -.94, .18, .12, .035, null, false, true);
      }
      const highway = overview && i >= 32;
      const carPath = overview ? highway ? highwayTrafficPaths[i < 36 ? i % 2 : i < 42 ? 2 + i % 2 : 4 + i % 2] : alignmentPath('arterial', i % 2 ? .9 : -.9) : null;
      animations.push(time => {
        if (overview) {
          const t = ((time * (i % 2 ? -.013 : .013) + i / traffic) % 1 + 1) % 1;
          const point = carPath.getPointAt(t), tangent = carPath.getTangentAt(t);
          car.position.set(point.x, t < .025 || t > .975 ? -1000 : highway ? 2.91 : .11, point.z);
          car.rotation.y = Math.atan2(tangent.x, tangent.z) + (i % 2 ? Math.PI : 0);
        } else {
          const position = route(time * (i % 2 ? -.035 : .035), .55, (length + 1) / 2, middle, i / traffic);
          car.position.set(position[0], .08, position[1]); car.rotation.y = position[2] + (i % 2 ? Math.PI : 0);
        }
      });
    }
    const walkPaths = overview ? [alignmentPath('promenade', -.3), alignmentPath('promenade', .3)] : [];
    const cyclePath = overview ? alignmentPath('promenade', 1.7) : null;
    for (let i = 0; i < (overview ? 42 : 18); i++) {
      const walker = group(0, 0, overview ? 1 : .8, true);
      box(walker, ['#b78278', '#507996', '#c8b170', '#6b9b85'][i % 4], 0, .66, 0, .3, .55, .22);
      ball(walker, '#ccac90', 0, 1.08, 0, .18);
      const left = box(walker, '#55616a', -.09, .25, 0, .1, .45, .12), right = box(walker, '#55616a', .09, .25, 0, .1, .45, .12);
      const leftArm = box(walker, '#ccac90', -.2, .65, 0, .085, .44, .11), rightArm = box(walker, '#ccac90', .2, .65, 0, .085, .44, .11);
      animations.push(time => {
        const path = walkPaths[i % 2], clock = (time * .008 + i / 42) % 2, phase = clock < 1 ? clock : 2 - clock;
        const point = path?.getPointAt(phase), tangent = path?.getTangentAt(phase); if (clock > 1) tangent?.negate();
        const pos = overview ? [point.x, point.z, Math.atan2(tangent.x, tangent.z)] : route(time * .015, 1.92 + i % 2 * .08, length / 2, middle, i / 18);
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
        const clock = (time * .017 + i / 10) % 2, phase = clock < 1 ? clock : 2 - clock, point = cyclePath?.getPointAt(phase), tangent = cyclePath?.getTangentAt(phase); if (clock > 1) tangent?.negate();
        const pos = overview ? [point.x, point.z, Math.atan2(tangent.x, tangent.z)] : route(time * .026, 1.38, length / 2, middle, i / 4);
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
    const driveCar = overview ? group(0, 0, 1, true) : null;
    if (driveCar) {
      roundedBox(driveCar, '#f3ede0', 0, .4, 0, .95, .5, 1.95);
      roundedBox(driveCar, '#709da8', 0, .76, -.05, .79, .35, 1.05);
      for (const side of [-1, 1]) for (const z of [-.62, .62]) {
        const wheel = cylinder(driveCar, '#343e43', side * .48, .2, z, .21, .12); wheel.rotation.z = Math.PI / 2;
      }
      for (const side of [-1, 1]) form(driveCar, 'box', '#fff0ba', side * .3, .43, .99, .18, .13, .04, null, false, true);
      driveCar.position.y = -1000;
    }
    function driveCurve(points) {
      const path = new THREE.CurvePath(), vertices = points.map(([x, z]) => new THREE.Vector3(x, .08, z));
      let previous = vertices[0];
      for (let i = 1; i < vertices.length - 1; i++) {
        const corner = vertices[i], next = vertices[i + 1], radius = Math.min(.55, previous.distanceTo(corner) / 3, corner.distanceTo(next) / 3);
        const before = corner.clone().add(previous.clone().sub(corner).normalize().multiplyScalar(radius));
        const after = corner.clone().add(next.clone().sub(corner).normalize().multiplyScalar(radius));
        path.add(new THREE.LineCurve3(previous, before)); path.add(new THREE.QuadraticBezierCurve3(before, corner, after)); previous = after;
      }
      path.add(new THREE.LineCurve3(previous, vertices[vertices.length - 1])); path.updateArcLengths(); return path;
    }
    let drivePath = null, driveProgress = 0, lastDriveDestination = '', originSite = null, orbitCamera = null, arrivalSent = false, labelsHidden = false;
    function updateLabels() {
      if (current.current.driving) return;
      camera.updateMatrixWorld();
      const height = element.clientHeight || 580, width = element.clientWidth || 680;
      const occupied = [], candidates = [];
      for (const sprite of labels) {
        const point = sprite.position.clone().project(camera), depth = -sprite.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
        const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth / height;
        const priority = sprite.userData.priority, naturalWidth = sprite.userData.labelWidth / worldPerPixel;
        const pixelWidth = priority >= 2 ? (width < 500 ? 100 : 126) : 138, pixelHeight = pixelWidth * 96 / 512;
        sprite.visible = depth > 0 && point.z >= -1 && point.z <= 1 && (priority >= 2 || naturalWidth >= (priority ? 48 : 100));
        sprite.scale.set(pixelWidth * worldPerPixel, pixelHeight * worldPerPixel, 1);
        const x = (point.x + 1) / 2 * width, y = (1 - point.y) / 2 * height;
        const bounds = { left: x - pixelWidth / 2, right: x + pixelWidth / 2, top: y - pixelHeight / 2, bottom: y + pixelHeight / 2 };
        if (bounds.left < 4 || bounds.right > width - 4 || bounds.top < 4 || bounds.bottom > height - 4) sprite.visible = false;
        if (sprite.visible) candidates.push({ sprite, priority, depth, bounds });
      }
      candidates.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
      for (const { sprite, bounds } of candidates) {
        const collision = occupied.some(other => bounds.left < other.right + 4 && bounds.right > other.left - 4 && bounds.top < other.bottom + 4 && bounds.bottom > other.top - 4);
        sprite.visible = !collision; if (!collision) occupied.push(bounds);
      }
    }
    function updateDrive(delta) {
      if (!driveCar) return;
      const state = current.current;
      if (state.driving !== labelsHidden) { labels.forEach(label => { label.visible = !state.driving; }); labelsHidden = state.driving; }
      if (!state.driving) {
        driveCar.position.y = -1000;
        if (orbitCamera) { camera.position.copy(orbitCamera.position); controls.target.copy(orbitCamera.target); orbitCamera = null; }
        controls.enabled = true; lastDriveDestination = ''; drivePath = null; originSite = null; return;
      }
      if (!orbitCamera) orbitCamera = { position: camera.position.clone(), target: controls.target.clone() };
      controls.enabled = false;
      if (lastDriveDestination !== state.driveDestination) {
        const index = cities.findIndex(city => city.id === state.driveDestination);
        const destination = CITY_LANDMARKS.find(item => item.id === state.driveDestination) || CITY_SITES[index]; if (!destination) return;
        if (drivePath && driveProgress < 1) {
          const point = drivePath.getPointAt(driveProgress);
          originSite = cityDriveOrigin([point.x, point.z]);
        }
        drivePath = driveCurve(cityDriveWaypoints(originSite, destination));
        driveProgress = 0; arrivalSent = false; lastDriveDestination = state.driveDestination; originSite = destination;
      }
      if (!drivePath) return;
      if (!state.drivePaused) driveProgress = Math.min(1, driveProgress + delta * 5 / Math.max(1, drivePath.getLength()));
      const point = drivePath.getPointAt(driveProgress), tangent = drivePath.getTangentAt(Math.min(.9999, driveProgress));
      point.add(new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(.35));
      driveCar.position.copy(point); driveCar.rotation.y = Math.atan2(tangent.x, tangent.z);
      const chase = point.clone().addScaledVector(tangent, -5.5); chase.y += 3.2;
      if (driveProgress === 0) camera.position.copy(chase); else camera.position.lerp(chase, 1 - Math.exp(-delta * 5));
      const look = point.clone().addScaledVector(tangent, 4); look.y += 1;
      camera.lookAt(look);
      renderer.domElement.dataset.driveProgress = String(driveProgress);
      renderer.domElement.dataset.driveDestination = state.driveDestination;
      if (driveProgress >= 1 && !arrivalSent) { arrivalSent = true; state.onDriveArrival?.(state.driveDestination); }
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
      scene.add(instanced); batches.push({ instanced, moving, originalMaterial: instanced.material, originalGeometry: instanced.geometry, originalShadow: instanced.castShadow });
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
    function restorePhysicalMaterials() {
      for (const batch of batches) {
        batch.instanced.material = batch.originalMaterial; batch.instanced.geometry = batch.originalGeometry;
        batch.instanced.castShadow = batch.originalShadow; batch.instanced.receiveShadow = batch.originalMaterial.type !== 'MeshBasicMaterial';
      }
      scene.environment = environmentTarget?.texture || null;
      renderer.shadowMap.enabled = true; renderer.shadowMap.needsUpdate = true;
      lightweight = illustrated = false; renderBudget.current = { lightweight: false, illustrated: false };
    }
    if (quality !== 'maximum' && renderBudget.current.lightweight) useResponsiveMaterials();
    if (quality !== 'maximum' && renderBudget.current.illustrated) useIllustratedMaterials();
    let composer = null, aoPass = null, outputPass = null;
    if (quality === 'maximum') {
      composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
      aoPass = new SSAOPass(scene, camera, element.clientWidth || 680, element.clientHeight || 580, 32);
      aoPass.kernelRadius = 5; aoPass.minDistance = .002; aoPass.maxDistance = .04;
      composer.addPass(aoPass); outputPass = new OutputPass(); composer.addPass(outputPass);
    }
    const movingRoots = world.children.filter(item => item.userData.moving);
    let frameId = 0, time = 0, last = 0, lastPaint = 0, inView = true, disposed = false;
    let sampledFrames = 0, sampledTime = 0, fastWindows = 0, recoveryWindows = 0;
    function adaptResolution(elapsed) {
      if (elapsed <= 0) return;
      renderer.domElement.dataset.renderQuality = illustrated ? 'basic' : lightweight ? 'balanced' : 'physical';
      renderer.domElement.dataset.pixelRatio = String(pixelRatio);
      renderer.domElement.dataset.instances = String(records.length);
      renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
      if (quality === 'maximum') return;
      sampledFrames++; sampledTime += Math.min(elapsed, 150);
      if (sampledFrames < 12 && sampledTime < 1000) return;
      const average = sampledTime / sampledFrames;
      sampledFrames = 0; sampledTime = 0;
      let nextRatio = pixelRatio;
      if (average > 50 && lightweight) useIllustratedMaterials();
      else if (average > 55) useResponsiveMaterials();
      if (average > 35) { nextRatio = Math.max(Math.min(lightweight ? .65 : .85, maxPixelRatio), pixelRatio - .2); fastWindows = 0; recoveryWindows = 0; }
      else if (average < 21) { if (++fastWindows >= 4) { nextRatio = Math.min(maxPixelRatio, pixelRatio + .1); fastWindows = 0; } }
      else fastWindows = 0;
      // A weaker frame window does not permanently cap a faster desktop GPU.
      // Retry physical materials after sustained headroom, then keep measuring.
      if (average < 18 && lightweight && ++recoveryWindows >= 60) { restorePhysicalMaterials(); recoveryWindows = 0; }
      if (Math.abs(nextRatio - pixelRatio) > .01) {
        pixelRatio = nextRatio; renderer.setPixelRatio(pixelRatio);
        renderer.setSize(element.clientWidth || 680, element.clientHeight || 580);
      }
      renderer.domElement.dataset.renderQuality = illustrated ? 'basic' : lightweight ? 'balanced' : 'physical';
      renderer.domElement.dataset.pixelRatio = String(pixelRatio);
      renderer.domElement.dataset.instances = String(records.length);
      renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
    }
    function requestFrame() { if (!disposed && !frameId && inView && !document.hidden) frameId = requestAnimationFrame(frame); }
    function frame(now) {
      frameId = 0;
      if (disposed || !inView || document.hidden) { last = 0; return; }
      const scenePlaying = current.current.motion !== 'paused';
      const playing = scenePlaying || (current.current.driving && !current.current.drivePaused);
      if (playing && now - lastPaint < (current.current.motion === 'calm' ? 32 : 15)) { requestFrame(); return; }
      lastPaint = now;
      const elapsed = last ? now - last : 0;
      const delta = Math.min(elapsed / 1000, .05); last = now;
      const renderStarted = performance.now();
      if (scenePlaying) {
        time += delta * (current.current.motion === 'calm' ? .4 : 1);
        animations.forEach(animate => animate(time));
      }
      updateDrive(delta);
      if (scenePlaying || current.current.driving || driveCar) {
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
      if (!current.current.driving) controls.update();
      updateLabels();
      if (composer) composer.render(delta); else renderer.render(scene, camera);
      adaptResolution(Math.max(performance.now() - renderStarted, playing ? Math.min(elapsed, current.current.motion === 'calm' ? 22 : 100) : 0));
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
      renderer.setSize(w, h); composer?.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); requestFrame();
    }
    // Match framing to the canvas aspect, including narrow phone screens.
    const width = element.clientWidth || 680, height = element.clientHeight || 580;
    framing = Math.max(1, height / width) * (width < 500 ? 1.12 : 1);
    camera.position.copy(focused ? target.clone().add(new THREE.Vector3(...focused.camera).multiplyScalar(framing)) : overview ? new THREE.Vector3(38, 170, 186).multiplyScalar(framing)
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
      const found = ray.intersectObjects([...pickMeshes, ...labels.filter(sprite => sprite.visible && sprite.userData.target)]).map(hit => hit.object.userData.target || hit.object.userData.targets?.[hit.instanceId]).find(Boolean);
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
      aoPass?.ssaoMaterial.dispose(); aoPass?.noiseTexture.dispose(); aoPass?.dispose(); outputPass?.dispose(); composer?.dispose(); sky.geometry.dispose(); sky.material.dispose();
      scene.clear(); world.clear(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [shape, overview, focusLandmark, theme, title, cityId, selected, resetKey, quality]);
  useEffect(() => { wake.current?.(); }, [motion, driving, drivePaused, driveDestination]);
  return <div ref={host} className={'map-city-scene' + (overview ? ' map-city-scene--all' : '')} />;
}

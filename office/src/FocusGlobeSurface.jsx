import { useEffect, useRef, useState } from 'react';
import reliefImage from './focus-media/gray-earth-50m.webp'; // Natural Earth 1:50m Gray Earth v3.2.0, downsampled.
import { GLOBE_RADIUS, MAP_HEIGHT, MAP_WIDTH, screenBasis } from './focus-map.mjs';

const VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;
const FRAGMENT = `
precision highp float;
uniform vec2 size;
uniform float radius;
uniform vec3 rightAxis;
uniform vec3 upAxis;
uniform vec3 frontAxis;
uniform float relief;
uniform sampler2D earth;

void main() {
  vec2 point = (gl_FragCoord.xy - size * 0.5) / radius;
  float distance = length(point);
  float edge = 1.15 / radius;
  if (distance > 1.0 + edge) discard;
  // Orthographic ray-sphere intersection gives depth and the surface normal.
  vec3 normal = vec3(point, sqrt(max(0.0, 1.0 - dot(point, point))));
  vec3 world = normal.x * rightAxis + normal.y * upAxis + normal.z * frontAxis;
  vec2 uv = vec2(0.5 + atan(world.y, world.x) / 6.2831853,
    0.5 - asin(clamp(world.z, -1.0, 1.0)) / 3.1415927);
  float terrain = texture2D(earth, uv).r;
  float land = smoothstep(0.425, 0.47, terrain);
  vec3 sea = vec3(0.080, 0.22, 0.34);
  vec3 ground = mix(vec3(0.22, 0.38, 0.34), vec3(0.65, 0.75, 0.64),
    mix(0.42, smoothstep(0.45, 0.93, terrain), relief));
  float light = 0.68 + 0.43 * max(0.0, dot(normal, normalize(vec3(-0.54, 0.58, 0.69))));
  float atmosphere = pow(1.0 - normal.z, 2.9) * 0.72;
  vec3 color = mix(mix(sea, ground, land) * light, vec3(0.31, 0.65, 0.80), atmosphere);
  gl_FragColor = vec4(color, 1.0 - smoothstep(1.0 - edge, 1.0 + edge, distance));
}
`;

function programFor(gl) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

export default function FocusGlobeSurface({ camera, zoom, relief, onReady }) {
  const node = useRef(null);
  const redraw = useRef(null);
  const view = useRef({ camera, zoom, relief });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const canvas = node.current;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
    const program = gl && programFor(gl);
    if (!program) return undefined;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const uniforms = Object.fromEntries(['size', 'radius', 'rightAxis', 'upAxis', 'frontAxis', 'relief']
      .map(name => [name, gl.getUniformLocation(program, name)]));
    let loaded = false;
    let frame = 0;
    function draw() {
      frame = 0;
      if (!loaded || gl.isContextLost()) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.floor(canvas.clientWidth * pixelRatio);
      const height = Math.floor(canvas.clientHeight * pixelRatio);
      if (!width || !height) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const scale = Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
      const insetX = Math.max(0, Math.floor((width - MAP_WIDTH * scale) / 2));
      const insetY = Math.max(0, Math.floor((height - MAP_HEIGHT * scale) / 2));
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(insetX, insetY, width - 2 * insetX, height - 2 * insetY);
      const current = view.current;
      const [right, up, front] = screenBasis(current.camera);
      gl.uniform2f(uniforms.size, width, height);
      gl.uniform1f(uniforms.radius, GLOBE_RADIUS * scale * current.zoom);
      gl.uniform3fv(uniforms.rightAxis, right);
      gl.uniform3fv(uniforms.upAxis, up);
      gl.uniform3fv(uniforms.frontAxis, front);
      gl.uniform1f(uniforms.relief, Number(current.relief));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      onReady(true);
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(draw);
    }
    function lost(event) {
      event.preventDefault();
      onReady(false);
    }
    const restored = () => setGeneration(current => current + 1);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    const image = new Image();
    image.onload = () => {
      if (gl.isContextLost()) return;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      loaded = gl.getError() === gl.NO_ERROR;
      schedule();
    };
    image.src = reliefImage;
    redraw.current = schedule;
    return () => {
      onReady(false);
      redraw.current = null;
      image.onload = null;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [generation, onReady]);

  useEffect(() => {
    view.current = { camera, zoom, relief };
    redraw.current?.();
  }, [camera, zoom, relief]);

  return <canvas ref={node} className="focus-globe-surface" aria-hidden="true" />;
}

import { useId, useRef } from 'react';
import { RADIUS_VALUES, radiusIndex, radiusLabel } from './focus-studio-model.mjs';

const CENTER = { x: 180, y: 112 };
const MIN_DRAW_RADIUS = 29;
const MAX_DRAW_RADIUS = 93;
const LAST_RADIUS_INDEX = RADIUS_VALUES.length - 1;

export function FocusRadiusDiagram({ radius, location, onResize }) {
  const map = useRef(null);
  const drag = useRef(null);
  const gridId = useId();
  const span = MAX_DRAW_RADIUS - MIN_DRAW_RADIUS;
  const size = MIN_DRAW_RADIUS + span * radiusIndex(radius) / LAST_RADIUS_INDEX;
  const dotRadius = location ? Math.min(102, size * location.distance / radius) : 0;
  function resizeAt(event) {
    const rect = map.current.getBoundingClientRect();
    const scale = Math.min(rect.width / 360, rect.height / 224);
    if (!scale) return;
    const deltaX = (event.clientX - drag.current.x) / scale;
    const deltaY = (event.clientY - drag.current.y) / scale;
    // The handle sits at 45° so it stays inside the diagram at either limit.
    const change = (deltaX - deltaY) / Math.SQRT2;
    const index = Math.max(0, Math.min(LAST_RADIUS_INDEX,
      Math.round(drag.current.index + change * LAST_RADIUS_INDEX / span)));
    onResize(RADIUS_VALUES[index]);
  }
  const handleX = CENTER.x + size / Math.SQRT2;
  const handleY = CENTER.y - size / Math.SQRT2;
  return <svg className="focus-radar" ref={map} viewBox="0 0 360 224" role="img" aria-label="Diagram of your circular focus zone. Resize with the radius slider below.">
    <defs>
      <pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" className="focus-radar-grid" /></pattern>
    </defs>
    <rect width="360" height="224" fill={`url(#${gridId})`} />
    <path className="focus-radar-axis" d="M180 14v196M24 112h312" />
    <circle cx={CENTER.x} cy={CENTER.y} r="93" className="focus-radar-guide" />
    <circle cx={CENTER.x} cy={CENTER.y} r="61" className="focus-radar-guide" />
    <circle cx={CENTER.x} cy={CENTER.y} r={size} className="focus-radar-boundary" />
    <circle cx={CENTER.x} cy={CENTER.y} r="7" className="focus-radar-origin" />
    <circle cx={CENTER.x} cy={CENTER.y} r="2" fill="#e1fff3" />
    {location && <circle cx={CENTER.x + Math.sin(location.bearing) * dotRadius}
      cy={CENTER.y - Math.cos(location.bearing) * dotRadius} r="5" className="focus-radar-device" />}
    <line x1={CENTER.x + 12} y1={CENTER.y - 12} x2={handleX} y2={handleY} className="focus-radar-guide" />
    <circle cx={handleX} cy={handleY} r="7" className="focus-radar-handle" />
    <circle cx={handleX} cy={handleY} r="22" fill="transparent" className="focus-radar-drag" aria-hidden="true"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, index: radiusIndex(radius) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => { if (drag.current?.id === event.pointerId) resizeAt(event); }}
      onLostPointerCapture={() => { drag.current = null; }} />
    <text x="23" y="28">NORTH ↑</text>
    <text x="23" y="204">RELATIVE VIEW</text>
    <text x="336" y="204" textAnchor="end">{radiusLabel(radius)}</text>
  </svg>;
}

import { useEffect, useState } from 'react';
import { STREET_TILE_SIZE } from './focus-streets.mjs';

export default function FocusStreetTile({ tile }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let imageUrl;
    // Wait briefly for pan and pinch gestures to settle before requesting tiles.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`https://tile.openstreetmap.org/${tile.path}.png`, {
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'strict-origin',
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) return;
        const image = await response.blob();
        if (controller.signal.aborted) return;
        imageUrl = URL.createObjectURL(image);
        setSrc(imageUrl);
      } catch {
        // Terrain and location overlays stay available if a street tile fails.
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [tile.path]);

  return src && <image href={src} width={STREET_TILE_SIZE} height={STREET_TILE_SIZE}
    preserveAspectRatio="none" transform={tile.transform} />;
}

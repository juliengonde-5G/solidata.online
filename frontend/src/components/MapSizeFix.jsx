import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// Fix Leaflet "fond gris" : force invalidateSize quand le conteneur
// change de taille (sidebar collapse, modal, onglet caché puis affiché).
// À placer DANS un <MapContainer> sinon useMap() lance.
export default function MapSizeFix() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t1 = setTimeout(fix, 50);
    const t2 = setTimeout(fix, 250);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fix) : null;
    if (ro) ro.observe(map.getContainer());
    return () => { clearTimeout(t1); clearTimeout(t2); if (ro) ro.disconnect(); };
  }, [map]);
  return null;
}

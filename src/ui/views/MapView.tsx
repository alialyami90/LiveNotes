import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { NodeId } from '../../model/types';
import { placeIcon } from '../../services/kinds';
import { useStore } from '../store';
import { setHovered, useHovered } from '../hover';
import { collectPlaces, unresolvedPlaces } from './collect';

const markerIcon = (index: number, hovered: boolean) =>
  L.divIcon({
    className: '',
    html: `<div class="map-marker${hovered ? ' is-hovered' : ''}">${index}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

export default function MapView({ id }: { id: NodeId }) {
  const { viewDoc: doc, contexts, setFocus, placeStatus } = useStore();
  const hovered = useHovered();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<NodeId, { marker: L.Marker; index: number }[]>());

  const stops = collectPlaces(doc, contexts, id);
  const unresolved = unresolvedPlaces(doc, contexts, id);
  const pending = unresolved.filter((u) => placeStatus[u.key] !== 'missing' && placeStatus[u.key] !== 'error');
  const unreachable = unresolved.filter((u) => placeStatus[u.key] === 'error');
  const notFound = unresolved.filter((u) => placeStatus[u.key] === 'missing');
  const stopsKey = JSON.stringify(stops.map((s) => [s.nodeId, s.place.lat, s.place.lon]));

  // Keep latest callbacks reachable from Leaflet handlers without rebuilding markers.
  const textOf = useRef((nodeId: NodeId) => doc.nodes[nodeId]?.text ?? '');
  textOf.current = (nodeId) => doc.nodes[nodeId]?.text ?? '';

  useEffect(() => {
    if (!el.current) return;
    // On touch screens one finger keeps scrolling the page; pinch still zooms.
    const m = L.map(el.current, { scrollWheelZoom: false, zoomControl: true, dragging: !L.Browser.mobile });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    markers.current.clear();
    if (stops.length === 0) return;
    // The container may have just become visible; Leaflet must re-measure it.
    m.invalidateSize();
    const points = stops.map((s) => L.latLng(s.place.lat, s.place.lon));
    if (points.length > 1) {
      L.polyline(points, { color: '#c2410c', weight: 2.5, dashArray: '6 6', opacity: 0.8 }).addTo(group);
    }
    for (const s of stops) {
      const title = `${placeIcon(s.place)} ${s.place.label ?? s.place.name}`;
      const marker = L.marker([s.place.lat, s.place.lon], { icon: markerIcon(s.index, false), title })
        .on('mouseover', () => setHovered(s.nodeId))
        .on('mouseout', () => setHovered(null))
        .on('click', () => setFocus({ id: s.nodeId, caret: textOf.current(s.nodeId).length }))
        .addTo(group);
      markers.current.set(s.nodeId, [...(markers.current.get(s.nodeId) ?? []), { marker, index: s.index }]);
    }
    if (points.length === 1) m.setView(points[0], 13);
    else m.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 14 });
  }, [stopsKey, setFocus]);

  useEffect(() => {
    for (const [nodeId, list] of markers.current) {
      for (const { marker, index } of list) {
        marker.setIcon(markerIcon(index, nodeId === hovered));
        marker.setZIndexOffset(nodeId === hovered ? 1000 : 0);
      }
    }
  }, [hovered, stopsKey]);

  return (
    <>
      <div ref={el} className={`map${stops.length === 0 ? ' is-empty' : ''}`} />
      {stops.length === 0 && pending.length > 0 && <div className="view-empty">Finding places…</div>}
      {stops.length === 0 && pending.length === 0 && unreachable.length === 0 && (
        <div className="view-empty">No places to show yet — mention one like @Lisbon.</div>
      )}
      {unreachable.length > 0 && (
        <div className="view-note">Couldn’t reach the place service for {unreachable.map((u) => u.name).join(', ')} — retrying. Tap a ⟳ place to retry now.</div>
      )}
      {notFound.length > 0 && (
        <div className="view-note">Couldn’t find: {notFound.map((u) => u.name).join(', ')}. Edit the mention and pick a suggestion.</div>
      )}
    </>
  );
}

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { NodeId } from '../../model/types';
import { useStore } from '../store';
import { setHovered, useHovered } from '../hover';
import { collectPlaces } from './collect';

const markerIcon = (index: number, hovered: boolean) =>
  L.divIcon({
    className: '',
    html: `<div class="map-marker${hovered ? ' is-hovered' : ''}">${index}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

export default function MapView({ id }: { id: NodeId }) {
  const { viewDoc: doc, contexts, setFocus } = useStore();
  const hovered = useHovered();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<NodeId, { marker: L.Marker; index: number }[]>());

  const stops = collectPlaces(doc, contexts, id);
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
    if (stops.length === 0) {
      m.setView([20, 0], 1);
      return;
    }
    const points = stops.map((s) => L.latLng(s.place.lat, s.place.lon));
    if (points.length > 1) {
      L.polyline(points, { color: '#c2410c', weight: 2.5, dashArray: '6 6', opacity: 0.8 }).addTo(group);
    }
    for (const s of stops) {
      const marker = L.marker([s.place.lat, s.place.lon], { icon: markerIcon(s.index, false), title: s.place.label ?? s.place.name })
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
      <div ref={el} className="map" />
      {stops.length === 0 && <div className="view-empty">No places found under this bullet yet — mention one like @Lisbon.</div>}
    </>
  );
}

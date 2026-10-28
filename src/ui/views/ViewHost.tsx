import { lazy, Suspense } from 'react';
import type { NodeId, ViewKind } from '../../model/types';
import { CalendarView } from './CalendarView';
import { TableView } from './TableView';

// Leaflet is the heaviest dependency; load it only when a map is shown.
const MapView = lazy(() => import('./MapView'));

export function ViewHost({ id, kind }: { id: NodeId; kind: ViewKind }) {
  return (
    <div className="view" data-view={kind}>
      {kind === 'map' && (
        <Suspense fallback={<div className="view-empty">Loading map…</div>}>
          <MapView id={id} />
        </Suspense>
      )}
      {kind === 'calendar' && <CalendarView id={id} />}
      {kind === 'table' && <TableView id={id} />}
    </div>
  );
}

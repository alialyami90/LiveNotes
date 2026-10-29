import { projectSketch } from '../library/sketch';

interface Props {
  places: { name: string; lat: number; lon: number }[];
  width?: number;
  height?: number;
}

/** A tile-free, network-free thumbnail of a note's route. Nothing at all without places. */
export function RouteSketch({ places, width = 112, height = 72 }: Props) {
  if (places.length === 0) return null;
  const pts = projectSketch(places, width, height, 8);
  const label = `Route: ${places.map((p) => p.name).join(' → ')}`;
  const first = pts[0];
  const last = pts[pts.length - 1];

  return (
    <svg
      className="route-sketch"
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {pts.length === 1 ? (
        <>
          <circle className="route-sketch__halo" cx={first.x} cy={first.y} r={10} />
          <circle className="route-sketch__start" cx={first.x} cy={first.y} r={4} />
        </>
      ) : (
        <>
          <polyline
            className="route-sketch__line"
            points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none"
          />
          <circle className="route-sketch__start" cx={first.x} cy={first.y} r={4} />
          <circle className="route-sketch__end" cx={last.x} cy={last.y} r={4} />
        </>
      )}
    </svg>
  );
}

import type { Doc, OutlineNode, ViewKind } from './types';

type Spec = { text: string; view?: ViewKind; children?: Spec[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates are relative to today so the weather formulas land inside the forecast window. */
function day(today: Date, offset: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

export function sampleDoc(today = new Date()): Doc {
  const d = (n: number) => day(today, n);
  const spec: Spec[] = [
    {
      text: 'Portugal road trip 🇵🇹',
      view: 'calendar',
      children: [
        {
          text: `${d(4)} — fly into @Lisbon`,
          children: [
            { text: 'Check in near @[Praça do Comércio]' },
            { text: 'Dinner at @[Time Out Market] {weather()}' },
          ],
        },
        {
          text: `${d(5)} — explore Lisbon`,
          view: 'map',
          children: [
            { text: 'Morning: @[Belém Tower]' },
            { text: 'Pastéis at @[Pastéis de Belém]' },
            { text: 'Sunset at @[Miradouro da Senhora do Monte] {route(prev, here)}' },
          ],
        },
        {
          text: `${d(6)} — drive to @Porto {route(@Lisbon, here)}`,
          children: [
            { text: 'Lunch stop in @Coimbra? {distance(@Lisbon, @Coimbra)} from Lisbon' },
            { text: 'Forecast in Porto: {weather()}' },
          ],
        },
        {
          text: `${d(7)} — @Porto`,
          children: [
            { text: 'Port tasting in @[Vila Nova de Gaia]' },
            { text: 'Bookshop @[Livraria Lello]' },
          ],
        },
      ],
    },
    {
      text: 'Maybe / ideas',
      view: 'table',
      children: [
        { text: 'Day trip to @Sintra {route(@Lisbon, here)}' },
        { text: 'Beaches near @Cascais {distance(@Lisbon, here)}' },
        { text: 'Wine country around @[Pinhão] {route(@Porto, here)}' },
      ],
    },
    {
      text: 'How this works: type @Place or @[Multi Word Place], dates like Nov 3, and formulas in {braces}. Try /map, /calendar or /table on an empty bullet.',
    },
  ];

  const nodes: Record<string, OutlineNode> = {};
  let counter = 0;
  const add = (s: Spec): string => {
    const id = `s${counter++}`;
    nodes[id] = { id, text: s.text, children: (s.children ?? []).map(add), ...(s.view ? { view: s.view } : {}) };
    return id;
  };
  nodes.root = { id: 'root', text: '', children: spec.map(add) };
  return { version: 1, rootId: 'root', nodes, places: {} };
}

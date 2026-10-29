import type { Doc, OutlineNode, Place, ViewKind } from './types';

/**
 * Real coordinates (from Open-Meteo and Photon) for the sample's mentions, so the
 * sample works instantly and offline. Anything the user types is looked up live,
 * and picking a suggestion replaces an entry.
 */
const SAMPLE_PLACES: Record<string, Place> = {
  lisbon: { name: 'Lisbon', lat: 38.7167, lon: -9.1333, label: 'Lisbon, Lisbon District, Portugal', kind: 'city' },
  'praça do comércio': { name: 'Praça do Comércio', lat: 38.7077151, lon: -9.1365238, label: 'Praça do Comércio, Lisboa, Portugal', kind: 'sight' },
  'time out market': { name: 'Time Out Market Lisboa', lat: 38.7070934, lon: -9.1458973, label: 'Time Out Market Lisboa, Lisboa, Portugal', kind: 'restaurant' },
  'belém tower': { name: 'Torre de Belém', lat: 38.691586, lon: -9.2159288, label: 'Torre de Belém, Lisboa, Portugal', kind: 'sight' },
  'pastéis de belém': { name: 'Pastéis de Belém', lat: 38.6974795, lon: -9.2033202, label: 'Pastéis de Belém, Lisboa, Portugal', kind: 'cafe' },
  'miradouro da senhora do monte': { name: 'Miradouro da Senhora do Monte', lat: 38.7190781, lon: -9.1329112, label: 'Miradouro da Senhora do Monte, Lisboa, Portugal', kind: 'sight' },
  porto: { name: 'Porto', lat: 41.1496, lon: -8.611, label: 'Porto, Porto District, Portugal', kind: 'city' },
  coimbra: { name: 'Coimbra', lat: 40.2111874, lon: -8.4291478, label: 'Coimbra, Portugal', kind: 'city' },
  'vila nova de gaia': { name: 'Vila Nova de Gaia', lat: 41.1239, lon: -8.6118, label: 'Vila Nova de Gaia, Portugal', kind: 'city' },
  'livraria lello': { name: 'Livraria Lello e Irmão', lat: 41.1469, lon: -8.6149, label: 'Livraria Lello e Irmão, Porto, Portugal', kind: 'shop' },
  sintra: { name: 'Sintra', lat: 38.8029, lon: -9.3817, label: 'Sintra, Lisbon District, Portugal', kind: 'city' },
  cascais: { name: 'Cascais', lat: 38.6979, lon: -9.4215, label: 'Cascais, Lisbon District, Portugal', kind: 'city' },
  'pinhão': { name: 'Pinhão', lat: 41.1907, lon: -7.5459, label: 'Pinhão, Vila Real District, Portugal', kind: 'village' },
};

type Spec = { text: string; view?: ViewKind; children?: Spec[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Dates are relative to today so the weather formulas land inside the forecast
 * window. The year is spelled out only when it differs from today's, since
 * yearless dates resolve to the current year.
 */
function day(today: Date, offset: number): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const year = d.getFullYear() === today.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
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
          // The phrase is the route (a {route()} too would show it twice). It names its start
          // because the previous day mentions no place, so `prev` would be empty.
          text: `${d(6)} — drive from @Lisbon to @Porto`,
          children: [
            { text: 'Lunch stop in @Coimbra? {distance(@Lisbon, @Coimbra)} from Lisbon' },
            { text: 'Porto weather' },
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
      // Escaped, so the bullet teaches the phrases without turning them into chips.
      text: 'How this works: type \\@Place or \\@[Multi Word Place], dates like Nov 3, plain words like \\weather or \\drive to \\@Place, and formulas in \\{braces}. End a bullet with /map, /calendar or /table and press Enter to add a view of everything under it.',
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
  return { version: 1, rootId: 'root', nodes, places: { ...SAMPLE_PLACES } };
}

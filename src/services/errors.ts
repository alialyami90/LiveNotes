/** The service couldn't be reached or is overloaded; worth retrying later. */
export class TransientError extends Error {}

/**
 * By name, not `instanceof DOMException`: an abort can come from another realm's DOMException
 * (Node's fetch under jsdom in the live check), and a timeout must still count as transient.
 */
export const isAbort = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

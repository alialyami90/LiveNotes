import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';

/**
 * The behaviour every ⋯ menu shares (card, home header, note bar): the first item takes
 * focus on open; a pointerdown outside, Escape (focus back to the trigger) or focus moving
 * elsewhere closes it; ↑/↓ cycle the items. Put rootRef/onKeyDown/onBlur on the element
 * that wraps both the trigger and the list, and triggerRef on the trigger.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length].focus();
    },
    [open, close],
  );

  const onBlur = useCallback((e: FocusEvent) => {
    // A null relatedTarget (Safari doesn't focus buttons on click) is left to the pointerdown handler,
    // otherwise the list would close before the click on an item lands.
    const next = e.relatedTarget as Node | null;
    if (next && !rootRef.current?.contains(next)) setOpen(false);
  }, []);

  return { open, setOpen, toggle, rootRef, triggerRef, close, onKeyDown, onBlur };
}

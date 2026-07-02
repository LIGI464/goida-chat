import {
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function AnchoredPopover({
  anchorRef,
  open,
  children,
  className = '',
  align = 'right',
  offset = 10,
  matchAnchorWidth = false,
  minWidth = 208,
  maxWidth = 360,
  surfaceRef,
  zIndex = 80,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
  offset?: number;
  matchAnchorWidth?: boolean;
  minWidth?: number;
  maxWidth?: number;
  surfaceRef?: MutableRefObject<HTMLDivElement | null>;
  zIndex?: number;
}) {
  const innerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const surface = innerSurfaceRef.current;
      if (!anchor || !surface) return;

      const margin = 12;
      const anchorRect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const preferredWidth = matchAnchorWidth
        ? Math.max(anchorRect.width, minWidth)
        : Math.max(surface.offsetWidth, minWidth);
      const width = Math.min(preferredWidth, viewportWidth - margin * 2, maxWidth);
      const height = surface.offsetHeight;
      const leftBase = align === 'right' ? anchorRect.right - width : anchorRect.left;
      const left = clamp(leftBase, margin, viewportWidth - width - margin);

      const spaceBelow = viewportHeight - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - margin;
      const placeAbove = height > spaceBelow && spaceAbove > spaceBelow;
      const topBase = placeAbove ? anchorRect.top - height - offset : anchorRect.bottom + offset;
      const top = clamp(topBase, margin, viewportHeight - height - margin);
      const availableHeight = placeAbove ? anchorRect.top - margin - offset : spaceBelow - offset;

      setStyle({
        left,
        maxHeight: Math.max(160, availableHeight),
        maxWidth: Math.min(maxWidth, viewportWidth - margin * 2),
        minWidth: matchAnchorWidth ? width : Math.min(minWidth, width),
        overflowY: 'auto',
        position: 'fixed',
        top,
        visibility: 'visible',
        width,
        zIndex,
      });
    };

    const frame = window.requestAnimationFrame(updatePosition);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updatePosition());

    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (innerSurfaceRef.current) observer?.observe(innerSurfaceRef.current);

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, anchorRef, matchAnchorWidth, maxWidth, minWidth, offset, open, zIndex]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={className}
      ref={(node) => {
        innerSurfaceRef.current = node;
        if (surfaceRef) {
          surfaceRef.current = node;
        }
      }}
      style={
        style ?? {
          left: 0,
          pointerEvents: 'none',
          position: 'fixed',
          top: 0,
          visibility: 'hidden',
          zIndex,
        }
      }
    >
      {children}
    </div>,
    document.body,
  );
}

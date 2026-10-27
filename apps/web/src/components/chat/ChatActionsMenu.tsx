import { useEffect, useRef, useState } from 'react';

import { AnchoredPopover } from '../ui/AnchoredPopover';

export type ChatActionItem = {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  hidden?: boolean;
  disabled?: boolean;
};

const MENU_BUTTON_LABEL = 'Действия чата';

export function ChatActionsMenu({
  items,
  buttonClassName = '',
  align = 'right',
}: {
  items: ChatActionItem[];
  buttonClassName?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const visibleItems = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (visibleItems.length === 0) return null;

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={MENU_BUTTON_LABEL}
        className={`brand-button brand-button-secondary grid h-9 w-9 place-items-center rounded-xl p-0 text-sm outline-none focus-visible:ring-2 focus-visible:ring-white/15 ${buttonClassName}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        ref={buttonRef}
        title={MENU_BUTTON_LABEL}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none h-4 w-4"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <circle cx="3" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="13" cy="8" r="1.25" />
        </svg>
      </button>

      <AnchoredPopover
        align={align}
        anchorRef={buttonRef}
        className="brand-modal w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-1"
        maxWidth={352}
        open={open}
        surfaceRef={menuRef}
        zIndex={90}
      >
        <div
          className="app-scrollbar grid max-h-[min(60vh,18rem)] gap-0.5 overflow-y-auto"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          {visibleItems.map((item) => (
            <button
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                item.tone === 'danger'
                  ? 'text-red-300 hover:bg-red-500/12'
                  : 'text-[var(--text)] hover:bg-white/[0.06]'
              }`}
              disabled={item.disabled}
              key={item.label}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                if (item.disabled) return;
                item.onSelect();
              }}
              role="menuitem"
              type="button"
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

type ChatActionItem = {
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleItems = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
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
    <div
      className="relative"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={MENU_BUTTON_LABEL}
        className={`grid h-9 w-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--panel)] text-sm text-[var(--text)] transition-colors duration-150 hover:bg-[var(--panel-2)] ${buttonClassName}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
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

      {open && (
        <div
          className={`absolute top-11 z-30 min-w-52 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-2xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          {visibleItems.map((item) => (
            <button
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                item.tone === 'danger'
                  ? 'text-red-300 hover:bg-red-500/10'
                  : 'text-[var(--text)] hover:bg-white/5'
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
      )}
    </div>
  );
}

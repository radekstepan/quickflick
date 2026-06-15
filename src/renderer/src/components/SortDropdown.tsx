import { useEffect, useRef, useState } from 'react';

export type SortKey = 'name' | 'tags';

interface Option {
  value: SortKey;
  label: string;
}

const OPTIONS: Option[] = [
  { value: 'name', label: 'Name' },
  { value: 'tags', label: 'Tags' }
];

interface Props {
  value: SortKey;
  onChange: (next: SortKey) => void;
  disabled?: boolean;
}

export function SortDropdown({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.sort-dropdown')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <div className="sort-dropdown" ref={wrapRef}>
      <button
        className="btn sort-button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title="Change sort order"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sort-label">Sort: {current.label}</span>
        <span className="sort-chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="sort-menu" role="listbox">
          {OPTIONS.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                className={`sort-option ${isActive ? 'active' : ''}`}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setOpen(false);
                  if (opt.value !== value) onChange(opt.value);
                }}
              >
                <span className="sort-check" aria-hidden="true">
                  {isActive ? '✓' : ''}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  matchingTags: string[];
  allTagNames: string[];
  userTagSet: Set<string>;
  excludedTagSet: Set<string>;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onClose: () => void;
}

function lc(s: string): string {
  return s.toLowerCase();
}

function rank(query: string, candidate: string): number {
  const q = lc(query);
  const c = lc(candidate);
  if (c === q) return 0;
  if (c.startsWith(q)) return 1;
  const i = c.indexOf(q);
  if (i >= 0) return 2 + i;
  return -1;
}

function isUserAssigned(name: string, userTagSet: Set<string>): boolean {
  return userTagSet.has(lc(name));
}

export function TagPickerModal({
  matchingTags,
  allTagNames,
  userTagSet,
  excludedTagSet,
  onAdd,
  onRemove,
  onClose
}: Props) {
  const [input, setInput] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matchingSet = useMemo(
    () => new Set(matchingTags.map(lc)),
    [matchingTags]
  );

  const suggestions = useMemo(() => {
    const q = input.trim();
    if (q.length === 0) return [] as { name: string; isNew: boolean }[];
    const ranked: { name: string; r: number }[] = [];
    for (const name of allTagNames) {
      if (matchingSet.has(lc(name))) continue;
      if (excludedTagSet.has(lc(name))) continue;
      const r = rank(q, name);
      if (r >= 0) ranked.push({ name, r });
    }
    ranked.sort((a, b) => a.r - b.r || a.name.localeCompare(b.name));
    const out = ranked.slice(0, 8).map((x) => ({ name: x.name, isNew: false }));
    const exact = out.find((x) => lc(x.name) === lc(q));
    if (!exact) out.push({ name: q.replace(/\s+/g, ' ').trim(), isNew: true });
    return out;
  }, [input, allTagNames, matchingSet, excludedTagSet]);

  useEffect(() => {
    setHighlight(0);
  }, [suggestions.length]);

  const commit = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length === 0) return;
    if (matchingSet.has(lc(name))) {
      setInput('');
      return;
    }
    onAdd(name);
    setInput('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === 'Tab') {
      if (suggestions.length > 0) {
        e.preventDefault();
        const pick = suggestions[Math.min(highlight, suggestions.length - 1)];
        if (pick && !pick.isNew) {
          setInput(pick.name);
          setHighlight(suggestions.length - 1);
        }
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) {
        const pick = suggestions[Math.min(highlight, suggestions.length - 1)];
        if (pick) commit(pick.name);
      } else {
        commit(input);
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460 }}
      >
        <div className="modal-header">
          <h2>Edit tags</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {matchingTags.length > 0 ? (
          <div className="tag-chip-row">
            {matchingTags.map((t) => {
              const isUser = isUserAssigned(t, userTagSet);
              return (
                <button
                  key={t}
                  type="button"
                  className="tag-chip"
                  onClick={() => onRemove(t)}
                  title={isUser ? 'Remove from this video' : 'Hide from this video'}
                >
                  <span>{t}</span>
                  <span className="tag-chip-x" aria-hidden>×</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p style={{ margin: 0 }}>No tags for this video.</p>
        )}
        <div className="tag-picker">
          <input
            ref={inputRef}
            className="tag-picker-input"
            type="text"
            value={input}
            placeholder="Add a tag…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {suggestions.length > 0 ? (
            <div className="tag-picker-suggest-list" role="listbox">
              {suggestions.map((s, i) => (
                <button
                  type="button"
                  key={`${s.name}-${s.isNew ? 'new' : 'old'}`}
                  className={`tag-picker-suggest${i === highlight ? ' active' : ''}${
                    s.isNew ? ' create-new' : ''
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(s.name);
                  }}
                >
                  {s.isNew ? (
                    <span>Create new tag "{s.name}"</span>
                  ) : (
                    <span>{s.name}</span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

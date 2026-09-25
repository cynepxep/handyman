"use client";

// Поле с выпадающим списком и поиском (город и отделение Новой Почты). Можно печатать — список подстраивается;
// стрелки ↑↓ и Enter выбирают, Esc закрывает. Если список не пришёл (НП не отвечает) — обычное текстовое поле.
import { useEffect, useRef, useState } from "react";

export type ComboOption = { ref: string; label: string; hint?: string };

export function Combo({
  id, value, onText, onPick, load, minChars = 2, placeholder, labels, invalid, describedBy, inputMode, autoComplete = "off", maxLength = 160,
}: {
  id: string;
  value: string;
  /** покупатель печатает сам (выбор из списка сбрасывается) */
  onText: (text: string) => void;
  onPick: (o: ComboOption) => void;
  /** null — список недоступен (поле работает как обычное) */
  load: (q: string) => Promise<ComboOption[] | null>;
  /** 0 — список открывается сразу при нажатии на поле */
  minChars?: number;
  placeholder?: string;
  labels: { searching: string; none: string };
  invalid?: boolean;
  describedBy?: string;
  inputMode?: "text" | "numeric" | "search";
  autoComplete?: string;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const req = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listId = `${id}-list`;

  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (q: string, delay = 250) => {
    clearTimeout(timer.current);
    if (q.trim().length < minChars) {
      setOpen(false);
      setItems([]);
      return;
    }
    const n = ++req.current;
    setLoading(true);
    setOpen(true);
    timer.current = setTimeout(async () => {
      const r = await load(q.trim()).catch(() => null);
      if (n !== req.current) return; // пришёл ответ на старый запрос
      setLoading(false);
      if (r === null) {
        setOpen(false); // НП не отвечает — просто текстовое поле
        return;
      }
      setItems(r);
      setActive(r.length ? 0 : -1);
    }, delay);
  };

  const pick = (o: ComboOption) => {
    onPick(o);
    setOpen(false);
    setItems([]);
    req.current++;
  };

  return (
    <div className="hm-combo">
      <input
        id={id}
        className="hm-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        onChange={(e) => {
          onText(e.target.value);
          search(e.target.value);
        }}
        onFocus={() => {
          if (minChars === 0 || value.trim().length >= minChars) search(value, 0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === "ArrowDown") search(value, 0);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && active >= 0 && items[active]) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="hm-combo-list">
          {loading && !items.length ? (
            <li className="hm-combo-note" aria-live="polite">{labels.searching}</li>
          ) : !items.length ? (
            <li className="hm-combo-note" aria-live="polite">{labels.none}</li>
          ) : (
            items.map((o, i) => (
              <li
                key={o.ref}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "is-active" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o.label}
                {o.hint ? <small>{o.hint}</small> : null}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

"use client";

// Поле с выпадающим списком и поиском (город и отделение Новой Почты). Можно печатать — список подстраивается;
// стрелки ↑↓ и Enter выбирают, Esc закрывает. Если список не пришёл (НП не отвечает) — обычное текстовое поле.
// Телефон: при нажатии поле поднимается под шапку, а список ограничен видимой частью экрана — чтобы его не закрывала клавиатура.
import { useEffect, useRef, useState } from "react";

export type ComboOption = { ref: string; label: string; hint?: string };

export function Combo({
  id, value, onText, onPick, load, minChars = 2, placeholder, labels, invalid, describedBy, inputMode, autoComplete = "off", maxLength = 160,
  picked = false, autoPickOnBlur = false,
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
  /** значение выбрано из списка — показать галочку */
  picked?: boolean;
  /** написали и ушли из поля, не выбрав, — взять первый вариант списка (для города: «Київ» → «м. Київ, Київська обл.») */
  autoPickOnBlur?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  const req = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  /** после последнего выбора покупатель что-то печатал */
  const dirty = useRef(false);
  const listId = `${id}-list`;

  useEffect(() => () => clearTimeout(timer.current), []);

  // высота списка — до клавиатуры (visualViewport — видимая часть экрана без клавиатуры)
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const el = input.current;
      const vv = window.visualViewport;
      if (!el) return;
      const bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      setMaxH(Math.max(140, Math.min(320, bottom - el.getBoundingClientRect().bottom - 12)));
    };
    fit();
    window.visualViewport?.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => {
      window.visualViewport?.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
    };
  }, [open]);

  /** На телефоне поднять поле под шапку сайта, когда откроется клавиатура — тогда список виден целиком. */
  const liftOnPhone = () => {
    if (!window.matchMedia("(max-width: 699px)").matches) return;
    setTimeout(() => {
      const el = input.current;
      if (!el || document.activeElement !== el) return;
      const header = document.querySelector(".hm-header")?.getBoundingClientRect();
      const top = header && header.bottom > 0 ? header.bottom : 0;
      window.scrollBy({ top: el.getBoundingClientRect().top - top - 12, behavior: "smooth" });
    }, 350);
  };

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
    dirty.current = false;
    onPick(o);
    setOpen(false);
    setItems([]);
    req.current++;
  };

  return (
    <div className={`hm-combo${picked ? " is-picked" : ""}`}>
      <input
        ref={input}
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
          dirty.current = true;
          onText(e.target.value);
          search(e.target.value);
        }}
        onFocus={() => {
          liftOnPhone();
          if (minChars === 0 || value.trim().length >= minChars) search(value, 0);
        }}
        onBlur={() =>
          setTimeout(() => {
            if (autoPickOnBlur && dirty.current && items.length && value.trim().length >= 3) pick(items[0]);
            setOpen(false);
          }, 150)
        }
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
        <ul id={listId} role="listbox" className="hm-combo-list" style={maxH ? { maxHeight: maxH } : undefined}>
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

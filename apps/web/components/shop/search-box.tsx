"use client";

// Поиск в шапке с подсказками: товары (фото, название, цена) по мере ввода, последние запросы и «часто ищут».
// Работает с клавиатуры (стрелки, Enter, Esc) и с экранным диктором (роль combobox).
// Подсказки берутся из /api/catalog/suggest — там же исправление раскладки («rheu» → «круг») и опечаток.
import { useId, useRef, useState } from "react";
import Image from "next/image";
import { optimizable } from "@/lib/image-hosts";
import { useRouter } from "next/navigation";
import { paths, shopHref, type ShopLang } from "@handyman/core/site/routes";
import { formatPrice } from "./format";
import { Icon } from "./icons";

export const SEARCH_INPUT_ID = "site-search";
const HISTORY_KEY = "hm.searchHistory";
const HISTORY_MAX = 6;

type Item = { id: string; sku: string; nameUk: string; nameRu: string; price: number; image: string | null; available: boolean; stock?: "local" | "supplier" | "order" };
export type SearchLabels = {
  label: string; placeholder: string; submit: string; history: string; popular: string; clear: string; all: string; none: string;
  stock: { local: string; supplier: string; order: string };
};

type Option = { kind: "product"; item: Item } | { kind: "query"; q: string } | { kind: "all"; q: string };

function readHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}
function writeHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {
    /* приватный режим браузера — просто не запоминаем */
  }
}

export function SearchBox({ lang, labels, popular }: { lang: ShopLang; labels: SearchLabels; popular: string[] }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [searched, setSearched] = useState(""); // для какого запроса пришли подсказки
  const [corrected, setCorrected] = useState<string | null>(null); // «rheu» → «круг»
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const term = q.trim();
  const options: Option[] =
    term.length >= 2
      ? [...(searched === term ? items : []).map((item) => ({ kind: "product" as const, item })), { kind: "all" as const, q: term }]
      : term.length === 0
        ? [...history, ...popular.filter((p) => !history.includes(p))].map((x) => ({ kind: "query" as const, q: x }))
        : [];

  const fetchSuggest = (text: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    fetch(`/api/catalog/suggest?q=${encodeURIComponent(text)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Item[]; correctedQuery?: string | null }) => {
        setItems(Array.isArray(data.items) ? data.items : []);
        setCorrected(typeof data.correctedQuery === "string" ? data.correctedQuery : null);
        setSearched(text);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setItems([]);
        setCorrected(null);
        setSearched(text);
        setLoading(false);
      });
  };

  const onChange = (value: string) => {
    setQ(value);
    setOpen(true);
    setActive(-1);
    if (timer.current) clearTimeout(timer.current);
    const text = value.trim();
    if (text.length < 2) {
      abort.current?.abort();
      setLoading(false);
      return;
    }
    timer.current = setTimeout(() => fetchSuggest(text), 180);
  };

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const goSearch = (text: string) => {
    const s = text.trim();
    if (!s) return;
    const next = [s, ...readHistory().filter((h) => h.toLowerCase() !== s.toLowerCase())];
    writeHistory(next);
    setHistory(next.slice(0, HISTORY_MAX));
    close();
    router.push(shopHref(lang, paths.search(s)));
  };

  // Подсказка-товар открывает страницу товара (адрес строится из украинского названия, как и везде).
  const openProduct = (item: Item) => {
    close();
    router.push(shopHref(lang, paths.product(item.sku, item.nameUk)));
  };

  const choose = (o: Option) => (o.kind === "product" ? openProduct(o.item) : goSearch(o.q));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const n = options.length;
      // -1 — курсор в поле ввода; дальше по кругу по вариантам
      setActive((a) => {
        const next = a + dir;
        if (next >= n) return -1;
        if (next < -1) return n - 1;
        return next;
      });
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      }
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (open && active >= 0 && options[active]) choose(options[active]);
    else goSearch(q);
  };

  const clearHistory = () => {
    writeHistory([]);
    setHistory([]);
  };

  const showList = open && (options.length > 0 || (term.length >= 2 && !loading && searched === term));
  const optId = (i: number) => `${listId}-o${i}`;
  const productCount = options.filter((o) => o.kind === "product").length;

  return (
    <form
      className="hm-search"
      role="search"
      action={shopHref(lang, "/search")}
      onSubmit={onSubmit}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <label htmlFor={SEARCH_INPUT_ID} className="hm-vh">{labels.label}</label>
      <div className="hm-search-box">
        <input
          id={SEARCH_INPUT_ID}
          name="q"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={labels.placeholder}
          value={q}
          maxLength={100}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optId(active) : undefined}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            setHistory(readHistory());
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" aria-label={labels.submit}>
          {loading ? <span className="hm-spinner" aria-hidden="true" /> : <Icon name="search" size={22} />}
        </button>
      </div>

      {showList && (
        <div className="hm-suggest" id={listId} role="listbox" aria-label={labels.label}>
          {term.length === 0 && history.length > 0 && (
            <p className="hm-suggest-title" role="presentation">
              <span>{labels.history}</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={clearHistory}>{labels.clear}</button>
            </p>
          )}
          {options.map((o, i) => {
            const common = {
              id: optId(i),
              role: "option" as const,
              "aria-selected": i === active,
              onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
              onClick: () => choose(o),
              onMouseEnter: () => setActive(i),
            };
            const popularTitle = term.length === 0 && o.kind === "query" && i === history.length && popular.length > 0;
            if (o.kind === "product") {
              const name = lang === "ru" && o.item.nameRu ? o.item.nameRu : o.item.nameUk;
              return (
                <div key={o.item.id} className="hm-suggest-item" {...common}>
                  <span className="hm-suggest-img">{o.item.image && <Image src={o.item.image} alt="" width={48} height={48} sizes="48px" unoptimized={!optimizable(o.item.image)} style={{ objectFit: "contain", width: "100%", height: "100%" }} />}</span>
                  <span>
                    <span className="hm-suggest-name">{name}</span>
                    {(() => {
                      const level = o.item.stock ?? (o.item.available ? "supplier" : "order");
                      return <span className={`hm-stock hm-stock-${level}`}>{labels.stock[level]}</span>;
                    })()}
                  </span>
                  <span className="hm-suggest-price">{formatPrice(o.item.price)}</span>
                </div>
              );
            }
            if (o.kind === "all") {
              return (
                <div key="all" className="hm-suggest-q" {...common}>
                  <Icon name="search" size={18} /> <b>{productCount === 0 ? labels.none : `${labels.all}: «${(searched === term && corrected) || o.q}»`}</b>
                </div>
              );
            }
            return (
              <div key={`q-${o.q}`} style={{ display: "contents" }}>
                {popularTitle && <p className="hm-suggest-title" role="presentation"><span>{labels.popular}</span></p>}
                <div className="hm-suggest-q" {...common}>
                  <Icon name={i < history.length ? "back" : "search"} size={18} /> {o.q}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </form>
  );
}

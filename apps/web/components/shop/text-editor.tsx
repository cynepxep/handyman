"use client";

// Режим «✎ Редагувати тексти» для сотрудника (право «Тексты и страницы сайта»). Покупатели кнопку не видят.
// Как работает: надписи страницы, которые пришли из «Сайт → Тексты», подсвечиваются; нажатие на надпись открывает окно
// с полями укр./рус. Страницу мы не перестраиваем (подсветка — CSS Custom Highlight), поэтому сайт работает как обычно.
// Это служебный инструмент для сотрудников — подписи в нём по-русски, как во всей админке.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editableTextsAction, saveTextAction, type EditableText } from "@/app/[lang]/text-edit-actions";

const MODE_KEY = "hm.textEdit";
const HL = "hm-te";
// правило подсветки задаём здесь: сборщик стилей пока не знает ::highlight и ругается на него в shop.css
const HL_CSS = `::highlight(${HL}) { background-color: rgba(45, 108, 223, .22); text-decoration: underline 2px dashed #2d6cdf; }`;

type Matcher = { exact: Map<string, EditableText[]>; patterns: Array<{ re: RegExp; entry: EditableText }> };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function buildMatcher(entries: EditableText[], lang: "uk" | "ru"): Matcher {
  const exact = new Map<string, EditableText[]>();
  const patterns: Matcher["patterns"] = [];
  for (const e of entries) {
    const value = norm(e[lang]);
    if (!value) continue;
    if (/\{[a-zA-Z]+\}/.test(value)) {
      const src = value.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[a-zA-Z]+\}/g, "(.+?)");
      // шаблон из одних переменных ({n}) совпадёт с чем угодно — такие пропускаем
      if (src.replace(/\(\.\+\?\)/g, "").trim().length >= 2) patterns.push({ re: new RegExp(`^${src}$`), entry: e });
    } else {
      (exact.get(value) ?? exact.set(value, []).get(value)!).push(e);
    }
  }
  return { exact, patterns };
}

function matchText(m: Matcher, text: string): EditableText[] {
  const t = norm(text);
  if (t.length < 2) return [];
  const found = m.exact.get(t);
  if (found) return found;
  return m.patterns.filter((p) => p.re.test(t)).map((p) => p.entry);
}

/** Текстовые узлы страницы (без самого редактора и служебных тегов). */
function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || p.closest("script,style,noscript,textarea,[data-te-ui]")) return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

type HighlightsApi = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
const highlights = (): HighlightsApi | null => {
  const c = (globalThis as { CSS?: { highlights?: HighlightsApi } }).CSS;
  return c?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === "function" ? c.highlights : null;
};

function caretText(x: number, y: number): Text | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null };
  const node = d.caretPositionFromPoint ? d.caretPositionFromPoint(x, y)?.offsetNode : document.caretRangeFromPoint?.(x, y)?.startContainer;
  return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
}

export function TextEditor({ lang }: { lang: "uk" | "ru" }) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [entries, setEntries] = useState<EditableText[] | null>(null);
  const [picked, setPicked] = useState<EditableText[] | null>(null);
  const [count, setCount] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const matcher = useRef<Matcher | null>(null);

  // режим сохраняется при переходе по страницам (до закрытия вкладки)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- однократное чтение из sessionStorage после загрузки
      if (sessionStorage.getItem(MODE_KEY) === "1") setOn(true);
    } catch {
      /* нет хранилища — режим просто выключен */
    }
  }, []);

  const load = useCallback(async () => {
    const list = await editableTextsAction();
    if (!list) {
      setOn(false);
      return;
    }
    matcher.current = buildMatcher(list, lang);
    setEntries(list);
  }, [lang]);

  useEffect(() => {
    try {
      sessionStorage.setItem(MODE_KEY, on ? "1" : "0");
    } catch {
      /* ничего */
    }
    document.documentElement.classList.toggle("hm-te-on", on);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка текстов при включении режима
    if (on && !entries) void load();
  }, [on, entries, load]);

  // подсветка найденных надписей; пересчёт при изменении страницы
  useEffect(() => {
    const api = highlights();
    if (!on || !entries || !matcher.current) {
      api?.delete(HL);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      const m = matcher.current!;
      const ranges: Range[] = [];
      for (const n of textNodes(document.body)) {
        if (!matchText(m, n.nodeValue ?? "").length) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        ranges.push(r);
      }
      setCount(ranges.length);
      if (api) api.set(HL, new (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight(...ranges));
    };
    paint();
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paint, 250);
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      mo.disconnect();
      clearTimeout(timer);
      api?.delete(HL);
    };
  }, [on, entries]);

  // нажатие на подсвеченную надпись открывает окно правки (вместо перехода по ссылке)
  useEffect(() => {
    if (!on || !entries) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-te-ui]")) return;
      const m = matcher.current;
      if (!m) return;
      const node = caretText(e.clientX, e.clientY);
      let found = node ? matchText(m, node.nodeValue ?? "") : [];
      // запасной путь: надпись — прямой текст нажатого элемента (кнопки, короткие подписи)
      if (!found.length && target) {
        for (const n of target.childNodes) if (n.nodeType === Node.TEXT_NODE && (found = matchText(m, n.nodeValue ?? "")).length) break;
      }
      if (!found.length) return;
      e.preventDefault();
      e.stopPropagation();
      setPicked(found);
      dialog.current?.showModal();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [on, entries]);

  const saved = async () => {
    dialog.current?.close();
    setPicked(null);
    setEntries(null); // перечитать тексты с сервера
    router.refresh();
  };

  return (
    <>
      {on && <style>{HL_CSS}</style>}
      <div className="hm-te-bar" data-te-ui>
        <button type="button" className={`hm-te-btn${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => setOn((v) => !v)}>
          ✎ {on ? `Готово (надписей: ${count})` : "Редагувати тексти"}
        </button>
        {on && <span className="hm-te-tip">Нажмите на выделенную надпись</span>}
      </div>
      <dialog ref={dialog} className="hm-modal hm-te-dialog" data-te-ui onClose={() => setPicked(null)}>
        {picked && <EditForm entries={picked} onClose={() => dialog.current?.close()} onSaved={saved} />}
      </dialog>
    </>
  );
}

function EditForm({ entries, onClose, onSaved }: { entries: EditableText[]; onClose: () => void; onSaved: () => void }) {
  const [idx, setIdx] = useState(0);
  const e = entries[Math.min(idx, entries.length - 1)];
  return (
    <div className="hm-modal-body">
      <div className="hm-drawer-head">
        <b>Текст сайта</b>
        <button type="button" className="hm-iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>
      {entries.length > 1 && (
        <div className="hm-field">
          <label htmlFor="te-which">Такая надпись есть в нескольких местах — выберите, какое меняем:</label>
          <select id="te-which" className="hm-input" value={idx} onChange={(ev) => setIdx(Number(ev.target.value))}>
            {entries.map((x, i) => <option key={x.key} value={i}>{x.group}: {x.hint || x.key}</option>)}
          </select>
        </div>
      )}
      <EntryForm key={e.key} entry={e} onSaved={onSaved} />
    </div>
  );
}

function EntryForm({ entry, onSaved }: { entry: EditableText; onSaved: () => void }) {
  const [uk, setUk] = useState(entry.uk);
  const [ru, setRu] = useState(entry.ru);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const save = (u: string, r: string) =>
    start(async () => {
      const res = await saveTextAction(entry.key, u, r);
      if (res.ok) onSaved();
      else setError(res.error);
    });
  return (
    <form
      className="hm-section"
      style={{ gap: 10 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        save(uk, ru);
      }}
    >
      <p className="hm-small">
        {entry.group}{entry.hint ? ` · ${entry.hint}` : ""}
        {entry.vars.length > 0 && <> · слова {entry.vars.map((v) => `{${v}}`).join(", ")} оставьте — сайт подставит туда число или название</>}
      </p>
      <div className="hm-field">
        <label htmlFor="te-uk">Українською</label>
        <textarea id="te-uk" className="hm-input hm-textarea" value={uk} onChange={(ev) => setUk(ev.target.value)} rows={3} />
      </div>
      <div className="hm-field">
        <label htmlFor="te-ru">По-русски</label>
        <textarea id="te-ru" className="hm-input hm-textarea" value={ru} onChange={(ev) => setRu(ev.target.value)} rows={3} />
      </div>
      {error && <p className="hm-alert hm-alert-error" role="alert">{error}</p>}
      <div className="hm-help-btns">
        <button type="submit" className="hm-btn hm-btn-primary" disabled={pending}>{pending ? "Сохраняю…" : "Сохранить"}</button>
        {(entry.uk !== entry.ukDefault || entry.ru !== entry.ruDefault) && (
          <button type="button" className="hm-btn hm-btn-ghost" disabled={pending} onClick={() => save("", "")}>↺ Вернуть стандартный</button>
        )}
      </div>
    </form>
  );
}

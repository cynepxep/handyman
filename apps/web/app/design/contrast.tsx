"use client";

// Проверка контраста цветов дизайн-системы прямо в браузере: берёт настоящие значения переменных из shop.css.
// Норма для текста — не ниже 4,5:1 (WCAG AA).
import { useSyncExternalStore } from "react";

const PAIRS: Array<[string, string, string]> = [
  ["--c-text", "--c-bg", "Основной текст на фоне"],
  ["--c-text", "--c-surface", "Основной текст на карточке"],
  ["--c-muted", "--c-bg", "Второстепенный текст на фоне"],
  ["--c-muted", "--c-surface", "Второстепенный текст на карточке"],
  ["--c-muted", "--c-chip", "Второстепенный текст на чипе"],
  ["--c-on-primary", "--c-primary", "Текст на жёлтой кнопке"],
  ["--c-on-primary", "--c-primary-hover", "Текст на жёлтой кнопке (наведение)"],
  ["--c-on-dark", "--c-dark", "Светлый текст на тёмном"],
  ["--c-primary", "--c-dark", "Жёлтый на тёмном (активный язык, заголовки подвала)"],
  ["--c-on-accent", "--c-accent", "Текст на бейдже скидки"],
  ["--c-success", "--c-surface", "«В наявності»"],
  ["--c-warn", "--c-surface", "«Під замовлення»"],
  ["--c-alert-text", "--c-alert-bg", "Текст предупреждения"],
];

function rgb(value: string): [number, number, number] | null {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
}
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

function compute(): string {
  const rows = PAIRS.map(([fg, bg, label]) => {
    const a = rgb(`var(${fg})`);
    const b = rgb(`var(${bg})`);
    if (!a || !b) return { fg, bg, label, ratio: 0 };
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return { fg, bg, label, ratio: (l1 + 0.05) / (l2 + 0.05) };
  });
  return JSON.stringify(rows);
}

let cache = "";
const subscribe = () => () => {};
const getSnapshot = () => (cache ||= compute());
const getServerSnapshot = () => "";

export function ContrastTable() {
  const json = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const rows: Array<{ fg: string; bg: string; label: string; ratio: number }> = json ? JSON.parse(json) : [];
  return (
    <table className="ds-table">
      <thead><tr><th>Пара</th><th>Образец</th><th>Контраст</th></tr></thead>
      <tbody>
        {PAIRS.map(([fg, bg, label], i) => {
          const r = rows[i]?.ratio ?? 0;
          return (
            <tr key={`${fg}-${bg}`}>
              <td>{label}<br /><code>{fg} / {bg}</code></td>
              <td><span className="ds-sample" style={{ color: `var(${fg})`, background: `var(${bg})` }}>Ґрунт Їжак 1 599 ₴</span></td>
              <td>{r ? <b style={{ color: r >= 4.5 ? "var(--c-success)" : "var(--c-accent)" }}>{r.toFixed(2)}:1 {r >= 4.5 ? "✓" : "мало"}</b> : "…"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

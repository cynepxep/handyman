// Текст страниц сайта («Доставка и оплата», «О магазине», «Оферта»…) пишется простым текстом, без HTML:
//   пустая строка — новый абзац;   ## Заголовок   ### Подзаголовок;   - пункт списка;   1. нумерованный пункт;
//   **жирный**;   [текст ссылки](https://адрес)
// Всё остальное показывается как обычный текст: ни скриптов, ни чужих тегов вставить нельзя.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Разрешённые адреса ссылок: сайт, телефон, почта, мессенджеры, свой сайт (/путь).
const SAFE_URL = /^(?:https?:\/\/[^\s]+|tel:\+?[0-9]{5,20}|mailto:[^\s@]+@[^\s@]+|tg:\/\/[^\s]+|viber:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i;

function inline(raw: string): string {
  let s = esc(raw);
  s = s.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (whole, text: string, url: string) => {
    // адрес уже экранирован (кавычки и скобки не могут вырваться из атрибута); в проверке возвращаем & обратно
    if (!SAFE_URL.test(url.replace(/&amp;/g, "&"))) return whole;
    const external = /^https?:/i.test(url);
    return `<a href="${url}"${external ? ' target="_blank" rel="noopener nofollow"' : ""}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return s;
}

/** Текст страницы → безопасный HTML. */
export function renderPageBody(text: string | null | undefined): string {
  const blocks = String(text ?? "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 1 && lines[0].startsWith("### ")) out.push(`<h3>${inline(lines[0].slice(4))}</h3>`);
    else if (lines.length === 1 && lines[0].startsWith("## ")) out.push(`<h2>${inline(lines[0].slice(3))}</h2>`);
    else if (lines.every((l) => /^[-*] /.test(l))) out.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`);
    else if (lines.every((l) => /^\d+[.)] /.test(l))) out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+[.)] /, ""))}</li>`).join("")}</ol>`);
    else out.push(`<p>${lines.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

/** Есть ли в тексте пометка «[заполнить]» — владельцу напоминаем, что там нужно дописать. */
export const hasFillMarker = (text: string | null | undefined) => /\[заполнить[^\]]*\]/i.test(String(text ?? ""));

// Очистка HTML из описаний поставщика: оставляем безопасные теги без атрибутов
// (кроме href у ссылок), убираем style/script/iframe, чиним сломанные кавычки атрибутов.

const ALLOWED = new Set([
  "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "b", "em", "i", "u", "br",
  "table", "thead", "tbody", "tr", "td", "th", "a",
]);
const RENAME: Record<string, string> = { h1: "h2", h5: "h4", h6: "h4" }; // h1 на странице один — заголовок товара
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

function cleanHref(attrs: string): string | null {
  const m = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? m[3] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
  if (!/^(https?:\/\/|\/|tel:|mailto:)/i.test(raw)) return null;
  return raw.replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E");
}

export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  const src = input.replace(COMMENTS, "").replace(DROP_WITH_CONTENT, "");
  let out = "";
  let last = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(src); m; m = TAG.exec(src)) {
    out += escapeText(src.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === "/";
    let name = m[2].toLowerCase();
    name = RENAME[name] ?? name;
    if (!ALLOWED.has(name)) continue;
    if (name === "br") {
      if (!closing) out += "<br>";
    } else if (closing) {
      out += `</${name}>`;
    } else if (name === "a") {
      const href = cleanHref(m[3]);
      out += href ? `<a href="${href}" rel="nofollow noopener">` : "<a>";
    } else {
      out += `<${name}>`;
    }
  }
  out += escapeText(src.slice(last));
  return tidy(out);
}

// В тексте (вне тегов) остаток "<" и ">" — это просто символы.
function escapeText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tidy(html: string): string {
  let s = html.replace(/\s+/g, " ");
  const emptyBlock = /<(p|li|h2|h3|h4|strong|b|em|i|u)>(?:\s|&nbsp;| |<br>)*<\/\1>/gi;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(emptyBlock, "");
  }
  return s.replace(/<a>\s*<\/a>/g, "").trim();
}

// Простой текст для поиска и мета-описаний.
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\/(p|li|h[2-4]|tr)>|<br>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;| /g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

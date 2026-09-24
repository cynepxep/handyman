// Разбор XML-фида поставщика. Понимает формат Vitals (<items><item>), Prom и YML (<offers><offer>).
// Только разбор: в базу ничего не пишет. Проверено на живом фиде Vitals (см. docs/CATALOG-IMPORT.md).

import { XMLParser } from "fast-xml-parser";
import { decodeXmlEntities } from "./xml-entities";
import { sanitizeHtml } from "./sanitize";

export type FeedCategory = {
  id: string;
  parentId: string | null;
  name: string;
  /** Названия от корня до этой категории. */
  path: string[];
};

export type FeedParam = { name: string; value: string };

export type FeedItem = {
  /** Наш артикул (vendorCode). Строка: ведущие нули важны ("000237651"). */
  sku: string;
  feedId: string | null;
  articleCode: string | null;
  url: string | null;
  name: string;
  /** Уже очищенный HTML (features_text + description). */
  descriptionHtml: string;
  price: number;
  oldPrice: number | null;
  /** Есть у поставщика. Количества в фиде нет: quantity_in_stock у Vitals бывает только 0 или 1. */
  available: boolean;
  categoryId: string | null;
  categoryPath: string[] | null;
  pictures: string[];
  params: FeedParam[];
};

export type FeedIssue = {
  /** Номер товара в файле, с 1. */
  row: number;
  sku: string | null;
  message: string;
};

export type FeedParseResult = {
  items: FeedItem[];
  categories: FeedCategory[];
  issues: FeedIssue[];
  info: { format: "items" | "offers"; currency: string | null; date: string | null; totalRows: number };
};

export class FeedFormatError extends Error {
  constructor(
    message: string,
    public readonly info: { isHtml: boolean; head: string; topTags: string[] },
  ) {
    super(message);
    this.name = "FeedFormatError";
  }
}

type Node = Record<string, unknown>;

const ARRAY_TAGS = new Set(["item", "offer", "category", "param", "picture", "image"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // артикулы с ведущими нулями и цены разбираем сами
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false, // сущности раскрываем сами (decodeXmlEntities), у библиотеки лимит на их число
  isArray: (tagName, _path, _isLeaf, isAttribute) => !isAttribute && ARRAY_TAGS.has(tagName.toLowerCase()),
});

export function decodeFeedBytes(bytes: Uint8Array): string {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  // Кодировка из объявления <?xml ... encoding="..."?>; у Vitals её нет в заголовке ответа, но в файле UTF-8.
  const headAscii = Buffer.from(bytes.subarray(start, start + 200)).toString("latin1");
  const enc = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(headAscii)?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(enc).decode(bytes.subarray(start));
  } catch {
    return new TextDecoder("utf-8").decode(bytes.subarray(start));
  }
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return decodeXmlEntities(v).trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text((v as Node)["#text"]);
  return "";
}

function attr(v: unknown, name: string): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const a = (v as Node)[`@_${name}`];
    if (typeof a === "string") return decodeXmlEntities(a).trim();
  }
  return "";
}

function num(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function lowerKeys(node: Node): Node {
  const out: Node = {};
  for (const [k, v] of Object.entries(node)) out[k.toLowerCase()] = v;
  return out;
}

/** Ищет в дереве первый массив с этим тегом (в <catalog>, <categories>, <items>, <offers>). */
function findList(root: unknown, tag: string): Node[] {
  const queue: unknown[] = [root];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    for (const [k, v] of Object.entries(cur as Node)) {
      if (k.toLowerCase() === tag && Array.isArray(v)) return v as Node[];
      if (v && typeof v === "object" && !Array.isArray(v)) queue.push(v);
    }
  }
  return [];
}

function find(root: unknown, tag: string): unknown {
  const queue: unknown[] = [root];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    for (const [k, v] of Object.entries(cur as Node)) {
      if (k.toLowerCase() === tag) return v;
      if (v && typeof v === "object" && !Array.isArray(v)) queue.push(v);
    }
  }
  return undefined;
}

function diagnose(source: string): FeedFormatError["info"] {
  const tags = new Map<string, number>();
  for (const m of source.matchAll(/<([a-zA-Z][a-zA-Z0-9_]*)/g)) tags.set(m[1], (tags.get(m[1]) ?? 0) + 1);
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${t}×${n}`);
  return { isHtml: /<html[\s>]/i.test(source.slice(0, 2000)), head: source.slice(0, 300), topTags };
}

const TRUE = /^(true|1|yes|y|да|так)$/i;
const FALSE = /^(false|0|no|n|нет|ні)$/i;

function readAvailable(g: Node, rawItem: unknown): boolean {
  const flag = text(g["available"]);
  if (flag) {
    if (TRUE.test(flag)) return true;
    if (FALSE.test(flag)) return false;
  } else if ("available" in g) {
    return false; // Vitals: пустой <available></available> = нет в наличии
  }
  const attrFlag = attr(rawItem, "available");
  if (attrFlag) return !FALSE.test(attrFlag);
  const presence = text(g["presence"]);
  if (presence) return !/^(not_available|out|false|0|waiting)/i.test(presence);
  const qty = num(text(g["quantity_in_stock"]) || text(g["stock_quantity"]) || text(g["quantity"]));
  return qty == null ? true : qty > 0;
}

export function parseFeed(input: Uint8Array | string): FeedParseResult {
  const source = typeof input === "string" ? input : decodeFeedBytes(input);
  let tree: unknown;
  try {
    tree = parser.parse(source);
  } catch {
    throw new FeedFormatError("Файл не удалось прочитать как XML.", diagnose(source));
  }

  const catNodes = findList(tree, "category");
  const itemNodes = findList(tree, "item");
  const offerNodes = itemNodes.length ? [] : findList(tree, "offer");
  const rows = itemNodes.length ? itemNodes : offerNodes;

  if (!rows.length) {
    const info = diagnose(source);
    throw new FeedFormatError(
      info.isHtml
        ? "Вместо XML пришла веб-страница (сайт поставщика мог заблокировать загрузку). Скачайте файл в браузере и загрузите его вручную."
        : "В файле не найдено ни одного товара. Проверьте, что это XML-фид (Prom/YML).",
      info,
    );
  }

  // ---- категории ----
  const byId = new Map<string, { id: string; parentId: string | null; name: string }>();
  for (const c of catNodes) {
    const id = attr(c, "id");
    if (!id) continue;
    byId.set(id, { id, parentId: attr(c, "parentId") || attr(c, "parentid") || null, name: text(c) });
  }
  const pathOf = (id: string): string[] => {
    const path: string[] = [];
    let cur: string | null = id;
    for (let depth = 0; cur && depth < 10; depth++) {
      const c = byId.get(cur);
      if (!c) break;
      path.unshift(c.name);
      cur = c.parentId;
    }
    return path;
  };
  const categories: FeedCategory[] = [...byId.values()].map((c) => ({ ...c, path: pathOf(c.id) }));

  // ---- товары ----
  const items: FeedItem[] = [];
  const issues: FeedIssue[] = [];
  const seen = new Set<string>();

  rows.forEach((rawItem, index) => {
    const row = index + 1;
    const g = lowerKeys(rawItem);
    const feedId = attr(rawItem, "id") || null;
    const sku = text(g["vendorcode"]) || text(g["sku"]) || text(g["code"]) || feedId || "";
    if (!sku) {
      issues.push({ row, sku: null, message: "Нет артикула (vendorCode) — товар пропущен." });
      return;
    }
    const name = text(g["name"]) || text(g["model"]) || text(g["name_ua"]);
    if (!/[\p{L}\p{N}]/u.test(name)) {
      // у Vitals есть служебные записи с названием «-» (без категории, фото и описания)
      issues.push({ row, sku, message: name ? `Нет осмысленного названия («${name}») — товар пропущен.` : "Нет названия — товар пропущен." });
      return;
    }
    const price = num(text(g["price"]) || text(g["priceuah"]));
    if (price == null || price <= 0) {
      issues.push({ row, sku, message: "Нет цены или она равна нулю — товар пропущен." });
      return;
    }
    if (seen.has(sku)) {
      issues.push({ row, sku, message: "Артикул повторяется в файле — использована первая строка." });
      return;
    }
    seen.add(sku);

    const oldPriceRaw = num(text(g["oldprice"]));
    const oldPrice = oldPriceRaw != null && oldPriceRaw > price ? oldPriceRaw : null;

    const categoryId = text(g["categoryid"]) || null;
    const catKnown = categoryId != null && byId.has(categoryId);
    if (categoryId && !catKnown) {
      issues.push({ row, sku, message: `Категория ${categoryId} не описана в фиде.` });
    }

    const pictures: string[] = [];
    for (const tag of ["picture", "image"]) {
      const list = g[tag];
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        const url = text(p);
        if (/^https?:\/\//i.test(url) && !pictures.includes(url)) pictures.push(url);
      }
    }

    const params: FeedParam[] = [];
    const rawParams = g["param"];
    if (Array.isArray(rawParams)) {
      for (const p of rawParams) {
        const pname = attr(p, "name");
        const pvalue = text(p);
        if (!pname || !pvalue) continue;
        if (!params.some((x) => x.name === pname && x.value === pvalue)) params.push({ name: pname, value: pvalue });
      }
    }

    const description = sanitizeHtml(text(g["description"]));
    const features = sanitizeHtml(text(g["features_text"]));

    items.push({
      sku,
      feedId,
      articleCode: text(g["articlcode"]) || text(g["articlecode"]) || null,
      url: text(g["url"]) || null,
      name,
      descriptionHtml: [features, description].filter(Boolean).join(" "),
      price,
      oldPrice,
      available: readAvailable(g, rawItem),
      categoryId: catKnown ? categoryId : null,
      categoryPath: catKnown ? pathOf(categoryId) : null,
      pictures,
      params,
    });
  });

  const currencyNode = find(tree, "currency");
  const currency = Array.isArray(currencyNode) ? attr(currencyNode[0], "code") || attr(currencyNode[0], "id") : attr(currencyNode, "code") || attr(currencyNode, "id");
  const priceRoot = (tree as Node)["price"] ?? (tree as Node)["yml_catalog"];
  const date = attr(priceRoot, "date") || null;

  return {
    items,
    categories,
    issues,
    info: { format: itemNodes.length ? "items" : "offers", currency: currency || null, date, totalRows: rows.length },
  };
}

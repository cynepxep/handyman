import "server-only";
import { prisma } from "@handyman/db";

export type CategoryNode = {
  id: string;
  nameUk: string;
  nameRu: string;
  sort: number;
  parentId: string | null;
  children: CategoryNode[];
};

/** Всё дерево категорий одним запросом (их сотни, не тысячи). */
export async function loadCategories() {
  const rows = await prisma.category.findMany({ orderBy: [{ sort: "asc" }, { nameUk: "asc" }] });
  const byId = new Map<string, CategoryNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const labelOf = (id: string): string => {
    const parts: string[] = [];
    for (let cur = byId.get(id), i = 0; cur && i < 6; cur = cur.parentId ? byId.get(cur.parentId) : undefined, i++) parts.unshift(cur.nameUk);
    return parts.join(" › ");
  };
  /** Сама категория и все вложенные. */
  const subtreeIds = (id: string): string[] => {
    const out: string[] = [];
    const walk = (n: CategoryNode) => {
      out.push(n.id);
      n.children.forEach(walk);
    };
    const start = byId.get(id);
    if (start) walk(start);
    return out;
  };
  const flat = [...byId.values()]
    .map((n) => ({ id: n.id, label: labelOf(n.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "uk"));
  return { roots, byId, labelOf, subtreeIds, flat };
}

export const PAGE_SIZE = 40;

export function money(n: number | { toNumber(): number } | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : n.toNumber();
  return `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;
}

/** «1 234,5» → 1234.5; пустое → null; мусор → NaN. */
export function parseMoney(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  return Number(s);
}

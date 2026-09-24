// Планировщик импорта: сравнивает разобранный фид с товарами в базе и решает, что создать/обновить/пропустить.
// Чистая логика без доступа к базе (тестируется без Docker). Запись в базу — packages/db/src/catalog-import.ts.
// Правила: docs/CATALOG-IMPORT.md (перенос из старого handyman/src/feed.js + новые из ТЗ).

import type { FeedItem, FeedParam } from "./feed-parse";
import {
  decideCategory, placeInTree, placementLeafId,
  type CategoryPlacement, type StoredMapping,
} from "./categories";

/** Поля товара, которые можно защитить от импорта (ProductFieldLock.fieldName). */
export const LOCKABLE_FIELDS = [
  "nameUk", "nameRu", "descUk", "descRu", "price", "oldPrice", "categoryId", "visible", "brandId", "supplierId",
] as const;
export type LockableField = (typeof LOCKABLE_FIELDS)[number];

export type ExistingProduct = {
  id: string;
  sku: string;
  nameUk: string;
  nameRu: string;
  descUk: string | null;
  descRu: string | null;
  price: number;
  oldPrice: number | null;
  supplierPrice: number | null;
  categoryId: string;
  brandId: string | null;
  supplierId: string | null;
  supplierAvailable: boolean;
  articleCode: string | null;
  supplierUrl: string | null;
  visible: boolean;
  priceConflict: boolean;
  missingFromFeedSince: Date | null;
  source: "MANUAL" | "FEED" | "TABLE";
  locked: ReadonlySet<string>;
  pictures: string[];
  params: FeedParam[];
};

export type PlanOptions = {
  supplierId: string;
  /** Наценка к цене фида в %. У Vitals пусто: цена фида уже РРЦ. */
  markupPct: number | null;
  /** Изменение цены больше этого процента не применяется без подтверждения (ТЗ: 30%). */
  jumpPct: number;
  brandId: string | null;
  stored: StoredMapping;
  /** Артикулы, для которых владелец подтвердил скачок цены. */
  approvedSkus: ReadonlySet<string>;
  now: Date;
};

/** Изменяемые скалярные поля товара (то, что уходит в prisma create/update). */
export type ProductWrite = {
  nameUk: string;
  nameRu: string;
  descUk: string | null;
  price: number;
  oldPrice: number | null;
  supplierPrice: number | null;
  categoryId: string;
  brandId: string | null;
  supplierId: string;
  supplierAvailable: boolean;
  articleCode: string | null;
  supplierUrl: string | null;
  missingFromFeedSince: Date | null;
  priceConflict: boolean;
};

export type PriceJump = { sku: string; productId: string; name: string; oldPrice: number; newPrice: number; pct: number };

export type ItemPlan =
  | { action: "skip"; sku: string; name: string; reason: string }
  | { action: "create"; sku: string; item: FeedItem; placement: CategoryPlacement; data: ProductWrite }
  | {
      action: "update" | "unchanged";
      sku: string;
      item: FeedItem;
      productId: string;
      placement: CategoryPlacement;
      /** Только изменившиеся поля. */
      changes: Partial<ProductWrite>;
      priceLog: { oldPrice: number; newPrice: number } | null;
      replacePictures: string[] | null;
      replaceParams: FeedParam[] | null;
      /** Скачок цены ждёт подтверждения (цена не применена, остальное применено). */
      jump: PriceJump | null;
      /** После импорта цена в расхождении с поставщиком (защищена вручную). */
      conflict: boolean;
    };

export type MissingPlan = { productId: string; sku: string; reason: string; changes: Partial<ProductWrite> };

export type ImportPlan = {
  items: ItemPlan[];
  missing: MissingPlan[];
  summary: ImportSummary;
};

export type ImportSummary = {
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  priceChanged: number;
  conflicts: number;
  needConfirm: number;
  missing: number;
  errors: number;
  issues: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const same = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 0.005);
const sameList = <T>(a: T[], b: T[], eq: (x: T, y: T) => boolean) => a.length === b.length && a.every((x, i) => eq(x, b[i]));

export function computePrice(feedPrice: number, markupPct: number | null): number {
  return round2(feedPrice * (1 + (markupPct ?? 0) / 100));
}

export function planImport(items: FeedItem[], existing: ReadonlyMap<string, ExistingProduct>, opts: PlanOptions, extra: { totalRows: number; issues: number }): ImportPlan {
  const plans: ItemPlan[] = [];
  const handled = new Set<string>(); // артикулы, которые есть в фиде и загружаются
  const skippedInFeed = new Map<string, string>(); // артикулы в фиде, но не загружаемые → причина

  for (const item of items) {
    const decision = decideCategory(item.categoryPath, opts.stored);
    const placement = placeInTree(item.categoryPath, decision);
    if (!placement || decision.kind === "skip") {
      const reason = decision.kind === "skip" ? decision.reason : "Не загружается";
      skippedInFeed.set(item.sku, reason);
      plans.push({ action: "skip", sku: item.sku, name: item.name, reason });
      continue;
    }
    handled.add(item.sku);
    const leaf = placementLeafId(placement);
    const price = computePrice(item.price, opts.markupPct);
    const oldPrice = item.oldPrice != null ? computePrice(item.oldPrice, opts.markupPct) : null;
    const cur = existing.get(item.sku);

    if (!cur) {
      plans.push({
        action: "create", sku: item.sku, item, placement,
        data: {
          nameUk: item.name, nameRu: item.name, descUk: item.descriptionHtml || null,
          price, oldPrice, supplierPrice: price, categoryId: leaf, brandId: opts.brandId, supplierId: opts.supplierId,
          supplierAvailable: item.available, articleCode: item.articleCode, supplierUrl: item.url,
          missingFromFeedSince: null, priceConflict: false,
        },
      });
      continue;
    }

    const changes: Partial<ProductWrite> = {};
    let priceLog: { oldPrice: number; newPrice: number } | null = null;
    let jump: PriceJump | null = null;
    let conflict = false; // цена защищена вручную и отличается от цены поставщика
    const has = (f: LockableField) => cur.locked.has(f);

    if (!has("nameUk") && cur.nameUk !== item.name) changes.nameUk = item.name;
    // Русское название пока копия украинского; если его уже перевели руками — не трогаем.
    if (!has("nameRu") && cur.nameRu === cur.nameUk && cur.nameRu !== item.name) changes.nameRu = item.name;
    if (item.descriptionHtml && !has("descUk") && cur.descUk !== item.descriptionHtml) changes.descUk = item.descriptionHtml;

    if (has("price")) {
      conflict = !same(cur.price, price);
      if (conflict !== cur.priceConflict) changes.priceConflict = conflict;
    } else {
      if (!same(cur.price, price)) {
        const pct = cur.price > 0 ? (Math.abs(price - cur.price) / cur.price) * 100 : 100;
        if (pct > opts.jumpPct && !opts.approvedSkus.has(item.sku)) {
          jump = { sku: item.sku, productId: cur.id, name: item.name, oldPrice: cur.price, newPrice: price, pct: Math.round(pct * 10) / 10 };
        } else {
          changes.price = price;
          priceLog = { oldPrice: cur.price, newPrice: price };
        }
      }
      if (!jump && cur.priceConflict) changes.priceConflict = false;
    }
    if (!has("oldPrice") && !same(cur.oldPrice, oldPrice)) changes.oldPrice = oldPrice;
    if (!same(cur.supplierPrice, price)) changes.supplierPrice = price;
    if (!has("categoryId") && cur.categoryId !== leaf) changes.categoryId = leaf;
    if (opts.brandId && !has("brandId") && cur.brandId !== opts.brandId) changes.brandId = opts.brandId;
    if (!has("supplierId") && cur.supplierId !== opts.supplierId) changes.supplierId = opts.supplierId;
    if (cur.supplierAvailable !== item.available) changes.supplierAvailable = item.available;
    if (item.articleCode && cur.articleCode !== item.articleCode) changes.articleCode = item.articleCode;
    if (item.url && cur.supplierUrl !== item.url) changes.supplierUrl = item.url;
    if (cur.missingFromFeedSince) changes.missingFromFeedSince = null;

    // Пустые картинки/характеристики из фида не затирают уже заполненные.
    const replacePictures = item.pictures.length && !sameList(cur.pictures, item.pictures, (a, b) => a === b) ? item.pictures : null;
    const replaceParams = item.params.length && !sameList(cur.params, item.params, (a, b) => a.name === b.name && a.value === b.value) ? item.params : null;

    const changed = Object.keys(changes).length > 0 || priceLog || replacePictures || replaceParams || jump;
    plans.push({
      action: changed ? "update" : "unchanged", sku: item.sku, item, productId: cur.id, placement,
      changes, priceLog, replacePictures, replaceParams, jump, conflict,
    });
  }

  // Товары поставщика, которых нет в фиде (или которые теперь не загружаются): остаются на сайте как «Под заказ».
  const missing: MissingPlan[] = [];
  for (const cur of existing.values()) {
    if (cur.supplierId !== opts.supplierId || cur.source !== "FEED" || handled.has(cur.sku)) continue;
    const reason = skippedInFeed.get(cur.sku) ?? "Нет в фиде";
    const changes: Partial<ProductWrite> = {};
    if (cur.supplierAvailable) changes.supplierAvailable = false;
    if (!cur.missingFromFeedSince) changes.missingFromFeedSince = opts.now;
    if (Object.keys(changes).length) missing.push({ productId: cur.id, sku: cur.sku, reason, changes });
  }

  const skippedByReason: Record<string, number> = {};
  const summary: ImportSummary = {
    totalRows: extra.totalRows, created: 0, updated: 0, unchanged: 0, skipped: 0, skippedByReason,
    priceChanged: 0, conflicts: 0, needConfirm: 0, missing: missing.length, errors: 0, issues: extra.issues,
  };
  for (const p of plans) {
    if (p.action === "skip") {
      summary.skipped++;
      skippedByReason[p.reason] = (skippedByReason[p.reason] ?? 0) + 1;
    } else if (p.action === "create") summary.created++;
    else {
      if (p.action === "update") summary.updated++;
      else summary.unchanged++;
      if (p.priceLog) summary.priceChanged++;
      if (p.conflict) summary.conflicts++;
      if (p.jump) summary.needConfirm++;
    }
  }

  return { items: plans, missing, summary };
}

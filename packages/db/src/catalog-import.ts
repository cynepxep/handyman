// Импорт каталога поставщика в базу: проверка (что изменится), применение с прогрессом, память сопоставления категорий.
// Логика решений — в @handyman/core/catalog (planImport). Здесь только чтение/запись базы и файлов.
// Правила и допущения: docs/CATALOG-IMPORT.md.

import fs from "node:fs/promises";
import path from "node:path";
import { prisma, Prisma } from "./client";
import { imageRows } from "./media";
import {
  parseFeed, planImport, decideCategory, slugify, PATH_SEP, NO_CATEGORY_PATH, FeedFormatError,
  UNSORTED_ID, UNSORTED_NAME_UK, UNSORTED_NAME_RU, NO_BRAND_KEY, NEW_BRAND_PREFIX, countVendors, suggestBrand, decideBrand, vendorKey,
  type FeedParseResult, type FeedIssue, type ImportPlan, type ImportSummary, type ExistingProduct,
  type StoredMapping, type PriceJump, type CategoryPlacement, type BrandDecision, type BrandSuggestion, type StoredBrandChoice,
} from "@handyman/core/catalog";

/** Ошибка, текст которой можно показать владельцу как есть. */
export class ImportUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportUserError";
  }
}

export type ImportSource = { kind: "url"; url: string } | { kind: "file"; name: string; bytes: Uint8Array };

export type MappingChoice =
  | { kind: "auto" }
  | { kind: "skip" }
  | { kind: "category"; categoryId: string }
  | { kind: "new"; name: string };

export type TreeDecision = { kind: "skip" | "category" | "new"; categoryId?: string; name?: string; reason?: string };

export type TreeRow = {
  key: string; // путь через PATH_SEP (или NO_CATEGORY_PATH)
  name: string;
  depth: number; // 1 — корень
  count: number; // товаров в ветке
  decision: TreeDecision; // что будет сделано сейчас
  suggested: TreeDecision; // что предлагает автоподсказка
  overridden: boolean; // решение принял владелец (иначе автоподсказка)
};

const toTreeDecision = (d: ReturnType<typeof decideCategory>): TreeDecision =>
  d.kind === "skip" ? { kind: "skip", reason: d.reason } : d.kind === "new" ? { kind: "new", categoryId: d.categoryId, name: d.name } : { kind: "category", categoryId: d.categoryId };

/** Бренд из фида и что с ним будет (таблица «Бренды в файле» на экране проверки). */
export type BrandRow = {
  key: string; // vendorKey или NO_BRAND_KEY
  name: string; // как написано в фиде
  count: number;
  decision: BrandDecision;
  suggested: BrandSuggestion;
  overridden: boolean; // выбрал владелец (иначе автоподсказка)
};

/** Выбор владельца по бренду фида. */
export type BrandChoice =
  | { kind: "auto" }
  | { kind: "skip" }
  | { kind: "none" }
  | { kind: "brand"; brandId: string }
  | { kind: "new"; name: string };

export type ImportReport = {
  feedInfo: { date: string | null; currency: string | null; totalRows: number };
  /** Бренды в файле (в отчётах до появления выбора брендов — нет). */
  brands?: BrandRow[];
  /** Сколько товаров этого поставщика из фида уже есть в каталоге (для предупреждения «станут Под заказ»). */
  supplierProducts?: number;
  /** Категории, созданные этой загрузкой (при отмене удаляются, если опустели). */
  createdCategories?: string[];
  /** Бренды, созданные этой загрузкой, и бренды, впервые отмеченные у поставщика (при отмене убираются, если без товаров). */
  createdBrands?: string[];
  addedBrandLinks?: string[];
  issues: FeedIssue[];
  needConfirm: PriceJump[];
  priceChanges: { sku: string; name: string; oldPrice: number; newPrice: number; pct: number }[];
  conflicts: { sku: string; name: string; price: number; supplierPrice: number }[];
  skipped: { sku: string; name: string; reason: string }[];
  missing: { sku: string; reason: string }[];
  newCategories: string[];
  errors: { sku: string; message: string }[];
  tree: TreeRow[];
};

const CAP = { issues: 200, needConfirm: 500, priceChanges: 50, conflicts: 200, skipped: 100, missing: 100, errors: 200 };
const MAX_FEED_BYTES = 200 * 1024 * 1024;
const KEEP_FEED_FILES = 3;
const STALE_RUN_MS = 30 * 60 * 1000;

// ---------- файлы фида ----------

// Папка задаётся пользователем (FEEDS_DIR), поэтому Turbopack не должен пытаться отследить её при сборке.
const feedsDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.FEEDS_DIR ?? path.join(process.cwd(), ".data", "feeds"));

async function saveFeedFile(runId: string, bytes: Uint8Array): Promise<string> {
  const dir = feedsDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${runId}.xml`);
  await fs.writeFile(file, bytes);
  return file;
}

async function pruneFeedFiles(supplierId: string) {
  const runs = await prisma.importRun.findMany({
    where: { supplierId, feedFile: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { id: true, feedFile: true },
  });
  for (const r of runs.slice(KEEP_FEED_FILES)) {
    if (r.feedFile) await fs.rm(r.feedFile, { force: true });
    await prisma.importRun.update({ where: { id: r.id }, data: { feedFile: null } });
    parsedCache.delete(r.id);
  }
}

const parsedCache = new Map<string, FeedParseResult>();
function cacheParsed(runId: string, parsed: FeedParseResult) {
  parsedCache.set(runId, parsed);
  while (parsedCache.size > 2) parsedCache.delete(parsedCache.keys().next().value as string);
}

async function loadParsed(run: { id: string; feedFile: string | null }): Promise<FeedParseResult> {
  const hit = parsedCache.get(run.id);
  if (hit) return hit;
  if (!run.feedFile) throw new ImportUserError("Файл этой проверки уже удалён с диска. Запустите проверку заново.");
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(run.feedFile);
  } catch {
    throw new ImportUserError("Файл этой проверки не найден на диске. Запустите проверку заново.");
  }
  const parsed = parseFeed(bytes);
  cacheParsed(run.id, parsed);
  return parsed;
}

// ---------- скачивание ----------

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i;

export async function fetchFeedBytes(rawUrl: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImportUserError("Ссылка на фид указана неверно.");
  }
  if (!/^https?:$/.test(url.protocol) || PRIVATE_HOST.test(url.hostname)) {
    throw new ImportUserError("Ссылка на фид должна быть обычным адресом сайта (http или https).");
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Handyman importer)", accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(180_000),
      redirect: "follow",
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ImportUserError(timeout ? "Поставщик слишком долго не отвечает (более 3 минут)." : "Не удалось подключиться к поставщику. Проверьте ссылку и интернет.");
  }
  if (!res.ok) throw new ImportUserError(`Фид недоступен: поставщик ответил ${res.status}. Скачайте файл в браузере и загрузите его вручную.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FEED_BYTES) throw new ImportUserError("Файл фида слишком большой (более 200 МБ).");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FEED_BYTES) throw new ImportUserError("Файл фида слишком большой (более 200 МБ).");
  return bytes;
}

function parseOrThrow(bytes: Uint8Array): FeedParseResult {
  try {
    return parseFeed(bytes);
  } catch (e) {
    if (e instanceof FeedFormatError) throw new ImportUserError(e.message);
    throw e;
  }
}

// ---------- поставщик, бренд, сопоставление ----------

/** Системная категория «Нераспределённые» (для товаров без категории в фиде). Нужна до импорта и до выбора в списках. */
export async function ensureSystemCategories() {
  await prisma.category.upsert({
    where: { id: UNSORTED_ID },
    update: {},
    create: { id: UNSORTED_ID, nameUk: UNSORTED_NAME_UK, nameRu: UNSORTED_NAME_RU, sort: 999 },
  });
}

/** Vitals — основной поставщик. Создаётся при первом открытии импорта, ссылку можно поменять на экране. */
export async function ensureDefaultSupplier() {
  await ensureSystemCategories();
  const existing = await prisma.supplier.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.supplier.create({
    data: {
      name: "Vitals",
      feedUrl: "https://vitals.ua/index.php?route=extension/feed/prom",
      defaultBrand: "Vitals",
      note: "Основной поставщик. Цена в фиде — РРЦ, наценка не применяется.",
    },
  });
}

async function readStored(supplierId: string): Promise<StoredMapping> {
  const rows = await prisma.feedCategoryMap.findMany({ where: { supplierId } });
  return new Map(rows.map((r) => [r.path, { categoryId: r.categoryId, skip: r.skip }]));
}

/** Наш бренд по названию без учёта регистра («MILWAUKEE» = «Milwaukee»); нет — создаётся. */
export async function ensureBrandByName(rawName: string): Promise<string> {
  return (await findOrCreateBrand(rawName)).id;
}

async function findOrCreateBrand(rawName: string): Promise<{ id: string; created: boolean }> {
  const name = rawName.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new ImportUserError("У бренда должно быть название.");
  const found = await prisma.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (found) return { id: found.id, created: false };
  const b = await prisma.brand.create({ data: { name } }).catch(() => prisma.brand.findUniqueOrThrow({ where: { name } }));
  return { id: b.id, created: true };
}

async function readBrandStored(supplierId: string): Promise<Map<string, StoredBrandChoice>> {
  const rows = await prisma.feedBrandMap.findMany({ where: { supplierId } });
  return new Map(rows.map((r) => [r.vendor, { brandId: r.brandId, skip: r.skip }]));
}

/** Сохраняет выбор владельца по брендам фида (ключ — vendorKey). auto — вернуть автоподсказку. */
export async function saveBrandMapping(supplierId: string, choices: Record<string, BrandChoice>) {
  for (const [vendor, choice] of Object.entries(choices)) {
    if (!vendor) continue;
    if (choice.kind === "auto") {
      await prisma.feedBrandMap.deleteMany({ where: { supplierId, vendor } });
      continue;
    }
    let brandId: string | null = null;
    if (choice.kind === "brand") {
      const b = await prisma.brand.findUnique({ where: { id: choice.brandId }, select: { id: true } });
      if (!b) throw new ImportUserError("Выбранный бренд не найден — обновите страницу.");
      brandId = b.id;
    } else if (choice.kind === "new") {
      brandId = await ensureBrandByName(choice.name);
    }
    const skip = choice.kind === "skip";
    await prisma.feedBrandMap.upsert({
      where: { supplierId_vendor: { supplierId, vendor } },
      update: { brandId, skip },
      create: { supplierId, vendor, brandId, skip },
    });
    if (brandId) await linkSupplierBrands(supplierId, [brandId]);
  }
}

/** Отметить, что поставщик возит эти бренды (повтор не страшен). Возвращает бренды, которых у поставщика раньше не было. */
export async function linkSupplierBrands(supplierId: string, brandIds: Iterable<string>): Promise<string[]> {
  const ids = [...new Set(brandIds)].filter(Boolean);
  if (!ids.length) return [];
  const had = new Set((await prisma.supplierBrand.findMany({ where: { supplierId, brandId: { in: ids } }, select: { brandId: true } })).map((l) => l.brandId));
  const fresh = ids.filter((id) => !had.has(id));
  if (fresh.length) await prisma.supplierBrand.createMany({ data: fresh.map((brandId) => ({ supplierId, brandId })), skipDuplicates: true });
  return fresh;
}

/**
 * Решения по брендам фида: выбор владельца, иначе автоподсказка (бренд из фида или бренд поставщика по умолчанию).
 * create — создать новые бренды (при применении); без него у нового бренда временный код «new:<название>».
 */
async function resolveBrands(supplier: { id: string; defaultBrand: string | null }, parsed: FeedParseResult, create: boolean) {
  const [brands, stored] = await Promise.all([prisma.brand.findMany({ select: { id: true, name: true } }), readBrandStored(supplier.id)]);
  const mapping = new Map<string, BrandDecision>();
  const rows: BrandRow[] = [];
  const createdBrands: string[] = [];
  for (const v of countVendors(parsed.items)) {
    const suggested = suggestBrand(v.key === NO_BRAND_KEY ? null : v.name, brands, supplier.defaultBrand);
    let decision = decideBrand(stored.get(v.key), suggested);
    if (create && decision.kind === "brand" && decision.brandId?.startsWith(NEW_BRAND_PREFIX)) {
      const b = await findOrCreateBrand(decision.brandId.slice(NEW_BRAND_PREFIX.length));
      if (b.created) createdBrands.push(b.id);
      decision = { kind: "brand", brandId: b.id };
    }
    mapping.set(v.key, decision);
    rows.push({ key: v.key, name: v.name, count: v.count, decision, suggested, overridden: stored.has(v.key) });
  }
  return { mapping, rows, createdBrands };
}

/** Сохраняет выбор владельца по веткам фида. auto — вернуть автоподсказку. */
export async function saveMapping(supplierId: string, choices: Record<string, MappingChoice>) {
  for (const [key, choice] of Object.entries(choices)) {
    if (!key) continue;
    if (choice.kind === "auto") {
      await prisma.feedCategoryMap.deleteMany({ where: { supplierId, path: key } });
    } else if (choice.kind === "skip") {
      await prisma.feedCategoryMap.upsert({
        where: { supplierId_path: { supplierId, path: key } },
        update: { skip: true, categoryId: null },
        create: { supplierId, path: key, skip: true, categoryId: null },
      });
    } else {
      let categoryId: string;
      if (choice.kind === "new") {
        const name = choice.name.trim();
        categoryId = slugify(name);
        if (!name || !categoryId) throw new ImportUserError("У новой категории должно быть название.");
        await prisma.category.upsert({
          where: { id: categoryId },
          update: {},
          create: { id: categoryId, nameUk: name, nameRu: name, sort: 100 },
        });
      } else {
        categoryId = choice.categoryId;
        const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
        if (!cat) throw new ImportUserError(`Категория «${categoryId}» не найдена.`);
      }
      await prisma.feedCategoryMap.upsert({
        where: { supplierId_path: { supplierId, path: key } },
        update: { skip: false, categoryId },
        create: { supplierId, path: key, skip: false, categoryId },
      });
    }
  }
}

// ---------- построение плана ----------

async function loadExisting(supplierId: string, skus: string[]): Promise<Map<string, ExistingProduct>> {
  const rows = await prisma.product.findMany({
    where: { OR: [{ supplierId }, { sku: { in: skus } }] },
    include: {
      images: { orderBy: { sort: "asc" }, select: { url: true } },
      attributes: { orderBy: { sort: "asc" }, select: { key: true, value: true } },
      fieldLocks: { select: { fieldName: true } },
    },
  });
  const out = new Map<string, ExistingProduct>();
  for (const r of rows) {
    out.set(r.sku, {
      id: r.id, sku: r.sku, nameUk: r.nameUk, nameRu: r.nameRu, descUk: r.descUk, descRu: r.descRu,
      price: r.price.toNumber(), oldPrice: r.oldPrice?.toNumber() ?? null, supplierPrice: r.supplierPrice?.toNumber() ?? null,
      categoryId: r.categoryId, brandId: r.brandId, supplierId: r.supplierId, supplierAvailable: r.supplierAvailable,
      articleCode: r.articleCode, supplierUrl: r.supplierUrl, visible: r.visible, priceConflict: r.priceConflict,
      missingFromFeedSince: r.missingFromFeedSince, source: r.source, locked: new Set(r.fieldLocks.map((l) => l.fieldName)),
      pictures: r.images.map((i) => i.url), params: r.attributes.map((a) => ({ name: a.key, value: a.value })),
    });
  }
  return out;
}

function buildTree(parsed: FeedParseResult, stored: StoredMapping): TreeRow[] {
  const counts = new Map<string, { path: string[]; count: number }>();
  let noCategory = 0;
  for (const item of parsed.items) {
    if (!item.categoryPath) {
      noCategory++;
      continue;
    }
    for (let d = 1; d <= Math.min(2, item.categoryPath.length); d++) {
      const p = item.categoryPath.slice(0, d);
      const key = p.join(PATH_SEP);
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { path: p, count: 1 });
    }
  }
  const rows: TreeRow[] = [];
  for (const [key, { path: p, count }] of counts) {
    rows.push({
      key, name: p[p.length - 1], depth: p.length, count,
      decision: toTreeDecision(decideCategory(p, stored)),
      suggested: toTreeDecision(decideCategory(p, new Map())),
      overridden: stored.has(key),
    });
  }
  if (noCategory) {
    rows.push({
      key: NO_CATEGORY_PATH, name: NO_CATEGORY_PATH, depth: 1, count: noCategory,
      decision: toTreeDecision(decideCategory(null, stored)),
      suggested: toTreeDecision(decideCategory(null, new Map())),
      overridden: stored.has(NO_CATEGORY_PATH),
    });
  }
  // порядок: как в фиде по алфавиту, родитель перед детьми
  return rows.sort((a, b) => a.key.localeCompare(b.key, "uk"));
}

function makeReport(
  plan: ImportPlan, existing: Map<string, ExistingProduct>, parsed: FeedParseResult, tree: TreeRow[], newCategories: string[],
  extra: { brands: BrandRow[]; supplierId: string },
): ImportReport {
  const priceChanges: ImportReport["priceChanges"] = [];
  const needConfirm: PriceJump[] = [];
  const conflicts: ImportReport["conflicts"] = [];
  const skipped: ImportReport["skipped"] = [];
  for (const p of plan.items) {
    if (p.action === "skip") {
      if (skipped.length < CAP.skipped) skipped.push({ sku: p.sku, name: p.name, reason: p.reason });
    } else if (p.action !== "create") {
      if (p.priceLog) {
        const pct = p.priceLog.oldPrice > 0 ? ((p.priceLog.newPrice - p.priceLog.oldPrice) / p.priceLog.oldPrice) * 100 : 0;
        priceChanges.push({ sku: p.sku, name: p.item.name, oldPrice: p.priceLog.oldPrice, newPrice: p.priceLog.newPrice, pct: Math.round(pct * 10) / 10 });
      }
      if (p.jump && needConfirm.length < CAP.needConfirm) needConfirm.push(p.jump);
      if (p.conflict && conflicts.length < CAP.conflicts) {
        const cur = existing.get(p.sku)!;
        conflicts.push({ sku: p.sku, name: p.item.name, price: cur.price, supplierPrice: p.item.price });
      }
    }
  }
  priceChanges.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return {
    feedInfo: { date: parsed.info.date, currency: parsed.info.currency, totalRows: parsed.info.totalRows },
    issues: parsed.issues.slice(0, CAP.issues),
    needConfirm,
    priceChanges: priceChanges.slice(0, CAP.priceChanges),
    conflicts,
    skipped,
    missing: plan.missing.slice(0, CAP.missing).map((m) => ({ sku: m.sku, reason: m.reason })),
    newCategories,
    errors: [],
    tree,
    brands: extra.brands,
    supplierProducts: [...existing.values()].filter((e) => e.supplierId === extra.supplierId && e.source === "FEED").length,
  };
}

function newCategoryNames(plan: ImportPlan, known: Set<string>): string[] {
  const names = new Set<string>();
  for (const p of plan.items) {
    if (p.action === "skip") continue;
    if (p.placement.topNewName && !known.has(p.placement.topId)) names.add(p.placement.topNewName);
  }
  return [...names];
}

async function computePlan(supplierId: string, parsed: FeedParseResult, approved: ReadonlySet<string>, createBrands = false) {
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const brands = await resolveBrands(supplier, parsed, createBrands);
  const stored = await readStored(supplierId);
  const existing = await loadExisting(supplierId, parsed.items.map((i) => i.sku));
  const plan = planImport(
    parsed.items, existing,
    { supplierId, markupPct: supplier.markupPct, jumpPct: 30, brandId: null, brands: brands.mapping, stored, approvedSkus: approved, now: new Date() },
    { totalRows: parsed.info.totalRows, issues: parsed.issues.length },
  );
  const cats = await prisma.category.findMany({ select: { id: true } });
  return { supplier, stored, existing, plan, brands, knownCategories: new Set(cats.map((c) => c.id)) };
}

// ---------- проверка ----------

export async function startPreview(input: { supplierId: string; source: ImportSource; who: string }): Promise<string> {
  const bytes = input.source.kind === "url" ? await fetchFeedBytes(input.source.url) : input.source.bytes;
  if (bytes.length > MAX_FEED_BYTES) throw new ImportUserError("Файл фида слишком большой (более 200 МБ).");
  const parsed = parseOrThrow(bytes);

  const run = await prisma.importRun.create({
    data: {
      supplierId: input.supplierId,
      sourceKind: input.source.kind,
      sourceRef: input.source.kind === "url" ? input.source.url : input.source.name,
      status: "PREVIEW",
      who: input.who,
    },
  });
  const file = await saveFeedFile(run.id, bytes);
  await prisma.importRun.update({ where: { id: run.id }, data: { feedFile: file } });
  cacheParsed(run.id, parsed);
  await refreshPreview(run.id);
  await pruneFeedFiles(input.supplierId);
  return run.id;
}

/** Пересчитать проверку по сохранённому файлу (после смены сопоставления или подтверждения скачков цен). */
export async function refreshPreview(runId: string) {
  const run = await prisma.importRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "PREVIEW") throw new ImportUserError("Эта проверка уже применена. Запустите новую.");
  const parsed = await loadParsed(run);
  const { stored, existing, plan, brands, knownCategories } = await computePlan(run.supplierId, parsed, new Set());
  const tree = buildTree(parsed, stored);
  const report = makeReport(plan, existing, parsed, tree, newCategoryNames(plan, knownCategories), { brands: brands.rows, supplierId: run.supplierId });
  await prisma.importRun.update({
    where: { id: runId },
    data: {
      summary: plan.summary as unknown as Prisma.InputJsonValue,
      report: report as unknown as Prisma.InputJsonValue,
      total: plan.summary.created + plan.summary.updated,
      progress: 0,
    },
  });
}

// ---------- применение ----------

/** Запускает применение в фоне и сразу возвращает управление; ход виден в ImportRun (status, progress). */
export async function startApply(input: { runId: string; approvedSkus: string[]; who: string; afterDone?: (summary: ImportSummary) => Promise<void> }) {
  const claimed = await prisma.importRun.updateMany({
    where: { id: input.runId, status: "PREVIEW" },
    data: { status: "RUNNING", progress: 0, startedAt: new Date(), who: input.who },
  });
  if (claimed.count !== 1) throw new ImportUserError("Эту проверку уже применили или она устарела. Запустите новую.");
  void executeApply(input.runId, new Set(input.approvedSkus), input.who, input.afterDone).catch(async (e) => {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.importRun.update({ where: { id: input.runId }, data: { status: "FAILED", error: message, finishedAt: new Date() } }).catch(() => {});
  });
}

/** Создаёт недостающие категории; возвращает коды созданных. */
async function ensureCategories(plan: ImportPlan, known: Set<string>): Promise<string[]> {
  const tops = new Map<string, string>();
  const levels: Map<string, { id: string; name: string; parentId: string }>[] = [new Map(), new Map()];
  for (const p of plan.items) {
    if (p.action === "skip") continue;
    const pl: CategoryPlacement = p.placement;
    if (pl.topNewName && !known.has(pl.topId)) tops.set(pl.topId, pl.topNewName);
    let parent = pl.topId;
    pl.subs.forEach((s, i) => {
      if (!known.has(s.id)) levels[i]?.set(s.id, { id: s.id, name: s.name, parentId: parent });
      parent = s.id;
    });
  }
  if (tops.size) {
    await prisma.category.createMany({ data: [...tops].map(([id, name]) => ({ id, nameUk: name, nameRu: name, sort: 100 })), skipDuplicates: true });
  }
  for (const lvl of levels) {
    if (!lvl.size) continue;
    await prisma.category.createMany({ data: [...lvl.values()].map((c) => ({ id: c.id, nameUk: c.name, nameRu: c.name, parentId: c.parentId })), skipDuplicates: true });
  }
  return [...tops.keys(), ...levels.flatMap((l) => [...l.keys()])];
}

type UndoRow = { runId: string; productId: string; kind: "created" | "updated"; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue };

/** Значение поля товара для записи отката (JSON): даты — строкой ISO. */
const undoVal = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);

/** Прежние и новые значения полей, которые меняет импорт (для отмены загрузки). */
function undoDiff(cur: ExistingProduct, changes: Record<string, unknown>) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) {
    before[k] = undoVal((cur as unknown as Record<string, unknown>)[k]);
    after[k] = undoVal(v);
  }
  return { before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue };
}

async function executeApply(runId: string, approved: ReadonlySet<string>, who: string, afterDone?: (s: ImportSummary) => Promise<void>) {
  const run = await prisma.importRun.findUniqueOrThrow({ where: { id: runId } });
  const parsed = await loadParsed(run);
  await ensureSystemCategories();
  const { existing, plan, brands, knownCategories } = await computePlan(run.supplierId, parsed, approved, true);
  const createdCategories = await ensureCategories(plan, knownCategories);
  const allCats = new Set((await prisma.category.findMany({ select: { id: true } })).map((c) => c.id));

  // что сделано с товарами — пишем по ходу, чтобы загрузку можно было отменить даже после сбоя
  const undo: UndoRow[] = [];
  const flushUndo = async () => {
    while (undo.length) await prisma.importUndo.createMany({ data: undo.splice(0, 500) });
  };

  const errors: ImportReport["errors"] = [];
  const work = plan.items.filter((p) => p.action === "create" || p.action === "update");
  await prisma.importRun.update({ where: { id: runId }, data: { total: work.length, progress: 0 } });

  let done = 0;
  let created = 0;
  let updated = 0;
  for (const p of work) {
    try {
      if (p.action === "create") {
        if (!allCats.has(p.data.categoryId)) throw new Error(`Категория «${p.data.categoryId}» не существует`);
        const row = await prisma.product.create({
          data: {
            sku: p.sku, source: "FEED", visible: true, ...p.data,
            images: { create: imageRows(p.item.pictures) }, // своя копия подставится сразу, если фото уже скачивали
            attributes: { create: p.item.params.map((a, sort) => ({ key: a.name, value: a.value, sort })) },
          },
          select: { id: true },
        });
        undo.push({ runId, productId: row.id, kind: "created" });
        created++;
      } else if (p.action === "update") {
        const ops: Prisma.PrismaPromise<unknown>[] = [];
        if (Object.keys(p.changes).length) ops.push(prisma.product.update({ where: { id: p.productId }, data: p.changes }));
        if (p.priceLog) ops.push(prisma.priceLog.create({ data: { productId: p.productId, oldPrice: p.priceLog.oldPrice, newPrice: p.priceLog.newPrice, source: "IMPORT", who } }));
        if (p.replacePictures) {
          ops.push(prisma.productImage.deleteMany({ where: { productId: p.productId } }));
          ops.push(prisma.productImage.createMany({ data: imageRows(p.replacePictures).map((r) => ({ ...r, productId: p.productId })) }));
        }
        if (p.replaceParams) {
          ops.push(prisma.productAttribute.deleteMany({ where: { productId: p.productId } }));
          ops.push(prisma.productAttribute.createMany({ data: p.replaceParams.map((a, sort) => ({ productId: p.productId, key: a.name, value: a.value, sort })) }));
        }
        if (ops.length) await prisma.$transaction(ops);
        const cur = existing.get(p.sku);
        // фото и характеристики тоже в журнал: иначе отмена загрузки чужого файла оставит товарам чужие фото
        const diff: Record<string, unknown> = { ...p.changes };
        if (p.replacePictures) diff.pictures = p.replacePictures;
        if (p.replaceParams) diff.params = p.replaceParams;
        if (cur && Object.keys(diff).length) undo.push({ runId, productId: p.productId, kind: "updated", ...undoDiff(cur, diff) });
        updated++;
      }
    } catch (e) {
      if (errors.length < CAP.errors) errors.push({ sku: p.sku, message: e instanceof Error ? e.message.split("\n").pop()!.trim() : String(e) });
    }
    done++;
    if (done % 25 === 0) {
      await prisma.importRun.update({ where: { id: runId }, data: { progress: done } });
      if (undo.length >= 200) await flushUndo();
    }
  }
  await flushUndo();

  // пропавшие из фида: одинаковые изменения применяем пачками
  const groups = new Map<string, { ids: string[]; data: Prisma.ProductUpdateManyMutationInput }>();
  for (const m of plan.missing) {
    const key = JSON.stringify(m.changes);
    const g = groups.get(key) ?? { ids: [], data: m.changes as Prisma.ProductUpdateManyMutationInput };
    g.ids.push(m.productId);
    groups.set(key, g);
    const cur = existing.get(m.sku);
    if (cur) undo.push({ runId, productId: m.productId, kind: "updated", ...undoDiff(cur, m.changes) });
  }
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 500) {
      await prisma.product.updateMany({ where: { id: { in: g.ids.slice(i, i + 500) } }, data: g.data });
    }
  }
  await flushUndo();

  // поставщик возит бренды загруженных товаров
  const usedBrands = new Set<string>();
  for (const p of plan.items) {
    if (p.action === "create" && p.data.brandId) usedBrands.add(p.data.brandId);
    if (p.action === "update" || p.action === "unchanged") {
      const d = brands.mapping.get(vendorKey(p.item.vendor));
      if (d?.kind === "brand" && d.brandId) usedBrands.add(d.brandId);
    }
  }
  const addedBrandLinks = await linkSupplierBrands(run.supplierId, usedBrands);

  const tree = buildTree(parsed, await readStored(run.supplierId));
  const report = makeReport(plan, existing, parsed, tree, [], { brands: brands.rows, supplierId: run.supplierId });
  report.errors = errors;
  report.createdCategories = createdCategories;
  report.createdBrands = brands.createdBrands;
  report.addedBrandLinks = addedBrandLinks;
  const summary: ImportSummary = { ...plan.summary, created, updated, errors: errors.length };
  await prisma.importRun.update({
    where: { id: runId },
    data: {
      status: "DONE", progress: work.length, finishedAt: new Date(),
      summary: summary as unknown as Prisma.InputJsonValue,
      report: report as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.auditLog.create({ data: { who, action: "import.apply", target: runId, details: summary as unknown as Prisma.InputJsonValue } });
  if (afterDone) await afterDone(summary).catch(() => {});
}

// ---------- журнал ----------

/** Прерванные (сервер перезапускали) запуски помечаем ошибкой, чтобы экран не ждал вечно. */
async function failStale(supplierId?: string) {
  await prisma.importRun.updateMany({
    where: { status: "RUNNING", ...(supplierId ? { supplierId } : {}), startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: "FAILED", error: "Импорт был прерван (перезапуск сервера). Запустите проверку заново.", finishedAt: new Date() },
  });
}

export async function getRun(runId: string) {
  await failStale();
  return prisma.importRun.findUnique({ where: { id: runId }, include: { supplier: { select: { id: true, name: true } } } });
}

/** Журнал загрузок: одного поставщика или всех (supplierId не задан). */
export async function listRuns(supplierId?: string, take = 10) {
  await failStale(supplierId);
  return prisma.importRun.findMany({
    where: supplierId ? { supplierId } : {},
    orderBy: { startedAt: "desc" },
    take,
    select: {
      id: true, sourceKind: true, sourceRef: true, status: true, summary: true, error: true, who: true, startedAt: true, finishedAt: true,
      undoneAt: true, supplier: { select: { id: true, name: true } },
    },
  });
}

// Нова Пошта: справочник городов и отделений/почтоматов для оформления заказа (запросы только с сервера).
// Поиск городов и отделений работает и без ключа; ключ NOVAPOSHTA_KEY (в .env) понадобится для ТТН (Этап 3).
// Кэш в памяти сервера на сутки: весь список отделений города (у Одеси ~1800 точек) грузится один раз.
// Если НП не отвечает — функции возвращают null, и в оформлении поля работают как обычный текст.
// В тестах сеть не нужна: setNovaPoshtaFetch() подставляет заглушку.

const API = "https://api.novaposhta.ua/v2.0/json/";
const DAY = 24 * 60 * 60 * 1000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ json(): Promise<unknown> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);

/** Для тестов: подменить запросы к НП (null — вернуть обычный fetch). Кэш очищается. */
export function setNovaPoshtaFetch(f: FetchLike | null) {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
  cities.clear();
  points.clear();
}

type NpResponse<T> = { success?: boolean; data?: T[]; errors?: string[] };

async function call<T>(calledMethod: string, methodProperties: Record<string, string>): Promise<T[] | null> {
  try {
    const res = await fetchImpl(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: process.env.NOVAPOSHTA_KEY ?? "", modelName: "Address", calledMethod, methodProperties }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json()) as NpResponse<T>;
    if (!j?.success || !Array.isArray(j.data)) {
      console.error("[novaposhta]", calledMethod, "ошибка:", (j?.errors ?? []).join("; ").slice(0, 200));
      return null;
    }
    return j.data;
  } catch (e) {
    console.error("[novaposhta]", calledMethod, "не отвечает:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Небольшой кэш с ограничением размера (старые записи вытесняются). */
class TtlCache<V> {
  private m = new Map<string, { at: number; v: V }>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e || Date.now() - e.at > DAY) return undefined;
    return e.v;
  }
  set(k: string, v: V) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value!);
    this.m.set(k, { at: Date.now(), v });
  }
  clear() {
    this.m.clear();
  }
}

// ---------- города ----------

export type NpCity = {
  /** код города для отделений (DeliveryCity) */
  ref: string;
  /** «м. Одеса, Одеська обл.» */
  name: string;
  /** сколько отделений и почтоматов */
  warehouses: number;
};

type RawSettlement = { Present?: string; DeliveryCity?: string; Warehouses?: number | string };
const cities = new TtlCache<NpCity[]>(500);

/** Поиск города по началу названия («Оде» → «м. Одеса, Одеська обл.»). null — НП не отвечает. */
export async function npCities(query: string): Promise<NpCity[] | null> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 40);
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = cities.get(key);
  if (hit) return hit;
  const data = await call<{ Addresses?: RawSettlement[] }>("searchSettlements", { CityName: q, Limit: "20", Page: "1" });
  if (!data) return null;
  const list = (data[0]?.Addresses ?? [])
    .map((a) => ({ ref: String(a.DeliveryCity ?? ""), name: String(a.Present ?? ""), warehouses: Number(a.Warehouses) || 0 }))
    .filter((c) => c.ref && c.name)
    .slice(0, 12);
  cities.set(key, list);
  return list;
}

// ---------- отделения и почтоматы ----------

export type NpPointKind = "warehouse" | "postomat";
export type NpPoint = { ref: string; number: string; kind: NpPointKind; uk: string; ru: string };

type RawWarehouse = { Ref?: string; Number?: string; Description?: string; DescriptionRu?: string; CategoryOfWarehouse?: string; WarehouseStatus?: string };
const points = new TtlCache<NpPoint[]>(60);
const REF = /^[0-9a-f-]{36}$/i;

/** Все работающие отделения и почтоматы города (из кэша или одним запросом). */
async function cityPoints(cityRef: string): Promise<NpPoint[] | null> {
  if (!REF.test(cityRef)) return [];
  const hit = points.get(cityRef);
  if (hit) return hit;
  const data = await call<RawWarehouse>("getWarehouses", { CityRef: cityRef, Limit: "5000", Page: "1" });
  if (!data) return null;
  const list: NpPoint[] = data
    .filter((w) => w.Ref && w.Description && (w.WarehouseStatus ?? "Working") === "Working")
    .map((w) => ({
      ref: String(w.Ref), number: String(w.Number ?? ""),
      kind: w.CategoryOfWarehouse === "Postomat" ? "postomat" : "warehouse",
      uk: String(w.Description), ru: String(w.DescriptionRu || w.Description),
    }));
  list.sort((a, b) => Number(a.number) - Number(b.number) || a.uk.localeCompare(b.uk, "uk"));
  points.set(cityRef, list);
  return list;
}

/**
 * Отделения (или почтоматы) города для выпадающего списка: по номеру («12» → №12, №120…) или по улице («Богдан»).
 * Не больше `limit`. null — НП не отвечает.
 */
export async function npPoints(cityRef: string, kind: NpPointKind, query = "", limit = 30): Promise<NpPoint[] | null> {
  const all = await cityPoints(cityRef);
  if (!all) return null;
  const q = query.replace(/[№#]/g, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60);
  const ofKind = all.filter((p) => p.kind === kind);
  if (!q) return ofKind.slice(0, limit);
  if (/^\d+$/.test(q)) {
    const exact = ofKind.filter((p) => p.number === q);
    const starts = ofKind.filter((p) => p.number !== q && p.number.startsWith(q));
    return [...exact, ...starts].slice(0, limit);
  }
  const words = q.split(" ");
  return ofKind.filter((p) => words.every((w) => p.uk.toLowerCase().includes(w) || p.ru.toLowerCase().includes(w))).slice(0, limit);
}

/** Отделение по коду (проверка на сервере при заказе). undefined — такого нет; null — НП не отвечает. */
export async function npPointByRef(cityRef: string, ref: string): Promise<NpPoint | undefined | null> {
  const all = await cityPoints(cityRef);
  if (!all) return null;
  return all.find((p) => p.ref === ref);
}

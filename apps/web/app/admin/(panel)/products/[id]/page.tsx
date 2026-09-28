import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { loadCategories, money } from "@/lib/catalog";
import { SubmitButton } from "../../import/client-bits";
import { Gallery } from "./gallery";
import { stockByWarehouse } from "@handyman/db/warehouses";
import {
  acceptPriceAction, addCompatAction, addQtyPriceAction, deleteQtyPriceAction, removeCompatAction, saveProductAction, setFlagsAction, setOwnStockAction, unlockFieldAction,
} from "../actions";
import { compatOfProduct, listCompatGroups, qtyRulesOf } from "@handyman/db/storefront-plus";
import { TIER_RU, type TierKey } from "@handyman/core/shop";

export const dynamic = "force-dynamic";

const FIELD_RU: Record<string, string> = {
  nameUk: "Название (укр.)",
  nameRu: "Название (рус.)",
  descUk: "Описание (укр.)",
  descRu: "Описание (рус.)",
  price: "Цена",
  oldPrice: "Старая цена",
  categoryId: "Категория",
  visible: "Видимость на сайте",
  brandId: "Бренд",
  supplierId: "Поставщик",
};

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requirePermission("products.view");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const can = (perm: string) => (session.permissions as string[]).includes(perm);

  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sort: "asc" } },
      attributes: { orderBy: { sort: "asc" } },
      fieldLocks: { orderBy: { lockedAt: "desc" } },
      brand: true,
      supplier: true,
      priceLogs: { orderBy: { ts: "desc" }, take: 15 },
      stockItems: { select: { onHand: true } },
    },
  });
  if (!p) notFound();
  const [cats, brands, suppliers, stock, qty, compat, groups] = await Promise.all([
    loadCategories(), prisma.brand.findMany({ orderBy: { name: "asc" } }), prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), stockByWarehouse(p.id), qtyRulesOf(p.id), compatOfProduct(p.id), listCompatGroups(),
  ]);
  const canEdit = can("products.edit");
  const canPrices = can("prices.edit");
  const price = p.price.toNumber();
  const supplierPrice = p.supplierPrice?.toNumber() ?? null;
  const purchase = p.purchasePrice?.toNumber() ?? null;
  // Закупочная цена и заработок — деньги: видит только тот, у кого есть право «Цены» (ТЗ: деньги и маржу видит владелец).
  const canSeePurchase = can("prices.view") || can("prices.edit");
  const belowRrp = supplierPrice != null && price < supplierPrice - 0.005;
  const lockedFields = new Set(p.fieldLocks.map((l) => l.fieldName));
  const mark = (f: string) => (lockedFields.has(f) ? " 🔒" : "");
  const own = p.stockItems.reduce((a, x) => a + x.onHand, 0);

  return (
    <>
      <p><Link className="adm-link" href="/admin/products">← К списку товаров</Link></p>
      <h1>{p.nameUk}</h1>
      <p className="adm-muted">
        Артикул {p.sku}
        {p.articleCode ? ` · код ${p.articleCode}` : ""} · {p.supplier ? `поставщик ${p.supplier.name}` : "без поставщика"}
        {p.supplierUrl ? <> · <a className="adm-link" href={p.supplierUrl} target="_blank" rel="noreferrer">страница у поставщика</a></> : null}
      </p>
      <div className="adm-row" style={{ gap: 6, margin: "8px 0" }}>
        {own > 0 && <span className="adm-chip ok">на нашем складе: {own} шт.</span>}
        {p.isHit && <span className="adm-chip warn">хит</span>}
        {p.isNew && <span className="adm-chip warn">новинка</span>}
        <span className={p.supplierAvailable ? "adm-chip ok" : "adm-chip"}>{p.supplierAvailable ? "В наличии у поставщика" : "Под заказ"}</span>
        {!p.visible && <span className="adm-chip bad">скрыт с сайта</span>}
        {p.missingFromFeedSince && <span className="adm-chip warn">нет в фиде с {p.missingFromFeedSince.toLocaleDateString("ru-RU")}</span>}
        {belowRrp && <span className="adm-chip warn">цена ниже РРЦ поставщика</span>}
      </div>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      {p.priceConflict && supplierPrice != null && (
        <div className="adm-card" style={{ borderColor: "var(--adm-warn)" }}>
          <b>Расхождение цен.</b> Ваша цена {money(price)}, цена поставщика (РРЦ) {money(supplierPrice)}. Импорт вашу цену не меняет.
          {canPrices ? (
            <form action={acceptPriceAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={p.id} />
              <SubmitButton>Принять цену поставщика ({money(supplierPrice)})</SubmitButton>
            </form>
          ) : null}
        </div>
      )}

      <form action={setOwnStockAction} className="adm-card">
        <input type="hidden" name="id" value={p.id} />
        <div className="adm-row" style={{ alignItems: "flex-end" }}>
          {stock.map((w) => (
            <div key={w.id} className="adm-field" style={{ margin: 0 }}>
              <label htmlFor={`stock-${w.id}`}>{stock.length > 1 ? `${w.name}, шт.` : "На нашем складе (Одесса), шт."}</label>
              <input id={`stock-${w.id}`} name={`stock.${w.id}`} className="adm-input" inputMode="numeric" defaultValue={String(w.onHand)} style={{ width: 120 }} disabled={!canEdit} />
            </div>
          ))}
          {canEdit && <SubmitButton pendingText="Сохраняю…">Сохранить остаток</SubmitButton>}
        </div>
        <p className="adm-muted" style={{ marginTop: 6 }}>
          Больше 0 — на сайте «В наявності в Одесі», товар выше в списках и попадает в фильтр «Швидка відправка з Одеси». 0 — берём у поставщика
          («Відправка за 3–4 дні») или «Під замовлення». При заказе остаток уменьшается сам, при отмене заказа — возвращается.
        </p>
      </form>

      <form action={setFlagsAction} className="adm-card">
        <input type="hidden" name="id" value={p.id} />
        <div className="adm-row">
          <b>Отметки на сайте:</b>
          <label className="adm-row" style={{ gap: 6 }}><input type="checkbox" name="isHit" defaultChecked={p.isHit} disabled={!canEdit} /> Хит</label>
          <label className="adm-row" style={{ gap: 6 }}><input type="checkbox" name="isNew" defaultChecked={p.isNew} disabled={!canEdit} /> Новинка</label>
          {canEdit && <SubmitButton pendingText="Сохраняю…">Сохранить отметки</SubmitButton>}
        </div>
        <p className="adm-muted" style={{ marginTop: 6 }}>Хиты и новинки показываются на главной (если блоки включены в «Сайт → Главная») и со значком на карточке товара. Импорт отметки не трогает.</p>
      </form>

      <div className="adm-card">
        <b>Опт и упаковка</b>
        <p className="adm-muted" style={{ margin: "4px 0 8px" }}>
          Цена за штуку сама снижается в корзине, когда покупатель берёт нужное количество (считает сервер). Упаковка работает так же: взяли 10 шт. —
          цена за штуку как в упаковке, а на странице товара появляется кнопка «У кошик 10 шт.». Цена «только для уровня» (например, «Опт») видна
          только таким покупателям после входа в кабинет и в заказе по звонку. Импорт эти цены не трогает.
        </p>
        {qty.breaks.length + qty.packs.length > 0 ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Что</th><th className="num">От, шт.</th><th className="num">За штуку</th><th>Для кого</th><th aria-label="Действие" /></tr></thead>
              <tbody>
                {qty.breaks.map((b) => (
                  <tr key={b.id}>
                    <td>Опт</td><td className="num">{b.minQty}</td><td className="num">{money(b.pricePerUnit)}</td>
                    <td>{b.clientTier ? `только уровень «${TIER_RU[b.clientTier as TierKey]}»` : "все покупатели"}</td>
                    <td className="num">{canPrices && (
                      <form action={deleteQtyPriceAction}>
                        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="break" /><input type="hidden" name="ruleId" value={b.id} />
                        <SubmitButton pendingText="…">Удалить</SubmitButton>
                      </form>
                    )}</td>
                  </tr>
                ))}
                {qty.packs.map((k) => (
                  <tr key={k.id}>
                    <td>Упаковка «{k.unitLabel}» за {money(k.packPrice)}</td><td className="num">{k.unitsPerPack}</td><td className="num">{money(k.packPrice / k.unitsPerPack)}</td>
                    <td>все покупатели</td>
                    <td className="num">{canPrices && (
                      <form action={deleteQtyPriceAction}>
                        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="pack" /><input type="hidden" name="ruleId" value={k.id} />
                        <SubmitButton pendingText="…">Удалить</SubmitButton>
                      </form>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="adm-muted">Пока нет: цена одна при любом количестве.</p>
        )}
        {canPrices ? (
          <div className="adm-row" style={{ alignItems: "flex-end", marginTop: 8 }}>
            <form action={addQtyPriceAction} className="adm-row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="break" />
              <div className="adm-field" style={{ margin: 0 }}><label htmlFor="qb-min">Опт: от, шт.</label><input id="qb-min" name="minQty" className="adm-input" inputMode="numeric" style={{ width: 90 }} required /></div>
              <div className="adm-field" style={{ margin: 0 }}><label htmlFor="qb-price">Цена за шт., ₴</label><input id="qb-price" name="price" className="adm-input" inputMode="decimal" style={{ width: 110 }} required /></div>
              <div className="adm-field" style={{ margin: 0 }}>
                <label htmlFor="qb-tier">Для кого</label>
                <select id="qb-tier" name="tier" className="adm-select" defaultValue="">
                  <option value="">все покупатели</option>
                  {(["WHOLESALE", "MASTER", "PRO", "LEGEND"] as const).map((k) => <option key={k} value={k}>только уровень «{TIER_RU[k]}»</option>)}
                </select>
              </div>
              <SubmitButton pendingText="…">Добавить опт</SubmitButton>
            </form>
            <form action={addQtyPriceAction} className="adm-row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="pack" />
              <div className="adm-field" style={{ margin: 0 }}><label htmlFor="qp-label">Упаковка</label><input id="qp-label" name="label" className="adm-input" defaultValue="уп." style={{ width: 80 }} /></div>
              <div className="adm-field" style={{ margin: 0 }}><label htmlFor="qp-units">Штук</label><input id="qp-units" name="units" className="adm-input" inputMode="numeric" style={{ width: 80 }} required /></div>
              <div className="adm-field" style={{ margin: 0 }}><label htmlFor="qp-price">Цена упаковки, ₴</label><input id="qp-price" name="price" className="adm-input" inputMode="decimal" style={{ width: 120 }} required /></div>
              <SubmitButton pendingText="…">Добавить упаковку</SubmitButton>
            </form>
          </div>
        ) : (
          <p className="adm-muted">Менять цены может роль с правом «Цены».</p>
        )}
      </div>

      <div className="adm-card">
        <b>Совместимость</b>
        <p className="adm-muted" style={{ margin: "4px 0 8px" }}>
          Группа — общий признак: «Диск 125 мм», «Акумулятор 18 В». Инструмент группы (УШМ 125) и расходники группы (круги 125) подходят друг к другу:
          на странице расходника — «Підходить до», на странице инструмента — «Витратні матеріали», в списках — фильтр «До мого інструменту»
          для покупателей, которые заказывали этот инструмент. Все группы — <Link className="adm-link" href="/admin/compat">«Совместимость»</Link>.
        </p>
        {compat.length > 0 ? (
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            {compat.map((g) => (
              <li key={g.groupId + g.role} style={{ marginBottom: 4 }}>
                <Link className="adm-link" href={`/admin/compat/${g.groupId}`}>{g.label}</Link> — {g.role === "HOST" ? "инструмент" : "расходник / аксессуар"}
                {canEdit && (
                  <form action={removeCompatAction} style={{ display: "inline", marginLeft: 8 }}>
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="groupId" value={g.groupId} /><input type="hidden" name="role" value={g.role} />
                    <SubmitButton pendingText="…">Убрать</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-muted">Товар не входит ни в одну группу.</p>
        )}
        {canEdit && (
          <form action={addCompatAction} className="adm-row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="id" value={p.id} />
            <div className="adm-field" style={{ margin: 0 }}>
              <label htmlFor="cg-role">Этот товар —</label>
              <select id="cg-role" name="role" className="adm-select" defaultValue="ACCESSORY">
                <option value="ACCESSORY">расходник / аксессуар</option>
                <option value="HOST">инструмент</option>
              </select>
            </div>
            <div className="adm-field" style={{ margin: 0 }}>
              <label htmlFor="cg-group">группы</label>
              <select id="cg-group" name="groupId" className="adm-select" defaultValue={groups[0]?.id ?? ""}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                <option value="">+ новая группа…</option>
              </select>
            </div>
            <div className="adm-field" style={{ margin: 0 }}><label htmlFor="cg-new">Новая группа (укр.)</label><input id="cg-new" name="newLabel" className="adm-input" placeholder="Диск 125 мм" style={{ width: 160 }} /></div>
            <div className="adm-field" style={{ margin: 0 }}><label htmlFor="cg-new-ru">(рус.)</label><input id="cg-new-ru" name="newLabelRu" className="adm-input" placeholder="Диск 125 мм" style={{ width: 160 }} /></div>
            <SubmitButton pendingText="…">Добавить</SubmitButton>
          </form>
        )}
      </div>

      <form action={saveProductAction} className="adm-card">
        <input type="hidden" name="id" value={p.id} />
        <fieldset disabled={!canEdit} style={{ border: 0 }}>
          <div className="adm-field">
            <label htmlFor="nameUk">Название (укр.){mark("nameUk")}</label>
            <input id="nameUk" name="nameUk" className="adm-input wide" defaultValue={p.nameUk} required />
          </div>
          <div className="adm-field">
            <label htmlFor="nameRu">Название (рус.){mark("nameRu")}</label>
            <input id="nameRu" name="nameRu" className="adm-input wide" defaultValue={p.nameRu} required />
            <small className="adm-muted">Пока фид только на украинском, русское название — копия. Переведите вручную: перевод защитится от импорта.</small>
          </div>
          <div className="adm-row" style={{ alignItems: "flex-start" }}>
            <div className="adm-field">
              <label htmlFor="price">Цена, ₴{mark("price")}</label>
              <input id="price" name="price" className="adm-input" inputMode="decimal" defaultValue={price} disabled={!canPrices} required />
            </div>
            <div className="adm-field">
              <label htmlFor="oldPrice">Старая цена, ₴{mark("oldPrice")}</label>
              <input id="oldPrice" name="oldPrice" className="adm-input" inputMode="decimal" defaultValue={p.oldPrice?.toNumber() ?? ""} disabled={!canPrices} />
            </div>
            <div className="adm-field">
              <label>Цена поставщика (РРЦ)</label>
              <div style={{ padding: "8px 0" }}>{money(supplierPrice)}</div>
            </div>
            {canSeePurchase && (
              <div className="adm-field">
                <label htmlFor="purchasePrice">Закупочная цена, ₴</label>
                <input id="purchasePrice" name="purchasePrice" className="adm-input" inputMode="decimal" placeholder="не задана" defaultValue={purchase ?? ""} disabled={!canPrices} />
                <small className="adm-muted">Ваша цена покупки у поставщика. Вводится вручную, импорт её не меняет.</small>
              </div>
            )}
          </div>
          {canSeePurchase && purchase != null && (
            <p style={{ marginTop: 0 }}>
              С одной штуки вы зарабатываете <b>{money(price - purchase)}</b> — это {((price - purchase) / price * 100).toFixed(1).replace(".", ",")}% от цены продажи
              {purchase > price ? <span className="adm-chip bad" style={{ marginLeft: 8 }}>продажа ниже закупки!</span> : null}
            </p>
          )}
          {!canPrices && <p className="adm-muted">Менять цены может роль с правом «Цены».</p>}
          <div className="adm-row" style={{ alignItems: "flex-start" }}>
            <div className="adm-field">
              <label htmlFor="categoryId">Категория{mark("categoryId")}</label>
              <select id="categoryId" name="categoryId" className="adm-select" defaultValue={p.categoryId}>
                {cats.flat.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="brandId">Бренд{mark("brandId")}</label>
              <select id="brandId" name="brandId" className="adm-select" defaultValue={p.brandId ?? ""}>
                <option value="">— без бренда —</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="supplierId">Поставщик{mark("supplierId")}</label>
              <select id="supplierId" name="supplierId" className="adm-select" defaultValue={p.supplierId ?? ""}>
                <option value="">— без поставщика —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="adm-field">
            <label>
              <input type="checkbox" name="visible" defaultChecked={p.visible} /> Показывать на сайте{mark("visible")}
            </label>
          </div>
          <div className="adm-field">
            <label htmlFor="descUk">Описание (укр.), HTML{mark("descUk")}</label>
            <textarea id="descUk" name="descUk" className="adm-input wide" rows={8} style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }} defaultValue={p.descUk ?? ""} />
            <small className="adm-muted">Допустимы теги: p, h2–h4, ul/ol/li, b/strong, i/em, br, table, a. Остальное при сохранении будет убрано.</small>
          </div>
          <div className="adm-field">
            <label htmlFor="descRu">Описание (рус.), HTML{mark("descRu")}</label>
            <textarea id="descRu" name="descRu" className="adm-input wide" rows={4} style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }} defaultValue={p.descRu ?? ""} />
            <small className="adm-muted">Если пусто, на русском показывается украинское описание.</small>
          </div>
          {canEdit && <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>}
        </fieldset>
      </form>

      <h2>Ручные правки (защищены от импорта)</h2>
      {p.fieldLocks.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Поле</th><th>Кто и когда</th><th aria-label="Действие" /></tr>
            </thead>
            <tbody>
              {p.fieldLocks.map((l) => (
                <tr key={l.id}>
                  <td>🔒 {FIELD_RU[l.fieldName] ?? l.fieldName}</td>
                  <td className="adm-muted">{l.lockedBy ?? "—"}, {l.lockedAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="num">
                    {canEdit && (
                      <form action={unlockFieldAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="field" value={l.fieldName} />
                        <SubmitButton pendingText="…">Снять защиту</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="adm-muted">Ничего не правилось вручную: все поля обновляются из фида.</p>
      )}

      <h2>История цен</h2>
      {p.priceLogs.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Когда</th><th className="num">Было</th><th className="num">Стало</th><th>Источник</th><th>Кто</th></tr>
            </thead>
            <tbody>
              {p.priceLogs.map((l) => (
                <tr key={l.id}>
                  <td>{l.ts.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="num">{money(l.oldPrice)}</td>
                  <td className="num">{money(l.newPrice)}</td>
                  <td>{{ MANUAL: "вручную", IMPORT: "импорт", SUPPLIER: "принята цена поставщика", BULK: "массово" }[l.source]}</td>
                  <td className="adm-muted">{l.who ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="adm-muted">Цена ещё не менялась.</p>
      )}

      {p.images.length > 0 && (
        <>
          <h2>Фото ({p.images.length})</h2>
          <p className="adm-muted" style={{ marginTop: 0 }}>Нажмите на фото, чтобы открыть его на весь экран. Стрелки клавиатуры листают, Esc закрывает.</p>
          <p className="adm-muted">
            Своих копий: {p.images.filter((im) => im.localUrl).length} из {p.images.length}
            {p.images.some((im) => !im.localUrl && im.localError) && (
              <> · не удалось скачать: {[...new Set(p.images.filter((im) => !im.localUrl && im.localError).map((im) => im.localError))].join("; ")}
                {" "}(повторить — <Link className="adm-link" href="/admin/media">Фото товаров</Link>)</>
            )}
          </p>
          <Gallery images={p.images.map((im) => im.localUrl ?? im.url)} name={p.nameUk} />
        </>
      )}

      {p.attributes.length > 0 && (
        <>
          <h2>Характеристики ({p.attributes.length})</h2>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <tbody>
                {p.attributes.map((a) => (
                  <tr key={a.id}><td className="adm-muted">{a.key}</td><td>{a.value}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

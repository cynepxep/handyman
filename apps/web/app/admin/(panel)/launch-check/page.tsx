// «Проверка перед запуском» (шаг 8.3) — только владелец: что готово к переезду на сервер и открытию сайта, а что нет.
// Правила — @handyman/core/launch-check, факты — @handyman/db/launch-check. Значения ключей не показываются.
import { launchSummary, type LaunchItem, type LaunchStatus } from "@handyman/core/launch-check";
import { launchCheck, loadIndexing, loadSearchConsole } from "@handyman/db/launch-check";
import { sitemapStats } from "@handyman/db/sitemap";
import { sitemapRootUrl } from "@handyman/core/sitemap";
import { requireOwner } from "@/lib/auth";
import { siteUrl } from "@/lib/shop/content";
import { closeIndexingAction, openIndexingAction, saveSearchConsoleAction } from "./actions";

export const dynamic = "force-dynamic";

const CHIP: Record<LaunchStatus, string> = { ok: "adm-chip ok", fail: "adm-chip bad", warn: "adm-chip warn", info: "adm-chip" };
const WORD: Record<LaunchStatus, string> = { ok: "готово", fail: "не готово", warn: "желательно", info: "не подключено" };

export default async function LaunchCheckPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const [items, indexing, sc, map] = await Promise.all([launchCheck(), loadIndexing(), loadSearchConsole(), sitemapStats().catch(() => null)]);
  const mapUrl = sitemapRootUrl(siteUrl());
  const fmt = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" });
  const sum = launchSummary(items);
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <>
      <h1>Проверка перед запуском</h1>
      <p className="adm-lead">
        Перед переездом на сервер и открытием сайта для покупателей всё с отметкой «не готово» нужно исправить. «Желательно» — не мешает работе,
        но лучше сделать. Часть пунктов (адрес https, ключ шифрования, пароли базы и поиска) можно выполнить только на сервере — на этом компьютере
        они пока «желательно». Список обновляется при каждом открытии страницы. Раздел видит только владелец.
      </p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok" role="status">{sp.ok}</p>}

      <section className="adm-card" aria-labelledby="lc-sum">
        <h2 id="lc-sum" style={{ margin: 0 }}>
          {sum.ready ? <span className="adm-chip ok">можно запускать</span> : <span className="adm-chip bad">пока рано</span>}{" "}
          <span className="adm-muted" style={{ fontSize: 15, fontWeight: 400 }}>
            готово {sum.ok} · не готово {sum.fail} · желательно {sum.warn}{sum.info ? ` · не подключено ${sum.info}` : ""}
          </span>
        </h2>
      </section>

      {groups.map((g) => (
        <section key={g} className="adm-card" aria-label={g}>
          <h2 style={{ marginTop: 0 }}>{g}</h2>
          <ul className="adm-health">
            {items.filter((i) => i.group === g).map((i) => <Row key={i.id} i={i} />)}
          </ul>
        </section>
      ))}

      <section className="adm-card" id="search-console" aria-labelledby="lc-sc">
        <h2 id="lc-sc" style={{ marginTop: 0 }}>Google Search Console и карта сайта</h2>
        <p>
          Карта сайта (<code>sitemap.xml</code>) — список всех страниц магазина для Google: главная, каталог, разделы, задачи, страницы и товары
          на двух языках. Собирается сама, ничего вписывать не нужно.{" "}
          {map ? <>Адресов в ней сейчас: <b>{map.urls}</b> (товаров — {map.products}).</> : "Сейчас посчитать не удалось (база недоступна)."}{" "}
          {/* карта — обычный адрес сайта (не страница админки), поэтому <a>, а не Link */}
          <a href="/sitemap.xml" target="_blank" rel="noreferrer">Посмотреть карту</a>
          {!indexing.open && <span className="adm-muted"> (пока сайт закрыт, её видите только вы — Google получит «нет такой страницы»)</span>}.
        </p>
        <p className="adm-muted">Search Console — бесплатный сервис Google: сколько страниц попало в поиск, по каким запросам находят магазин, какие ошибки. Порядок в день запуска:</p>
        <ol className="adm-muted" style={{ marginTop: 0, paddingLeft: 22 }}>
          <li>Откройте <code>search.google.com/search-console</code> под своим Google-аккаунтом → «Добавить ресурс» → справа «Префикс URL» → впишите адрес сайта (<code>{siteUrl().origin}</code>).</li>
          <li>Способ подтверждения «Тег HTML» → «Копировать». Вставьте скопированное в поле ниже и нажмите «Сохранить» — тег сразу появится на главной.</li>
          <li>Вернитесь в Search Console и нажмите «Подтвердить». Получилось — поставьте ниже отметку «Подтверждено» и сохраните. (Если подтвердили иначе, например записью у регистратора домена, — поле можно оставить пустым и просто поставить отметку.)</li>
          <li>После кнопки «Открыть сайт для Google» (ниже): в Search Console → «Файлы Sitemap» → впишите <code>sitemap.xml</code> → «Отправить». Полный адрес: <code>{mapUrl}</code>.</li>
          <li>Через 1–3 дня — раздел «Страницы»: сколько страниц в поиске и почему остальные нет.</li>
        </ol>
        <form action={saveSearchConsoleAction} style={{ display: "grid", gap: 10, justifyItems: "start", maxWidth: 640 }}>
          <label style={{ display: "grid", gap: 4, width: "100%" }}>
            <span>Код подтверждения (тег из Search Console или только код)</span>
            <input className="adm-input wide" name="code" defaultValue={sc.code ?? ""} maxLength={500} autoComplete="off" spellCheck={false}
              placeholder='<meta name="google-site-verification" content="…" />' />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" name="verified" value="yes" defaultChecked={Boolean(sc.verifiedAt)} style={{ marginTop: 4 }} />
            <span>Подтверждено: Search Console написал «Право собственности подтверждено»</span>
          </label>
          <button className="adm-btn primary" type="submit">Сохранить</button>
          {sc.verifiedAt && <span className="adm-muted">Подтверждено {fmt(sc.verifiedAt)}{sc.by ? ` (${sc.by})` : ""}.</span>}
        </form>
      </section>

      <section className="adm-card" id="indexing" aria-labelledby="lc-idx">
        <h2 id="lc-idx" style={{ marginTop: 0 }}>Открытие сайта для Google</h2>
        <p>
          Сейчас:{" "}
          {indexing.open ? <span className="adm-chip ok">открыт</span> : <span className="adm-chip">закрыт от поисковиков</span>}
          {indexing.at && <span className="adm-muted"> · {indexing.open ? "открыт" : "закрыт"} {new Date(indexing.at).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })}{indexing.by ? ` (${indexing.by})` : ""}</span>}
        </p>
        <p className="adm-muted">
          Пока сайт закрыт, Google и другие поисковики его не показывают (покупатели по прямой ссылке заходят как обычно). Открывать — в день запуска
          на сервере с настоящим доменом, когда выше всё «готово» и тестовые заказы пройдены (<code>docs/LAUNCH-CHECKLIST.md</code>). После открытия
          поисковикам видна витрина (главная, каталог, товары, страницы), а админка, корзина, оформление, поиск и адреса с фильтрами остаются закрыты.
          Закрыть обратно можно в любой момент, но из результатов Google сайт пропадёт не сразу (дни–недели).
        </p>
        {indexing.open ? (
          <form action={closeIndexingAction}>
            <button className="adm-btn" type="submit">Закрыть сайт от поисковиков</button>
          </form>
        ) : (
          <form action={openIndexingAction} style={{ display: "grid", gap: 10, justifyItems: "start" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" name="confirm" value="yes" required style={{ marginTop: 4 }} />
              <span>Понимаю: сайт на настоящем домене, тестовые заказы пройдены — показывать его в Google.</span>
            </label>
            <button className="adm-btn primary" type="submit">Открыть сайт для Google</button>
            {!sum.ready && <span className="adm-muted">В списке выше есть «не готово» — лучше сначала исправить.</span>}
          </form>
        )}
      </section>
    </>
  );
}

function Row({ i }: { i: LaunchItem }) {
  return (
    <li data-check={i.id} data-status={i.status}>
      <span className={CHIP[i.status]}>{WORD[i.status]}</span> <b>{i.title}</b> <span className="adm-muted">— {i.detail}</span>
      {i.fix && i.status !== "ok" && i.status !== "info" && <div className="adm-muted" style={{ marginLeft: 4 }}>Что сделать: {i.fix}</div>}
    </li>
  );
}

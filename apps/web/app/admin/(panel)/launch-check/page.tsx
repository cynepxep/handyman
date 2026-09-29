// «Проверка перед запуском» (шаг 8.3) — только владелец: что готово к переезду на сервер и открытию сайта, а что нет.
// Правила — @handyman/core/launch-check, факты — @handyman/db/launch-check. Значения ключей не показываются.
import { launchSummary, type LaunchItem, type LaunchStatus } from "@handyman/core/launch-check";
import { launchCheck, loadIndexing } from "@handyman/db/launch-check";
import { requireOwner } from "@/lib/auth";
import { closeIndexingAction, openIndexingAction } from "./actions";

export const dynamic = "force-dynamic";

const CHIP: Record<LaunchStatus, string> = { ok: "adm-chip ok", fail: "adm-chip bad", warn: "adm-chip warn", info: "adm-chip" };
const WORD: Record<LaunchStatus, string> = { ok: "готово", fail: "не готово", warn: "желательно", info: "не подключено" };

export default async function LaunchCheckPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const [items, indexing] = await Promise.all([launchCheck(), loadIndexing()]);
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

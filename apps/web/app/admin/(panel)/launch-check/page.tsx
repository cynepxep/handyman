// «Проверка перед запуском» (шаг 8.3) — только владелец: что готово к переезду на сервер и открытию сайта, а что нет.
// Правила — @handyman/core/launch-check, факты — @handyman/db/launch-check. Значения ключей не показываются.
import { launchSummary, type LaunchItem, type LaunchStatus } from "@handyman/core/launch-check";
import { launchCheck } from "@handyman/db/launch-check";
import { requireOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

const CHIP: Record<LaunchStatus, string> = { ok: "adm-chip ok", fail: "adm-chip bad", warn: "adm-chip warn", info: "adm-chip" };
const WORD: Record<LaunchStatus, string> = { ok: "готово", fail: "не готово", warn: "желательно", info: "не подключено" };

export default async function LaunchCheckPage() {
  await requireOwner();
  const items = await launchCheck();
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

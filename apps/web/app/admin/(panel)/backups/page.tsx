// «Резервные копии» (шаг 8.1) — только владелец: список копий, «Сделать копию сейчас», «Проверить восстановление», «Скачать»,
// состояние второй копии в облаке. Копии делает сайт сам каждую ночь (packages/db/src/backups.ts, из runJobs).
import Link from "next/link";
import { BACKUP_KEEP, BACKUP_KIND_RU, formatBytes } from "@handyman/core/backups";
import { backupOverview, type BackupRow } from "@handyman/db/backups";
import { requireOwner } from "@/lib/auth";
import { AutoRefresh, SubmitButton } from "../import/client-bits";
import { backupNowAction, checkNowAction } from "./actions";

export const dynamic = "force-dynamic";

const when = (d: string | Date) => new Date(d).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const nameDate = (name: string) => `${name.slice(8, 10)}.${name.slice(5, 7)}.${name.slice(0, 4)} ${name.slice(11, 13)}:${name.slice(13, 15)}`;
/** Последняя копия старше 26 часов — ночная не сделалась. */
const isStale = (iso: string | undefined) => !iso || Date.now() - Date.parse(iso) > 26 * 3600_000;
function ago(iso: string): string {
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  if (h < 1) return "меньше часа назад";
  if (h < 48) return `${Math.floor(h)} ч назад`;
  return `${Math.floor(h / 24)} дн. назад`;
}

function State({ b }: { b: BackupRow }) {
  if (b.state === "running") return <span className="adm-chip warn">идёт…</span>;
  if (b.state === "broken") return <span className="adm-chip bad">оборвалась</span>;
  if (b.state === "failed") return <span className="adm-chip bad" title={b.manifest?.error}>не получилась</span>;
  return <span className="adm-chip ok">готова</span>;
}

function Checked({ b }: { b: BackupRow }) {
  const c = b.manifest?.check;
  if (!c) return <span className="adm-muted">—</span>;
  return c.ok ? <span className="adm-chip ok" title={when(c.at)}>восстанавливается</span> : <span className="adm-chip bad" title={c.problems.join("; ")}>не прошла</span>;
}

function Offsite({ b }: { b: BackupRow }) {
  const o = b.manifest?.offsite;
  if (!o) return <span className="adm-muted">—</span>;
  return o.ok ? <span className="adm-chip ok">в облаке</span> : <span className="adm-chip bad" title={o.error}>не выгружена</span>;
}

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const o = await backupOverview();
  const last = o.lastOk?.manifest;
  const stale = isStale(last?.finishedAt);
  const lastFailed = o.list[0]?.state === "failed" ? o.list[0] : null;
  const check = o.lastCheck;

  return (
    <>
      {o.running && <AutoRefresh everyMs={3000} />}
      <h1>Резервные копии</h1>
      <p className="adm-lead">
        Каждую ночь (с 03:30) сайт сам сохраняет копию: базу (заказы, клиенты, товары, остатки, настройки), фото товаров и ключ шифрования — без
        этого ключа сохранённые в «Интеграциях» пароли сервисов из копии не восстановить. Хранятся {BACKUP_KEEP.daily} ежедневных и {BACKUP_KEEP.weekly} еженедельных
        копий (и {BACKUP_KEEP.manual} последних сделанных вручную), старые удаляются сами. Раз в неделю сайт пробует восстановить последнюю копию во временную базу;
        если не получилось — приходит сообщение в Telegram. Раздел видит только владелец.
      </p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok" role="status">{sp.ok}</p>}

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Состояние</h2>
        {o.running && (
          <p>
            <span className="adm-chip warn">{o.running.what === "backup" ? "идёт копирование" : "идёт проверка восстановления"}</span>{" "}
            начато {when(o.running.at)} ({o.running.who}). Страница обновится сама.
          </p>
        )}
        <p>
          Последняя копия:{" "}
          {last ? (
            <>
              <b>{nameDate(last.name)}</b> ({ago(last.finishedAt)}) — база {formatBytes(last.db?.size ?? 0)}, фото {last.media?.files ?? 0}{" "}
              {stale ? <span className="adm-chip warn">давно не было</span> : <span className="adm-chip ok">свежая</span>}
            </>
          ) : (
            <span className="adm-chip bad">копий ещё нет</span>
          )}
        </p>
        {lastFailed && (
          <p className="adm-flash err" role="alert">
            Последняя попытка {nameDate(lastFailed.name)} не получилась: {lastFailed.manifest?.error}
          </p>
        )}
        <p>
          Проверка восстановления:{" "}
          {check ? (
            <>
              {check.ok ? <span className="adm-chip ok">прошла</span> : <span className="adm-chip bad">не прошла</span>} {when(check.at)}
              {check.name ? <> — копия {nameDate(check.name)}</> : null}
              {check.ok && check.secrets?.total ? <span className="adm-muted"> · ключи «Интеграций» открываются ({check.secrets.opened} из {check.secrets.total})</span> : null}
              {!check.ok && <><br /><b style={{ color: "var(--adm-warn)" }}>{check.problems.join("; ")}</b></>}
            </>
          ) : (
            <span className="adm-muted">ещё не было (первая — после первой копии, с 04:30)</span>
          )}
        </p>
        <p>
          Вторая копия в облаке:{" "}
          {o.offsite.configured ? (
            <>
              <span className="adm-chip ok">настроена</span> <span className="adm-muted">{o.offsite.endpoint} · корзина {o.offsite.bucket}</span>
              {last?.offsite && !last.offsite.ok && <><br /><b style={{ color: "var(--adm-warn)" }}>Последняя выгрузка не удалась: {last.offsite.error}</b></>}
              {last?.offsite?.ok && last.offsite.mediaLeft ? <span className="adm-muted"> · фото ещё выгружаются: осталось {last.offsite.mediaLeft}</span> : null}
            </>
          ) : (
            <>
              <span className="adm-chip warn">не настроена</span> — копии лежат только на этом компьютере/сервере: если он сломается целиком, пропадут и они.{" "}
              <Link className="adm-link" href="/admin/integrations#backup">Подключить облачное хранилище →</Link>
            </>
          )}
        </p>
        {o.viaError && <p className="adm-flash err" role="alert">{o.viaError}</p>}
        <div className="adm-row">
          <form action={backupNowAction}>
            <SubmitButton primary pendingText="Запускаю…">Сделать копию сейчас</SubmitButton>
          </form>
          {o.lastOk && (
            <form action={checkNowAction}>
              <SubmitButton pendingText="Запускаю…">Проверить восстановление</SubmitButton>
            </form>
          )}
        </div>
      </section>

      <h2>Копии</h2>
      {o.list.length === 0 ? (
        <p className="adm-muted">Копий пока нет. Первая сделается сама ночью или по кнопке «Сделать копию сейчас».</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Какая</th>
                <th>Состояние</th>
                <th>Размер</th>
                <th>Проверка</th>
                <th>Облако</th>
                <th>Скачать</th>
              </tr>
            </thead>
            <tbody>
              {o.list.map((b) => (
                <tr key={b.name}>
                  <td>{nameDate(b.name)}</td>
                  <td>{BACKUP_KIND_RU[b.kind]}{b.manifest?.who && b.kind !== "auto" ? <span className="adm-muted"> · {b.manifest.who}</span> : null}</td>
                  <td>
                    <State b={b} />
                    {b.state === "failed" && b.manifest?.error && <div className="adm-muted" style={{ maxWidth: 320 }}>{b.manifest.error}</div>}
                  </td>
                  <td>{b.size ? formatBytes(b.size) : "—"}</td>
                  <td><Checked b={b} /></td>
                  <td><Offsite b={b} /></td>
                  <td>
                    {b.state === "ok" && (
                      <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
                        {/* файлы — обычная загрузка браузера, не страница: Link здесь не нужен */}
                        <a className="adm-link" href={`/admin/backups/download?name=${encodeURIComponent(b.name)}&file=db`} download>база</a>
                        <a className="adm-link" href={`/admin/backups/download?name=${encodeURIComponent(b.name)}&file=key`} download>ключ</a>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="adm-card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Где лежат и как восстановить</h2>
        <ul style={{ margin: 0, paddingLeft: 18, overflowWrap: "anywhere" }}>
          <li>Копии: <code>{o.dir}</code> (по папке на копию: <code>db.dump</code> — база, <code>secrets.key</code> — ключ шифрования, <code>manifest.json</code> — описание).</li>
          <li>Фото: <code>{o.mediaDir}</code> копируется в <code>{o.dir}/media</code> — каждую ночь только новые файлы.</li>
          <li>Ключ шифрования сайта: {o.keySource === "SECRETS_KEY" ? "переменная SECRETS_KEY в .env" : "файл .data/secrets.key"}. «Скачать → ключ» — это он и есть: храните его так же бережно, как пароль.</li>
          <li>Как делается: {o.via ?? "—"}. Поисковый индекс не копируется — после восстановления пересобирается командой <code>pnpm search:reindex</code>.</li>
          <li>
            Восстановить: остановить сайт и выполнить <code>pnpm backup:restore &lt;копия&gt; --yes</code> — перед этим сайт сам сохранит копию текущей базы.
            Пошагово — в файле <code>docs/BACKUPS.md</code>.
          </li>
        </ul>
      </section>
    </>
  );
}

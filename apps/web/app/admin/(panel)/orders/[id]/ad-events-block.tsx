// Аналитика, шаг А3, в карточке заказа: куда ушла покупка с сервера (Meta, TikTok, GA4) и возврат в GA4 при отмене.
// Только просмотр: повторы — сами (runJobs), после исправления ключа в «Интеграциях» недавние ошибки уходят снова.
import { AD_PLATFORM_RU, type AdPlatform } from "@handyman/core/ad-events";

type Row = { id: string; platform: string; kind: string; state: string; attempts: number; nextTryAt: Date | null; error: string | null; sentAt: Date | null; stub: boolean };

const time = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function stateText(r: Row) {
  if (r.state === "sent") return <span className="adm-chip ok">{r.stub ? "заглушка (ключа нет)" : "принято"}{r.sentAt ? ` · ${time(r.sentAt)}` : ""}</span>;
  if (r.state === "error") {
    return (
      <>
        <span className="adm-chip bad">не ушло{r.nextTryAt ? `, повтор в ${time(r.nextTryAt)}` : ""}</span>
        {r.error && <div className="adm-muted">{r.error}</div>}
      </>
    );
  }
  return <span className="adm-chip warn">{r.state === "sending" ? "отправляется" : "в очереди"}</span>;
}

export function AdEventsBlock({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <section className="adm-card">
      <h2 style={{ marginTop: 0 }}>Реклама: покупка с сервера</h2>
      <p className="adm-muted" style={{ marginTop: 0 }}>
        Кабинеты склеивают её с покупкой из браузера по номеру заказа — дважды не считается. Отмена или возврат заказа уходит в Google Analytics как «возврат».
      </p>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr><th>Кабинет</th><th>Что</th><th>Состояние</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{AD_PLATFORM_RU[r.platform as AdPlatform] ?? r.platform}</td>
                <td>{r.kind === "refund" ? "возврат (отмена заказа)" : "покупка"}</td>
                <td>{stateText(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

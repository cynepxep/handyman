// Отзывы и вопросы о товарах (шаг 5.6): новые ждут проверки и на сайте не видны. Опубликовать / отклонить / ответить / удалить.
import Link from "next/link";
import { listReviewsAdmin } from "@handyman/db/storefront-plus";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { answerAction, deleteAction, moderateAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS = { PENDING: "Ждут проверки", PUBLISHED: "Опубликованные", REJECTED: "Отклонённые" } as const;
type Status = keyof typeof STATUS;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; page?: string; ok?: string; error?: string }> }) {
  await requirePermission("reviews.moderate");
  const sp = await searchParams;
  const status: Status = sp.status === "PUBLISHED" || sp.status === "REJECTED" ? sp.status : "PENDING";
  const kind = sp.kind === "REVIEW" || sp.kind === "QUESTION" ? sp.kind : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await listReviewsAdmin({ status, kind, page });
  const q = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const all = { status, kind, ...p };
    for (const [k, v] of Object.entries(all)) if (v) u.set(k, v);
    return `/admin/reviews?${u}`;
  };
  const here = q({ page: page > 1 ? String(page) : undefined });

  return (
    <>
      <h1>Отзывы и вопросы</h1>
      <p className="adm-lead">
        Покупатели пишут отзывы (оценка, текст, до 3 фото) и задают вопросы на странице товара. Новые <b>не видны на сайте</b>, пока вы их не
        опубликуете. Ответ магазина показывается под отзывом/вопросом и сразу публикует его; если автор вошёл в кабинет через Telegram — ответ
        придёт ему в бота. О каждом новом отзыве приходит сообщение в чат менеджеров.
      </p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}

      <div className="adm-row" style={{ margin: "8px 0" }}>
        {(Object.keys(STATUS) as Status[]).map((s) => (
          <Link key={s} className={`adm-chip${s === status ? " ok" : ""}`} href={q({ status: s, page: undefined })} aria-current={s === status ? "page" : undefined}>
            {STATUS[s]}{s === "PENDING" && data.pending.reviews + data.pending.questions > 0 ? ` (${data.pending.reviews + data.pending.questions})` : ""}
          </Link>
        ))}
        <span className="adm-muted">·</span>
        <Link className={`adm-chip${!kind ? " ok" : ""}`} href={q({ kind: undefined, page: undefined })}>все</Link>
        <Link className={`adm-chip${kind === "REVIEW" ? " ok" : ""}`} href={q({ kind: "REVIEW", page: undefined })}>отзывы</Link>
        <Link className={`adm-chip${kind === "QUESTION" ? " ok" : ""}`} href={q({ kind: "QUESTION", page: undefined })}>вопросы</Link>
      </div>

      {data.rows.length === 0 ? (
        <p className="adm-muted">Здесь пусто.</p>
      ) : (
        data.rows.map((r) => (
          <article key={r.id} className="adm-card">
            <div className="adm-row" style={{ justifyContent: "space-between" }}>
              <div>
                <b>{r.kind === "QUESTION" ? "❓ Вопрос" : `⭐ ${"★".repeat(r.rating ?? 0)}${"☆".repeat(5 - (r.rating ?? 0))}`}</b>{" "}
                <Link className="adm-link" href={`/admin/products/${r.product.id}`}>{r.product.nameUk}</Link> <span className="adm-muted">{r.product.sku}</span>
              </div>
              <span className="adm-muted">{r.createdAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kyiv" })} · {r.lang === "RU" ? "рус." : "укр."}{r.clientId ? " · из кабинета" : ""}</span>
            </div>
            <p style={{ whiteSpace: "pre-line", margin: "8px 0" }}><b>{r.name}:</b> {r.text}</p>
            {r.photos.length > 0 && (
              <div className="adm-row" style={{ gap: 8, marginBottom: 8 }}>
                {r.photos.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="Фото покупателя" width={96} height={96} style={{ objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }} /></a>
                ))}
              </div>
            )}
            <div className="adm-row" style={{ gap: 8 }}>
              {r.status !== "PUBLISHED" && (
                <form action={moderateAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="publish" /><input type="hidden" name="back" value={here} /><SubmitButton primary pendingText="…">Опубликовать</SubmitButton></form>
              )}
              {r.status !== "REJECTED" && (
                <form action={moderateAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="reject" /><input type="hidden" name="back" value={here} /><SubmitButton pendingText="…">Отклонить</SubmitButton></form>
              )}
              <form action={deleteAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} /><SubmitButton pendingText="…">Удалить</SubmitButton></form>
            </div>
            <form action={answerAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} />
              <div className="adm-field">
                <label htmlFor={`ans-${r.id}`}>Ответ магазина{r.answeredBy ? ` (${r.answeredBy})` : ""}</label>
                <textarea id={`ans-${r.id}`} name="answer" className="adm-input wide" rows={2} defaultValue={r.answer ?? ""} placeholder={r.kind === "QUESTION" ? "Ответ на вопрос — появится под ним на сайте" : "Спасибо за отзыв! …"} />
              </div>
              <SubmitButton pendingText="…">{r.answer ? "Сохранить ответ" : "Ответить и опубликовать"}</SubmitButton>
            </form>
          </article>
        ))
      )}

      {data.pages > 1 && (
        <p className="adm-row">
          {page > 1 && <Link className="adm-link" href={q({ page: String(page - 1) })}>← назад</Link>}
          <span className="adm-muted">стр. {page} из {data.pages}</span>
          {page < data.pages && <Link className="adm-link" href={q({ page: String(page + 1) })}>дальше →</Link>}
        </p>
      )}
    </>
  );
}

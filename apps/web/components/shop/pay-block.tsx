"use client";

// Блок оплаты картой на странице заказа (шаг 3.2): «Сплатити» → страница банка; после возврата — «чекаємо підтвердження» с автопроверкой
// раз в 5 секунд (до 3 минут) и кнопкой «Я сплатив(ла), перевірити». Без токена mono (только не в production) — тестовая оплата.
// Сумму считает сервер; тексты — из «Сайт → Тексты» (группа «Оплата»).
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PayView } from "@handyman/core/shop";
import { checkPayAction, startPayAction, stubPayAction } from "@/app/[lang]/pay-actions";
import { btn } from "./ui";

export type PayBlockLabels = {
  btn: string; lead: string; later: string; pending: string; notYet: string; failed: string; retry: string; checkPay: string; devPay: string; stub: string; noPay: string;
};

export function PayBlock({ lang, no, k, view, stub, labels }: { lang: string; no: string; k: string; view: PayView; stub: boolean; labels: PayBlockLabels }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [stubOpen, setStubOpen] = useState(stub && view === "pending");
  const tries = useRef(0);

  // ждём подтверждения банка: спрашиваем сами, пока покупатель смотрит на страницу
  useEffect(() => {
    if (view !== "pending" || stub) return;
    tries.current = 0;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (++tries.current > 36) return clearInterval(id);
      void checkPayAction(no, k, view).then((r) => r.changed && router.refresh());
    }, 5000);
    return () => clearInterval(id);
  }, [view, stub, no, k, router]);

  const pay = () =>
    start(async () => {
      setMsg(null);
      const r = await startPayAction(lang, no, k);
      if (!r.ok) {
        if (r.refresh) router.refresh();
        else setMsg(r.message);
        return;
      }
      if (r.stub) setStubOpen(true);
      else window.location.assign(r.url);
    });

  const check = () =>
    start(async () => {
      setMsg(null);
      const r = await checkPayAction(no, k, view);
      if (r.changed) router.refresh();
      else setMsg(labels.notYet);
    });

  const fake = () =>
    start(async () => {
      if (await stubPayAction(no, k)) router.refresh();
      else setMsg(labels.noPay);
    });

  return (
    <div className="hm-pay" aria-live="polite">
      {view === "due" && <p>{labels.lead}</p>}
      {view === "pending" && <p className="hm-alert">{labels.pending}</p>}
      {view === "failed" && <p className="hm-alert hm-alert-error">{labels.failed}</p>}
      {stubOpen ? (
        <div className="hm-alert">
          <p style={{ margin: "0 0 10px" }}>{labels.stub}</p>
          <button type="button" className={btn("primary")} onClick={fake} disabled={busy}>{labels.devPay}</button>
        </div>
      ) : (
        <div className="hm-pay-actions">
          <button type="button" className={btn(view === "pending" ? "secondary" : "primary", { block: true })} onClick={pay} disabled={busy}>
            {view === "failed" ? labels.retry : labels.btn}
          </button>
          {view === "pending" && (
            <button type="button" className={btn("primary", { block: true })} onClick={check} disabled={busy}>{labels.checkPay}</button>
          )}
        </div>
      )}
      {msg && <p className="hm-muted" role="status">{msg}</p>}
      {view === "due" && <p className="hm-muted">{labels.later}</p>}
    </div>
  );
}

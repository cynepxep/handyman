"use client";
// Экран входа покупателя (Этап 5): «Увійти через Telegram» (ждём подтверждения в боте) или код из SMS. Тексты — из реестра.
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/shop/ui";
import { Icon } from "@/components/shop/icons";
import { PhoneInput } from "@/components/shop/cart/phone-input";
import { checkTgLoginAction, smsLoginAction, startTgLoginAction, type SmsState } from "@/app/[lang]/account-actions";

const fill = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));

export function LoginPanel({ lang, t, smsOn }: { lang: "uk" | "ru"; t: Record<string, string>; smsOn: boolean }) {
  const router = useRouter();
  const [tgLink, setTgLink] = useState<string | null>(null);
  const [tgState, setTgState] = useState<"idle" | "wait" | "expired" | "error">("idle");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sms, smsAction, smsPending] = useActionState<SmsState, FormData>(smsLoginAction, { step: "phone" });
  const [phone, setPhone] = useState("");

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => {
    if (sms.errorVars?.done) router.refresh(); // вошли по SMS — показать кабинет
  }, [sms, router]);

  const startTg = async () => {
    const r = await startTgLoginAction();
    if ("error" in r) return setTgState("error");
    setTgLink(r.link);
    setTgState("wait");
    window.open(r.link, "_blank", "noopener");
    if (timer.current) clearInterval(timer.current);
    const started = Date.now();
    timer.current = setInterval(async () => {
      const c = await checkTgLoginAction();
      if (c.status === "ok") {
        if (timer.current) clearInterval(timer.current);
        router.refresh();
      } else if (c.status === "expired" || Date.now() - started > 10 * 60_000) {
        if (timer.current) clearInterval(timer.current);
        setTgState("expired");
      }
    }, 2000);
  };

  return (
    <section className="hm-section hm-login">
      <h1 className="hm-h1">{t["login.title"]}</h1>
      <p className="hm-muted">{t["login.lead"]}</p>
      <div className="hm-panel">
        <button type="button" className={btn("primary", { block: true })} onClick={startTg} data-gtm="login-telegram">
          <Icon name="telegram" size={20} />{t["login.tg.btn"]}
        </button>
        {tgState === "wait" && (
          <p className="hm-alert" role="status">
            {t["login.tg.wait"]} {tgLink && <a className="hm-link" href={tgLink} target="_blank" rel="noopener">{t["login.tg.again"]}</a>}
          </p>
        )}
        {tgState === "expired" && <p className="hm-alert hm-alert-error" role="alert">{t["login.tg.expired"]}</p>}
        {tgState === "error" && <p className="hm-alert hm-alert-error" role="alert">{t["login.sms.off"]}</p>}

        <p className="hm-login-or"><span>{t["login.or"]}</span></p>

        {!smsOn ? <p className="hm-muted">{t["login.sms.off"]}</p> : (
          <form action={smsAction} className="hm-login-sms">
            <input type="hidden" name="lang" value={lang} />
            {sms.step === "phone" ? (
              <>
                <div className="hm-field">
                  <label htmlFor="login-phone">{t["login.sms.phone"]}</label>
                  <PhoneInput id="login-phone" value={phone} onChange={setPhone} invalid={Boolean(sms.error)} />
                  <input type="hidden" name="phone" value={phone} />
                </div>
                <button type="submit" className={btn("secondary", { block: true })} disabled={smsPending}>{t["login.sms.send"]}</button>
              </>
            ) : (
              <>
                <input type="hidden" name="step" value="code" />
                <p className="hm-alert hm-alert-ok" role="status">{fill(t["login.sms.sent"], { phone: sms.phone ?? "" })}</p>
                <div className="hm-field">
                  <label htmlFor="login-code">{t["login.sms.code"]}</label>
                  <input id="login-code" name="code" className="hm-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required aria-invalid={Boolean(sms.error)} />
                </div>
                <button type="submit" className={btn("primary", { block: true })} disabled={smsPending}>{t["login.sms.check"]}</button>
              </>
            )}
            {sms.error && <p className="hm-field-error" role="alert">{fill(t[sms.error] ?? sms.error, sms.errorVars)}</p>}
          </form>
        )}
      </div>
    </section>
  );
}

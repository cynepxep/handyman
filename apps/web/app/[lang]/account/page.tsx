// Личный кабинет покупателя (Этап 5): вход (Telegram / SMS) или кабинет — уровень и прогресс, заказы со статусом и ТТН, «Повторить заказ»,
// приглашение друга, подключение Telegram. Тексты — реестр («Вход и регистрация», «Профиль и уровни», «Заказы покупателя»).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isShopLang, paths, pickTexts, shopHref } from "@handyman/core/site";
import { TIER_RU, clientDiscountPct, formatPhone, tierProgress, type TierKey } from "@handyman/core/shop";
import { prisma } from "@handyman/db";
import { loadLoyalty } from "@handyman/db/clients";
import { smsLoginAvailable } from "@handyman/db/client-auth";
import { ensureRefCode } from "@handyman/db/clients";
import { getShopContent, siteUrl } from "@/lib/shop/content";
import { getClient } from "@/lib/client-auth";
import { formatPrice } from "@/components/shop/format";
import { btn } from "@/components/shop/ui";
import { LoginPanel } from "@/components/shop/account/login-panel";
import { ConnectTelegramButton, CopyLinkButton, LogoutButton, RepeatOrderButton } from "@/components/shop/account/account-bits";

export const dynamic = "force-dynamic";

const LOGIN_KEYS = [
  "login.title", "login.lead", "login.tg.btn", "login.tg.wait", "login.tg.again", "login.tg.expired", "login.or", "login.sms.phone", "login.sms.send",
  "login.sms.sent", "login.sms.code", "login.sms.check", "login.sms.resend", "login.sms.off", "login.err.phone", "login.err.wait", "login.err.limit",
  "login.err.code", "login.err.expired",
] as const;

export async function generateMetadata({ params }: PageProps<"/[lang]/account">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("meta.account.title"), robots: { index: false, follow: false } };
}

export default async function AccountPage({ params }: PageProps<"/[lang]/account">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const c = await getShopContent(lang);
  const { t } = c;
  const client = await getClient();
  if (!client) return <LoginPanel lang={lang} t={pickTexts(c.texts, LOGIN_KEYS)} smsOn={smsLoginAvailable()} />;

  const [loyalty, orders, invited, refCode] = await Promise.all([
    loadLoyalty(),
    prisma.order.findMany({
      where: { clientId: client.id, isTest: false }, orderBy: { createdAt: "desc" }, take: 30,
      select: { no: true, status: true, total: true, ttn: true, createdAt: true, _count: { select: { items: true } } },
    }),
    prisma.client.count({ where: { referredById: client.id } }),
    client.refCode ? client.refCode : ensureRefCode(client.id).catch(() => null),
  ]);
  const tier = client.tier as TierKey;
  const spent = client.spent.toNumber();
  const disc = clientDiscountPct({ tier, manualDiscountPct: client.manualDiscountPct }, loyalty);
  const progress = loyalty.enabled ? tierProgress(spent, tier, loyalty) : null;
  const firstName = client.name?.trim().split(/\s+/).slice(-1)[0] ?? "";
  const refUrl = refCode ? `${siteUrl().toString().replace(/\/$/, "")}${shopHref(lang, paths.home())}?ref=${refCode}` : null;
  const dateFmt = (d: Date) => d.toLocaleDateString(lang === "ru" ? "ru-RU" : "uk-UA", { timeZone: "Europe/Kyiv" });

  return (
    <section className="hm-section hm-account">
      <div className="hm-section-head">
        <h1 className="hm-h1">{firstName ? t("account.title", { name: firstName }) : t("account.title.noname")}</h1>
        <LogoutButton label={t("account.logout")} />
      </div>
      <p className="hm-muted">{client.phone ? formatPhone(client.phone) : t("account.phone.none")}{client.username ? ` · @${client.username}` : ""}</p>

      {(loyalty.enabled || disc.pct > 0) && (
        <div className="hm-panel hm-level">
          {loyalty.enabled && <p className="hm-level-name">{t("account.level", { tier: TIER_RU[tier] ?? tier })}</p>}
          {disc.pct > 0 && <p><b>{t("account.discount", { pct: disc.pct })}</b></p>}
          {progress && (
            <>
              <div className="hm-level-bar" role="progressbar" aria-valuenow={progress.pctDone} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.pctDone}%` }} /></div>
              <p className="hm-muted">{t("account.progress", { tier: TIER_RU[progress.next] ?? progress.next, sum: formatPrice(progress.left) })}</p>
            </>
          )}
          {spent > 0 && <p className="hm-muted">{t("account.spent", { sum: formatPrice(spent) })}</p>}
        </div>
      )}

      {client.tgId == null && (
        <div className="hm-panel">
          <p>{t("account.tg.connect")}</p>
          <div><ConnectTelegramButton label={t("account.tg.btn")} /></div>
        </div>
      )}

      <div className="hm-panel">
        <h2>{t("account.orders")}</h2>
        {orders.length ? (
          <ul className="hm-orders">
            {orders.map((o) => (
              <li key={o.no} className="hm-order-row">
                <div>
                  <b>{o.no}</b> <span className="hm-muted">· {dateFmt(o.createdAt)} · {t("account.order.items", { n: o._count.items })}</span>
                  <div><span className={`hm-status hm-status-${o.status.toLowerCase()}`}>{t(`status.${o.status}`)}</span></div>
                  {o.ttn && (
                    <div className="hm-muted">
                      {t("account.order.ttn", { ttn: o.ttn })}{" "}
                      <a className="hm-link" href={`https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(o.ttn)}`} target="_blank" rel="noopener">{t("account.order.track")}</a>
                    </div>
                  )}
                </div>
                <div className="hm-order-side">
                  <b>{formatPrice(o.total.toNumber())}</b>
                  <RepeatOrderButton no={o.no} label={t("account.order.repeat")} doneLabel={t("account.order.repeated")} cartHref={shopHref(lang, paths.cart())} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="hm-muted">{t("account.orders.none")}</p>
            <div><Link className={btn("primary")} href={shopHref(lang, paths.catalog())}>{t("thanks.home")}</Link></div>
          </>
        )}
      </div>

      {refUrl && (
        <div className="hm-panel">
          <h2>{t("account.ref.title")}</h2>
          <p>{t("account.ref.text")}</p>
          <p className="hm-ref-url">{refUrl}</p>
          <div className="hm-row"><CopyLinkButton url={refUrl} label={t("account.ref.copy")} doneLabel={t("account.ref.copied")} />{invited > 0 && <span className="hm-muted">{t("account.ref.count", { n: invited })}</span>}</div>
        </div>
      )}
    </section>
  );
}

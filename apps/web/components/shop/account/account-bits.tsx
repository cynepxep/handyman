"use client";
// Кнопки кабинета покупателя (Этап 5): «Повторить заказ», «Скопировать ссылку», «Выйти».
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/shop/ui";
import { cartStore } from "@/components/shop/cart/store";
import { logoutAction, repeatOrderAction, telegramLinkAction } from "@/app/[lang]/account-actions";

export function RepeatOrderButton({ no, label, doneLabel, cartHref }: { no: string; label: string; doneLabel: string; cartHref: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className={btn("secondary", { small: true })}
      disabled={pending}
      data-gtm="repeat-order"
      onClick={() =>
        start(async () => {
          const items = await repeatOrderAction(no);
          for (const i of items) cartStore.add(i.sku, i.qty);
          setDone(true);
          router.push(cartHref);
        })
      }
    >
      {done ? doneLabel : label}
    </button>
  );
}

export function CopyLinkButton({ url, label, doneLabel }: { url: string; label: string; doneLabel: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={btn("secondary", { small: true })}
      onClick={() => navigator.clipboard?.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }, () => {})}
    >
      {done ? doneLabel : label}
    </button>
  );
}

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={btn("ghost", { small: true })} disabled={pending} onClick={() => start(async () => { await logoutAction(); router.refresh(); })}>
      {label}
    </button>
  );
}

export function ConnectTelegramButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={btn("secondary")}
      disabled={pending}
      onClick={() => start(async () => { const link = await telegramLinkAction(); if (link) window.open(link, "_blank", "noopener"); })}
    >
      {label}
    </button>
  );
}

"use client";
// Mini App (Этап 5): сайт, открытый кнопкой «🛒 Магазин» в боте. Telegram передаёт в адресе (#tgWebAppData=…) подписанные данные
// покупателя — отправляем их серверу (он проверит подпись) и входим без логина/пароля. Скрипт Telegram грузим только внутри Telegram.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

type TgWebApp = { ready: () => void; expand: () => void; initData: string; HapticFeedback?: { impactOccurred: (s: string) => void } };

export function MiniAppBridge({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromHash = hash.get("tgWebAppData");
    const inTelegram = Boolean(fromHash) || sessionStorage.getItem("hm-miniapp") === "1";
    if (!inTelegram) return;
    try {
      sessionStorage.setItem("hm-miniapp", "1");
    } catch {
      /* приватный режим — не страшно */
    }
    document.documentElement.classList.add("hm-miniapp");
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.async = true;
    s.onload = () => {
      const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
      wa?.ready();
      wa?.expand();
    };
    document.head.appendChild(s);
    if (loggedIn || !fromHash) return;
    void fetch("/api/client/miniapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: fromHash }) })
      .then((r) => { if (r.ok) router.refresh(); })
      .catch(() => {});
  }, [loggedIn, router]);
  return null;
}

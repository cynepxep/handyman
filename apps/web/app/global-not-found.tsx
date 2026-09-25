import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";

// «Не найдено» для служебных адресов (админка, стенды), у которых нет своей страницы 404.
// Адреса витрины сюда не попадают: у неё своя страница «не найдено» на языке сайта (app/[lang]/not-found.tsx).
export const metadata: Metadata = { title: "Страница не найдена — Handyman" };

export default function GlobalNotFound() {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, lineHeight: 1.5 }}>
        <h1>Страница не найдена</h1>
        <p>Проверьте адрес.</p>
        <p>
          <Link href="/">На сайт</Link> · <Link href="/admin">В админку</Link>
        </p>
      </body>
    </html>
  );
}

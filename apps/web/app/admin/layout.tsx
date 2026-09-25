import type { Metadata } from "next";
import "../globals.css";

// Корневой layout админки (у витрины и у стендов дизайна — свои). Админка на русском и закрыта от поисковиков.
export const metadata: Metadata = {
  title: { default: "Handyman — админка", template: "%s — админка Handyman" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

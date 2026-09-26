import type { Metadata, Viewport } from "next";
import "../globals.css";

// Корневой layout админки (у витрины и у стендов дизайна — свои). Админка на русском и закрыта от поисковиков.
// Шаг 4.8: можно «установить как приложение» на телефон (иконка на главном экране, открывается без адресной строки).
export const metadata: Metadata = {
  title: { default: "Handyman — админка", template: "%s — админка Handyman" },
  robots: { index: false, follow: false },
  manifest: "/admin-manifest.json",
  icons: { icon: "/admin-icon.svg", apple: "/admin-apple-icon.png" },
  appleWebApp: { capable: true, title: "Handyman", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#1E2126", width: "device-width", initialScale: 1 };

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

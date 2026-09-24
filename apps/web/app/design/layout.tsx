import type { Metadata } from "next";
import { Inter, Manrope, Onest } from "next/font/google";
import "./design.css";

// Три кандидата шрифта, все с кириллицей (ґ, є, і, ї). Подключаются с нашего сервера, без запросов к Google в браузере.
const onest = Onest({ variable: "--font-onest", subsets: ["latin", "cyrillic"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin", "cyrillic"] });

// Служебная страница для выбора стиля: закрыта от поисковиков, в готовый сайт не входит.
export const metadata: Metadata = {
  title: "Стенд дизайна (служебная)",
  robots: { index: false, follow: false },
};

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${onest.variable} ${inter.variable} ${manrope.variable}`}>{children}</div>;
}

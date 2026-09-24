// Шрифты стенда «Мастерская v2». Подключаются с нашего сервера (без запросов к Google в браузере).
// Скачивается только тот шрифт, который реально используется на странице.
import { Exo_2, Golos_Text, Inter, Montserrat, Onest, Oswald, Roboto, Roboto_Condensed, Rubik, Unbounded } from "next/font/google";

const onest = Onest({ variable: "--f-onest", subsets: ["latin", "cyrillic"] });
const oswald = Oswald({ variable: "--f-oswald", subsets: ["latin", "cyrillic"] });
const golos = Golos_Text({ variable: "--f-golos", subsets: ["latin", "cyrillic"] });
const unbounded = Unbounded({ variable: "--f-unbounded", subsets: ["latin", "cyrillic"] });
const rubik = Rubik({ variable: "--f-rubik", subsets: ["latin", "cyrillic"] });
const exo = Exo_2({ variable: "--f-exo", subsets: ["latin", "cyrillic"] });
const inter = Inter({ variable: "--f-inter", subsets: ["latin", "cyrillic"] });
const robotoC = Roboto_Condensed({ variable: "--f-robotoc", subsets: ["latin", "cyrillic"], weight: ["400", "600", "700"] });
const roboto = Roboto({ variable: "--f-roboto", subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"] });
const montserrat = Montserrat({ variable: "--f-montserrat", subsets: ["latin", "cyrillic"] });

export const FONT_CLASSES = [onest, oswald, golos, unbounded, rubik, exo, inter, robotoC, roboto, montserrat].map((f) => f.variable).join(" ");

export type FontPair = { key: string; label: string };

// Заголовки и текст подставляются в CSS через data-font (см. v2.css).
export const FONT_PAIRS: FontPair[] = [
  { key: "oswald-golos", label: "Oswald + Golos" },
  { key: "onest", label: "Onest" },
  { key: "unbounded-golos", label: "Unbounded + Golos" },
  { key: "rubik", label: "Rubik" },
  { key: "exo-inter", label: "Exo 2 + Inter" },
  { key: "robotoc-roboto", label: "Roboto Condensed" },
  { key: "montserrat", label: "Montserrat" },
];

export const DEFAULT_FONT = "oswald-golos";

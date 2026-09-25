// Шрифты витрины — выбор владельца: Roboto Condensed (заголовки) + Roboto (текст). Оба с кириллицей (ґ, є, і, ї).
// Подключаются с нашего сервера (без запросов к Google в браузере); скачивается только то, что реально используется.
import { Roboto, Roboto_Condensed } from "next/font/google";

const robotoC = Roboto_Condensed({ variable: "--f-robotoc", subsets: ["latin", "cyrillic"], weight: ["400", "600", "700"] });
const roboto = Roboto({ variable: "--f-roboto", subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"] });

export const FONT_CLASSES = `${robotoC.variable} ${roboto.variable}`;

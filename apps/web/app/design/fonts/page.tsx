import {
  Golos_Text, Onest, Oswald, Roboto, Roboto_Condensed, Rubik, Unbounded, Exo_2, Inter, Montserrat,
} from "next/font/google";
import "./fonts.css";

export const metadata = { title: "Шрифты (служебная)", robots: { index: false, follow: false } };

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

const PAIRS = [
  { id: "a", name: "1. Onest + Onest (сейчас)", note: "мягкий, современный, один шрифт на всё", head: "onest", body: "onest" },
  { id: "b", name: "2. Oswald + Golos Text", note: "заголовки узкие и «инструментальные», текст спокойный", head: "oswald", body: "golos" },
  { id: "c", name: "3. Unbounded + Golos Text", note: "заголовки широкие, «технологичные», необычные", head: "unbounded", body: "golos" },
  { id: "d", name: "4. Rubik + Rubik", note: "закруглённый, дружелюбный, «домашний»", head: "rubik", body: "rubik" },
  { id: "e", name: "5. Exo 2 + Inter", note: "спортивно-технический характер, нейтральный текст", head: "exo", body: "inter" },
  { id: "f", name: "6. Roboto Condensed + Roboto", note: "строгий и экономный по ширине (много текста в узкой карточке)", head: "robotoc", body: "roboto" },
  { id: "g", name: "7. Montserrat + Montserrat", note: "самый «магазинный» и узнаваемый, широкий", head: "montserrat", body: "montserrat" },
] as const;

const NAME = "Круг відрізний по металу Vitals Professional 125×1,2×22,2 мм, ґатунок «А», 10 шт. в упаковці";

export default function FontsPage() {
  const vars = [onest, oswald, golos, unbounded, rubik, exo, inter, robotoC, roboto, montserrat].map((f) => f.variable).join(" ");
  return (
    <div className={`fz-root ${vars}`}>
      <header className="fz-top">
        <strong>Сравнение шрифтов (цвета «Мастерской»)</strong>
        <span>На каждом образце: логотип, заголовок, карточка, цена, украинские буквы ґ є і ї, узкая карточка телефона.</span>
      </header>
      <div className="fz-grid">
        {PAIRS.map((p) => (
          <section key={p.id} className={`fz-sample fz-${p.head}-${p.body}`} style={{ ["--fh" as string]: `var(--f-${p.head})`, ["--fb" as string]: `var(--f-${p.body})` }}>
            <p className="fz-label">{p.name}<small>{p.note}</small></p>
            <div className="fz-logo"><span>H</span> Handyman</div>
            <h2 className="fz-h1">Круги для болгарки</h2>
            <p className="fz-text">Ґрунтовка, єдиний, їжак, інструмент: усе для майстра з Одеси. Гарантія 12 міс., повернення 14 днів, доставка сьогодні.</p>
            <div className="fz-row">
              <article className="fz-card">
                <div className="fz-img">фото</div>
                <h3>{NAME}</h3>
                <p className="fz-stock">В наявності</p>
                <p className="fz-price">1 599 ₴ <s>1 909 ₴</s></p>
                <button type="button">У кошик</button>
              </article>
              <article className="fz-card fz-card-wide">
                <p className="fz-tile-name">Акумуляторний інструмент</p>
                <p className="fz-price fz-price-big">999 999 ₴</p>
                <p className="fz-filter"><b>Діаметр, мм</b><br />125 · 180 · 230 <em>617</em></p>
                <p className="fz-filter"><b>Посадковий отвір, мм</b><br />22,2 <em>431</em></p>
              </article>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

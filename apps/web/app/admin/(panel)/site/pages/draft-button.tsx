"use client";

// «Вставить черновик по настройкам» для страницы «Доставка і оплата»: заполняет поля текста, но НЕ сохраняет —
// владелец читает, правит и сам нажимает «Сохранить».
import { useState } from "react";

export function DraftButton({ uk, ru }: { uk: string; ru: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="adm-card" style={{ borderColor: "var(--adm-accent)" }}>
      <p style={{ margin: 0 }}>
        <b>Черновик по вашим настройкам.</b> Соберём текст из того, что уже настроено: способы доставки и оплаты, сумма предоплаты
        («Сайт → Оформление заказа»), адрес и график («Контакты»), сроки (свой склад, поставщик 3–4 дня, под заказ). Проверьте и допишите своё.
      </p>
      <div className="adm-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="adm-btn"
          onClick={() => {
            const a = document.getElementById("bodyUk") as HTMLTextAreaElement | null;
            const b = document.getElementById("bodyRu") as HTMLTextAreaElement | null;
            if (!a || !b) return;
            if ((a.value.trim() || b.value.trim()) && !window.confirm("Заменить текущий текст страницы черновиком? Сохранится только после кнопки «Сохранить».")) return;
            a.value = uk;
            b.value = ru;
            setDone(true);
            a.focus();
          }}
        >
          Вставить черновик по настройкам
        </button>
        {done && <span className="adm-muted">Черновик вставлен в поля ниже. Это ещё не сохранено — проверьте текст и нажмите «Сохранить».</span>}
      </div>
    </div>
  );
}

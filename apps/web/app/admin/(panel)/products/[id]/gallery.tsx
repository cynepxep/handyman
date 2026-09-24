"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Фото товара: миниатюры, по нажатию открывается на весь экран с листанием (стрелки, Esc, свайп-кнопки). */
export function Gallery({ images, name }: { images: string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const go = useCallback((delta: number) => setOpen((i) => (i == null ? i : (i + delta + images.length) % images.length)), [images.length]);
  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);

  useEffect(() => {
    if (open == null) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, go, close]);

  return (
    <>
      <div className="adm-row" style={{ gap: 8 }}>
        {images.map((url, i) => (
          <button
            key={url}
            type="button"
            className="adm-thumb"
            aria-label={`Открыть фото ${i + 1} из ${images.length} на весь экран`}
            onClick={(e) => {
              opener.current = e.currentTarget;
              setOpen(i);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- фото по ссылкам поставщика */}
            <img src={url} alt={`${name}, фото ${i + 1}`} loading="lazy" width={96} height={96} />
          </button>
        ))}
      </div>

      {open != null && (
        <div className="adm-lightbox" role="dialog" aria-modal="true" aria-label={`Фото ${open + 1} из ${images.length}`} onClick={close}>
          <button ref={closeRef} type="button" className="adm-lb-btn adm-lb-close" onClick={close} aria-label="Закрыть">×</button>
          {images.length > 1 && (
            <button type="button" className="adm-lb-btn adm-lb-prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Предыдущее фото">‹</button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- фото по ссылкам поставщика */}
          <img src={images[open]} alt={`${name}, фото ${open + 1}`} onClick={(e) => e.stopPropagation()} />
          {images.length > 1 && (
            <button type="button" className="adm-lb-btn adm-lb-next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Следующее фото">›</button>
          )}
          <div className="adm-lb-count">{open + 1} / {images.length}</div>
        </div>
      )}
    </>
  );
}

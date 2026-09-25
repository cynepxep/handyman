"use client";

// Галерея товара: листание пальцем (прокрутка с «защёлкой»), миниатюры, просмотр на весь экран со стрелками (клавиши ← → и Esc).
// Фото отдаются через наш сервер уменьшенными (next/image); на весь экран — крупнее.
import { useRef, useState } from "react";
import Image from "next/image";
import { optimizable } from "@/lib/image-hosts";

export type GalleryLabels = { photo: string; zoom: string; prev: string; next: string; close: string; thumbs: string; noPhoto: string };

export function Gallery({ images, alt, labels, badge }: { images: string[]; alt: string; labels: GalleryLabels; badge?: string }) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const count = images.length;
  const caption = (i: number) => labels.photo.replace("{n}", String(i + 1)).replace("{total}", String(count));

  const scrollTo = (i: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setIndex(i);
  };
  const step = (dir: number) => setIndex((i) => (i + dir + count) % count);

  if (count === 0) {
    return (
      <div className="hm-gallery">
        <div className="hm-gallery-main"><div className="hm-noimg">{labels.noPhoto}</div></div>
      </div>
    );
  }

  return (
    <div className="hm-gallery">
      <div className="hm-gallery-main">
        {badge && <span className="hm-badge hm-badge-sale hm-gallery-badge">{badge}</span>}
        <div
          ref={strip}
          className="hm-gallery-strip"
          onScroll={(e) => {
            const el = e.currentTarget;
            const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (i !== index && i >= 0 && i < count) setIndex(i);
          }}
        >
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              className="hm-gallery-slide"
              onClick={() => {
                setIndex(i);
                dialog.current?.showModal();
              }}
              aria-label={`${labels.zoom}: ${caption(i)}`}
            >
              <Image src={src} alt={i === 0 ? alt : `${alt} — ${caption(i)}`} fill sizes="(max-width: 999px) 100vw, 560px" priority={i === 0} unoptimized={!optimizable(src)} />
            </button>
          ))}
        </div>
        {count > 1 && <span className="hm-gallery-count" aria-live="polite">{caption(index)}</span>}
      </div>

      {count > 1 && (
        <ul className="hm-gallery-thumbs" aria-label={labels.thumbs}>
          {images.map((src, i) => (
            <li key={src}>
              <button type="button" className={i === index ? "is-on" : ""} onClick={() => scrollTo(i)} aria-label={caption(i)} aria-current={i === index ? "true" : undefined}>
                <Image src={src} alt="" width={64} height={64} sizes="64px" unoptimized={!optimizable(src)} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <dialog
        ref={dialog}
        className="hm-lightbox"
        aria-label={alt}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        onClose={() => scrollTo(index)}
      >
        <div className="hm-lightbox-img">
          <Image src={images[index]} alt={`${alt} — ${caption(index)}`} fill sizes="100vw" unoptimized={!optimizable(images[index])} />
        </div>
        <button type="button" className="hm-lb-btn hm-lb-close" onClick={() => dialog.current?.close()} aria-label={labels.close}>✕</button>
        {count > 1 && (
          <>
            <button type="button" className="hm-lb-btn hm-lb-prev" onClick={() => step(-1)} aria-label={labels.prev}>‹</button>
            <button type="button" className="hm-lb-btn hm-lb-next" onClick={() => step(1)} aria-label={labels.next}>›</button>
            <span className="hm-lb-count">{caption(index)}</span>
          </>
        )}
      </dialog>
    </div>
  );
}

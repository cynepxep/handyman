"use client";
// Защита от ботов (шаг 8.3): сколько миллисекунд форма была открыта — сервер отклоняет отправку быстрее 3 секунд
// (filledTooFast в @handyman/core/shop). Живой человек, если успел быстрее, просто нажимает ещё раз.
import { useEffect, useRef } from "react";

export function useFillTimer(): () => number | undefined {
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);
  return () => (openedAt.current ? Date.now() - openedAt.current : undefined);
}

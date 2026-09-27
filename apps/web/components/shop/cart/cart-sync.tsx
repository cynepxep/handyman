"use client";

// Общая корзина сайт ↔ Mini App (шаг 5.5): у вошедшего покупателя корзина браузера сверяется с корзиной в кабинете —
// при открытии страницы, при возврате на вкладку и через секунду после каждого изменения. Правило встречи — mergeCartSync (сервер).
import { useEffect } from "react";
import { cartSyncAction } from "@/app/[lang]/cabinet-actions";
import { cartStore } from "./store";

export function CartSync({ loggedIn }: { loggedIn: boolean }) {
  useEffect(() => {
    if (!loggedIn) {
      // вышел или сессия кончилась: корзина остаётся в браузере; при следующем входе она объединится с кабинетом
      const m = cartStore.syncMeta();
      if (m.v > 0) cartStore.setSyncMeta({ v: 0, dirty: cartStore.get().length > 0 });
      return;
    }
    let alive = true;
    let busy = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sync = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      const edits = cartStore.edits();
      const meta = cartStore.syncMeta();
      try {
        const r = await cartSyncAction({ local: cartStore.get(), baseVersion: meta.v, dirty: meta.dirty });
        if (!alive || !r) return;
        if (cartStore.edits() === edits) cartStore.applySynced(r.lines, r.version);
        else {
          // пока ждали ответ, покупатель ещё что-то поменял — запомним версию и отправим снова
          cartStore.setSyncMeta({ v: r.version, dirty: true });
          again = true;
        }
      } catch {
        /* нет сети — попробуем при следующем изменении или возврате на вкладку */
      } finally {
        busy = false;
        if (again && alive) {
          again = false;
          void sync();
        }
      }
    };

    void sync();
    const unsubscribe = cartStore.subscribe(() => {
      if (!cartStore.syncMeta().dirty) return; // это пришло из кабинета
      clearTimeout(timer);
      timer = setTimeout(() => void sync(), 800);
    });
    const onVisible = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [loggedIn]);
  return null;
}

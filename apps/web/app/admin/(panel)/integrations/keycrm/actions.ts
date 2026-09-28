"use server";

import { redirect } from "next/navigation";
import { KEYCRM_OUR_STATUSES } from "@handyman/core/shop";
import { KeycrmError, refreshKeycrmStatuses, saveKeycrmStatusMap, setKeycrmEnabled } from "@handyman/db/keycrm";
import { requireOwner } from "@/lib/auth";

const back = (kind: "ok" | "error", text: string, hash = "") => `/admin/integrations/keycrm?${kind}=${encodeURIComponent(text)}${hash}`;

/** Переключатель «Передавать заказы в KeyCRM». */
export async function setKeycrmEnabledAction(formData: FormData): Promise<void> {
  const s = await requireOwner();
  const on = formData.get("enabled") === "on";
  await setKeycrmEnabled(on, s.name || s.username);
  redirect(back("ok", on ? "Передача включена: новые заказы (кроме тестовых) уходят в KeyCRM сами." : "Передача выключена: новые заказы в KeyCRM не уходят."));
}

/** «Загрузить статусы из KeyCRM». */
export async function refreshKeycrmStatusesAction(): Promise<void> {
  const s = await requireOwner();
  let n = 0;
  try {
    n = (await refreshKeycrmStatuses(s.name || s.username)).statuses.length;
  } catch (e) {
    redirect(back("error", e instanceof KeycrmError ? e.message : "Не получилось — попробуйте ещё раз.", "#statuses"));
  }
  redirect(back("ok", `Загружено статусов: ${n}. Проверьте соответствие и нажмите «Сохранить таблицу».`, "#statuses"));
}

/** Таблица соответствия статусов (поля st_<id KeyCRM> = наш статус или «»). */
export async function saveKeycrmStatusMapAction(formData: FormData): Promise<void> {
  const s = await requireOwner();
  const map: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    const m = k.match(/^st_(\d{1,9})$/);
    if (m && typeof v === "string" && (v === "" || KEYCRM_OUR_STATUSES.includes(v))) map[m[1]] = v;
  }
  const saved = await saveKeycrmStatusMap(map, s.name || s.username);
  const n = Object.values(saved.statusMap).filter(Boolean).length;
  redirect(back("ok", `Таблица сохранена: меняем статус на сайте для ${n} статусов KeyCRM.`, "#statuses"));
}

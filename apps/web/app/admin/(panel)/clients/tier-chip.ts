import type { TierKey } from "@handyman/core/shop";

/** Отметка уровня клиента: Старт — обычная, Майстер/Профі — зелёная, Легенда — жёлтая, Опт — жёлтая. */
export const tierChip = (t: TierKey) => (t === "START" ? "adm-chip" : t === "LEGEND" || t === "WHOLESALE" ? "adm-chip warn" : "adm-chip ok");

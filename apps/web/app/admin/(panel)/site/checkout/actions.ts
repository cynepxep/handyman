"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateCheckoutSettingsForm } from "@handyman/core/shop";
import { saveCheckoutSettings } from "@handyman/db/orders";
import { saveTextEdits } from "@handyman/db/site-content";
import { requirePermission } from "@/lib/auth";

const back = (kind: "ok" | "error", text: string) => `/admin/site/checkout?${kind}=${encodeURIComponent(text)}`;

/** Сумма предоплаты, скидка, включённые способы доставки и оплаты + реквизиты для оплаты на карту (это текст сайта). */
export async function saveCheckoutAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.edit");
  const input: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") input[k] = v;
  const r = validateCheckoutSettingsForm(input);
  if (!r.ok) redirect(back("error", r.error));
  await saveCheckoutSettings(r.value, session.username);
  const texts = await saveTextEdits(
    [
      { key: "checkout.requisites", lang: "uk", value: input["requisites.uk"] ?? "" },
      { key: "checkout.requisites", lang: "ru", value: input["requisites.ru"] ?? "" },
    ],
    session.username,
  );
  if (!texts.ok) redirect(back("error", texts.error));
  revalidatePath("/", "layout");
  redirect(back("ok", "Настройки оформления сохранены — на сайте они уже действуют."));
}

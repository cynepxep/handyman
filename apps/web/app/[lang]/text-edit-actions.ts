"use server";

// Правка текстов прямо на странице сайта (режим «✎ Редагувати тексти» для сотрудника с правом «Тексты и страницы сайта»).
// Правила те же, что в админке «Сайт → Тексты»: пустое поле = стандартный текст, {слова в скобках} терять нельзя.
import { TEXT_ENTRIES, resolveTexts, textVars } from "@handyman/core/site";
import { loadTextOverrides, saveTextEdits } from "@handyman/db/site-content";
import { getStaffSession } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

export type EditableText = {
  key: string; group: string; hint: string; vars: string[];
  uk: string; ru: string; ukDefault: string; ruDefault: string;
};

async function editor() {
  const s = await getStaffSession();
  return s && s.permissions.includes("texts.edit") ? s : null;
}

/** Все тексты сайта с текущими значениями — только для сотрудника с правом «Тексты». */
export async function editableTextsAction(): Promise<EditableText[] | null> {
  if (!(await editor())) return null;
  const overrides = await loadTextOverrides();
  const uk = resolveTexts(overrides, "uk");
  const ru = resolveTexts(overrides, "ru");
  return TEXT_ENTRIES.map((e) => ({
    key: e.key, group: e.group, hint: e.hint ?? "", vars: textVars(e),
    uk: uk[e.key], ru: ru[e.key], ukDefault: e.uk, ruDefault: e.ru,
  }));
}

export async function saveTextAction(key: string, uk: string, ru: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await editor();
  if (!s) return { ok: false, error: "Нет права «Тексты и страницы сайта» или вход в админку истёк." };
  const r = await saveTextEdits(
    [
      { key, lang: "uk", value: String(uk ?? "") },
      { key, lang: "ru", value: String(ru ?? "") },
    ],
    s.username,
  );
  if (!r.ok) return r;
  shopChanged();
  return { ok: true };
}

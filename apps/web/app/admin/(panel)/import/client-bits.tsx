"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

/** Кнопка отправки формы: пока выполняется действие, блокируется и показывает, что идёт работа. */
export function SubmitButton({
  children,
  pendingText = "Работаю…",
  primary = false,
  formAction,
}: {
  children: React.ReactNode;
  pendingText?: string;
  primary?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formAction={formAction} disabled={pending} className={primary ? "adm-btn primary" : "adm-btn"}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Галочка «выбрать всё» для группы флажков с одним именем внутри той же формы. */
export function SelectAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Выбрать все на странице"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}

/** Обновляет страницу раз в пару секунд, пока идёт импорт. */
export function AutoRefresh({ everyMs = 1500 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}

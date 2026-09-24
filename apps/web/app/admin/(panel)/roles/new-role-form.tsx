"use client";

import { useRef, useTransition } from "react";
import { createRole } from "./actions";

export function NewRoleForm() {
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      style={{ marginTop: 24, display: "flex", gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        const title = inputRef.current?.value ?? "";
        if (!title.trim()) return;
        startTransition(async () => {
          await createRole(title);
          if (inputRef.current) inputRef.current.value = "";
        });
      }}
    >
      <input ref={inputRef} placeholder="Название новой роли" required />
      <button type="submit" disabled={isPending}>
        Создать свою роль
      </button>
    </form>
  );
}

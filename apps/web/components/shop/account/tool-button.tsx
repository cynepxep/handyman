"use client";
// «Це мій інструмент» на странице инструмента и «Прибрати» в кабинете (шаг 5.5).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/shop/ui";
import { toolToggleAction } from "@/app/[lang]/cabinet-actions";

export function MyToolButton({ sku, on: initial, addLabel, addedLabel }: { sku: string; on: boolean; addLabel: string; addedLabel: string }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={btn(on ? "ghost" : "secondary", { small: true })}
      aria-pressed={on}
      disabled={pending}
      data-action="my-tool"
      onClick={() => start(async () => { if (await toolToggleAction(sku, !on)) setOn(!on); })}
    >
      {on ? addedLabel : addLabel}
    </button>
  );
}

export function RemoveToolButton({ sku, label }: { sku: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="hm-linkbtn"
      disabled={pending}
      onClick={() => start(async () => { await toolToggleAction(sku, false); router.refresh(); })}
    >
      {label}
    </button>
  );
}

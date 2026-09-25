import { requirePermission } from "@/lib/auth";
import { SiteTabs } from "./tabs";

// Весь раздел «Сайт» (тексты, контакты, страницы, меню) — только для тех, у кого есть право «Тексты и страницы сайта».
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("texts.edit");
  return (
    <>
      <SiteTabs />
      {children}
    </>
  );
}

import { redirect } from "next/navigation";

export default function SiteIndex() {
  redirect("/admin/site/texts");
}

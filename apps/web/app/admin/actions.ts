"use server";

import { redirect } from "next/navigation";
import { logoutStaff } from "@/lib/auth";

export async function logoutAction(): Promise<void> {
  await logoutStaff();
  redirect("/admin/login");
}

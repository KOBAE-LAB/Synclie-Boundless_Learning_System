"use server";

import { cookies } from "next/headers";
import { signOut } from "@/auth";
import { VIEW_AS_COOKIE } from "@/lib/auth/session";

export async function logoutAction() {
  // 管理者の「学習者として表示」の目印も、ログアウトで必ず消す。
  const cookieStore = await cookies();
  cookieStore.delete(VIEW_AS_COOKIE);
  await signOut({ redirectTo: "/login" });
}

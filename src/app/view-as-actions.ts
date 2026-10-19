"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VIEW_AS_COOKIE } from "@/lib/auth/session";

// 管理者の「学習者として表示」を終えて、管理者(教師)の画面に戻る。
// (開始は、授業の所有確認が要るため courses/[courseId]/actions.ts の startStudentViewAction にある)
export async function stopStudentViewAction() {
  const cookieStore = await cookies();
  cookieStore.delete(VIEW_AS_COOKIE);
  redirect("/courses");
}

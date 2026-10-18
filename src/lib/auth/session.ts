import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/server";

type Role = "teacher" | "student" | "guardian";
type SessionUser = NonNullable<Session["user"]>;

export interface AppSessionUser {
  id: string;
  role: Role;
  name?: string | null;
  email?: string | null;
}

/**
 * 指定ロールでのログインを要求する。未ログイン/ロール不一致ならリダイレクトする。
 * 戻り値の user は id / role を含む(session.user の生の型は id/role を持たないため、ここで整形する)。
 */
export async function requireRole(role: Role): Promise<{ user: AppSessionUser }> {
  const session = await auth();
  const rawUser = session?.user as (SessionUser & { id?: string; role?: Role }) | undefined;

  if (!rawUser?.id) {
    redirect("/login");
  }
  if (rawUser.role !== role) {
    // 段階1では簡易に「役割違い」を弾く。専用の403ページは後で用意する。
    redirect("/login");
  }

  return {
    user: {
      id: rawUser.id,
      role: rawUser.role,
      name: rawUser.name,
      email: rawUser.email,
    },
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** 管理者(profiles.is_admin)かどうか。教師アカウントのうち、教師の承認ができる人だけが true。 */
export async function isAdmin(admin: AdminClient, profileId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("is_admin").eq("id", profileId).maybeSingle();
  return data?.is_admin === true;
}

/**
 * 管理者としてのログインを要求する。教師でない・管理者でない場合はリダイレクトする
 * (教師の承認など、アプリ全体に関わる操作用。管理者は別ロールではなく教師の1人に付く属性)。
 */
export async function requireAdmin(): Promise<{ user: AppSessionUser }> {
  const { user } = await requireRole("teacher");
  if (!(await isAdmin(createAdminClient(), user.id))) {
    redirect("/courses");
  }
  return { user };
}

/** ロールを問わず、ログイン中であることだけを要求する(パスワード変更など全員共通の画面用)。 */
export async function requireLogin(): Promise<{ user: AppSessionUser }> {
  const session = await auth();
  const rawUser = session?.user as (SessionUser & { id?: string; role?: Role }) | undefined;
  if (!rawUser?.id || !rawUser.role) {
    redirect("/login");
  }
  return {
    user: { id: rawUser.id, role: rawUser.role, name: rawUser.name, email: rawUser.email },
  };
}

import { cookies } from "next/headers";
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
    // 管理者が「学習者として表示」(動作確認)を使っている間だけ、学習者の画面に入れる。
    if (role === "student" && rawUser.role === "teacher") {
      const viewAs = await resolveViewAsStudent({ id: rawUser.id, role: rawUser.role });
      if (viewAs) return { user: viewAs };
    }
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

// ---- 管理者の「学習者として表示」(動作確認用、src/lib/auth/view-as.ts参照) ----

export const VIEW_AS_COOKIE = "synclie_view_as";

/**
 * 管理者が「学習者として表示」中なら、その間の学習者(管理者専用のテスト学習者)を返す。
 * Cookieは「切り替え中」の目印にすぎず、信用しない: 毎回、本人が管理者(profiles.is_admin)であること
 * をDBで確かめ、その人専用のテスト学習者(test_owner_id)が実在する時だけ有効にする
 * (管理者でない人がCookieを偽装しても、何も起きない)。
 */
async function resolveViewAsStudent(realUser: { id: string; role?: Role }): Promise<AppSessionUser | null> {
  if (realUser.role !== "teacher") return null;
  const cookieStore = await cookies();
  if (cookieStore.get(VIEW_AS_COOKIE)?.value !== "student") return null;

  const admin = createAdminClient();
  if (!(await isAdmin(admin, realUser.id))) return null;

  const { data } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("test_owner_id", realUser.id)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, role: "student", name: data.display_name, email: null };
}

/**
 * いま学習者として振る舞うユーザー(学習者本人、または「学習者として表示」中の管理者のテスト学習者)。
 * 学習者でも、切り替え中の管理者でもなければ null(ページ側のrequireRoleと違い、リダイレクトしない。
 * APIなど、リダイレクトでは返せない所で使う)。
 */
export async function getEffectiveStudent(): Promise<AppSessionUser | null> {
  const session = await auth();
  const rawUser = session?.user as (SessionUser & { id?: string; role?: Role }) | undefined;
  if (!rawUser?.id) return null;
  if (rawUser.role === "student") {
    return { id: rawUser.id, role: "student", name: rawUser.name, email: rawUser.email };
  }
  return resolveViewAsStudent({ id: rawUser.id, role: rawUser.role });
}

/** 管理者として「学習者として表示」中かどうか(画面上部の表示用)。 */
export async function isViewingAsStudent(): Promise<boolean> {
  const session = await auth();
  const rawUser = session?.user as (SessionUser & { id?: string; role?: Role }) | undefined;
  if (!rawUser?.id || rawUser.role !== "teacher") return false;
  return (await resolveViewAsStudent({ id: rawUser.id, role: rawUser.role })) !== null;
}

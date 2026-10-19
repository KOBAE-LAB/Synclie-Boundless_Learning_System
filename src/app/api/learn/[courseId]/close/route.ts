import { revalidatePath } from "next/cache";
import { getEffectiveStudent } from "@/lib/auth/session";
import { hasConsent } from "@/lib/consent";
import { isEnrolled } from "@/lib/courses/enrollment";
import { createAdminClient } from "@/lib/supabase/server";
import { closeDiscussion } from "@/lib/learn/close";

// 議論を終えて、AIのまとめを作る(「まとめに進む」ボタン・制限時間の終了から呼ばれる)。
// 発言送信API(../message)と同じ境界: 学習者本人(または管理者のテスト学習者)で、同意済みで、
// この授業に参加登録(承認済み)していること。
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  const user = await getEffectiveStudent();
  if (!user) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!(await hasConsent(admin, user.id))) {
    return Response.json({ error: "データ利用への同意が必要です。" }, { status: 403 });
  }
  if (!(await isEnrolled(admin, courseId, user.id))) {
    return Response.json({ error: "この授業への参加登録がありません。" }, { status: 403 });
  }

  try {
    const { summary, alreadyEnded } = await closeDiscussion(admin, courseId, user.id);
    revalidatePath(`/learn/${courseId}`);
    return Response.json({ ok: true, summary, alreadyEnded });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "議論のまとめに失敗しました。" },
      { status: 500 },
    );
  }
}

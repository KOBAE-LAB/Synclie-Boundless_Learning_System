import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

// 管理者の「学習者として表示」(動作確認用)の仕組み。
//
// 管理者は教師アカウントなので、そのままでは学習者の画面(/learn)に入れない。そこで、管理者ごとに
// 専用の「テスト学習者」(profiles.test_owner_id)を1つ用意し、切り替え中だけ、その人として
// 学習者の画面を使えるようにする。発言・提出物などは全てテスト学習者のデータになり、
// 管理者自身のデータとは混ざらない。テスト学習者は、パスワードもメールアドレスも持たないため、
// 直接ログインすることはできない。
export const TEST_STUDENT_NAME = "テスト学習者";

/** 管理者のテスト学習者を取得する(無ければ作る)。 */
export async function getOrCreateTestStudent(admin: AdminClient, adminId: string): Promise<string> {
  const find = async () => {
    const { data } = await admin.from("profiles").select("id").eq("test_owner_id", adminId).maybeSingle();
    return data?.id as string | undefined;
  };

  const existing = await find();
  if (existing) return existing;

  const { data: created, error } = await admin
    .from("profiles")
    .insert({
      id: crypto.randomUUID(),
      role: "student",
      display_name: TEST_STUDENT_NAME,
      test_owner_id: adminId,
    })
    .select("id")
    .single();
  if (error || !created) {
    // 同時に2か所から作られた場合(unique制約違反)は、先にできた方を使う。
    const raced = await find();
    if (raced) return raced;
    throw new Error(`テスト学習者の作成に失敗しました: ${error?.message ?? "不明なエラー"}`);
  }
  return created.id;
}

/** テスト学習者を、その授業の承認済みの受講者にする(授業画面に入れるようにする)。 */
export async function ensureTestStudentEnrolled(
  admin: AdminClient,
  adminId: string,
  courseId: string,
): Promise<string> {
  const testStudentId = await getOrCreateTestStudent(admin, adminId);
  const { data: lesson } = await admin.from("courses").select("series_id").eq("id", courseId).maybeSingle();
  if (!lesson) {
    throw new Error("授業が見つかりません。");
  }
  const { error } = await admin
    .from("series_enrollments")
    .upsert(
      { series_id: lesson.series_id, student_id: testStudentId, status: "approved" },
      { onConflict: "series_id,student_id" },
    );
  if (error) {
    throw new Error(`テスト学習者の参加登録に失敗しました: ${error.message}`);
  }
  return testStudentId;
}

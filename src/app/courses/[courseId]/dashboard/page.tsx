import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { loadCourseStats } from "@/lib/teacher-guidance/stats";
import { SubmitButton } from "@/components/submit-button";
import { generateTeacherGuidanceAction } from "./actions";

interface GuidanceContent {
  classOverview: string;
  facilitation: string[];
  nextActivity: string;
  individuals: { studentId: string; observation: string; suggestedAction: string }[];
  studentCount: number;
}

// F14: 教師ダッシュボード。
// 「参加状況、つまずき、擬似メンバーの挙動を確認し、学級・個人の指導計画に活かす」
// (要件定義書4章)。「状況を確認するだけで終わらせず、次に何に取り組むかをその場で
// 決められる形にする」(要件定義書7章)ため、各行から学習者プロファイル・個別最適化の
// 判断(F09/F11)やペルソナの挙動監査(F20)へ直接リンクする。
// 新規のAI呼び出しは行わず、既存の蓄積データ(dialogue_turns/submissions/
// argument_evaluations/student_profiles)を集計するだけの読み取り専用画面にする
// (呼び出し回数を増やさないコスト方針、要件定義書10章)。
//
// 学習者一覧は学習セッション(learning_sessions)を基準にする。students/(F09/F11)は
// 提出物がある学習者だけを対象にしているが、ダッシュボードは「対話はしたが一度も
// 提出していない」学習者も参加状況の一部として拾う必要があるため、より広い基準にしている。

export default async function CourseDashboardPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const { stats: statList, names: studentNames, turnIds } = await loadCourseStats(admin, courseId);

  const { data: guidanceRow } = await admin
    .from("teacher_guidance")
    .select("status, error, content, generated_at")
    .eq("course_id", courseId)
    .maybeSingle();
  const guidance = guidanceRow?.status === "done" ? (guidanceRow.content as GuidanceContent | null) : null;

  const STRUGGLE_SCORE_THRESHOLD = 2.5; // 0〜5点中。閾値は暫定(運用しながら調整する)。

  // 擬似メンバーの挙動: F20と同じデータソースをペルソナ単位に集計する(詳細はF20の画面へ)。
  const { data: activePersonas } = await admin
    .from("personas")
    .select("id, name")
    .eq("course_id", courseId)
    .eq("status", "active");
  const personaNames = new Map((activePersonas ?? []).map((p) => [p.id, p.name]));

  const personaStats = new Map<string, { total: number; unwarranted: number }>();
  if (turnIds.length > 0) {
    const { data: personaEvaluations } = await admin
      .from("argument_evaluations")
      .select("persona_id, unwarranted_conformity")
      .in("dialogue_turn_id", turnIds)
      .not("persona_id", "is", null);
    for (const evaluation of personaEvaluations ?? []) {
      const key = evaluation.persona_id as string;
      const stat = personaStats.get(key) ?? { total: 0, unwarranted: 0 };
      stat.total += 1;
      if (evaluation.unwarranted_conformity) stat.unwarranted += 1;
      personaStats.set(key, stat);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/courses" }, { label: course.title, href: `/courses/${courseId}` }]} current="教師ダッシュボード" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        教師ダッシュボード(F14)
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        参加状況・つまずき・擬似メンバーの挙動をまとめて確認し、学級・個人の指導計画に活かす。
        各行から学習者プロファイルの確認・生成(F09)や個別最適化の判断(F11)にそのまま進める。
      </p>

      <section className="mt-6 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">指導のヒント(AIの提案)</h2>
        <p className="mt-1 text-xs text-ink-muted">
          参加状況・論証評価・つまずき・学習者が共有した迷ったこと・議論の問いをもとに、次にどうファシリテートし、
          どう指導するとよいかを提案します。学習者の氏名はAIに送りません。提案は材料で、判断と実行は先生です。
          押したときだけ生成されます。
        </p>
        <form action={generateTeacherGuidanceAction.bind(null, courseId)} className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingText="生成中…"
            className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            {guidance ? "ヒントを再生成する" : "指導のヒントを生成する"}
          </SubmitButton>
          {guidanceRow?.generated_at && guidance && (
            <span className="text-xs text-ink-faint">
              {new Date(guidanceRow.generated_at).toLocaleString("ja-JP")}に生成(同意済み{guidance.studentCount}人分)
            </span>
          )}
        </form>
        {guidanceRow?.status === "failed" && guidanceRow.error && (
          <p className="mt-2 text-xs text-danger">{guidanceRow.error}</p>
        )}
        {guidance && (
          <div className="mt-4 space-y-4 border-t border-line pt-4 text-sm">
            <div>
              <p className="text-xs font-medium text-ink-muted">授業全体の様子</p>
              <p className="mt-1">{guidance.classOverview}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-muted">次の授業でのファシリテーション</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {guidance.facilitation.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-muted">次の活動・投げかけたい問い</p>
              <p className="mt-1">{guidance.nextActivity}</p>
            </div>
            {guidance.individuals.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ink-muted">個別に声をかけるとよい学習者</p>
                <ul className="mt-1 space-y-2">
                  {guidance.individuals.map((item) => (
                    <li key={item.studentId} className="rounded-md border border-line px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="font-medium text-ink">{studentNames.get(item.studentId) ?? "(不明な学習者)"}</span>
                        <Link href={`/courses/${courseId}/students#${item.studentId}`} className="text-xs text-ink-muted hover:underline">
                          プロファイル・提案を見る →
                        </Link>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">{item.observation}</p>
                      <p className="mt-1">{item.suggestedAction}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-ink-faint">
              AIが記録から作った提案です。学習者の様子の最終的な判断は、先生が行ってください。擬似メンバーの設定を
              変えたいときは「ペルソナ設定」へ。
            </p>
          </div>
        )}
      </section>

      <h2 className="mt-8 text-sm font-medium text-ink">
        学習者の参加状況とつまずき
      </h2>
      <ul className="mt-3 space-y-2">
        {statList.map((stat) => {
          const struggling =
            (stat.avgScore !== null && stat.avgScore < STRUGGLE_SCORE_THRESHOLD) ||
            (stat.turnCount > 0 && stat.submissionCount === 0);
          return (
            <li
              key={stat.studentId}
              className={`rounded-md border px-4 py-3 text-sm ${
                struggling
                  ? "border-warn bg-warn-soft"
                  : "border-line"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-ink">
                  {studentNames.get(stat.studentId) ?? "(不明な学習者)"}
                </span>
                <Link
                  href={`/courses/${courseId}/students#${stat.studentId}`}
                  className="shrink-0 text-xs text-ink-muted hover:underline"
                >
                  プロファイル・提案を見る(F09/F11)→
                </Link>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                発言{stat.turnCount}件・提出{stat.submissionCount}件
                {stat.avgScore !== null && `・論証評価平均${stat.avgScore.toFixed(1)}点`}
                {stat.lastActivityAt &&
                  `・最終活動 ${new Date(stat.lastActivityAt).toLocaleString("ja-JP")}`}
              </p>
              {stat.turnCount > 0 && stat.submissionCount === 0 && (
                <p className="mt-1 text-xs text-warn">
                  対話はあるが、まだ成果(F06)を提出していない。
                </p>
              )}
              {stat.avgScore !== null && stat.avgScore < STRUGGLE_SCORE_THRESHOLD && (
                <p className="mt-1 text-xs text-warn">
                  論証評価の平均が低め(根拠・論理構成・反論への応答)。
                </p>
              )}
              {stat.challenges && (
                <p className="mt-1 text-xs text-ink-muted">課題(F09): {stat.challenges}</p>
              )}
            </li>
          );
        })}
        {statList.length === 0 && (
          <li className="text-sm text-ink-muted">まだ活動記録のある学習者がいません。</li>
        )}
      </ul>

      <h2 className="mt-8 text-sm font-medium text-ink">
        擬似メンバーの挙動(F20)
      </h2>
      <ul className="mt-3 space-y-2">
        {[...personaStats.entries()].map(([personaId, stat]) => (
          <li key={personaId} className="flex flex-wrap items-center justify-between text-sm">
            <span>{personaNames.get(personaId) ?? "(承認待ち等)"}</span>
            <span className="text-ink-muted">
              根拠なく同調 {stat.unwarranted}/{stat.total}件(
              {Math.round((stat.unwarranted / stat.total) * 100)}%)
            </span>
          </li>
        ))}
        {personaStats.size === 0 && <li className="text-sm text-ink-muted">まだ評価データがありません。</li>}
      </ul>
      <Link
        href={`/courses/${courseId}/conformity`}
        className="mt-2 inline-block text-xs text-ink-muted hover:underline"
      >
        発言単位の詳細を見る(F20)→
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/audit`}
        className="mt-1 inline-block text-xs text-ink-muted hover:underline"
      >
        発言を確認・修正する(F15)→
      </Link>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}

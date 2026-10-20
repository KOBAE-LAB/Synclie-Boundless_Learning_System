import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { linkResourceDirectlyAction } from "./actions";

// F17: LMS側で「どのSynclieの授業を使うか」を教師が選ぶ画面。
// 2つの経路から来る:
//  (1) Deep Linking(returnUrlあり): LMSの課題作成画面から呼ばれた本物のフロー。
//      選ぶと /courses/lti-deep-link/submit で署名付きの応答をLMSへ返す。
//  (2) Deep Linkingを経ない直接起動(returnUrlなし): まだ紐づいていないリソースリンクを
//      教師がこの場で選び直す(linkResourceDirectlyActionでDBに直接書き込む)。
export default async function LtiDeepLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireRole("teacher");
  const params = await searchParams;
  const issuer = params.issuer ?? "";
  const deploymentId = params.deploymentId ?? "";
  const resourceLinkId = params.resourceLinkId ?? "";
  const contextId = params.contextId ?? "";
  const returnUrl = params.returnUrl ?? "";

  const admin = createAdminClient();
  const { data: courses } = await admin
    .from("courses")
    .select("id, title, subject")
    .eq("owner_teacher_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">
        LMSにリンクする授業を選ぶ
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {returnUrl
          ? "LMSの課題にリンクするSynclieの授業を選んでください。選ぶとLMSの画面に戻ります。"
          : "この課題(リソースリンク)にリンクするSynclieの授業を選んでください。"}
      </p>

      <ul className="mt-8 space-y-2">
        {(courses ?? []).map((course) => {
          const submitParams = new URLSearchParams({
            courseId: course.id,
            issuer,
            deploymentId,
            resourceLinkId,
            contextId,
            returnUrl,
          });
          return (
            <li key={course.id} className="rounded-md border border-line px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="font-medium text-ink">{course.title}</span>
                  {course.subject && <span className="ml-2 text-ink-muted">({course.subject})</span>}
                </span>
                {returnUrl ? (
                  <Link
                    href={`/courses/lti-deep-link/submit?${submitParams.toString()}`}
                    className="shrink-0 rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover"
                  >
                    この授業を選ぶ
                  </Link>
                ) : (
                  <form action={linkResourceDirectlyAction}>
                    <input type="hidden" name="courseId" value={course.id} />
                    <input type="hidden" name="issuer" value={issuer} />
                    <input type="hidden" name="deploymentId" value={deploymentId} />
                    <input type="hidden" name="resourceLinkId" value={resourceLinkId} />
                    <button
                      type="submit"
                      className="shrink-0 rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover"
                    >
                      この授業を選ぶ
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
        {(!courses || courses.length === 0) && (
          <li className="text-sm text-ink-muted">まだ授業がありません。先に授業を作成してください。</li>
        )}
      </ul>
    </div>
  );
}

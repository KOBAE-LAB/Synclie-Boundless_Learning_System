import { getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { getLtiConfig } from "@/lib/lti/config";
import { signDeepLinkingResponse } from "@/lib/lti/keys";

// F17: Deep Linking応答(LtiDeepLinkingResponse)をLMSへ返す。
// content itemのurlに `course_id` を埋め込んでおくことで、以後この課題が起動されるたびに
// /api/lti/login がそのcourse_idを拾い、初回起動時にlti_resource_linksへ登録できる
// (resource_link_idはLMS側がリンクを作成するまで分からないため)。
// 署名済みJWTをhidden inputに入れ、ブラウザから自動でLMSへform_postする(クライアントJS無し、
// フォームのautoFocus+onload属性のみ)。
export default async function LtiDeepLinkSubmitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireRole("teacher");
  const params = await searchParams;
  const courseId = params.courseId ?? "";
  const issuer = params.issuer ?? "";
  const deploymentId = params.deploymentId ?? "";
  const returnUrl = params.returnUrl ?? "";

  const config = getLtiConfig();
  if (!config || !courseId || !issuer || !deploymentId || !returnUrl) {
    notFound();
  }

  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);
  const { data: course } = await admin.from("courses").select("id, title").eq("id", courseId).single();
  if (!course) {
    notFound();
  }

  const responseJwt = await signDeepLinkingResponse({
    platformClientId: config.platformClientId,
    issuer,
    deploymentId,
    courseTitle: course.title,
    targetLinkUri: `${config.toolBaseUrl}/api/lti/login?course_id=${courseId}`,
  });

  const { t } = await getT();
  return (
    <div className="mx-auto max-w-md px-6 py-12 text-center text-sm text-ink-muted">
      <p>{t("lti.returning")}</p>
      <form id="lti-deep-link-response-form" method="POST" action={returnUrl}>
        <input type="hidden" name="JWT" value={responseJwt} />
        <noscript>
          <button type="submit" className="mt-4 rounded-md bg-accent-fill px-4 py-2 text-sm text-white">
            {t("lti.continue")}
          </button>
        </noscript>
      </form>
      {/* クライアントJSフレームワークは使わない方針のため、静的なscriptタグで自動送信する
          (Reactのイベントハンドラではなく、素のHTML/JSとして解釈される)。 */}
      <script
        dangerouslySetInnerHTML={{
          __html: "document.getElementById('lti-deep-link-response-form').submit();",
        }}
      />
    </div>
  );
}

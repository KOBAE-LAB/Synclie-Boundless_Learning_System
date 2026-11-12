import { getT } from "@/lib/i18n/server";
import Link from "next/link";
import Image from "next/image";
import { BRAND_LOGO_SRC } from "@/lib/brand";

// サインアップの入口。学習者(授業コードで申請)か教師(管理者の承認制)かを選ぶ。
export default async function SignupPage() {
  const { t } = await getT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-8 shadow-sm">
        <div>
          <Image src={BRAND_LOGO_SRC} unoptimized alt="" width={56} height={56} priority className="mb-3 rounded-full" />
          <h1 className="text-xl font-semibold text-ink">{t("signup.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("signup.pick")}</p>
        </div>

        <Link
          href="/signup/student"
          className="block rounded-md border border-line px-4 py-3 text-sm hover:bg-surface-raised"
        >
          <span className="font-medium text-ink">{t("signup.asStudent")}</span>
          <span className="mt-1 block text-xs text-ink-muted">
            {t("signup.studentNote")}
          </span>
        </Link>
        <Link
          href="/signup/teacher"
          className="block rounded-md border border-line px-4 py-3 text-sm hover:bg-surface-raised"
        >
          <span className="font-medium text-ink">{t("signup.asTeacher")}</span>
          <span className="mt-1 block text-xs text-ink-muted">
            {t("signup.teacherNote")}
          </span>
        </Link>

        <Link href="/login" className="inline-block text-sm text-ink-muted underline underline-offset-2">
          {t("signup.backToLogin")}
        </Link>
      </div>
    </div>
  );
}

import { getT } from "@/lib/i18n/server";
import { requireLogin } from "@/lib/auth/session";
import { changePasswordAction } from "./actions";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { user } = await requireLogin();
  const { error, done } = await searchParams;
  const { t } = await getT();
  const home = user.role === "teacher" ? "/courses" : "/learn";

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <Breadcrumbs trail={[{ label: t("learnList.title"), href: home }]} current={t("account.title")} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{t("account.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{user.name ?? user.email}</p>

      {done && (
        <p className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted" role="status">
          {t("account.done")}
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <form action={changePasswordAction} className="mt-6 space-y-4">
        <div className="space-y-1">
          <label htmlFor="current" className="text-sm font-medium text-ink">
            {t("account.current")}
          </label>
          <input
            id="current"
            name="current"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="next" className="text-sm font-medium text-ink">
            {t("account.next")}
          </label>
          <input
            id="next"
            name="next"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          {t("account.change")}
        </button>
      </form>

    </div>
  );
}

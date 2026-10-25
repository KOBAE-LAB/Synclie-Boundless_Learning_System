"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { useT } from "@/lib/i18n/client";

export function LoginForm() {
  const t = useT();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          {t("login.email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium text-ink">
          {t("login.password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-fill-hover disabled:opacity-50"
      >
        {pending ? t("login.submitting") : t("login.submit")}
      </button>
    </form>
  );
}

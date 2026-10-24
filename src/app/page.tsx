import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PrVideo } from "@/components/pr-video";

// ログイン後の遷移先をロールで振り分ける(教師→/courses、学習者→/learn)。
// login/actions.ts の loginAction は redirectTo: "/" に固定しているため、
// ロールごとの行き先はここでまとめて決める。
export default async function Home() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (role === "teacher") {
    redirect("/courses");
  }
  if (role === "student") {
    redirect("/learn");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center font-sans">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        Synclie
      </h1>
      <p className="text-sm font-medium tracking-wide text-ink-muted">
        Boundless Learning System
      </p>
      <p className="max-w-xl text-base text-ink-muted">
        オンデマンド学習をインタラクティブに、独習を個別最適に。
        AI擬似メンバーとの協働・討論を通じて学ぶ、離島発・世界水準の学習体験を目指しています。
      </p>
      <PrVideo className="mt-2 w-full max-w-xl" />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/login"
          className="rounded-md bg-accent-fill px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-fill-hover"
        >
          ログインする
        </Link>
        <Link
          href="/signup"
          className="rounded-md border border-line px-6 py-2.5 text-sm font-medium text-ink hover:bg-surface"
        >
          新規登録
        </Link>
      </div>
      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-faint">
        <Link href="/privacy" className="underline underline-offset-2">
          プライバシーポリシー
        </Link>
        <Link href="/terms" className="underline underline-offset-2">
          利用規約
        </Link>
      </p>
    </div>
  );
}

import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import type { Metadata } from "next";
import Link from "next/link";
import videos from "./videos.json";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("guidePage.metaTitle"), description: t("guidePage.metaDesc") };
}

const NUMBERS = ["①", "②", "③", "④", "⑤"];

function minutes(seconds: number, t: Translator) {
  return t("guidePage.about", { n: Math.max(1, Math.round(seconds / 60)) });
}

// ログインしていなくても見られる公開ページ。動画は public/guide/ に置き、字幕(WebVTT)と文字起こしを添える。
export default async function GuidePage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">{t("guidePage.heading")}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {t("guidePage.lead")}
      </p>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {videos.map((v, i) => (
          <li key={v.slug}>
            <a href={`#${v.slug}`} className="text-ink underline underline-offset-2">
              {NUMBERS[i]} {v.title}
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-10 space-y-14">
        {videos.map((v, i) => (
          <section key={v.slug} id={v.slug} aria-labelledby={`${v.slug}-title`} className="scroll-mt-6">
            <h2 id={`${v.slug}-title`} className="text-lg font-semibold text-ink">
              {NUMBERS[i]} {v.title}
              <span className="ml-2 text-sm font-normal text-ink-muted">{minutes(v.seconds, t)}</span>
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{v.description}</p>
            <video
              className="mt-3 w-full rounded-md border border-line bg-black"
              controls
              preload="none"
              playsInline
              poster={`/guide/${v.slug}.jpg`}
            >
              <source src={`/guide/${v.slug}.mp4`} type="video/mp4" />
              <track kind="captions" src={`/guide/${v.slug}.ja.vtt`} srcLang="ja" label="日本語" />
              {t("guidePage.noSupport")}
            </video>
            <details className="mt-3 rounded-md border border-line px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">{t("guidePage.transcript")}</summary>
              <div className="mt-3 space-y-3 text-sm leading-7 text-ink-muted">
                {v.transcript.map((t, k) => (
                  <div key={k}>
                    <p className="font-medium text-ink">{t.heading}</p>
                    <p>{t.text}</p>
                  </div>
                ))}
              </div>
            </details>
          </section>
        ))}
      </div>

      <p id="credit" className="mt-10 text-xs text-ink-muted">
        {t("guidePage.credit")}
      </p>

      <nav className="mt-12 flex flex-wrap gap-x-4 gap-y-2 border-t border-line-soft pt-6 text-sm text-ink-muted">
        <Link href="/" className="underline underline-offset-2">
          {t("guidePage.top")}
        </Link>
        <Link href="/login" className="underline underline-offset-2">
          {t("guidePage.login")}
        </Link>
      </nav>
    </div>
  );
}

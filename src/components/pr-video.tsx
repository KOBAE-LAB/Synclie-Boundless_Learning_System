import Link from "next/link";
import videos from "@/app/guide/videos.json";
import { getT } from "@/lib/i18n/server";

/** システムの機能PR動画(トップ画面・ログイン画面に置く)。再生するまで読み込まない。字幕つき。 */
export async function PrVideo({ className = "" }: { className?: string }) {
  const { t } = await getT();
  const v = videos.find((x) => x.slug === "feature-pr");
  if (!v) return null;
  const minutes = Math.max(1, Math.round(v.seconds / 60));
  return (
    <figure className={className}>
      <video
        className="w-full rounded-md border border-line bg-black"
        controls
        preload="none"
        playsInline
        poster="/guide/feature-pr.jpg"
        aria-label={t("prVideo.aria", { minutes })}
      >
        <source src="/guide/feature-pr.mp4" type="video/mp4" />
        <track kind="captions" src="/guide/feature-pr.ja.vtt" srcLang="ja" label="日本語" />
        {t("prVideo.unsupported")}
      </video>
      <figcaption className="mt-1 text-xs text-ink-muted">
        {t("prVideo.caption", { minutes })}{" "}
        <Link href="/guide#feature-pr" className="underline underline-offset-2">
          {t("prVideo.transcript")}
        </Link>
        <span className="ml-2">
          {t("prVideo.voice")}: Open JTalk「Mei」(
          <Link href="/guide#credit" className="underline underline-offset-2">
            CC BY 3.0
          </Link>
          )
        </span>
      </figcaption>
    </figure>
  );
}

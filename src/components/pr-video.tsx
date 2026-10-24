import Link from "next/link";
import videos from "@/app/guide/videos.json";

/** システムの機能PR動画(トップ画面・ログイン画面に置く)。再生するまで読み込まない。字幕つき。 */
export function PrVideo({ className = "" }: { className?: string }) {
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
        aria-label={`システムの機能PR動画(約${minutes}分)`}
      >
        <source src="/guide/feature-pr.mp4" type="video/mp4" />
        <track kind="captions" src="/guide/feature-pr.ja.vtt" srcLang="ja" label="日本語" default />
        お使いのブラウザは動画に対応していません。
      </video>
      <figcaption className="mt-1 text-xs text-ink-muted">
        システムの機能PR動画(約{minutes}分・字幕つき){" "}
        <Link href="/guide#feature-pr" className="underline underline-offset-2">
          文字起こしを読む
        </Link>
      </figcaption>
    </figure>
  );
}

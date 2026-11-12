// サイトのロゴ。KOBAE-LABのマスコット(Techるくん)を使うかどうかの切り替え。
// 2026-11: 文部科学省の研修で使うため、一時的にマスコットを外している(SHOW_MASCOT = false)。
// 研修が終わったら true に戻すだけで、ヘッダー・ログイン・登録画面・ブラウザのタブのアイコンが元に戻る。
// (使い方ガイドの動画は、映像そのものにロゴが入っているため、この切り替えでは変わらない。
//  scripts/guide-video/README.md の「ロゴの差し替え」を参照)
export const SHOW_MASCOT = false;

export const BRAND_LOGO_SRC = SHOW_MASCOT ? "/logo.png" : "/logo-plain.svg";
export const BRAND_ICON_SRC = SHOW_MASCOT ? "/icon-mascot.png" : "/logo-plain.svg";

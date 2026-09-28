import { describe, expect, it } from "vitest";
import { isPersonaMentioned } from "./persona-mention";

// この判定ロジックは、実際に「山田くんと短く呼びかけても本人ではなく
// 別のペルソナが答えてしまう」という不具合の原因だった(フルネーム完全一致でしか
// 判定していなかったため)。同じ不具合を再発させないための回帰テスト。
describe("isPersonaMentioned", () => {
  it("教師が付けた説明的な名前の一部(短い呼び方)でも名指しと判定する", () => {
    expect(isPersonaMentioned("討論好きの山田くん", "山田くんはどう思う？")).toBe(true);
  });

  it("フルネームでの名指しも判定する", () => {
    expect(isPersonaMentioned("討論好きの山田くん", "討論好きの山田くんに聞きたい")).toBe(true);
  });

  it("無関係な発言では名指しと判定しない", () => {
    expect(isPersonaMentioned("討論好きの山田くん", "水はどうやって循環しますか？")).toBe(false);
  });

  it("2文字以下の断片的な一致では名指しと判定しない(誤検出を避ける)", () => {
    // 敬称「くん」だけが一致するような場合まで拾うと、無関係な「〜くん」を含む発言
    // (別の人物の名前など)にも誤反応してしまうため、3文字未満の末尾一致は無視する。
    expect(isPersonaMentioned("討論好きの山田くん", "太郎くんも一緒にいますか？")).toBe(false);
  });

  it("名前の途中の断片だけでは名指しと判定しない", () => {
    expect(isPersonaMentioned("討論好きの山田くん", "討論するのは楽しいですね")).toBe(false);
  });
});

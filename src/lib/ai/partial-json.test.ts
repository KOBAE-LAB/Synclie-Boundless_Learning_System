import { describe, expect, it } from "vitest";
import { extractPartialJsonString, extractPartialSceneMessages } from "./partial-json";

describe("extractPartialJsonString", () => {
  it("キーがまだ届いていなければnull", () => {
    expect(extractPartialJsonString('{"rep', "reply")).toBeNull();
    expect(extractPartialJsonString("", "reply")).toBeNull();
  });

  it("閉じていない文字列は、届いている分まで返す", () => {
    expect(extractPartialJsonString('{"reply":"こんに', "reply")).toBe("こんに");
  });

  it("文字列が閉じたら、以降(別のキー)は含めない", () => {
    expect(extractPartialJsonString('{"reply":"こんにちは","conceded":false}', "reply")).toBe("こんにちは");
  });

  it("エスケープ(改行・引用符・バックスラッシュ)を解釈する", () => {
    expect(extractPartialJsonString('{"reply":"a\\nb \\"c\\" d\\\\e"}', "reply")).toBe('a\nb "c" d\\e');
  });

  it("切れかけのエスケープは、次の断片が届くまで出さない", () => {
    expect(extractPartialJsonString('{"reply":"ab\\', "reply")).toBe("ab");
    expect(extractPartialJsonString('{"reply":"ab\\u30', "reply")).toBe("ab");
    expect(extractPartialJsonString('{"reply":"ab\\u3042c', "reply")).toBe("abあc");
  });

  it("キーの前後に空白があっても取り出せる", () => {
    expect(extractPartialJsonString('{ "reply" : "x"', "reply")).toBe("x");
  });

  it("断片を足していくと、出力は単調に伸びる(途中で巻き戻らない)", () => {
    const full = '{"reply":"こんにちは\\nお元気ですか","conceded":true}';
    let prev = "";
    for (let n = 1; n <= full.length; n++) {
      const cur = extractPartialJsonString(full.slice(0, n), "reply") ?? "";
      expect(cur.startsWith(prev)).toBe(true);
      prev = cur;
    }
    expect(prev).toBe("こんにちは\nお元気ですか");
  });
});

describe("extractPartialSceneMessages", () => {
  const full =
    '{"messages":[{"speaker":"コウタ","reply":"うーん、{根拠}は?","conceded":false},{"speaker":"ナナ","reply":"私は\\"違う\\"と思う","conceded":false}]}';

  it("messagesがまだ届いていなければ空", () => {
    expect(extractPartialSceneMessages("")).toEqual([]);
    expect(extractPartialSceneMessages('{"mess')).toEqual([]);
    expect(extractPartialSceneMessages('{"messages":[')).toEqual([]);
  });

  it("最初のメッセージの途中: 話者はまだ確定せず、返答は届いた分だけ", () => {
    expect(extractPartialSceneMessages('{"messages":[{"speaker":"コウ')).toEqual([
      { speaker: null, reply: "", complete: false },
    ]);
    expect(extractPartialSceneMessages('{"messages":[{"speaker":"コウタ","reply":"うーん')).toEqual([
      { speaker: "コウタ", reply: "うーん", complete: false },
    ]);
  });

  it("全部届くと、メッセージごとの話者・返答・完了が取れる(文字列中の括弧・引用符も壊れない)", () => {
    expect(extractPartialSceneMessages(full)).toEqual([
      { speaker: "コウタ", reply: "うーん、{根拠}は?", complete: true },
      { speaker: "ナナ", reply: '私は"違う"と思う', complete: true },
    ]);
  });

  it("2つ目の途中: 1つ目は完了、2つ目は届いた分だけ", () => {
    const cut = full.slice(0, full.indexOf("私は") + 3);
    const result = extractPartialSceneMessages(cut);
    expect(result).toHaveLength(2);
    expect(result[0].complete).toBe(true);
    expect(result[1]).toMatchObject({ speaker: "ナナ", complete: false });
    expect(result[1].reply.startsWith("私は")).toBe(true);
  });

  it("どの位置で切っても、既に確定したメッセージの内容が後退・変化しない", () => {
    let prev: ReturnType<typeof extractPartialSceneMessages> = [];
    for (let n = 1; n <= full.length; n++) {
      const cur = extractPartialSceneMessages(full.slice(0, n));
      expect(cur.length).toBeGreaterThanOrEqual(prev.length);
      prev.forEach((m, k) => {
        if (m.complete) expect(cur[k]).toEqual(m);
        else expect(cur[k].reply.startsWith(m.reply)).toBe(true);
      });
      prev = cur;
    }
    expect(prev).toHaveLength(2);
  });
});

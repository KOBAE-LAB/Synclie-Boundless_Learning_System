import { describe, expect, it } from "vitest";
import { extractPartialJsonString } from "./partial-json";

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

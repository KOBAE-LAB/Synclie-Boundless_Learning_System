import { describe, expect, it } from "vitest";
import { canOpenStep, currentStep, discussionGate, hasLaterOutput, parseVideoUrl, readCheckQuestions, validateVideoFile, MAX_VIDEO_BYTES, type FlowStep } from "./steps";

const steps: FlowStep[] = [
  { id: "i1", position: 1, kind: "input", title: "動画を見る" },
  { id: "o1", position: 2, kind: "output", title: "議論する" },
  { id: "i2", position: 3, kind: "input", title: "資料を読む" },
  { id: "o2", position: 4, kind: "output", title: "もう一度議論" },
];
const done = (...ids: string[]) => new Set(ids);

describe("currentStep", () => {
  it("まだ終えていない最初のステップ(順序はpositionで決める)", () => {
    expect(currentStep(steps, done())?.id).toBe("i1");
    expect(currentStep([...steps].reverse(), done("i1"))?.id).toBe("o1");
    expect(currentStep(steps, done("i1", "o1", "i2", "o2"))).toBeNull();
  });
});

describe("discussionGate", () => {
  it("インプットの間は議論に入れない(順番を強制する授業)", () => {
    expect(discussionGate(steps, done(), true).allowed).toBe(false);
    expect(discussionGate(steps, done("i1", "o1"), true).allowed).toBe(false);
  });
  it("アウトプットの間・全部終えたあとは入れる", () => {
    expect(discussionGate(steps, done("i1"), true).allowed).toBe(true);
    expect(discussionGate(steps, done("i1", "o1", "i2", "o2"), true).allowed).toBe(true);
  });
  it("ステップが無い授業・順番を強制しない授業は、いつでも入れる", () => {
    expect(discussionGate([], done(), true).allowed).toBe(true);
    expect(discussionGate(steps, done(), false).allowed).toBe(true);
  });
  it("入れない理由に、いまのステップ名を含む", () => {
    const gate = discussionGate(steps, done(), true);
    expect(gate.allowed === false && gate.reason).toContain("動画を見る");
  });
});

describe("canOpenStep", () => {
  it("いまのステップと、終えたインプットの見直しだけ開ける", () => {
    expect(canOpenStep(steps, done("i1"), "o1", true)).toBe(true); // いま
    expect(canOpenStep(steps, done("i1"), "i1", true)).toBe(true); // 終えたインプット
    expect(canOpenStep(steps, done("i1"), "i2", true)).toBe(false); // 先のステップ
    expect(canOpenStep(steps, done("i1", "o1"), "o1", true)).toBe(false); // 終えたアウトプットは開けない
    expect(canOpenStep(steps, done(), "nope", true)).toBe(false);
  });
  it("順番を強制しない授業はどれでも開ける", () => {
    expect(canOpenStep(steps, done(), "o2", false)).toBe(true);
  });
});

describe("hasLaterOutput", () => {
  it("いまより後に未了のアウトプットが残っているか", () => {
    expect(hasLaterOutput(steps, done("i1"))).toBe(true); // いまo1、後ろにo2
    expect(hasLaterOutput(steps, done("i1", "o1", "i2"))).toBe(false); // いまo2、後ろは無い
    expect(hasLaterOutput([], done())).toBe(false);
  });
});

describe("parseVideoUrl", () => {
  it("空はnull、http(s)以外は拒否", () => {
    expect(parseVideoUrl("  ")).toBeNull();
    expect(parseVideoUrl("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(() => parseVideoUrl("javascript:alert(1)")).toThrow();
    expect(() => parseVideoUrl("not a url")).toThrow();
  });
});

describe("readCheckQuestions", () => {
  it("壊れた要素は捨てる", () => {
    expect(readCheckQuestions(null)).toEqual([]);
    expect(readCheckQuestions([{ question: "Q1", answerPoints: "A", evidence: "E" }, { question: "" }, 3, null])).toEqual([
      { question: "Q1", answerPoints: "A", evidence: "E" },
    ]);
  });
});

describe("validateVideoFile", () => {
  it("mp4 / webm で上限以内なら通す", () => {
    expect(validateVideoFile({ name: "授業.MP4", size: 1000 })).toEqual({ ext: "mp4", contentType: "video/mp4" });
    expect(validateVideoFile({ name: "a.webm", size: MAX_VIDEO_BYTES })).toMatchObject({ contentType: "video/webm" });
  });
  it("他の形式・上限超えは拒否する", () => {
    expect(() => validateVideoFile({ name: "a.exe", size: 10 })).toThrow("mp4");
    expect(() => validateVideoFile({ name: "a.mp4", size: MAX_VIDEO_BYTES + 1 })).toThrow("MB");
    expect(() => validateVideoFile({ name: "noext", size: 10 })).toThrow();
  });
});

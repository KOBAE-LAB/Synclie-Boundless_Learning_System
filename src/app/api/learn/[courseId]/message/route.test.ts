import { beforeEach, describe, expect, it, vi } from "vitest";

// 発言送信API(ストリーミング)の権限境界と、イベントの流れを検証する。
// 認証・同意・DB・AI(postStudentMessageAndRespond)は、いずれも実物には繋がず偽装する。
vi.mock("@/lib/auth/session", () => ({ getEffectiveStudent: vi.fn() }));
vi.mock("@/lib/consent", () => ({ hasConsent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/learn/dialogue", () => ({ postStudentMessageAndRespond: vi.fn() }));

const { getEffectiveStudent } = await import("@/lib/auth/session");
const { hasConsent } = await import("@/lib/consent");
const { postStudentMessageAndRespond } = await import("@/lib/learn/dialogue");
const { POST } = await import("./route");

const authMock = vi.mocked(getEffectiveStudent);
const hasConsentMock = vi.mocked(hasConsent);
const respondMock = vi.mocked(postStudentMessageAndRespond);

function request(body: unknown) {
  return new Request("http://localhost/api/learn/course-1/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ courseId: "course-1" }) };

async function readEvents(response: Response) {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  authMock.mockReset();
  hasConsentMock.mockReset();
  respondMock.mockReset();
  authMock.mockResolvedValue({ id: "student-1", role: "student" });
  hasConsentMock.mockResolvedValue(true);
});

describe("POST /api/learn/[courseId]/message", () => {
  it("未ログインなら401(発言は保存しない)", async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(request({ message: "こんにちは" }), params);
    expect(response.status).toBe(401);
    expect(respondMock).not.toHaveBeenCalled();
  });

  it("学習者として扱えない人(教師など。getEffectiveStudentがnull)は401", async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(request({ message: "こんにちは" }), params);
    expect(response.status).toBe(401);
    expect(respondMock).not.toHaveBeenCalled();
  });

  it("空の発言・壊れたJSONは400", async () => {
    expect((await POST(request({ message: "   " }), params)).status).toBe(400);
    expect((await POST(request("not json"), params)).status).toBe(400);
    expect(respondMock).not.toHaveBeenCalled();
  });

  it("同意していない(撤回済みを含む)学習者は403", async () => {
    hasConsentMock.mockResolvedValue(false);
    const response = await POST(request({ message: "こんにちは" }), params);
    expect(response.status).toBe(403);
    expect(respondMock).not.toHaveBeenCalled();
  });

  it("正常時は、途中経過のイベントをNDJSONで順に返し、最後にdoneを返す", async () => {
    respondMock.mockImplementation(async (_admin, _course, _student, _message, _source, options) => {
      options?.onEvent?.({ type: "persona", id: "p1", name: "コウタ" });
      options?.onEvent?.({ type: "reply", text: "こん" });
      options?.onEvent?.({ type: "reply", text: "こんにちは" });
    });
    const response = await POST(request({ message: "  こんにちは  " }), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("x-accel-buffering")).toBe("no"); // nginxで流れが止まらないように

    expect(await readEvents(response)).toEqual([
      { type: "persona", id: "p1", name: "コウタ" },
      { type: "reply", text: "こん" },
      { type: "reply", text: "こんにちは" },
      { type: "done" },
    ]);
    // 前後の空白は取り除かれ、ログイン中の本人・授業IDで呼ばれる
    expect(respondMock.mock.calls[0].slice(1, 4)).toEqual(["course-1", "student-1", "こんにちは"]);
  });

  it("処理が失敗したら、errorイベントを返す(参加登録がない場合など)", async () => {
    respondMock.mockRejectedValue(new Error("この授業への参加登録がありません。"));
    const response = await POST(request({ message: "こんにちは" }), params);
    expect(response.status).toBe(200);
    expect(await readEvents(response)).toEqual([
      { type: "error", message: "この授業への参加登録がありません。" },
    ]);
  });
});

import { getEffectiveStudent } from "@/lib/auth/session";
import { hasConsent } from "@/lib/consent";
import { createAdminClient } from "@/lib/supabase/server";
import { postStudentMessageAndRespond, type DialogueEvent } from "@/lib/learn/dialogue";

// F05: 学習者の発言(タイピング)を保存し、擬似メンバーの返答を「できた分から順に」返す。
// 画面(components/chat-composer.tsx)が、送信直後に自分の発言を出し、返答を流れるように
// 表示できるようにするためのAPI。処理の中身は postStudentMessageAndRespond() で、
// 手書き・音声の確定(サーバーアクション)と同じ経路・同じ権限チェック(参加登録・承認)を通る。
//
// 応答はNDJSON(1行1イベントのJSON): {type:"persona"} / {type:"reply"} / {type:"done"} / {type:"error"}
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;

  // 学習者本人、または「学習者として表示」中の管理者(テスト学習者)だけが使える。
  const user = await getEffectiveStudent();
  if (!user) {
    return json(401, { error: "ログインしてください。" });
  }

  let message = "";
  try {
    const body = (await request.json()) as { message?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
  } catch {
    return json(400, { error: "リクエストの形式が正しくありません。" });
  }
  if (!message) {
    return json(400, { error: "発言を入力してください。" });
  }

  const admin = createAdminClient();
  // 学習画面(ページ)と同じ境界: 同意していない/撤回した学習者は対話できない。
  // (参加登録・承認の確認は postStudentMessageAndRespond 内の getOrCreateSession が行う)
  if (!(await hasConsent(admin, user.id))) {
    return json(403, { error: "データ利用への同意が必要です。" });
  }

  const encoder = new TextEncoder();
  let clientGone = false;
  const studentId = user.id;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          clientGone = true;
        }
      };

      // 画面が閉じられても、保存まで処理を最後まで続ける(途中で止めると、発言だけ残って
      // 返答が無い状態になるため)。通知は送れなくなるだけ。
      void (async () => {
        try {
          await postStudentMessageAndRespond(admin, courseId, studentId, message, { kind: "text" }, {
            onEvent: (event: DialogueEvent) => send(event),
          });
          send({ type: "done" });
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : "不明なエラーが発生しました。" });
        } finally {
          try {
            controller.close();
          } catch {
            // 既に閉じている
          }
        }
      })();
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // nginxが応答をためこまず、すぐに流すため(これが無いとストリーミングが効かない)
      "X-Accel-Buffering": "no",
    },
  });
}

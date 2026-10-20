"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toneClass } from "@/lib/persona-tones";

/**
 * 学習画面の発言入力欄。送信した瞬間に自分の発言を画面に出し、擬似メンバーの返答を
 * 「できた分から順に」流れるように表示する(以前は、返答が全部できるまで何も変わらず、
 * 発言を送れたのかも分からない数秒間があった)。
 *
 * 発言の保存・返答の生成は /api/learn/[courseId]/message が行い、処理の途中経過を
 * NDJSONで返す。完了したらサーバーが描画する「これまでのやり取り」に切り替える
 * (router.refresh() で再取得し、新しい発言が含まれた時点で、このコンポーネントの
 * 仮表示を消す)。クライアントJSが必要な4つ目の理由(SubmitButton/ThinkingIndicator/
 * AutoDiscussionTimerに次ぐ)で、「送信中の途中経過を画面に出す」ことはサーバー
 * コンポーネントだけでは実現できない。
 */

type Phase = "idle" | "sending" | "refreshing";

// 擬似メンバーが複数いる授業の「場面」の、1発言(話者が確定したもの)
type LiveMessage = { personaId: string; name: string; text: string };

type StreamEvent =
  | { type: "persona"; id: string; name: string }
  | { type: "reply"; text: string }
  | { type: "scene"; messages: LiveMessage[] }
  | { type: "done" }
  | { type: "error"; message: string };

export function ChatComposer({
  courseId,
  turnCount,
  personaAvatars,
  personaTones,
}: {
  courseId: string;
  // サーバーが描画した「これまでのやり取り」の件数。増えたら、送信した分が反映されたとみなして
  // 仮表示を消す。
  turnCount: number;
  // 擬似メンバーのID → アバター画像のパス(返答の仮表示にも、同じ顔を出すため)
  personaAvatars: Record<string, string>;
  // 擬似メンバーのID → 色の番号(吹き出しの色を、発言済みの履歴と同じにそろえるため)
  personaTones: Record<string, number>;
}) {
  const router = useRouter();
  // ページの読み込み(ハイドレーション)が終わるまでは送信させない。終わる前にフォームが
  // 普通に送信されると、発言の内容がURL(?message=...)に載って履歴やログに残ってしまうため。
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const liveEndRef = useRef<HTMLDivElement>(null);
  const baseCount = useRef(turnCount);

  const [phase, setPhase] = useState<Phase>("idle");
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [persona, setPersona] = useState<{ id: string; name: string } | null>(null);
  const [reply, setReply] = useState("");
  const [scene, setScene] = useState<LiveMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  function clearLive() {
    setPhase("idle");
    setSentMessage(null);
    setPersona(null);
    setReply("");
    setScene([]);
  }

  // サーバーの描画に新しい発言が含まれたら、仮表示を消す。
  useEffect(() => {
    if (phase === "refreshing" && turnCount > baseCount.current) {
      clearLive();
    }
  }, [turnCount, phase]);

  // 送信した発言や、流れてくる返答が、画面の外に隠れないように、新しい内容が出るたびに見える位置へ寄せる。
  useEffect(() => {
    if (sentMessage) liveEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [sentMessage, scene, reply]);

  // 反映が見えない場合(通信の遅れなど)でも、仮表示が残り続けないようにする。
  useEffect(() => {
    if (phase !== "refreshing") return;
    const timer = setTimeout(clearLive, 6000);
    return () => clearTimeout(timer);
  }, [phase]);

  async function send() {
    const textarea = textareaRef.current;
    const message = textarea?.value.trim() ?? "";
    if (!message || phase !== "idle") return;

    baseCount.current = turnCount;
    setError(null);
    setSentMessage(message);
    setPersona(null);
    setReply("");
    setScene([]);
    setPhase("sending");
    if (textarea) textarea.value = "";

    try {
      const response = await fetch(`/api/learn/${courseId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!response.ok || !response.body) {
        // 送信が受け付けられなかった(未ログイン・同意なし等)。発言は保存されていないので入力欄に戻す。
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        if (textarea) textarea.value = message;
        clearLive();
        setError(data?.error ?? `送信に失敗しました(${response.status})。`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "persona") setPersona({ id: event.id, name: event.name });
          else if (event.type === "reply") setReply(event.text);
          else if (event.type === "scene") setScene(event.messages);
          else if (event.type === "error") streamError = event.message;
        }
      }

      // 発言は保存済み(返答の生成で失敗した場合も含む)なので、エラーでも画面は最新にする。
      if (streamError) setError(streamError);
      setPhase("refreshing");
      router.refresh();
    } catch {
      // 通信が途中で切れた場合も、サーバー側は処理を最後まで続けて保存するので、再取得して見せる。
      setError("通信が途中で切れました。少し待つと、続きが表示されることがあります。");
      setPhase("refreshing");
      router.refresh();
    }
  }

  const busy = phase !== "idle" || !hydrated;
  // 画面に出す擬似メンバーの発言。複数人の場面ならそのまま、1人の授業なら1つにそろえる。
  const bubbles: LiveMessage[] =
    scene.length > 0
      ? scene
      : reply !== ""
        ? [{ personaId: persona?.id ?? "", name: persona?.name ?? "擬似メンバー", text: reply }]
        : [];

  // 入力欄の固定表示(sticky)は、親の枠の中でしか効かない。小さな枠で包むと、枠の外側に
  // 出られず固定されなくなるため、枠を作らずに、ページ全体の枠の直下に並べる(Fragment)。
  return (
    <>
      {sentMessage && (
        <div className="mt-4 space-y-3 pb-3" aria-live="polite">
          <div className="text-right">
            <div className="inline-block max-w-[88%] rounded-lg bg-accent-fill px-4 py-2 text-left text-sm leading-7 text-white">
              <p className="whitespace-pre-wrap">{sentMessage}</p>
            </div>
          </div>

          {phase === "sending" && bubbles.length === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-ink-muted" role="status">
              {persona ? `${persona.name}が考えています` : "擬似メンバーが考えています"}
              <span className="flex items-center gap-0.5" aria-hidden="true">
                <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
                <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
                <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
              </span>
            </p>
          )}

          {bubbles.map((bubble, index) => {
            const avatarPath = personaAvatars[bubble.personaId];
            return (
              <div key={index} className={`flex items-end gap-2 ${toneClass(personaTones[bubble.personaId])}`}>
                {avatarPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarPath} alt="" width={36} height={36} className="persona-ring h-9 w-9 shrink-0 rounded-full bg-canvas" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="persona-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  >
                    {bubble.name.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="persona-name mb-1 text-xs font-semibold">{bubble.name}(AI)</p>
                  <div className="persona-bubble inline-block rounded-lg px-4 py-2 text-left text-sm leading-7 text-ink">
                    <p className="whitespace-pre-wrap">{bubble.text}</p>
                  </div>
                </div>
              </div>
            );
          })}

          {phase === "sending" && bubbles.length > 0 && (
            <span className="flex items-center gap-0.5 pl-11 text-ink-faint" aria-hidden="true">
              <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
              <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
              <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
            </span>
          )}
        </div>
      )}
      <div ref={liveEndRef} />

      {/* 入力欄は、画面の下に固定する(会話が長くなっても、いつでも発言できるように) */}
      <div className="sticky bottom-0 z-10 -mx-6 border-t border-line bg-canvas/95 px-6 py-3 backdrop-blur">
        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex gap-2">
            <label htmlFor="chat-message" className="sr-only">
              発言
            </label>
            <textarea
              id="chat-message"
              ref={textareaRef}
              name="message"
              required
              rows={2}
              placeholder="発言を入力(Ctrl+Enterで送信)"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
              className="flex-1 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm leading-6"
            />
            <button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className="shrink-0 self-end rounded-md bg-accent-fill px-5 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
            >
              {phase !== "idle" ? "送信中…" : "送信"}
            </button>
          </div>
        </form>

        {error && (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

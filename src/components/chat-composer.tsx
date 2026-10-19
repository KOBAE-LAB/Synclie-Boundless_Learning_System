"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

type StreamEvent =
  | { type: "persona"; id: string; name: string }
  | { type: "reply"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export function ChatComposer({
  courseId,
  turnCount,
  personaAvatars,
}: {
  courseId: string;
  // サーバーが描画した「これまでのやり取り」の件数。増えたら、送信した分が反映されたとみなして
  // 仮表示を消す。
  turnCount: number;
  // 擬似メンバーのID → アバター画像のパス(返答の仮表示にも、同じ顔を出すため)
  personaAvatars: Record<string, string>;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const baseCount = useRef(turnCount);

  const [phase, setPhase] = useState<Phase>("idle");
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [persona, setPersona] = useState<{ id: string; name: string } | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  function clearLive() {
    setPhase("idle");
    setSentMessage(null);
    setPersona(null);
    setReply("");
  }

  // サーバーの描画に新しい発言が含まれたら、仮表示を消す。
  useEffect(() => {
    if (phase === "refreshing" && turnCount > baseCount.current) {
      clearLive();
    }
  }, [turnCount, phase]);

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

  const busy = phase !== "idle";
  const avatarPath = persona ? personaAvatars[persona.id] : undefined;

  return (
    <div className="mt-6">
      <form
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
            className="flex-1 rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="shrink-0 self-end rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            {busy ? "送信中…" : "送信"}
          </button>
        </div>
      </form>

      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {sentMessage && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="text-right">
            <div className="inline-block max-w-[75%] rounded-lg bg-accent-fill px-4 py-2 text-left text-sm text-white">
              <p className="whitespace-pre-wrap">{sentMessage}</p>
            </div>
          </div>

          {phase === "sending" && reply === "" && (
            <p className="flex items-center gap-1.5 text-xs text-ink-muted" role="status">
              {persona ? `${persona.name}が考えています` : "擬似メンバーが考えています"}
              <span className="flex items-center gap-0.5" aria-hidden="true">
                <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
                <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
                <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
              </span>
            </p>
          )}

          {reply !== "" && (
            <div className="flex items-end gap-2">
              {avatarPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarPath} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-xs text-ink-faint"
                >
                  ?
                </span>
              )}
              <div className="max-w-[75%]">
                <p className="mb-1 text-xs font-medium text-ink-muted">
                  {persona?.name ?? "擬似メンバー"}(AI)
                </p>
                <div className="inline-block rounded-lg bg-surface px-4 py-2 text-left text-sm text-ink">
                  <p className="whitespace-pre-wrap">{reply}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

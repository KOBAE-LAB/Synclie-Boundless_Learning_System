// 学習の流れ(インプット/アウトプットのステップ)の、画面やDBに依存しない判定ロジック。

export type StepKind = "input" | "output";

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  input: "インプット",
  output: "アウトプット",
};

export interface FlowStep {
  id: string;
  position: number;
  kind: StepKind;
  title: string;
}

export interface CheckQuestion {
  question: string;
  answerPoints: string;
  evidence: string;
}

/** DBのjsonbから読んだ理解チェックの問いを、安全な形に直す(壊れた要素は捨てる)。 */
export function readCheckQuestions(value: unknown): CheckQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: CheckQuestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    if (typeof v.question !== "string" || v.question.trim() === "") continue;
    out.push({
      question: v.question,
      answerPoints: typeof v.answerPoints === "string" ? v.answerPoints : "",
      evidence: typeof v.evidence === "string" ? v.evidence : "",
    });
  }
  return out;
}

/** position順に並べた、まだ終えていない最初のステップ(=いまのステップ)。全部終えていれば null。 */
export function currentStep<T extends FlowStep>(steps: T[], doneIds: Set<string>): T | null {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  return sorted.find((s) => !doneIds.has(s.id)) ?? null;
}

export type DiscussionGate = { allowed: true } | { allowed: false; reason: string };

/**
 * いま議論(擬似メンバーとの対話)をしてよいか。
 * ステップが無い授業・順番を強制しない授業は常に可。順番を強制する授業では、いまのステップが
 * インプットの間は議論に入れない(インプットを終えてから、アウトプットで深める流れを守る)。
 */
export function discussionGate(
  steps: FlowStep[],
  doneIds: Set<string>,
  inOrder: boolean,
): DiscussionGate {
  if (steps.length === 0 || !inOrder) return { allowed: true };
  const current = currentStep(steps, doneIds);
  if (current && current.kind === "input") {
    return { allowed: false, reason: `いまはインプットの時間です。「${current.title}」を終えてから、議論に進みましょう。` };
  }
  return { allowed: true };
}

/** 学習者が、そのステップの画面を開いてよいか(いまのステップ、または終えたインプットの見直し)。 */
export function canOpenStep(
  steps: FlowStep[],
  doneIds: Set<string>,
  stepId: string,
  inOrder: boolean,
): boolean {
  const target = steps.find((s) => s.id === stepId);
  if (!target) return false;
  if (!inOrder) return true;
  const current = currentStep(steps, doneIds);
  if (current?.id === target.id) return true;
  return target.kind === "input" && doneIds.has(target.id);
}

/** いまのステップより後に、まだ終えていないアウトプットが残っているか(残っていれば、AIが議論の終了を急がない)。 */
export function hasLaterOutput(steps: FlowStep[], doneIds: Set<string>): boolean {
  const current = currentStep(steps, doneIds);
  if (!current) return false;
  return steps.some((s) => s.position > current.position && s.kind === "output" && !doneIds.has(s.id));
}

/** 教師が入力した動画URLの検証。空はOK(null)、http(s)以外は拒否。 */
export function parseVideoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("動画のURLは、https:// から始まる形式で入力してください。");
  }
}

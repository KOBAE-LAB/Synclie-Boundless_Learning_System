import type { StudentStat } from "./stats";

// 教師向け「指導のヒント」のAIへの入力を組み立てる(DBに触れない純粋な関数)。
// 学習者の氏名・メールはAIに送らない。「学習者A」「学習者B」の仮の呼び名に置き換え、
// 返ってきた仮の呼び名をサーバー側で本人のidに戻す(mapIndividuals)。

export interface GuidanceStudentInput {
  stat: StudentStat;
  /** 学習者が「教師に共有」を選んだ振り返りの「迷ったこと」 */
  confusions: string[];
}

export interface GuidanceData {
  course: { title: string; objective: string | null; discussionStyle: string | null; learnerLevel: string | null };
  students: GuidanceStudentInput[];
  personas: { name: string; total: number; unwarranted: number }[];
  /** 議論のまとめ(closing_summary)に出た「次に考えたい問い」 */
  discussionNextQuestions: string[];
}

export function studentLabel(index: number): string {
  return `学習者${index < 26 ? String.fromCharCode(65 + index) : index + 1}`;
}

const score = (n: number | null) => (n === null ? "未計測" : n.toFixed(1));

export function formatGuidanceInput(data: GuidanceData): { text: string; labelToStudentId: Map<string, string> } {
  const labelToStudentId = new Map<string, string>();
  const lines: string[] = [];
  const c = data.course;
  lines.push(`授業: ${c.title}`);
  if (c.objective) lines.push(`ねらい・議題: ${c.objective}`);
  if (c.learnerLevel) lines.push(`学習者: ${c.learnerLevel}`);
  if (c.discussionStyle) lines.push(`討論の型: ${c.discussionStyle}`);
  lines.push("", `## 学習者(${data.students.length}人。氏名は伏せ、仮の呼び名にしてある)`);

  data.students.forEach(({ stat, confusions }, i) => {
    const label = studentLabel(i);
    labelToStudentId.set(label, stat.studentId);
    const axes = stat.axisAvg
      ? `論理構成${score(stat.axisAvg.logic)}・根拠の質${score(stat.axisAvg.evidence)}・反論への応答${score(stat.axisAvg.rebuttal)}(各0〜5)`
      : "論証評価は未計測";
    lines.push(`### ${label}`, `発言${stat.turnCount}件・提出${stat.submissionCount}件。${axes}`);
    if (stat.strengths) lines.push(`得意な点: ${stat.strengths}`);
    if (stat.challenges) lines.push(`課題: ${stat.challenges}`);
    for (const confusion of confusions) lines.push(`本人が書いた迷ったこと: ${confusion}`);
  });

  if (data.personas.length > 0) {
    lines.push("", "## 擬似メンバーの挙動(根拠なく同調した割合)");
    for (const p of data.personas) {
      lines.push(`- ${p.name}: ${p.unwarranted}/${p.total}件`);
    }
  }
  if (data.discussionNextQuestions.length > 0) {
    lines.push("", "## 議論のまとめで出た「次に考えたい問い」");
    for (const q of data.discussionNextQuestions) lines.push(`- ${q}`);
  }
  return { text: lines.join("\n"), labelToStudentId };
}

export interface RawIndividual {
  label: string;
  observation: string;
  suggestedAction: string;
}

export interface GuidanceIndividual {
  studentId: string;
  observation: string;
  suggestedAction: string;
}

/** AIが返した仮の呼び名を本人のidに戻す。知らない呼び名(作り話)は捨てる。 */
export function mapIndividuals(raw: RawIndividual[], labelToStudentId: Map<string, string>): GuidanceIndividual[] {
  const seen = new Set<string>();
  const out: GuidanceIndividual[] = [];
  for (const item of raw) {
    const studentId = labelToStudentId.get(item.label.trim());
    if (!studentId || seen.has(studentId)) continue;
    seen.add(studentId);
    out.push({ studentId, observation: item.observation, suggestedAction: item.suggestedAction });
  }
  return out;
}

/**
 * AIの文章に出てくる仮の呼び名(「学習者A」)を、教師が分かる名前に戻す(保存する直前にサーバー側で行う。
 * AIには氏名を送っていない)。長い呼び名から置き換え、「学習者1」が「学習者10」の一部を壊さないようにする。
 */
export function restoreNames(text: string, labelToName: Map<string, string>): string {
  const labels = [...labelToName.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const label of labels) {
    out = out.split(label).join(labelToName.get(label) ?? label);
  }
  return out;
}

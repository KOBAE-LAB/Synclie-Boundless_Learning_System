// 集約型ペルソナ(0047)の「まとめた項目」(共通するつまずき・よくある誤解・有効だった問い)の、DBに触れない部分。
// 項目は personas.stance.items(jsonb)に持つ。画面での編集は、1行に1項目の文字(「種類: 内容」)で行う。
import type { AggregateItemKind } from "@/lib/ai/aggregate-persona";

export type { AggregateItemKind };

export const MIN_AGGREGATE_LEARNERS = 3;
export const MAX_AGGREGATE_ITEMS = 8;

export interface AggregateItem {
  kind: AggregateItemKind;
  text: string;
  /** 主に現れた授業回の番号(教科・科目学習モードの、授業回で絞る用)。分からなければ null */
  lessonNo: number | null;
}

export const AGGREGATE_ITEM_LABELS: Record<AggregateItemKind, string> = {
  stumble: "つまずき",
  misconception: "よくある誤解",
  good_question: "有効だった問い",
};

const KIND_BY_LABEL = new Map(Object.entries(AGGREGATE_ITEM_LABELS).map(([k, v]) => [v, k as AggregateItemKind]));

/** 「2025年度のみんな ミライ(AI)」。呼び名が無ければ「2025年度のみんな(AI)」。 */
export function aggregateDisplayName(fiscalYear: number | null | undefined, nickname: string): string {
  const base = `${fiscalYear ? `${fiscalYear}年度の` : "前の年度の"}みんな`;
  return nickname ? `${base} ${nickname}(AI)` : `${base}(AI)`;
}

/** personas.stance から、項目を安全に取り出す(壊れた形は捨てる)。 */
export function parseAggregateItems(stance: unknown): AggregateItem[] {
  const items = (stance as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const result: AggregateItem[] = [];
  for (const raw of items) {
    const i = raw as { kind?: unknown; text?: unknown; lessonNo?: unknown };
    if (typeof i?.text !== "string" || !i.text.trim() || typeof i.kind !== "string" || !(i.kind in AGGREGATE_ITEM_LABELS)) continue;
    result.push({
      kind: i.kind as AggregateItemKind,
      text: i.text.trim().slice(0, 120),
      lessonNo: typeof i.lessonNo === "number" && Number.isInteger(i.lessonNo) && i.lessonNo > 0 ? i.lessonNo : null,
    });
    if (result.length >= MAX_AGGREGATE_ITEMS) break;
  }
  return result;
}

/** 編集用の文字: 1行に1項目。「つまずき(第3回): 内容」。授業回が無ければ括弧は付けない。 */
export function itemsToLines(items: AggregateItem[]): string {
  return items.map((i) => `${AGGREGATE_ITEM_LABELS[i.kind]}${i.lessonNo ? `(第${i.lessonNo}回)` : ""}: ${i.text}`).join("\n");
}

/** 編集用の文字から、項目に戻す。読めない行は捨てる。 */
export function linesToItems(lines: string): AggregateItem[] {
  const result: AggregateItem[] = [];
  for (const line of lines.split(/\r?\n/)) {
    const m = line.trim().match(/^([^:\uFF1A(\uFF08]+?)\s*(?:[(\uFF08]第(\d+)回[)\uFF09])?\s*[:\uFF1A]\s*(.+)$/);
    if (!m) continue;
    const kind = KIND_BY_LABEL.get(m[1].trim());
    if (!kind) continue;
    result.push({ kind, text: m[3].trim().slice(0, 120), lessonNo: m[2] ? Number.parseInt(m[2], 10) : null });
    if (result.length >= MAX_AGGREGATE_ITEMS) break;
  }
  return result;
}

/**
 * 後輩のいまの授業回までの項目(教科・科目学習モードの、授業回で絞る用)。授業回が分からない項目は、全体に共通することとして残す
 * (個別の場面ではなく、複数の記録の共通点なので、結論の先取りにはなりにくい)。juniorLessonNo が無ければ絞らない。
 */
export function itemsForLesson(items: AggregateItem[], juniorLessonNo: number | null | undefined): AggregateItem[] {
  if (typeof juniorLessonNo !== "number") return items;
  return items.filter((i) => i.lessonNo === null || i.lessonNo <= juniorLessonNo);
}

export const AGGREGATE_GUARDRAILS = `# 前の年度の学習者の記録をもとにしたAIとしてのルール
- あなたは特定の誰かではなく、前の年度の多くの学習者の記録から見えた共通点をもとにしたAIである。聞かれたら、そう答える。
- 個人の話はしない。「多くの人が…」の言い方で話し、特定の誰かのことのように言わない。
- 記録にないことは、推測で補わず「そこは分からない」と答える。
- 答えを押し付けず、共通のつまずきを材料に、後輩に問い返す。
- 後輩の意見にも、根拠なく同調しない(新しい根拠か具体的な事例が出たときだけ、考えを少し変えてよい)。
- 人の名前・学校名・地名は話さない。`;

/** 擬似メンバーのプロンプトに入れる「記憶」。項目が無ければ空(話し方の設定だけで話す)。 */
export function buildAggregateMemoryText(items: AggregateItem[]): string {
  const lines = (["stumble", "misconception", "good_question"] as AggregateItemKind[])
    .map((kind) => {
      const of = items.filter((i) => i.kind === kind);
      return of.length === 0 ? "" : `## ${AGGREGATE_ITEM_LABELS[kind]}\n${of.map((i) => `- ${i.text}${i.lessonNo ? `(第${i.lessonNo}回の頃)` : ""}`).join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
  return `# 前の年度の、多くの学習者の記録から見えたこと
${lines || "(まとめた項目は、まだ少ない。分からないことは、分からないと答える。)"}
${AGGREGATE_GUARDRAILS}`;
}

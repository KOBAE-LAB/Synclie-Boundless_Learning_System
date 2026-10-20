import { RATING_LABELS } from "./assessment";
import type { Portfolio, PortfolioEntry } from "./types";

// ポートフォリオの書き出し(JSON / Markdown / 印刷用HTML)。DBや画面に依存しない純粋な関数。
// 「評価の最終判断は学習者と教師に残す」ため、AIの評価には必ず「非最終」の注記を付ける。

export const AI_NOTE = "AIによる評価は最終ではなく、自己評価・教師評価の材料です。";

function dateText(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
}

function ratingText(a: { rating: number | null }): string {
  return a.rating ? `${RATING_LABELS[a.rating]}(${a.rating}/4)` : "";
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderJson(portfolio: Portfolio): string {
  return JSON.stringify({ format: "synclie-portfolio", version: 1, ...portfolio, note: AI_NOTE }, null, 2);
}

function mdQuote(text: string): string {
  return text.split("\n").map((l) => `> ${l}`).join("\n");
}

function entryMarkdown(e: PortfolioEntry): string {
  const out: string[] = [`### ${dateText(e.createdAt)} ・ ${e.courseTitle}`, "", "**成果**", "", mdQuote(e.content), ""];
  if (e.discussion) {
    out.push("**議論のまとめ**", "", e.discussion.summary, "");
    if (e.discussion.keyPoints.length) out.push(...e.discussion.keyPoints.map((p) => `- ${p}`), "");
    if (e.discussion.nextQuestions.length) out.push("次に考えたい問い:", ...e.discussion.nextQuestions.map((p) => `- ${p}`), "");
  }
  if (e.selfAssessment) out.push(`**自己評価** ${ratingText(e.selfAssessment)}`, "", e.selfAssessment.comment, "");
  if (e.teacherAssessment) out.push(`**教師のコメント** ${ratingText(e.teacherAssessment)}`, "", e.teacherAssessment.comment, "");
  if (e.feedback.length || e.judgment) {
    out.push(`**AIフィードバック**(${AI_NOTE})`, "");
    for (const f of e.feedback) out.push(`- ${f.criteriaLabel}: 良い点「${f.goodPoints}」/ 次に考える問い「${f.nextQuestion}」`);
    if (e.judgment) {
      out.push(`- 議論の評価: 論理構成 ${e.judgment.logicStructure}/5、根拠の質 ${e.judgment.evidenceQuality}/5、反論への応答 ${e.judgment.rebuttalResponse}/5 — ${e.judgment.summaryComment}`);
    }
    out.push("");
  }
  if (e.reflection) {
    out.push("**振り返り**", "", `- 学んだこと: ${e.reflection.whatLearned}`, `- 迷ったこと: ${e.reflection.whatConfused}`, `- 次にやりたいこと: ${e.reflection.nextGoal}`, "");
  }
  return out.join("\n");
}

export function renderMarkdown(portfolio: Portfolio): string {
  const out = [`# ${portfolio.learnerName}さんの学びのポートフォリオ`, "", `書き出した日: ${dateText(portfolio.generatedAt)}`, ""];
  let year: number | null = null;
  for (const e of portfolio.entries) {
    if (e.fiscalYear !== year) {
      year = e.fiscalYear;
      out.push(`## ${year}年度`, "");
    }
    out.push(entryMarkdown(e));
  }
  if (portfolio.entries.length === 0) out.push("(まだ記録がありません)", "");
  return out.join("\n");
}

function htmlEntry(e: PortfolioEntry): string {
  const p = (text: string) => `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  const parts: string[] = [
    `<article><h3>${escapeHtml(dateText(e.createdAt))} ・ ${escapeHtml(e.courseTitle)}</h3>`,
    `<h4>成果</h4>${p(e.content)}`,
  ];
  if (e.discussion) {
    parts.push(`<h4>議論のまとめ</h4>${p(e.discussion.summary)}`);
    if (e.discussion.keyPoints.length) parts.push(`<ul>${e.discussion.keyPoints.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>`);
    if (e.discussion.nextQuestions.length) parts.push(`<p>次に考えたい問い:</p><ul>${e.discussion.nextQuestions.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>`);
  }
  if (e.selfAssessment) parts.push(`<h4>自己評価 ${escapeHtml(ratingText(e.selfAssessment))}</h4>${p(e.selfAssessment.comment)}`);
  if (e.teacherAssessment) parts.push(`<h4>教師のコメント ${escapeHtml(ratingText(e.teacherAssessment))}</h4>${p(e.teacherAssessment.comment)}`);
  if (e.feedback.length || e.judgment) {
    parts.push(`<h4>AIフィードバック</h4><p class="note">${escapeHtml(AI_NOTE)}</p><ul>`);
    for (const f of e.feedback) {
      parts.push(`<li>${escapeHtml(f.criteriaLabel)}: 良い点「${escapeHtml(f.goodPoints)}」/ 次に考える問い「${escapeHtml(f.nextQuestion)}」</li>`);
    }
    if (e.judgment) {
      parts.push(`<li>議論の評価: 論理構成 ${e.judgment.logicStructure}/5、根拠の質 ${e.judgment.evidenceQuality}/5、反論への応答 ${e.judgment.rebuttalResponse}/5 — ${escapeHtml(e.judgment.summaryComment)}</li>`);
    }
    parts.push("</ul>");
  }
  if (e.reflection) {
    parts.push(
      `<h4>振り返り</h4><ul><li>学んだこと: ${escapeHtml(e.reflection.whatLearned)}</li><li>迷ったこと: ${escapeHtml(e.reflection.whatConfused)}</li><li>次にやりたいこと: ${escapeHtml(e.reflection.nextGoal)}</li></ul>`,
    );
  }
  parts.push("</article>");
  return parts.join("");
}

/** 印刷・PDF保存向けの、単体で開けるHTML(外部ファイルを読み込まない)。 */
export function renderHtml(portfolio: Portfolio): string {
  const body: string[] = [];
  let year: number | null = null;
  for (const e of portfolio.entries) {
    if (e.fiscalYear !== year) {
      year = e.fiscalYear;
      body.push(`<h2>${year}年度</h2>`);
    }
    body.push(htmlEntry(e));
  }
  if (portfolio.entries.length === 0) body.push("<p>(まだ記録がありません)</p>");
  const title = `${portfolio.learnerName}さんの学びのポートフォリオ`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,"Hiragino Sans","Yu Gothic",sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#1f2937}
h1{font-size:1.5rem}h2{margin-top:2.5rem;border-bottom:2px solid #d1d5db}h3{margin-bottom:.2rem}h4{margin:.9rem 0 .1rem;color:#4b5563;font-size:.95rem}
article{border:1px solid #d1d5db;border-radius:.5rem;padding:.2rem 1rem 1rem;margin:1rem 0;break-inside:avoid}
.note{color:#6b7280;font-size:.85rem}p{margin:.2rem 0}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="note">書き出した日: ${escapeHtml(dateText(portfolio.generatedAt))}</p>
${body.join("\n")}
</body></html>`;
}

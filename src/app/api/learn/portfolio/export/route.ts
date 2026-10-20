import { getEffectiveStudent } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { loadPortfolio } from "@/lib/portfolio/load";
import { renderHtml, renderJson, renderMarkdown } from "@/lib/portfolio/render";

// ポートフォリオの持ち出し。本人のデータだけを返す(同意を撤回中でも、自分のデータは持ち出せる)。
export async function GET(request: Request) {
  const user = await getEffectiveStudent();
  if (!user) return new Response("ログインが必要です。", { status: 401 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "html";
  const courseId = url.searchParams.get("course") ?? undefined;
  if (!["html", "md", "json"].includes(format)) return new Response("形式が不正です。", { status: 400 });

  const portfolio = await loadPortfolio(createAdminClient(), user.id, { courseId });
  const stamp = new Date().toISOString().slice(0, 10);

  const headers = { "Cache-Control": "no-store" };
  if (format === "json") {
    return new Response(renderJson(portfolio), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="portfolio-${stamp}.json"` },
    });
  }
  if (format === "md") {
    return new Response(renderMarkdown(portfolio), {
      headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="portfolio-${stamp}.md"` },
    });
  }
  return new Response(renderHtml(portfolio), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

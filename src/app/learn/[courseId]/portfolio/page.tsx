import { redirect } from "next/navigation";

// 旧・授業ごとのポートフォリオ。全授業を横断する /learn/portfolio に統合した。
export default async function CoursePortfolioRedirect({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  redirect(`/learn/portfolio?course=${encodeURIComponent(courseId)}`);
}

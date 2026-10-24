"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

// F16: 同意の取得(再同意も含む)。
export async function grantConsentAction() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { error } = await admin.from("consent_records").upsert(
    {
      student_id: user.id,
      scope: "data_use",
      granted_at: new Date().toISOString(),
      withdrawn_at: null,
    },
    { onConflict: "student_id,scope" },
  );
  if (error) {
    throw new Error(`同意の記録に失敗しました: ${error.message}`);
  }

  redirect("/learn");
}

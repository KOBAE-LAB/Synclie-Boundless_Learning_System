/**
 * F17: LTIでローンチしたユーザーを、既存のprofilesに紐づけるか新規作成する。
 * F22のsrc/lib/auth/sso.tsのlinkOrCreateSsoProfileと同じ考え方
 * (iss+subで永続的に同じ人物を指す。既存のCredentials/SSOアカウントがあればメールで統合)。
 */
import { createAdminClient } from "@/lib/supabase/server";
import { mapLtiRolesToAppRole } from "./claims";

interface LinkLtiProfileInput {
  issuer: string;
  subject: string;
  email: string | null;
  displayName: string | null;
  roles: string[] | undefined;
}

export async function linkOrCreateLtiProfile(
  input: LinkLtiProfileInput,
): Promise<{ id: string; role: string } | null> {
  const admin = createAdminClient();

  const { data: bySubject } = await admin
    .from("profiles")
    .select("id, role, approval_status")
    .eq("lti_issuer", input.issuer)
    .eq("lti_subject", input.subject)
    .maybeSingle();
  // 承認待ち・却下された教師(自己登録の承認制)は、LMS経由でも入れない。
  if (bySubject) {
    return bySubject.approval_status === "approved" ? { id: bySubject.id, role: bySubject.role } : null;
  }

  if (input.email) {
    const { data: byEmail } = await admin
      .from("profiles")
      .select("id, role, approval_status, lti_issuer")
      .eq("email", input.email)
      .maybeSingle();
    if (byEmail && !byEmail.lti_issuer) {
      if (byEmail.approval_status !== "approved") return null;
      const { error } = await admin
        .from("profiles")
        .update({ lti_issuer: input.issuer, lti_subject: input.subject })
        .eq("id", byEmail.id);
      if (error) return null;
      return { id: byEmail.id, role: byEmail.role };
    }
  }

  const { data: created, error } = await admin
    .from("profiles")
    .insert({
      role: mapLtiRolesToAppRole(input.roles),
      display_name: input.displayName,
      email: input.email,
      lti_issuer: input.issuer,
      lti_subject: input.subject,
    })
    .select("id, role")
    .single();
  if (error || !created) return null;
  return created;
}

/**
 * F22: SSOでサインインしたユーザーを、既存のprofilesに紐づけるか新規作成する。
 *
 * 「生徒のSSO subject idは、進級後もポートフォリオを引き継ぐための永続キーとして使う」
 * (要件定義書6章・12章)ため、同じprovider+subjectであれば常に同じprofilesの行を返す。
 * 段階1のCredentialsアカウントが既にある場合はメールアドレスで一度だけ紐づける
 * (アカウント統合。以後はsubjectで引ける)。
 *
 * 役割(教師/生徒)の自動判定はできないため、新規作成時は既定でstudentにする
 * (教師アカウントは、既存の教師が別途DBで役割を上げる運用を想定。単一の管理者ロールが
 * まだ無いための暫定的な扱い。要件定義書12章の未解決課題とあわせて本番投入前に見直すこと)。
 *
 * 自己登録(signup/)を入れたため、次の2点を守っている:
 *  - 承認待ち・却下された教師(profiles.approval_status)は、SSO経由でも入れない(null=拒否)
 *  - メールアドレスでの既存アカウントとの統合は、IdPがそのメールアドレスを「確認済み」と
 *    保証している時(emailVerified)に限る。自己登録は本人確認をしていないため、他人のメールで
 *    先に登録しておけば、本人がSSOで入った時に乗っ取れてしまう(pre-hijacking)。統合する時は
 *    念のため既存のパスワードも無効化し、以後はSSOだけで入るようにする
 */
import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

interface LinkSsoProfileInput {
  provider: string;
  subject: string;
  email: string | null;
  displayName: string | null;
  tenantId: string | null;
  // IdPが「このメールアドレスは本人のもの」と確認済みか(Googleの email_verified など)。
  emailVerified: boolean;
}

export async function linkOrCreateSsoProfile(
  input: LinkSsoProfileInput,
): Promise<{ id: string; role: string } | null> {
  const admin = createAdminClient();

  const { data: bySubject } = await admin
    .from("profiles")
    .select("id, role, approval_status")
    .eq("sso_provider", input.provider)
    .eq("sso_subject", input.subject)
    .maybeSingle();
  if (bySubject) {
    return bySubject.approval_status === "approved" ? { id: bySubject.id, role: bySubject.role } : null;
  }

  if (input.email && input.emailVerified) {
    const { data: byEmail } = await admin
      .from("profiles")
      .select("id, role, approval_status, sso_provider, organization_id")
      .eq("email", input.email)
      .maybeSingle();
    if (byEmail && !byEmail.sso_provider) {
      if (byEmail.approval_status !== "approved") return null;
      const { error } = await admin
        .from("profiles")
        .update({ sso_provider: input.provider, sso_subject: input.subject, password_hash: null })
        .eq("id", byEmail.id);
      if (error) return null;

      if (!byEmail.organization_id) {
        const organizationId = await findOrCreateOrganizationByTenant(admin, input.tenantId);
        if (organizationId) {
          await admin.from("profiles").update({ organization_id: organizationId }).eq("id", byEmail.id);
        }
      }
      return { id: byEmail.id, role: byEmail.role };
    }
  }

  const organizationId = await findOrCreateOrganizationByTenant(admin, input.tenantId);
  const { data: created, error } = await admin
    .from("profiles")
    .insert({
      role: "student",
      display_name: input.displayName,
      email: input.email,
      sso_provider: input.provider,
      sso_subject: input.subject,
      organization_id: organizationId,
    })
    .select("id, role, approval_status")
    .single();
  if (error || !created || created.approval_status !== "approved") return null;
  return { id: created.id, role: created.role };
}

async function findOrCreateOrganizationByTenant(
  admin: AdminClient,
  tenantId: string | null,
): Promise<string | null> {
  if (!tenantId) return null;

  const { data: existing } = await admin
    .from("organizations")
    .select("id")
    .eq("sso_tenant_id", tenantId)
    .maybeSingle();
  if (existing) return existing.id;

  // 名前はひとまずテナントIDをそのまま使う(教師が/organizationで見て分かりづらい場合、
  // 改名する仕組みは今のところ無い。実運用前に検討すること)。
  const { data: created, error } = await admin
    .from("organizations")
    .insert({ name: tenantId, sso_tenant_id: tenantId })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id;
}

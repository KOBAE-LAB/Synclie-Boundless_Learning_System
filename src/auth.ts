/**
 * Auth.js (NextAuth v5) 設定。
 *
 * 段階1: Credentials(メール+パスワード等の簡易ログイン)。
 * 段階2: F22(SSO対応)。Microsoft Entra ID / Google Workspace for Education の
 *        プロバイダーは、対応する環境変数(AUTH_MICROSOFT_ENTRA_ID_ID など)が
 *        設定されている時だけ有効になる(未設定でもbuild・Credentialsログインは動く)。
 *        実際のOAuthアプリ登録(Azure Portal / Google Cloud Console)は開発者が
 *        別途行う必要があり、このコードだけでは完結しない。
 *
 * サインインしたユーザーをprofilesに紐づける処理は src/lib/auth/sso.ts に分離している
 * (生徒のSSO subject idを、学年が上がってもポートフォリオを引き継ぐための永続キーとして
 * 使う想定。要件定義書6章・12章を参照)。
 *
 * 段階3: F17(LMS連携、LTI 1.3)。/api/lti/launch がプラットフォームのid_tokenを検証した
 * 「あと」に、その結果(どのprofileか)だけを積んだ短命な受け渡しトークンを
 * "lti" Credentialsプロバイダーへ渡してセッションを確立する
 * (src/lib/lti/handoff.ts参照。プラットフォームのid_tokenを直接ここへは渡さない)。
 */
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/auth/password";
import { linkOrCreateSsoProfile } from "@/lib/auth/sso";
import { verifyLtiHandoffToken } from "@/lib/lti/handoff";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 教師の自己登録は管理者の承認が済むまでログインさせない(承認待ち・却下)。
// パスワードが合っている人にだけ状態を伝えるため、照合の後で投げる。
class PendingApprovalError extends CredentialsSignin {
  code = "pending_approval";
}
class RejectedError extends CredentialsSignin {
  code = "rejected";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // 段階1: メール+パスワードの簡易ログイン。
    // profiles.email / profiles.password_hash を照合する(0002マイグレーション参照)。
    Credentials({
      credentials: {
        email: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // RLSを回避する必要がある(ログイン前はまだセッションがないため)管理者クライアントを使う。
        const admin = createAdminClient();
        const { data: profile, error } = await admin
          .from("profiles")
          .select("id, email, display_name, role, password_hash, approval_status")
          .eq("email", email)
          .maybeSingle();

        if (error || !profile || !profile.password_hash) return null;

        const valid = await verifyPassword(password, profile.password_hash);
        if (!valid) return null;

        if (profile.approval_status === "pending") throw new PendingApprovalError();
        if (profile.approval_status === "rejected") throw new RejectedError();

        return {
          id: profile.id,
          email: profile.email,
          name: profile.display_name,
          role: profile.role,
        };
      },
    }),
    // F22: Microsoft Entra ID。AUTH_MICROSOFT_ENTRA_ID_ISSUERで特定のテナントに限定できる
    // (未指定なら個人アカウントも含む共通(common)テナントで動く)。
    // IDだけ設定してISSUERを忘れると、Auth.jsが設定エラーを出して認証全体(メールログインも含む)が
    // 動かなくなるため、両方揃っている時だけ有効にする。
    ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
          }),
        ]
      : []),
    // F22: Google Workspace for Education。
    ...(process.env.AUTH_GOOGLE_ID
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
    // F17: LTI 1.3。/api/lti/launch がプラットフォームのid_tokenを検証・profileへの
    // 紐づけまで済ませた後にだけ呼ばれる(このauthorize()自体はLTIを検証しない)。
    Credentials({
      id: "lti",
      name: "LTI",
      credentials: { token: { label: "LTI handoff token", type: "text" } },
      async authorize(rawCredentials) {
        const token = rawCredentials?.token;
        if (typeof token !== "string") return null;
        const payload = await verifyLtiHandoffToken(token);
        if (!payload) return null;
        return {
          id: payload.profileId,
          email: payload.email,
          name: payload.name,
          role: payload.role,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    // SSOで入れなかった時(承認待ちの教師など)の理由も、ログイン画面に表示する。
    error: "/login",
  },
  callbacks: {
    // F22: SSOでのサインイン時、profilesへの紐づけ・役割の決定をここで行い、
    // 結果(id/role)をuserに詰め直す。Credentials("credentials"/"lti")は
    // それぞれのauthorize()で既に決定済みなのでスキップする。
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials" || account.provider === "lti") return true;

      const subject = account.providerAccountId;
      if (!subject) return false;

      const tenantId =
        account.provider === "microsoft-entra-id"
          ? ((profile as { tid?: string } | undefined)?.tid ?? null)
          : account.provider === "google"
            ? ((profile as { hd?: string } | undefined)?.hd ?? null)
            : null;

      const linked = await linkOrCreateSsoProfile({
        provider: account.provider,
        subject,
        email: user.email ?? null,
        displayName: user.name ?? null,
        tenantId,
        // Googleは email_verified で確認済みかを返す。Microsoft(Entra ID)のemailクレームは
        // 本人確認の保証が無い(nOAuthと呼ばれる既知の問題)ため、確認済みとは扱わない
        // (既存アカウントとのメール統合はしない)。
        emailVerified:
          account.provider === "google" &&
          (profile as { email_verified?: boolean } | undefined)?.email_verified === true,
      });
      if (!linked) return false;

      user.id = linked.id;
      (user as typeof user & { role?: string }).role = linked.role as "teacher" | "student" | "guardian";
      return true;
    },
    async jwt({ token, user }) {
      // サインイン直後(user が渡されるタイミング)にロールをJWTへ焼き込む。
      if (user) {
        (token as typeof token & { role?: string }).role = (
          user as typeof user & { role?: string }
        ).role;
      }
      return token;
    },
    async session({ session, token }) {
      // ロール(教師/生徒/保護者)や所属組織(テナント)、ユーザーIDを
      // session に載せて、ダッシュボードや承認フロー、DB書き込みで使えるようにする。
      if (session.user) {
        (session.user as typeof session.user & { role?: string }).role =
          (token as { role?: string }).role;
        if (token.sub) {
          (session.user as typeof session.user & { id?: string }).id = token.sub;
        }
      }
      return session;
    },
  },
});

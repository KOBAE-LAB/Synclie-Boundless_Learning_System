import { randomBytes } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export const SHARE_DURATION_DAYS = [7, 30, 90] as const;

export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function computeExpiry(days: number, now: Date = new Date()): string {
  const allowed = (SHARE_DURATION_DAYS as readonly number[]).includes(days) ? days : SHARE_DURATION_DAYS[0];
  return new Date(now.getTime() + allowed * 24 * 60 * 60 * 1000).toISOString();
}

export type ShareLinkStatus = "active" | "expired" | "revoked";

export function shareLinkStatus(link: { expires_at: string; revoked_at: string | null }, now: Date = new Date()): ShareLinkStatus {
  if (link.revoked_at) return "revoked";
  if (new Date(link.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}

/** トークンから、有効な公開リンク(取り消されておらず、期限内)の持ち主を返す。無効なら null。 */
export async function resolveShareLink(
  admin: AdminClient,
  token: string,
  now: Date = new Date(),
): Promise<{ studentId: string; label: string | null } | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  const { data } = await admin
    .from("portfolio_share_links")
    .select("student_id, label, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (!data || shareLinkStatus(data, now) !== "active") return null;
  return { studentId: data.student_id, label: data.label };
}

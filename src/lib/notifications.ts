import { supabase } from "@/integrations/supabase/client";

export async function notifyUser(
  userId: string,
  type: string,
  title: string,
  message: string,
  relatedId?: string
) {
  await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    message,
    related_id: relatedId ?? null,
  });
}

export async function notifyAdmins(
  type: string,
  title: string,
  message: string,
  relatedId?: string
) {
  const { data: adminRoles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "administrator");

  if (!adminRoles?.length) return;

  const notifications = adminRoles.map((r) => ({
    user_id: r.user_id,
    type,
    title,
    message,
    related_id: relatedId ?? null,
  }));

  await supabase.from("notifications").insert(notifications);
}

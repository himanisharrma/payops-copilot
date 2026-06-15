import { query } from "@/lib/db";

export async function databaseHealth() {
  const result = await query<{ now: Date }>("SELECT NOW() AS now");
  return result.rows[0].now.toISOString();
}

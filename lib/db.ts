import { Pool, type PoolClient, type QueryResultRow } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";

const globalForDb = globalThis as unknown as { payopsPool?: Pool };

export const db =
  globalForDb.payopsPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 20_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.payopsPool = db;

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return db.query<T>(text, values);
}

export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

import bcrypt from "bcryptjs";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://payops:payops_local@127.0.0.1:5438/payops";
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const organization = await client.query(
  "SELECT id FROM organizations WHERE slug = 'payops-portfolio'",
);
const organizationId = organization.rows[0].id;
const passwordHash = await bcrypt.hash("PayOpsDemo123!", 12);
const users = [
  ["Himani Admin", "admin@payops.local", "admin"],
  ["Asha Analyst", "analyst@payops.local", "analyst"],
  ["Vikram Viewer", "viewer@payops.local", "viewer"],
];

for (const [name, email, role] of users) {
  await client.query(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       active = TRUE`,
    [organizationId, name, email, passwordHash, role],
  );
}

await client.end();
console.log("Seeded admin, analyst, and viewer demo users.");

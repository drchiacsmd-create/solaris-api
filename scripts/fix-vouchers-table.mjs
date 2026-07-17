import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const sql = postgres(DATABASE_URL, { ssl: "require" });

async function fix() {
  console.log("Checking vouchers table columns...");
  
  // Check existing columns
  const cols = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'vouchers' ORDER BY ordinal_position
  `;
  const colNames = cols.map(c => c.column_name);
  console.log("Existing columns:", colNames);

  // If issuedAt exists but createdAt doesn't, rename it
  if (colNames.includes('issuedAt') && !colNames.includes('createdAt')) {
    console.log("Renaming issuedAt → createdAt...");
    await sql`ALTER TABLE "vouchers" RENAME COLUMN "issuedAt" TO "createdAt"`;
    console.log("✅ Renamed issuedAt to createdAt");
  } else if (!colNames.includes('createdAt')) {
    console.log("Adding createdAt column...");
    await sql`ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()`;
    console.log("✅ Added createdAt column");
  } else {
    console.log("✅ createdAt column already exists, no fix needed");
  }

  // Also ensure issuedAt exists as an alias if db.ts uses it
  if (!colNames.includes('issuedAt') && colNames.includes('createdAt')) {
    console.log("Note: issuedAt was renamed to createdAt successfully");
  }

  console.log("Done!");
  await sql.end();
}

fix().catch(err => {
  console.error("Fix failed:", err);
  process.exit(1);
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const url = process.env.SUPABASE_URL;

  // Use the existing Supabase key.
  // SUPABASE_ANON_KEY is the original variable name.
  // SUPABASE_PUBLISHABLE_KEY is supported only as a fallback.
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  const missing = [];

  if (!url) {
    missing.push("SUPABASE_URL");
  }

  if (!key) {
    missing.push("SUPABASE_ANON_KEY");
  }

  if (missing.length) {
    return res.status(500).json({
      success: false,
      error: `Supabase configuration is missing: ${missing.join(" and ")}.`
    });
  }

  return res.status(200).json({
    success: true,
    supabaseUrl: url,
    supabasePublishableKey: key
  });
}

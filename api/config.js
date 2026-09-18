export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, error:"Method not allowed" });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(500).json({ success:false, error:"Supabase configuration is missing." });
  return res.status(200).json({ success:true, supabaseUrl:url, supabasePublishableKey:key });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

export async function authUser(req) {
  const token = bearer(req);
  if (!token || !SUPABASE_URL || !PUBLISHABLE) throw new Error("Unauthorized.");

  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey:PUBLISHABLE, Authorization:`Bearer ${token}`, Accept:"application/json" }
  });
  if (!r.ok) throw new Error("Unauthorized.");
  const u = await r.json();
  if (!u?.id) throw new Error("Unauthorized.");
  return u;
}

export async function sb(path, options={}) {
  if (!SUPABASE_URL || !SERVICE) throw new Error("Supabase server configuration is missing.");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers:{
      apikey:SERVICE,
      Authorization:`Bearer ${SERVICE}`,
      "Content-Type":"application/json",
      Accept:"application/json",
      Prefer:"return=representation",
      ...(options.headers||{})
    }
  });
  const text = await r.text();
  let data={};
  try { data=text?JSON.parse(text):{}; } catch { throw new Error(`Supabase returned invalid JSON (HTTP ${r.status}).`); }
  if (!r.ok) throw new Error(data?.message || data?.hint || data?.details || `Supabase request failed (HTTP ${r.status}).`);
  return data;
}

export { SUPABASE_URL };

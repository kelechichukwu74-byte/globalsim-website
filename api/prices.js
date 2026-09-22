import { sureVerificationRequest, getServersForCountry } from "./_lib.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rfitbmkizfmwfqqskwhy.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: "application/json" }
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data?.message || data?.hint || `Supabase request failed (HTTP ${r.status})`);
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, error:"Method not allowed" });
  try {
    const countryId = req.query?.countryId;
    const countryName = req.query?.countryName || "";
    const service = req.query?.service;
    if (!countryId || !service) return res.status(400).json({ success:false, error:"countryId and service are required" });
    const servers = getServersForCountry(countryName);
    const results = [];
    for (const server of servers) {
      try {
        const data = await sureVerificationRequest(`/${server}/price?country_id=${encodeURIComponent(countryId)}&service=${encodeURIComponent(service)}`);
        const price = Number(data?.price ?? data?.data?.price ?? data?.amount ?? data?.data?.amount);
        if (Number.isFinite(price) && price > 0) results.push({ server, price, available:true, raw:data });
      } catch (e) { results.push({ server, available:false, error:e?.message || "Unavailable" }); }
    }
    results.sort((a,b) => (a.available? a.price:Infinity) - (b.available? b.price:Infinity));
    let selling_price = null;
    try {
      const rows = await supabaseRequest(`product_prices?country_id=eq.${encodeURIComponent(countryId)}&service_id=eq.${encodeURIComponent(service)}&select=selling_price&limit=1`);
      selling_price = rows?.[0]?.selling_price ?? null;
    } catch {}
    return res.status(200).json({ success:true, countryId, service, selling_price, selected: results.find(x=>x.available) || null, servers:results });
  } catch (e) { return res.status(500).json({ success:false, error:e?.message || "Unable to load prices." }); }
}

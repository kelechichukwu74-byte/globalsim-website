import { sureVerificationRequest } from "./_lib.js";

export default async function handler(req,res) {
  if (req.method !== "GET") return res.status(405).json({success:false,error:"Method not allowed"});
  try {
    const data = await sureVerificationRequest("/countries");
    const raw = Array.isArray(data) ? data :
      Array.isArray(data?.countries) ? data.countries :
      Array.isArray(data?.data) ? data.data :
      Array.isArray(data?.providerResponse?.countries) ? data.providerResponse.countries : [];
    const countries = raw.map(c => ({
      ...c,
      id:c.id ?? c.country_id ?? c.countryId,
      name:c.name ?? c.country_name ?? c.countryName ?? String(c.id ?? c.country_id ?? ""),
      code:c.code ?? c.country_code ?? c.countryCode ?? ""
    })).filter(c=>c.id!=null);
    res.status(200).json({success:true,countries});
  } catch(e) {
    console.error(e);
    res.status(500).json({success:false,error:e.message||"Unable to load countries."});
  }
}

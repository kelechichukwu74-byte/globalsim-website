import { getServersForCountry, sureVerificationRequest, extractProviderPrice, quote } from "./_lib.js";

export default async function handler(req,res) {
  if(req.method!=="GET") return res.status(405).json({success:false,error:"Method not allowed"});
  const {countryId,service,countryCode,countryName}=req.query||{};
  if(!countryId||!service) return res.status(400).json({success:false,error:"Country and service are required."});
  const results=[];
  for(const server of getServersForCountry(countryCode||countryName)) {
    try {
      const data=await sureVerificationRequest(`/${server}/price?country_id=${quote(countryId)}&service=${quote(service)}`);
      const price=extractProviderPrice(data);
      if(price) results.push({server,providerPrice:price});
    } catch(e) { console.error(`price ${server}`,e.message); }
  }
  results.sort((a,b)=>a.providerPrice-b.providerPrice);
  res.status(200).json({success:true,servers:results,selected:results[0]||null});
}

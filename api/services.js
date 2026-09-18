import { getServersForCountry, sureVerificationRequest, quote } from "./_lib.js";
import { sb } from "./_supabase.js";

export default async function handler(req,res) {
  if (req.method !== "GET") return res.status(405).json({success:false,error:"Method not allowed"});
  const countryId=req.query?.countryId;
  const countryCode=req.query?.countryCode||"";
  const countryName=req.query?.countryName||"";
  if (!countryId) return res.status(400).json({success:false,error:"Country is required."});

  try {
    const servers=getServersForCountry(countryCode||countryName);
    const map=new Map();

    for (const server of servers) {
      try {
        const data=await sureVerificationRequest(`/${server}/services?country_id=${quote(countryId)}`);
        const list=Array.isArray(data?.services)?data.services:Array.isArray(data)?data:Array.isArray(data?.data)?data.data:[];
        for(const s of list) {
          const id=s.id??s.service_id??s.serviceId;
          const name=s.name??s.service_name??s.serviceName??String(id);
          if(id!=null) {
            const item=map.get(String(id))||{id,name,servers:[],available_servers:[]};
            if(!item.servers.includes(server)) item.servers.push(server);
            if(!item.available_servers.includes(server)) item.available_servers.push(server);
            map.set(String(id),item);
          }
        }
      } catch(e) { console.error(`services ${server}`,e.message); }
    }

    const services=[...map.values()];
    try {
      const prices=await sb(`product_prices?country_id=eq.${quote(countryId)}&select=country_id,service_id,country_name,service_name,selling_price`);
      for(const p of prices) {
        const item=map.get(String(p.service_id));
        if(item) {
          item.selling_price=p.selling_price;
          item.country_name=p.country_name;
          item.service_name=p.service_name;
        }
      }
    } catch(e) { console.error("pricing merge",e.message); }

    res.status(200).json({success:true,services});
  } catch(e) {
    console.error(e);
    res.status(500).json({success:false,error:e.message||"Unable to load services."});
  }
}

import { authUser, sb } from "./_supabase.js";
function q(v){return encodeURIComponent(String(v??""))}
async function admin(userId){const r=await sb(`profiles?id=eq.${q(userId)}&select=role&limit=1`);return r?.[0]?.role==="admin";}
export default async function handler(req,res){
  try{
    const u=await authUser(req);
    if(!(await admin(u.id))) return res.status(403).json({success:false,error:"Admin access required."});
    if(req.method==="GET"){
      const rows=await sb("product_prices?select=*&order=country_name.asc,service_name.asc");
      return res.status(200).json({success:true,prices:rows});
    }
    if(req.method==="POST"||req.method==="PATCH"){
      const b=req.body||{};
      if(!b.countryId||!b.serviceId) return res.status(400).json({success:false,error:"Country and service are required."});
      const price=Number(b.sellingPrice);
      if(!Number.isFinite(price)||price<=0) return res.status(400).json({success:false,error:"Enter a valid selling price."});
      const row={country_id:b.countryId,country_name:b.countryName||String(b.countryId),service_id:b.serviceId,service_name:b.serviceName||String(b.serviceId),selling_price:price,updated_at:new Date().toISOString()};
      const existing=await sb(`product_prices?country_id=eq.${q(b.countryId)}&service_id=eq.${q(b.serviceId)}&select=id&limit=1`);
      const data=existing?.[0]
        ? await sb(`product_prices?id=eq.${q(existing[0].id)}`,{method:"PATCH",body:JSON.stringify(row)})
        : await sb("product_prices",{method:"POST",body:JSON.stringify(row)});
      return res.status(200).json({success:true,message:"Selling price saved successfully.",price:data?.[0]||null});
    }
    return res.status(405).json({success:false,error:"Method not allowed"});
  }catch(e){res.status(e.message==="Unauthorized."?401:500).json({success:false,error:e.message||"Admin pricing failed."});}
}

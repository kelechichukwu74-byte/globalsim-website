import { getServersForCountry, sureVerificationRequest, quote, extractProviderPrice, getVerification, getVerificationId, getPhoneNumber } from "./_lib.js";
import { authUser, sb } from "./_supabase.js";

async function wallet(userId) {
  const rows=await sb(`wallets?user_id=eq.${quote(userId)}&select=user_id,balance&limit=1`);
  if(!rows?.[0]) throw new Error("Wallet not found. Please contact support.");
  return rows[0];
}

async function changeWallet(userId, amount) {
  for(let i=0;i<5;i++){
    const w=await wallet(userId);
    const old=Number(w.balance||0);
    const next=old+Number(amount);
    if(!Number.isFinite(next)) throw new Error("Invalid wallet balance.");
    const rows=await sb(`wallets?user_id=eq.${quote(userId)}&balance=eq.${encodeURIComponent(old)}`,{
      method:"PATCH",body:JSON.stringify({balance:next,updated_at:new Date().toISOString()})
    });
    if(rows?.length) return next;
  }
  throw new Error("Wallet is being updated. Please try again.");
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({success:false,error:"Method not allowed"});
  let user=null, debited=false, debit=0;
  try{
    user=await authUser(req);
    const b=req.body||{};
    const countryId=b.countryId??b.country_id;
    const countryName=b.countryName??b.country_name??"";
    const countryCode=b.countryCode??b.country_code??"";
    const serviceId=b.serviceCountryPriceId??b.serviceId??b.service_id;
    const serviceName=b.serviceName??b.service_name??String(serviceId||"");
    if(!countryId) return res.status(400).json({success:false,error:"Country is required."});
    if(!serviceId) return res.status(400).json({success:false,error:"Service is required."});

    const prices=await sb(`product_prices?country_id=eq.${quote(countryId)}&service_id=eq.${quote(serviceId)}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`);
    const p=prices?.[0];
    const selling=Number(p?.selling_price);
    if(!Number.isFinite(selling)||selling<=0) return res.status(400).json({success:false,error:"This country and service is not currently available for purchase."});

    const servers=Array.isArray(b.availableServers)&&b.availableServers.length?b.availableServers:getServersForCountry(countryCode||countryName);
    const options=[];
    for(const server of servers){
      try{
        const priceData=await sureVerificationRequest(`/${server}/price?country_id=${quote(countryId)}&service=${quote(serviceId)}`);
        const providerPrice=extractProviderPrice(priceData);
        if(providerPrice) options.push({server,providerPrice});
      }catch(e){ console.error("provider price",server,e.message); }
    }
    options.sort((a,b)=>a.providerPrice-b.providerPrice);
    if(!options.length) return res.status(503).json({success:false,error:"No provider price is currently available for this country and service."});

    const w=await wallet(user.id);
    const balance=Number(w.balance||0);
    if(balance<selling) return res.status(400).json({success:false,error:"Insufficient wallet balance."});

    let selected=null, purchase=null, lastError=null;
    for(const o of options){
      try{
        const data=await sureVerificationRequest(`/${o.server}/purchase?country_id=${quote(countryId)}&service=${quote(serviceId)}`,{method:"POST"});
        const id=getVerificationId(data), number=getPhoneNumber(data);
        if(id&&number){selected=o;purchase=data;break;}
      }catch(e){lastError=e;console.error("purchase",o.server,e.message);}
    }
    if(!selected||!purchase) return res.status(503).json({success:false,error:lastError?.message||"No number is currently available from the provider."});

    const newBalance=await changeWallet(user.id,-selling); debited=true; debit=selling;
    const v=getVerification(purchase), verificationId=getVerificationId(purchase), phone=getPhoneNumber(purchase);
    let orderRows;
    try{
      orderRows=await sb("orders",{method:"POST",body:JSON.stringify({
        user_id:user.id,
        provider_order_id:verificationId,
        service_country_price_id:serviceId,
        service_name:p?.service_name||serviceName,
        country_name:p?.country_name||countryName,
        provider_cost:selected.providerPrice,
        customer_price:selling,
        profit:selling-selected.providerPrice,
        status:v?.status||"active",
        phone_number:phone
      })});
    }catch(e){
      await changeWallet(user.id,selling);
      debited=false;
      throw e;
    }

    try{
      await sb("wallet_transactions",{method:"POST",body:JSON.stringify({
        user_id:user.id,amount:-selling,balance_after:newBalance,type:"order",
        description:`Purchase: ${p?.service_name||serviceName} ${phone}`
      })});
    }catch(e){ console.error("wallet history",e.message); }

    res.status(200).json({
      success:true,message:"Number purchased successfully.",
      order:orderRows?.[0]||null,
      verification:{...v,request_id:verificationId,number:phone},
      provider_server:selected.server,provider_price:selected.providerPrice,
      selling_price:selling,balance:newBalance
    });
  }catch(e){
    if(debited&&user&&debit){
      try{await changeWallet(user.id,debit);}catch(refundError){console.error("refund",refundError);}
    }
    const msg=e.message||"Purchase failed.";
    const code=msg==="Unauthorized."?401:500;
    res.status(code).json({success:false,error:msg});
  }
}

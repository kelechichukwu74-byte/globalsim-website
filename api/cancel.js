import { authUser, sb } from "./_supabase.js";
import { sureVerificationRequest, quote } from "./_lib.js";

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({success:false,error:"Method not allowed"});

  try{
    const user=await authUser(req);
    const id=req.body?.verificationId||req.body?.id;
    if(!id) return res.status(400).json({success:false,error:"Verification ID is required."});

    const rows=await sb(
      `orders?user_id=eq.${quote(user.id)}&provider_order_id=eq.${quote(id)}&select=*&limit=1`
    );
    const order=rows?.[0];

    if(!order) return res.status(404).json({success:false,error:"Order not found."});
    if(order.status==="cancelled" || order.status==="refunded"){
      return res.status(400).json({success:false,error:"This number has already been cancelled."});
    }

    const created=new Date(order.created_at||0).getTime();
    if(!Number.isFinite(created) || Date.now()-created < 120000){
      return res.status(400).json({success:false,error:"Cancellation is available after the 2-minute waiting period."});
    }

    const provider=await sureVerificationRequest(
      `/verifications/cancel/${quote(id)}`,
      {method:"DELETE"}
    );

    const walletRows=await sb(
      `wallets?user_id=eq.${quote(user.id)}&select=balance&limit=1`
    );
    const balance=Number(walletRows?.[0]?.balance||0);
    const refund=Number(order.customer_price||0);
    const newBalance=balance+refund;

    await sb(
      `wallets?user_id=eq.${quote(user.id)}`,
      {
        method:"PATCH",
        body:JSON.stringify({
          balance:newBalance,
          updated_at:new Date().toISOString()
        })
      }
    );

    await sb(
      `orders?id=eq.${quote(order.id)}`,
      {
        method:"PATCH",
        body:JSON.stringify({status:"cancelled"})
      }
    );

    try{
      await sb("wallet_transactions",{
        method:"POST",
        body:JSON.stringify({
          user_id:user.id,
          amount:refund,
          balance_after:newBalance,
          type:"refund",
          description:`Refund: ${order.service_name||"number"} ${order.phone_number||""}`
        })
      });
    }catch(e){
      console.error("refund transaction history",e);
    }

    return res.status(200).json({
      success:true,
      message:"Number cancelled and wallet refunded.",
      balance:newBalance,
      provider
    });
  }catch(e){
    const code=e.message==="Unauthorized."?401:500;
    return res.status(code).json({success:false,error:e.message||"Unable to cancel number."});
  }
}

import { authUser, sb } from "./_supabase.js";
const q=v=>encodeURIComponent(String(v??""));

export default async function handler(req,res){
  try{
    const u=await authUser(req);

    if(req.method==="GET"){
      const p=await sb(`profiles?id=eq.${q(u.id)}&select=*&limit=1`);
      const w=await sb(`wallets?user_id=eq.${q(u.id)}&select=*&limit=1`);
      return res.status(200).json({
        success:true,
        profile:p?.[0]||null,
        wallet:w?.[0]||{balance:0}
      });
    }

    if(req.method==="POST"){
      const b=req.body||{};
      const existing=await sb(`profiles?id=eq.${q(u.id)}&select=id&limit=1`);
      if(!existing?.length){
        await sb("profiles",{
          method:"POST",
          body:JSON.stringify({
            id:u.id,
            full_name:b.fullName||u.user_metadata?.full_name||"",
            email:u.email||b.email||"",
            role:"customer",
            is_active:true
          })
        });
      }

      const wallets=await sb(`wallets?user_id=eq.${q(u.id)}&select=user_id&limit=1`);
      if(!wallets?.length){
        await sb("wallets",{method:"POST",body:JSON.stringify({user_id:u.id,balance:0})});
      }

      return res.status(200).json({success:true});
    }

    return res.status(405).json({success:false,error:"Method not allowed"});
  }catch(e){
    res.status(e.message==="Unauthorized."?401:500)
      .json({success:false,error:e.message||"Profile request failed."});
  }
}

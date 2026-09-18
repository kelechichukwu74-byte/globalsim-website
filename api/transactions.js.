import { authUser, sb } from "./_supabase.js";
const q=v=>encodeURIComponent(String(v??""));
export default async function handler(req,res){
  if(req.method!=="GET")return res.status(405).json({success:false,error:"Method not allowed"});
  try{
    const u=await authUser(req);
    const rows=await sb(`wallet_transactions?user_id=eq.${q(u.id)}&select=*&order=created_at.desc`);
    res.status(200).json({success:true,transactions:rows});
  }catch(e){res.status(e.message==="Unauthorized."?401:500).json({success:false,error:e.message})}
}

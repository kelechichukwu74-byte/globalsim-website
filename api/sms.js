import { sureVerificationRequest, quote } from "./_lib.js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({success:false,error:"Method not allowed"});
  const id=req.query?.id;
  if(!id) return res.status(400).json({success:false,error:"Verification ID is required."});
  try{
    const data=await sureVerificationRequest(`/verifications/sms/${quote(id)}`);
    res.status(200).json({success:true,...data});
  }catch(e){res.status(500).json({success:false,error:e.message||"Unable to load SMS."});}
}

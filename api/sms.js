import { sureVerificationRequest, quote } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const id = req.query?.id;

  if (!id) {
    return res.status(400).json({
      success: false,
      error: "Verification ID is required."
    });
  }

  try {
    const data = await sureVerificationRequest(
      `/verifications/sms/${quote(id)}`
    );

    return res.status(200).json({
      success: true,
      verification_id: id,
      sms: data?.sms || data?.message || data?.code || null,
      code: data?.code || null,
      message: data?.message || null,
      data: data
    });

  } catch (e) {
    console.error("SMS error:", e);

    return res.status(500).json({
      success: false,
      error: e?.message || "Unable to load SMS."
    });
  }
}

import { sureVerificationRequest } from "./_lib.js";

function encode(value) {
  return encodeURIComponent(String(value ?? "").trim());
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const verificationId = String(
    req.query?.verificationId ||
    req.query?.verification_id ||
    req.query?.id ||
    ""
  ).trim();

  if (!verificationId) {
    return res.status(400).json({
      success: false,
      error: "Verification ID is required."
    });
  }

  try {
    const data = await sureVerificationRequest(
      `/verifications/sms/${encode(verificationId)}`
    );

    const smsList = Array.isArray(data?.sms)
      ? data.sms
      : [];

    const latest = smsList.length
      ? smsList[smsList.length - 1]
      : null;

    const code =
      latest?.formatted ||
      latest?.raw ||
      null;

    return res.status(200).json({
      success: true,
      verification_id: verificationId,
      sms: code,
      code,
      sms_received: Boolean(code),
      sms_list: smsList
    });

  } catch (error) {
    console.error("SMS API error:", error);

    return res.status(502).json({
      success: false,
      verification_id: verificationId,
      sms: null,
      code: null,
      sms_received: false,
      error:
        error?.message ||
        "Unable to retrieve SMS."
    });
  }
}

import { sureVerificationRequest, quote } from "./_lib.js";

function extractSMS(data) {
  if (!data || typeof data !== "object") {
    return {
      sms: null,
      code: null
    };
  }

  const sources = [
    data,
    data.verification,
    data.data,
    data.result
  ].filter(Boolean);

  let sms = null;
  let code = null;

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    if (!sms) {
      sms =
        source.sms ??
        source.sms_code ??
        source.sms_content ??
        source.content ??
        source.text ??
        null;
    }

    if (!code) {
      code =
        source.code ??
        source.verification_code ??
        source.verificationCode ??
        source.otp ??
        source.otp_code ??
        null;
    }
  }

  if (!sms && code) {
    sms = String(code);
  }

  return {
    sms: sms != null ? String(sms) : null,
    code: code != null ? String(code) : null
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const verificationId = String(
    req.query?.id ||
    req.query?.verificationId ||
    req.query?.verification_id ||
    ""
  ).trim();

  if (!verificationId) {
    return res.status(400).json({
      success: false,
      error: "Verification ID is required."
    });
  }

  try {
    const providerResponse = await sureVerificationRequest(
      `/verifications/sms/${quote(verificationId)}`
    );

    const result = extractSMS(providerResponse);

    return res.status(200).json({
      success: true,
      verification_id: verificationId,
      sms: result.sms,
      code: result.code,
      message: providerResponse?.message || null,
      data: providerResponse
    });

  } catch (error) {
    console.error("SMS API error:", error);

    return res.status(502).json({
      success: false,
      verification_id: verificationId,
      sms: null,
      code: null,
      error:
        error?.message ||
        "Unable to retrieve SMS from SureVerification."
    });
  }
}

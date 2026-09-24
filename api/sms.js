// api/SMS.js

import { sureVerificationRequest, quote } from "./_lib.js";

function extractSms(data) {
  if (!data || typeof data !== "object") {
    return {
      sms: null,
      code: null
    };
  }

  const candidates = [
    data,
    data.verification,
    data.data,
    data.result,
    data.sms,
    data.message
  ].filter(Boolean);

  let sms = null;
  let code = null;

  for (const item of candidates) {
    if (typeof item === "string") {
      if (!sms) sms = item;
      continue;
    }

    if (typeof item !== "object") continue;

    if (!sms) {
      sms =
        item.sms ??
        item.sms_code ??
        item.sms_content ??
        item.content ??
        item.text ??
        null;
    }

    if (!code) {
      code =
        item.code ??
        item.verification_code ??
        item.otp ??
        item.otp_code ??
        null;
    }
  }

  // If there is a code but no separate SMS text, use the code as SMS.
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

  const id = String(req.query?.id || "").trim();

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

    const extracted = extractSms(data);

    return res.status(200).json({
      success: true,
      verification_id: id,

      // What the frontend can display
      sms: extracted.sms,
      code: extracted.code,

      // Provider response preserved for debugging/future compatibility
      provider_response: data
    });

  } catch (error) {
    console.error("SureVerification SMS error:", error);

    const status =
      Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status < 600
        ? error.status
        : 502;

    return res.status(status).json({
      success: false,
      verification_id: id,
      error:
        error?.message ||
        "Unable to load SMS from SureVerification."
    });
  }
}

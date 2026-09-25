import { sureVerificationRequest } from "./_lib.js";

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
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
    const data =
      await sureVerificationRequest(
        `/verifications/sms/${encode(
          verificationId
        )}`
      );

    const smsList =
      Array.isArray(data?.sms)
        ? data.sms
        : [];

    const latestSms =
      smsList.length > 0
        ? smsList[smsList.length - 1]
        : null;

    const code =
      latestSms?.formatted ||
      latestSms?.raw ||
      null;

    return res.status(200).json({
      success: true,
      verification_id:
        verificationId,
      sms: code,
      code: code,
      sms_received:
        Boolean(code),
      sms_list: smsList
    });

  } catch (error) {
    console.error(
      "SMS API error:",
      error
    );

    return res.status(502).json({
      success: false,
      verification_id:
        verificationId,
      sms: null,
      code: null,
      sms_received: false,
      error:
        error?.message ||
        "Unable to retrieve SMS from SureVerification."
    });
  }
}

import {
  sureVerificationRequest
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function getAuthenticatedUser(req) {
  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  if (!SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_PUBLISHABLE_KEY,
          Authorization:
            `Bearer ${token}`,
          Accept:
            "application/json"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      "Unauthorized."
    );
  }

  const user =
    await response.json();

  if (!user?.id) {
    throw new Error(
      "Unauthorized."
    );
  }

  return user;
}

async function supabaseRequest(
  path
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${path}`,
      {
        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Accept:
            "application/json"
        }
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    throw new Error(
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}

function quote(value) {
  return encodeURIComponent(
    String(value)
  );
}

function extractSms(data) {
  if (!data) {
    return null;
  }

  if (
    typeof data ===
    "string"
  ) {
    return {
      message: data
    };
  }

  const source =
    data?.sms ||
    data?.data ||
    data?.verification ||
    data;

  return {
    code:
      source?.code ??
      source?.otp ??
      source?.verification_code ??
      source?.verificationCode ??
      null,

    message:
      source?.message ??
      source?.sms ??
      source?.text ??
      source?.body ??
      null,

    status:
      source?.status ??
      null,

    received_at:
      source?.received_at ??
      source?.receivedAt ??
      null
  };
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return res.status(405).json({
      success:
        false,
      error:
        "Method not allowed"
    });
  }

  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    const verificationId =
      req.query?.verificationId ||
      req.query?.verification_id ||
      req.query?.requestId ||
      req.query?.request_id;

    if (!verificationId) {
      return res.status(400).json({
        success:
          false,
        error:
          "Verification ID is required."
      });
    }

    /*
     * Make sure this verification belongs
     * to the currently logged-in customer.
     */
    const orders =
      await supabaseRequest(
        `orders?user_id=eq.${quote(
          user.id
        )}&verification_id=eq.${quote(
          verificationId
        )}&select=id,user_id,verification_id,phone_number,service_name,status,created_at&limit=1`
      );

    const order =
      orders?.[0];

    if (!order) {
      return res.status(404).json({
        success:
          false,
        error:
          "Verification not found."
      });
    }

    /*
     * Ask SureVerification for the
     * latest SMS received on the number.
     */
    const providerData =
      await sureVerificationRequest(
        `/verifications/sms/${encodeURIComponent(
          verificationId
        )}`
      );

    const sms =
      extractSms(
        providerData
      );

    const providerStatus =
      providerData?.status ||
      providerData?.data?.status ||
      providerData?.verification?.status ||
      sms?.status ||
      order.status ||
      "active";

    return res.status(200).json({
      success:
        true,

      verification_id:
        verificationId,

      number:
        order.phone_number,

      service:
        order.service_name,

      status:
        providerStatus,

      sms:
        sms,

      data:
        providerData
    });

  } catch (error) {
    console.error(
      "SMS verification error:",
      error
    );

    const message =
      error?.message ||
      "Unable to load SMS.";

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,
        error:
          message
      });
    }

    return res.status(500).json({
      success:
        false,
      error:
        message
    });
  }
}

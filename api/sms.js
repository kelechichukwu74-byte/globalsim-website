// api/sms.js

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://jvfpbqzndxqzvsygqvpg.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_BASE_URL = "https://sureverifications.com/api/v1";

function json(res, status, data) {
  res.status(status).json(data);
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...(options.body !== undefined ? { body: options.body } : {})
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.hint ||
      `Supabase request failed (${response.status})`
    );
  }

  return data;
}

async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();

  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) return null;

  return await response.json();
}

async function providerRequest(verificationId) {
  const apiKey = process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error("SUREVERIFICATION_API_KEY is not configured.");
  }

  const response = await fetch(
    `${SURE_BASE_URL}/verifications/sms/${encodeURIComponent(
      verificationId
    )}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `SureVerification returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}

function extractSms(data) {
  const list = Array.isArray(data?.sms)
    ? data.sms
    : Array.isArray(data?.messages)
      ? data.messages
      : Array.isArray(data?.data)
        ? data.data
        : [];

  const sms = list.map((item) => ({
    from: item?.from ?? null,
    raw:
      item?.raw ??
      item?.code ??
      item?.otp ??
      null,
    formatted:
      item?.formatted ??
      item?.code ??
      item?.otp ??
      item?.raw ??
      null,
    created_at: item?.created_at ?? null
  }));

  const latest = sms.length
    ? sms[sms.length - 1]
    : null;

  const code =
    latest?.formatted ||
    latest?.raw ||
    null;

  return {
    sms,
    code,
    sms_received: Boolean(code),
    smsCode: code,
    verificationCode: code,
    otp: code
  };
}

function getParam(req, names) {
  for (const name of names) {
    if (req.query?.[name] !== undefined) {
      return String(req.query[name]).trim();
    }

    if (req.body?.[name] !== undefined) {
      return String(req.body[name]).trim();
    }
  }

  return "";
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, {
        success: false,
        error: "SUPABASE_SERVICE_ROLE_KEY is not configured."
      });
    }

    const user = await getAuthenticatedUser(req);

    if (!user?.id) {
      return json(res, 401, {
        success: false,
        error: "Unauthorized."
      });
    }

    const suppliedIdentifier = getParam(req, [
      "verificationId",
      "verification_id",
      "verification",
      "orderId",
      "order_id",
      "id",
      "provider_order_id",
      "request_id",
      "phone_number",
      "phone"
    ]);

    if (!suppliedIdentifier) {
      return json(res, 400, {
        success: false,
        error: "Verification ID or order ID is required."
      });
    }

    let verificationId = null;
    let matchedOrder = null;

    const orderById = await supabaseRequest(
      `/rest/v1/orders?id=eq.${encodeURIComponent(
        suppliedIdentifier
      )}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
    );

    if (Array.isArray(orderById) && orderById.length) {
      matchedOrder = orderById[0];
    }

    if (!matchedOrder) {
      const orderByProviderId = await supabaseRequest(
        `/rest/v1/orders?provider_verification_id=eq.${encodeURIComponent(
          suppliedIdentifier
        )}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
      );

      if (
        Array.isArray(orderByProviderId) &&
        orderByProviderId.length
      ) {
        matchedOrder = orderByProviderId[0];
      }
    }

    if (!matchedOrder) {
      const orderByRequestId = await supabaseRequest(
        `/rest/v1/orders?provider_order_id=eq.${encodeURIComponent(
          suppliedIdentifier
        )}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
      );

      if (
        Array.isArray(orderByRequestId) &&
        orderByRequestId.length
      ) {
        matchedOrder = orderByRequestId[0];
      }
    }

    if (!matchedOrder) {
      const orderByPhone = await supabaseRequest(
        `/rest/v1/orders?phone_number=eq.${encodeURIComponent(
          suppliedIdentifier
        )}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
      );

      if (
        Array.isArray(orderByPhone) &&
        orderByPhone.length
      ) {
        matchedOrder = orderByPhone[0];
      }
    }

    if (matchedOrder) {
      verificationId =
        matchedOrder.provider_verification_id ||
        null;

      if (!verificationId) {
        return json(res, 400, {
          success: false,
          error: "Provider verification ID is missing.",
          order_id: matchedOrder.id,
          provider_order_id:
            matchedOrder.provider_order_id || null
        });
      }

      if (matchedOrder.provider_expired_at) {
        const expiryText = String(
          matchedOrder.provider_expired_at
        ).trim();

        const expiry = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
          expiryText
        )
          ? new Date(
              expiryText.replace(" ", "T") + "Z"
            )
          : new Date(expiryText);

        if (
          !Number.isNaN(expiry.getTime()) &&
          Date.now() >= expiry.getTime()
        ) {
          return json(res, 410, {
            success: false,
            expired: true,
            error: "This number has expired.",
            order_id: matchedOrder.id,
            verification_id: verificationId
          });
        }
      }
    } else {
      verificationId = suppliedIdentifier;
    }

    const providerData =
      await providerRequest(verificationId);

    const result = extractSms(providerData);

    return json(res, 200, {
      success: true,
      order_id: matchedOrder?.id || null,
      verification_id: verificationId,
      provider_order_id:
        matchedOrder?.provider_order_id || null,
      sms: result.sms,
      code: result.code,
      smsCode: result.smsCode,
      verificationCode: result.verificationCode,
      otp: result.otp,
      sms_received: result.sms_received,
      sms_list: result.sms
    });
  } catch (error) {
    return json(res, 500, {
      success: false,
      error:
        error?.message ||
        "Failed to retrieve SMS."
    });
  }
}

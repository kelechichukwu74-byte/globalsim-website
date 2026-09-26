// api/sms.js

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://jvfpbqzndxqzvsygqvpg.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";

function json(res, status, data) {
  return res.status(status).json(data);
}

async function getUser(req) {
  const auth =
    req.headers.authorization || "";

  if (
    !auth
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return null;
  }

  const token =
    auth.slice(7).trim();

  if (!token) return null;

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_PUBLISHABLE_KEY,
          Authorization:
            `Bearer ${token}`
        }
      }
    );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function supabaseRequest(
  path,
  options = {}
) {
  const response =
    await fetch(
      `${SUPABASE_URL}${path}`,
      {
        method:
          options.method || "GET",
        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
          ...(options.headers || {})
        },
        ...(options.body !== undefined
          ? { body: options.body }
          : {})
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
    data = {
      raw: text
    };
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

function parseProviderDate(
  value
) {
  if (!value) return null;

  const text =
    String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(text)
  ) {
    return new Date(
      text.replace(
        " ",
        "T"
      ) + "Z"
    );
  }

  const date =
    new Date(text);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

async function providerSms(
  verificationId
) {
  const apiKey =
    process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SURE_BASE_URL}/verifications/sms/${encodeURIComponent(
        verificationId
      )}`,
      {
        headers: {
          Accept:
            "application/json",
          "x-api-key":
            apiKey
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

function extractSms(
  data
) {
  const sms =
    Array.isArray(data?.sms)
      ? data.sms
      : [];

  const list =
    sms.map((item) => ({
      from:
        item?.from ?? null,
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
      created_at:
        item?.created_at ??
        null
    }));

  const latest =
    list.length
      ? list[list.length - 1]
      : null;

  const code =
    latest?.formatted ||
    latest?.raw ||
    null;

  return {
    sms:
      list,
    code,
    sms_received:
      Boolean(code),
    smsCode:
      code,
    verificationCode:
      code,
    otp:
      code
  };
}

function getIdentifier(req) {
  return String(
    req.query?.verificationId ||
    req.query?.verification_id ||
    req.query?.orderId ||
    req.query?.order_id ||
    req.query?.id ||
    req.query?.provider_order_id ||
    req.query?.request_id ||
    req.query?.phone_number ||
    req.query?.phone ||
    ""
  ).trim();
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "GET") {
    return json(res, 405, {
      success: false,
      error:
        "Method not allowed."
    });
  }

  try {
    const user =
      await getUser(req);

    if (!user?.id) {
      return json(res, 401, {
        success: false,
        error:
          "Unauthorized."
      });
    }

    const identifier =
      getIdentifier(req);

    if (!identifier) {
      return json(res, 400, {
        success: false,
        error:
          "Verification ID or order ID is required."
      });
    }

    let order = null;

    const searches = [
      `id=eq.${encodeURIComponent(
        identifier
      )}`,
      `provider_verification_id=eq.${encodeURIComponent(
        identifier
      )}`,
      `provider_order_id=eq.${encodeURIComponent(
        identifier
      )}`,
      `phone_number=eq.${encodeURIComponent(
        identifier
      )}`
    ];

    for (const condition of searches) {
      const rows =
        await supabaseRequest(
          `/rest/v1/orders?user_id=eq.${encodeURIComponent(
            user.id
          )}&${condition}&limit=1`
        );

      if (
        Array.isArray(rows) &&
        rows.length
      ) {
        order = rows[0];
        break;
      }
    }

    if (!order) {
      return json(res, 404, {
        success: false,
        error:
          "Order not found."
      });
    }

    const verificationId =
      order.provider_verification_id
        ? String(
            order.provider_verification_id
          )
        : null;

    if (!verificationId) {
      return json(res, 400, {
        success: false,
        error:
          "Provider verification ID is missing.",
        order_id:
          order.id,
        provider_order_id:
          order.provider_order_id ||
          null
      });
    }

    const expiry =
      parseProviderDate(
        order.provider_expired_at
      );

    if (
      expiry &&
      Date.now() >=
        expiry.getTime()
    ) {
      return json(res, 410, {
        success: false,
        expired: true,
        error:
          "This number has expired.",
        order_id:
          order.id,
        verification_id:
          verificationId
      });
    }

    const providerData =
      await providerSms(
        verificationId
      );

    const result =
      extractSms(
        providerData
      );

    return json(res, 200, {
      success: true,
      order_id:
        order.id,
      verification_id:
        verificationId,
      provider_order_id:
        order.provider_order_id ||
        null,
      sms:
        result.sms,
      sms_list:
        result.sms,
      code:
        result.code,
      smsCode:
        result.smsCode,
      verificationCode:
        result.verificationCode,
      otp:
        result.otp,
      sms_received:
        result.sms_received
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

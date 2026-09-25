// api/cancel.js

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  SUPABASE_SERVICE_ROLE_KEY;

const SUREVERIFICATION_API_KEY =
  process.env.SUREVERIFICATION_API_KEY;

const SUREVERIFICATION_BASE_URL =
  "https://sureverifications.com/api/v1";

const MIN_CANCEL_WAIT_MS = 2 * 60 * 1000;


// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function json(res, status, data) {
  return res.status(status).json(data);
}

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function formatRemaining(ms) {
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}${
      remainingSeconds > 0
        ? ` ${remainingSeconds} second${
            remainingSeconds === 1 ? "" : "s"
          }`
        : ""
    }`;
  }

  return `${remainingSeconds} second${
    remainingSeconds === 1 ? "" : "s"
  }`;
}


// ---------------------------------------------------------
// SUPABASE
// ---------------------------------------------------------

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is missing.");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text || {};
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      data?.hint ||
      `Supabase request failed (HTTP ${response.status})`
    );
  }

  return data;
}


// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------

async function getAuthenticatedUser(req) {
  const authorization =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  if (!authorization.startsWith("Bearer ")) {
    throw new Error("Authentication required.");
  }

  const accessToken =
    authorization.slice(7).trim();

  if (!accessToken) {
    throw new Error(
      "Authentication token is missing."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization:
          `Bearer ${accessToken}`
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok || !data?.id) {
    throw new Error(
      "Your login session is invalid or expired."
    );
  }

  return data;
}


// ---------------------------------------------------------
// FIND ORDER
// ---------------------------------------------------------

async function findOrder(userId, identifier) {
  if (!identifier) return null;

  const value = String(identifier).trim();

  // 1. Order UUID
  if (isUuid(value)) {
    const rows = await supabaseRequest(
      `orders?id=eq.${encode(value)}` +
      `&user_id=eq.${encode(userId)}` +
      `&select=*&limit=1`
    );

    if (Array.isArray(rows) && rows.length) {
      return rows[0];
    }
  }

  // 2. Provider order ID
  const providerOrder = await supabaseRequest(
    `orders?provider_order_id=eq.${encode(value)}` +
    `&user_id=eq.${encode(userId)}` +
    `&select=*&limit=1`
  );

  if (
    Array.isArray(providerOrder) &&
    providerOrder.length
  ) {
    return providerOrder[0];
  }

  // 3. Provider verification ID
  const verification = await supabaseRequest(
    `orders?provider_verification_id=eq.${encode(value)}` +
    `&user_id=eq.${encode(userId)}` +
    `&select=*&limit=1`
  );

  if (
    Array.isArray(verification) &&
    verification.length
  ) {
    return verification[0];
  }

  // 4. Phone number
  const phone = await supabaseRequest(
    `orders?phone_number=eq.${encode(value)}` +
    `&user_id=eq.${encode(userId)}` +
    `&select=*&order=created_at.desc&limit=1`
  );

  if (Array.isArray(phone) && phone.length) {
    return phone[0];
  }

  return null;
}


// ---------------------------------------------------------
// REFUND CHECK
// ---------------------------------------------------------

async function hasRefund(order) {
  const rows = await supabaseRequest(
    `wallet_transactions?user_id=eq.${encode(
      order.user_id
    )}` +
    `&type=eq.refund` +
    `&reference_id=eq.${encode(order.id)}` +
    `&select=id&limit=1`
  );

  return Array.isArray(rows) && rows.length > 0;
}


// ---------------------------------------------------------
// REFUND
// ---------------------------------------------------------

async function refundOrder(order) {
  if (await hasRefund(order)) {
    return {
      refunded: false,
      alreadyRefunded: true
    };
  }

  const refundAmount =
    Number(order.customer_price || 0);

  if (
    !Number.isFinite(refundAmount) ||
    refundAmount <= 0
  ) {
    throw new Error(
      "Unable to refund this order because the customer price is invalid."
    );
  }

  const wallets = await supabaseRequest(
    `wallets?user_id=eq.${encode(order.user_id)}` +
    `&select=*&limit=1`
  );

  let wallet =
    Array.isArray(wallets) && wallets.length
      ? wallets[0]
      : null;

  if (!wallet) {
    await supabaseRequest("wallets", {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        user_id: order.user_id,
        balance: refundAmount
      })
    });

    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          user_id: order.user_id,
          type: "refund",
          amount: refundAmount,
          balance_before: 0,
          balance_after: refundAmount,
          reference_id: order.id,
          description:
            "Refund for cancelled virtual number order"
        })
      }
    );

    return {
      refunded: true,
      amount: refundAmount,
      balanceBefore: 0,
      balanceAfter: refundAmount
    };
  }

  const balanceBefore =
    Number(wallet.balance || 0);

  const balanceAfter =
    balanceBefore + refundAmount;

  await supabaseRequest(
    `wallets?user_id=eq.${encode(order.user_id)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        balance: balanceAfter,
        updated_at:
          new Date().toISOString()
      })
    }
  );

  await supabaseRequest(
    "wallet_transactions",
    {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: order.user_id,
        type: "refund",
        amount: refundAmount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reference_id: order.id,
        description:
          "Refund for cancelled virtual number order"
      })
    }
  );

  return {
    refunded: true,
    amount: refundAmount,
    balanceBefore,
    balanceAfter
  };
}


// ---------------------------------------------------------
// UPDATE ORDER
// ---------------------------------------------------------

async function updateOrderStatus(
  orderId,
  status
) {
  await supabaseRequest(
    `orders?id=eq.${encode(orderId)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        status,
        updated_at:
          new Date().toISOString()
      })
    }
  );
}


// ---------------------------------------------------------
// SUREVERIFICATION
// ---------------------------------------------------------

async function sureVerificationRequest(
  path,
  options = {}
) {
  if (!SUREVERIFICATION_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is missing."
    );
  }

  const response = await fetch(
    `${SUREVERIFICATION_BASE_URL}${path}`,
    {
      ...options,
      headers: {
        "x-api-key":
          SUREVERIFICATION_API_KEY,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text || {};
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.error ||
      data?.detail ||
      data?.error_description ||
      `SureVerification request failed (HTTP ${response.status})`
    );

    error.status = response.status;
    error.providerData = data;

    throw error;
  }

  return data;
}


// ---------------------------------------------------------
// PROVIDER EXPIRED / INACTIVE
// ---------------------------------------------------------

function looksLikeExpiredOrInactive(error) {
  const message = String(
    error?.message ||
    error?.providerData?.message ||
    error?.providerData?.error ||
    ""
  ).toLowerCase();

  return (
    message.includes("expired") ||
    message.includes("not active") ||
    message.includes("inactive") ||
    message.includes("already cancelled") ||
    message.includes("already canceled") ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("invalid verification")
  );
}


// ---------------------------------------------------------
// MAIN
// ---------------------------------------------------------

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "DELETE" &&
    req.method !== "POST"
  ) {
    res.setHeader(
      "Allow",
      ["DELETE", "POST"]
    );

    return json(res, 405, {
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    const user =
      await getAuthenticatedUser(req);

    const query = req.query || {};

    let identifier =
      query.id ||
      query.orderId ||
      query.order_id ||
      query.phone ||
      query.phone_number ||
      query.verificationId ||
      query.verification_id;

    if (!identifier && req.body) {
      if (typeof req.body === "string") {
        try {
          req.body = JSON.parse(req.body);
        } catch {}
      }

      if (
        req.body &&
        typeof req.body === "object"
      ) {
        identifier =
          req.body.id ||
          req.body.orderId ||
          req.body.order_id ||
          req.body.phone ||
          req.body.phone_number ||
          req.body.verificationId ||
          req.body.verification_id;
      }
    }

    if (!identifier) {
      return json(res, 400, {
        success: false,
        error:
          "Order ID, phone number, or verification ID is required."
      });
    }

    const order =
      await findOrder(
        user.id,
        identifier
      );

    if (!order) {
      return json(res, 404, {
        success: false,
        error:
          "Active number order was not found."
      });
    }

    const alreadyRefunded =
      await hasRefund(order);

    if (
      alreadyRefunded ||
      ["cancelled", "expired", "refunded"].includes(
        String(order.status || "").toLowerCase()
      )
    ) {
      return json(res, 200, {
        success: true,
        alreadyProcessed: true,
        message:
          "This number has already been cancelled or expired, and the refund has already been processed."
      });
    }

    // -----------------------------------------------------
    // MINIMUM 2-MINUTE PROVIDER WAIT
    // -----------------------------------------------------

    const createdAt =
      new Date(order.created_at).getTime();

    if (!Number.isFinite(createdAt)) {
      return json(res, 500, {
        success: false,
        error:
          "Unable to determine when this number was purchased."
      });
    }

    const elapsed =
      Date.now() - createdAt;

    if (elapsed < MIN_CANCEL_WAIT_MS) {
      return json(res, 400, {
        success: false,
        error:
          `Please wait ${formatRemaining(
            MIN_CANCEL_WAIT_MS - elapsed
          )} before cancelling this number.`
      });
    }

    // -----------------------------------------------------
    // IMPORTANT FIX:
    //
    // Your current purchase code stores the provider
    // request_id in provider_order_id.
    //
    // Therefore use provider_verification_id FIRST,
    // then provider_order_id as fallback.
    // -----------------------------------------------------

    const verificationId =
      order.provider_verification_id ||
      order.provider_order_id;

    if (!verificationId) {
      return json(res, 409, {
        success: false,
        error:
          "This number cannot be cancelled because the provider verification ID is missing."
      });
    }

    // -----------------------------------------------------
    // CANCEL AT SUREVERIFICATION
    // -----------------------------------------------------

    let providerResponse;

    try {
      providerResponse =
        await sureVerificationRequest(
          `/verifications/cancel/${encode(
            verificationId
          )}`,
          {
            method: "DELETE"
          }
        );
    } catch (providerError) {
      if (
        looksLikeExpiredOrInactive(
          providerError
        )
      ) {
        await updateOrderStatus(
          order.id,
          "expired"
        );

        const refund =
          await refundOrder(order);

        return json(res, 200, {
          success: true,
          expired: true,
          refunded:
            refund.refunded ||
            refund.alreadyRefunded,
          amount:
            refund.amount ||
            Number(order.customer_price || 0),
          message:
            "Number expired and your money has been returned to your wallet."
        });
      }

      console.error(
        "SureVerification cancellation error:",
        providerError
      );

      return json(res, 502, {
        success: false,
        error:
          providerError?.message ||
          "Unable to cancel the number with the provider."
      });
    }

    // -----------------------------------------------------
    // PROVIDER CANCELLED SUCCESSFULLY
    // -----------------------------------------------------

    await updateOrderStatus(
      order.id,
      "cancelled"
    );

    // -----------------------------------------------------
    // REFUND
    // -----------------------------------------------------

    const refund =
      await refundOrder(order);

    return json(res, 200, {
      success: true,
      cancelled: true,
      refunded:
        refund.refunded ||
        refund.alreadyRefunded,
      amount:
        refund.amount ||
        Number(order.customer_price || 0),
      verification_id:
        String(verificationId),
      provider_response:
        providerResponse,
      message:
        "Number cancelled and your money has been returned to your wallet."
    });

  } catch (error) {
    console.error(
      "Cancel API error:",
      error
    );

    return json(res, 500, {
      success: false,
      error:
        error?.message ||
        "Unable to cancel number."
    });
  }
}

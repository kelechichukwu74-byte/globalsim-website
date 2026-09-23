const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_API_KEY =
  process.env.SUREVERIFICATION_API_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";


function getToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}


async function authenticate(req) {
  const token = getToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error("Unauthorized.");
  }

  const user = await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}


async function db(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
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
        Prefer: "return=representation",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.details ||
      data?.hint ||
      `Supabase request failed (${response.status})`
    );
  }

  return data;
}


async function parseProviderResponse(response) {
  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  return {
    data,
    text
  };
}


/*
 * IMPORTANT:
 *
 * SureVerification cancellation requires the
 * verification ID, NOT the request/order ID.
 *
 * provider_verification_id must therefore be
 * used first.
 */
async function cancelWithSureVerification(
  providerVerificationId
) {
  if (!SURE_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  if (
    providerVerificationId === undefined ||
    providerVerificationId === null ||
    String(providerVerificationId).trim() === ""
  ) {
    throw new Error(
      "SureVerification verification ID is missing."
    );
  }

  const verificationId =
    String(providerVerificationId).trim();

  const url =
    `${SURE_BASE_URL}/verifications/cancel/${encodeURIComponent(
      verificationId
    )}`;

  console.log(
    "Cancelling SureVerification verification:",
    verificationId
  );

  const response = await fetch(
    url,
    {
      method: "DELETE",

      headers: {
        "x-api-key": SURE_API_KEY,
        Accept: "application/json"
      }
    }
  );

  const {
    data,
    text
  } = await parseProviderResponse(response);

  console.log(
    "SureVerification cancellation response:",
    {
      verificationId,
      status: response.status,
      ok: response.ok,
      response: data
    }
  );

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.details ||
      data?.hint ||
      text ||
      `Provider cancellation failed (${response.status})`
    );
  }

  return {
    success: true,
    provider_response: data,
    cancelled_id: verificationId
  };
}


async function getWallet(userId) {
  const wallets = await db(
    `wallets?user_id=eq.${encodeURIComponent(
      userId
    )}&select=*&limit=1`
  );

  const wallet = wallets?.[0];

  if (!wallet) {
    throw new Error("Wallet not found.");
  }

  return wallet;
}


async function refundWallet(userId, amount) {
  const refundAmount = Number(amount);

  if (
    !Number.isFinite(refundAmount) ||
    refundAmount <= 0
  ) {
    return null;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet = await getWallet(userId);

    const currentBalance =
      Number(wallet.balance || 0);

    if (!Number.isFinite(currentBalance)) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    const newBalance =
      currentBalance + refundAmount;

    const updated = await db(
      `wallets?user_id=eq.${encodeURIComponent(
        userId
      )}&balance=eq.${encodeURIComponent(
        currentBalance
      )}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          balance: newBalance,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (
      Array.isArray(updated) &&
      updated.length > 0
    ) {
      return newBalance;
    }
  }

  throw new Error(
    "Unable to update wallet balance."
  );
}


async function recordRefund(
  userId,
  amount,
  balanceAfter,
  orderId
) {
  try {
    await db(
      "wallet_transactions",
      {
        method: "POST",

        body: JSON.stringify({
          user_id: userId,
          amount: Number(amount),
          balance_after: Number(balanceAfter),
          type: "refund",
          reference_id: orderId,
          description:
            `Refund for cancelled virtual number (${orderId})`
        })
      }
    );

    return true;

  } catch (error) {
    console.error(
      "Refund transaction error:",
      error
    );

    return false;
  }
}


function getSuppliedId(req) {
  const query = req.query || {};
  const body = req.body || {};

  return (
    query.id ||
    query.orderId ||
    query.order_id ||
    query.providerOrderId ||
    query.provider_order_id ||
    query.verificationId ||
    query.verification_id ||
    query.providerVerificationId ||
    query.provider_verification_id ||

    body.orderId ||
    body.order_id ||
    body.id ||
    body.providerOrderId ||
    body.provider_order_id ||
    body.verificationId ||
    body.verification_id ||
    body.providerVerificationId ||
    body.provider_verification_id ||

    ""
  );
}


async function findOrder(
  userId,
  suppliedId
) {
  const cleanId =
    String(suppliedId).trim();

  /*
   * First try Supabase order UUID.
   */
  let orders = await db(
    `orders?user_id=eq.${encodeURIComponent(
      userId
    )}&id=eq.${encodeURIComponent(
      cleanId
    )}&select=*&limit=1`
  );

  if (
    Array.isArray(orders) &&
    orders.length > 0
  ) {
    return orders[0];
  }

  /*
   * Then provider verification ID.
   */
  orders = await db(
    `orders?user_id=eq.${encodeURIComponent(
      userId
    )}&provider_verification_id=eq.${encodeURIComponent(
      cleanId
    )}&select=*&limit=1`
  );

  if (
    Array.isArray(orders) &&
    orders.length > 0
  ) {
    return orders[0];
  }

  /*
   * Finally provider request/order ID.
   *
   * This is only for locating the database
   * order. It is NOT used for provider
   * cancellation.
   */
  orders = await db(
    `orders?user_id=eq.${encodeURIComponent(
      userId
    )}&provider_order_id=eq.${encodeURIComponent(
      cleanId
    )}&select=*&limit=1`
  );

  if (
    Array.isArray(orders) &&
    orders.length > 0
  ) {
    return orders[0];
  }

  return null;
}


export default async function handler(req, res) {
  if (
    req.method !== "DELETE" &&
    req.method !== "POST"
  ) {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    const user =
      await authenticate(req);

    const suppliedId =
      getSuppliedId(req);

    const cleanId =
      String(suppliedId).trim();

    if (!cleanId) {
      return res.status(400).json({
        success: false,
        error: "Cancellation ID is required."
      });
    }

    const order =
      await findOrder(
        user.id,
        cleanId
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        error:
          "Order not found for this account."
      });
    }

    console.log(
      "Cancellation order:",
      {
        id: order.id,
        provider_order_id:
          order.provider_order_id,
        provider_verification_id:
          order.provider_verification_id,
        status: order.status
      }
    );

    const status =
      String(order.status || "")
        .trim()
        .toLowerCase();

    if (
      status === "cancelled" ||
      status === "canceled"
    ) {
      return res.status(200).json({
        success: true,
        already_cancelled: true,
        message:
          "Number is already cancelled.",
        refunded: false
      });
    }

    if (
      status === "expired" ||
      status === "refunded" ||
      status === "failed" ||
      status === "rejected"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This number can no longer be cancelled."
      });
    }

    /*
     * THIS IS THE IMPORTANT PART.
     *
     * Use provider_verification_id for the
     * SureVerification cancellation request.
     */
    const providerVerificationId =
      order.provider_verification_id ||
      order.providerVerificationId ||
      order.verification?.id ||
      order.verification?.verification_id ||
      order.verification?.verificationId ||
      null;

    if (!providerVerificationId) {
      return res.status(400).json({
        success: false,
        error:
          "SureVerification verification ID is missing for this order."
      });
    }

    /*
     * Cancel at SureVerification.
     */
    const providerResult =
      await cancelWithSureVerification(
        providerVerificationId
      );

    if (!providerResult?.success) {
      throw new Error(
        "Unable to cancel number with SureVerification."
      );
    }

    /*
     * Refund customer wallet.
     */
    const refundAmount =
      Number(
        order.customer_price ??
        order.selling_price ??
        order.amount ??
        0
      );

    let balanceAfter = null;
    let refunded = false;

    if (
      Number.isFinite(refundAmount) &&
      refundAmount > 0
    ) {
      balanceAfter =
        await refundWallet(
          user.id,
          refundAmount
        );

      refunded = true;

      await recordRefund(
        user.id,
        refundAmount,
        balanceAfter,
        order.id
      );
    }

    /*
     * Mark order cancelled.
     */
    const updatedOrders =
      await db(
        `orders?id=eq.${encodeURIComponent(
          order.id
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}`,
        {
          method: "PATCH",

          body: JSON.stringify({
            status: "cancelled",
            updated_at:
              new Date().toISOString()
          })
        }
      );

    if (
      !Array.isArray(updatedOrders) ||
      updatedOrders.length === 0
    ) {
      console.error(
        "Provider cancelled but database order update returned no rows.",
        {
          orderId: order.id,
          providerVerificationId
        }
      );
    }

    return res.status(200).json({
      success: true,

      message: refunded
        ? `Number cancelled successfully. ₦${refundAmount.toLocaleString()} has been refunded to your wallet.`
        : "Number cancelled successfully.",

      order_id: order.id,

      provider_order_id:
        order.provider_order_id || null,

      provider_verification_id:
        providerVerificationId,

      provider_cancelled_id:
        providerResult.cancelled_id,

      refunded,

      refund_amount:
        refunded ? refundAmount : 0,

      balance_after:
        balanceAfter,

      status: "cancelled"
    });

  } catch (error) {
    console.error(
      "Cancel number error:",
      error
    );

    const message =
      error?.message ||
      "Unable to cancel number.";

    return res.status(
      message === "Unauthorized."
        ? 401
        : 500
    ).json({
      success: false,
      error: message
    });
  }
}

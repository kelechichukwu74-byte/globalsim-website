const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C0-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";

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
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
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

async function supabaseRequest(path, options = {}) {
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
        "Content-Type": "application/json",
        Accept: "application/json",
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

async function cancelProviderVerification(
  verificationId
) {
  const cleanId =
    String(verificationId || "").trim();

  if (!cleanId) {
    throw new Error("Verification ID is missing.");
  }

  if (!process.env.SUREVERIFICATION_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const url =
    `${SURE_BASE_URL}/verifications/cancel/${encodeURIComponent(
      cleanId
    )}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "x-api-key":
        process.env.SUREVERIFICATION_API_KEY,
      Accept: "application/json"
    }
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      message: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `Provider cancellation failed (HTTP ${response.status}).`
    );
  }

  return data;
}

async function refundWallet(
  userId,
  amount
) {
  const refundAmount =
    Number(amount);

  if (
    !Number.isFinite(refundAmount) ||
    refundAmount <= 0
  ) {
    throw new Error(
      "Invalid refund amount."
    );
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const rows =
      await supabaseRequest(
        `wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&select=user_id,balance&limit=1`
      );

    const wallet =
      rows?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found while processing refund."
      );
    }

    const currentBalance =
      Number(wallet.balance || 0);

    const newBalance =
      currentBalance +
      refundAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance: newBalance,
            updated_at:
              new Date().toISOString()
          })
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length
    ) {
      return newBalance;
    }
  }

  throw new Error(
    "Unable to complete wallet refund automatically."
  );
}

async function createRefundTransaction(
  userId,
  amount,
  balanceAfter
) {
  try {
    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          amount: Number(amount),
          balance_after:
            Number(balanceAfter),
          type: "refund",
          description:
            "Refund for cancelled virtual number"
        })
      }
    );
  } catch (error) {
    console.error(
      "Refund transaction history error:",
      error
    );
  }
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "DELETE" &&
    req.method !== "POST"
  ) {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const user =
      await getAuthenticatedUser(req);

    const queryId =
      req.query?.id ||
      req.query?.verificationId ||
      req.query?.verification_id;

    const body =
      req.body || {};

    const requestedId =
      queryId ||
      body.verificationId ||
      body.verification_id ||
      body.providerOrderId ||
      body.provider_order_id;

    if (!requestedId) {
      return res.status(400).json({
        success: false,
        error:
          "Verification ID is required."
      });
    }

    const id =
      String(requestedId).trim();

    /*
     * IMPORTANT:
     * provider_order_id must contain the
     * SureVerification request_id.
     */

    const orders =
      await supabaseRequest(
        `orders?user_id=eq.${encodeURIComponent(
          user.id
        )}&provider_order_id=eq.${encodeURIComponent(
          id
        )}&select=*&limit=1`
      );

    const order =
      orders?.[0];

    if (!order) {
      return res.status(404).json({
        success: false,
        error:
          "Order not found for this account."
      });
    }

    const currentStatus =
      String(
        order.status || ""
      ).toLowerCase();

    if (
      [
        "cancelled",
        "canceled",
        "refunded"
      ].includes(currentStatus)
    ) {
      return res.status(200).json({
        success: true,
        message:
          "Number is already cancelled.",
        refunded: true
      });
    }

    /*
     * Cancel directly through
     * SureVerification.
     */
    await cancelProviderVerification(
      id
    );

    /*
     * Refund the customer.
     */
    const refundAmount =
      Number(
        order.customer_price || 0
      );

    let balanceAfter = null;

    if (refundAmount > 0) {
      balanceAfter =
        await refundWallet(
          user.id,
          refundAmount
        );

      await createRefundTransaction(
        user.id,
        refundAmount,
        balanceAfter
      );
    }

    /*
     * Mark the order as cancelled.
     */
    await supabaseRequest(
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

    return res.status(200).json({
      success: true,

      message:
        refundAmount > 0
          ? `Number cancelled successfully. ₦${refundAmount.toLocaleString()} has been refunded to your wallet.`
          : "Number cancelled successfully.",

      refunded:
        refundAmount > 0,

      refund_amount:
        refundAmount,

      balance_after:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "Cancel number error:",
      error
    );

    const message =
      error?.message ||
      "Unable to cancel number.";

    const status =
      message === "Unauthorized."
        ? 401
        : 500;

    return res.status(status).json({
      success: false,
      error: message
    });
  }
}

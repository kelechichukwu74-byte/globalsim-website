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

  if (
    !header
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return null;
  }

  return header.slice(7).trim();
}


async function authenticate(req) {
  const accessToken =
    getToken(req);

  if (!accessToken) {
    throw new Error(
      "Unauthorized."
    );
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${accessToken}`,

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


async function db(
  path,
  options = {}
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
        ...options,

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          Accept:
            "application/json",

          "Content-Type":
            "application/json",

          Prefer:
            "return=representation",

          ...(options.headers || {})
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
    data = {
      message: text
    };
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


/*
 * Cancel through SureVerification.
 *
 * We try the provider request_id first.
 * If that fails, we try provider_verification_id.
 */
async function cancelWithSureVerification(
  requestId,
  providerVerificationId
) {
  if (!SURE_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const candidates = [];

  if (
    requestId !== undefined &&
    requestId !== null &&
    String(requestId).trim() !== ""
  ) {
    candidates.push(
      String(requestId).trim()
    );
  }

  if (
    providerVerificationId !== undefined &&
    providerVerificationId !== null &&
    String(providerVerificationId).trim() !== ""
  ) {
    const id =
      String(
        providerVerificationId
      ).trim();

    if (
      !candidates.includes(id)
    ) {
      candidates.push(id);
    }
  }

  if (!candidates.length) {
    throw new Error(
      "SureVerification verification ID is missing."
    );
  }

  let lastMessage =
    "Verification number cannot be cancelled.";

  for (
    const idToCancel of candidates
  ) {
    try {
      const response =
        await fetch(
          `${SURE_BASE_URL}/verifications/cancel/${encodeURIComponent(
            idToCancel
          )}`,
          {
            method:
              "DELETE",

            headers: {
              "x-api-key":
                SURE_API_KEY,

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
        data = {
          message: text
        };
      }

      if (response.ok) {
        return {
          success:
            true,

          provider_response:
            data,

          cancelled_id:
            idToCancel
        };
      }

      lastMessage =
        data?.message ||
        data?.error ||
        data?.details ||
        lastMessage;

    } catch (error) {
      lastMessage =
        error?.message ||
        lastMessage;
    }
  }

  throw new Error(
    lastMessage
  );
}


/*
 * Refund the customer's wallet.
 */
async function refundWallet(
  userId,
  amount
) {
  const refundAmount =
    Number(amount);

  if (
    !Number.isFinite(
      refundAmount
    ) ||
    refundAmount <= 0
  ) {
    return null;
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const wallets =
      await db(
        `wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&select=*&limit=1`
      );

    const wallet =
      wallets?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found."
      );
    }

    const currentBalance =
      Number(
        wallet.balance || 0
      );

    if (
      !Number.isFinite(
        currentBalance
      )
    ) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    const newBalance =
      currentBalance +
      refundAmount;

    const updated =
      await db(
        `wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date().toISOString()
            })
        }
      );

    if (
      Array.isArray(
        updated
      ) &&
      updated.length > 0
    ) {
      return newBalance;
    }
  }

  throw new Error(
    "Unable to update wallet balance."
  );
}


/*
 * Record refund in transaction history.
 */
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
        method:
          "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            amount:
              Number(amount),

            balance_after:
              Number(
                balanceAfter
              ),

            type:
              "refund",

            description:
              `Refund for cancelled virtual number (${orderId})`
          })
      }
    );
  } catch (error) {
    console.error(
      "Refund transaction error:",
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
      success:
        false,

      error:
        "Method not allowed."
    });
  }

  try {
    /*
     * Authenticate customer.
     */
    const user =
      await authenticate(
        req
      );

    const query =
      req.query || {};

    const body =
      req.body || {};

    /*
     * The frontend may send:
     * order id,
     * provider order id,
     * or provider verification id.
     */
    const suppliedId =
      query.id ||
      query.orderId ||
      query.verificationId ||
      query.verification_id ||
      body.orderId ||
      body.order_id ||
      body.id ||
      body.providerOrderId ||
      body.provider_order_id ||
      body.verificationId ||
      body.verification_id ||
      "";

    const cleanId =
      String(
        suppliedId
      ).trim();

    if (!cleanId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Cancellation ID is required."
      });
    }


    /*
     * First try provider_order_id.
     */
    let orders =
      await db(
        `orders?user_id=eq.${encodeURIComponent(
          user.id
        )}&provider_order_id=eq.${encodeURIComponent(
          cleanId
        )}&select=*&limit=1`
      );


    /*
     * If not found, try the new
     * provider_verification_id column.
     */
    if (
      !Array.isArray(orders) ||
      orders.length === 0
    ) {
      orders =
        await db(
          `orders?user_id=eq.${encodeURIComponent(
            user.id
          )}&provider_verification_id=eq.${encodeURIComponent(
            cleanId
          )}&select=*&limit=1`
        );
    }


    /*
     * If still not found, try Supabase
     * order UUID.
     */
    if (
      !Array.isArray(orders) ||
      orders.length === 0
    ) {
      orders =
        await db(
          `orders?user_id=eq.${encodeURIComponent(
            user.id
          )}&id=eq.${encodeURIComponent(
            cleanId
          )}&select=*&limit=1`
        );
    }

    const order =
      orders?.[0];

    if (!order) {
      return res.status(404).json({
        success:
          false,

        error:
          "Order not found for this account."
      });
    }


    /*
     * EXISTING provider request ID.
     */
    const requestId =
      order.provider_order_id ||
      order.providerOrderId ||
      order.request_id ||
      order.requestId ||
      order.verification?.request_id ||
      order.verification?.requestId ||
      null;


    /*
     * NEW provider verification ID.
     *
     * This is the important part.
     */
    const providerVerificationId =
      order.provider_verification_id ||
      order.providerVerificationId ||
      order.verification?.id ||
      order.verification?.verification_id ||
      order.verification?.verificationId ||
      null;


    if (
      !requestId &&
      !providerVerificationId
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "SureVerification verification ID was not saved for this order."
      });
    }


    /*
     * Do not cancel twice.
     */
    const status =
      String(
        order.status || ""
      ).toLowerCase();

    if (
      status ===
        "cancelled" ||
      status ===
        "canceled"
    ) {
      return res.status(200).json({
        success:
          true,

        message:
          "Number is already cancelled.",

        refunded:
          false
      });
    }


    /*
     * Cancel with SureVerification.
     */
    const providerResult =
      await cancelWithSureVerification(
        requestId,
        providerVerificationId
      );


    /*
     * Customer selling price is
     * what gets refunded.
     */
    const refundAmount =
      Number(
        order.customer_price ??
        order.selling_price ??
        order.amount ??
        0
      );

    let balanceAfter =
      null;


    /*
     * Refund wallet.
     */
    if (
      Number.isFinite(
        refundAmount
      ) &&
      refundAmount > 0
    ) {
      balanceAfter =
        await refundWallet(
          user.id,
          refundAmount
        );

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
    await db(
      `orders?id=eq.${encodeURIComponent(
        order.id
      )}&user_id=eq.${encodeURIComponent(
        user.id
      )}`,
      {
        method:
          "PATCH",

        body:
          JSON.stringify({
            status:
              "cancelled",

            updated_at:
              new Date().toISOString()
          })
      }
    );


    return res.status(200).json({
      success:
        true,

      message:
        refundAmount > 0
          ? `Number cancelled successfully. ₦${refundAmount.toLocaleString()} has been refunded to your wallet.`
          : "Number cancelled successfully.",

      refunded:
        refundAmount > 0,

      refund_amount:
        refundAmount,

      balance_after:
        balanceAfter,

      provider_cancelled_id:
        providerResult?.cancelled_id ||
        null
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
      message ===
        "Unauthorized."
        ? 401
        : 500
    ).json({
      success:
        false,

      error:
        message
    });
  }
}

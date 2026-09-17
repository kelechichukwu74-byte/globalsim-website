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
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  if (!SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY is not configured."
    );
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

async function supabaseRequest(
  path,
  options = {}
) {
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
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type":
          "application/json",
        Accept:
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
    throw new Error(
      "Invalid refund amount."
    );
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const wallets =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&select=user_id,balance&limit=1`
      );

    const wallet =
      wallets?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found while processing refund."
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
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance:
              newBalance,
            updated_at:
              new Date().toISOString()
          })
        }
      );

    if (
      Array.isArray(updated) &&
      updated.length > 0
    ) {
      return {
        previousBalance:
          currentBalance,
        newBalance
      };
    }
  }

  throw new Error(
    "Unable to complete wallet refund automatically."
  );
}

async function createRefundTransaction(
  userId,
  amount,
  balanceAfter,
  description
) {
  try {
    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",
        body: JSON.stringify({
          user_id:
            userId,
          amount:
            Number(amount),
          balance_after:
            Number(balanceAfter),
          type:
            "refund",
          description:
            description
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
  if (req.method !== "POST") {
    return res.status(405).json({
      success:
        false,
      error:
        "Method not allowed"
    });
  }

  let user = null;
  let order = null;
  let refundAmount = 0;
  let refundCompleted = false;

  try {
    user =
      await getAuthenticatedUser(
        req
      );

    const body =
      req.body || {};

    const verificationId =
      body.verificationId ??
      body.verification_id ??
      body.requestId ??
      body.request_id;

    if (!verificationId) {
      return res.status(400).json({
        success:
          false,
        error:
          "Verification ID is required."
      });
    }

    /*
     * Only the authenticated user's order can be cancelled.
     */
    const orders =
      await supabaseRequest(
        `orders?user_id=eq.${quote(
          user.id
        )}&verification_id=eq.${quote(
          verificationId
        )}&select=*&limit=1`
      );

    order =
      orders?.[0];

    if (!order) {
      return res.status(404).json({
        success:
          false,
        error:
          "Order not found."
      });
    }

    const currentStatus =
      String(
        order.status || ""
      ).toLowerCase();

    if (
      currentStatus ===
        "cancelled" ||
      currentStatus ===
        "canceled"
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "This number has already been cancelled."
      });
    }

    if (
      currentStatus ===
        "refunded"
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "This number has already been refunded."
      });
    }

    if (
      currentStatus ===
        "cancelling"
    ) {
      return res.status(409).json({
        success:
          false,
        error:
          "This number is already being cancelled. Please wait."
      });
    }

    /*
     * SureVerification requires at least 2 minutes
     * before a number can be cancelled.
     */
    const createdAt =
      new Date(
        order.created_at
      ).getTime();

    if (
      !Number.isFinite(
        createdAt
      )
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "Unable to determine when this number was purchased."
      });
    }

    const elapsed =
      Date.now() -
      createdAt;

    const minimumWait =
      2 * 60 * 1000;

    if (
      elapsed <
      minimumWait
    ) {
      const remainingMs =
        minimumWait -
        elapsed;

      const remainingSeconds =
        Math.ceil(
          remainingMs /
            1000
        );

      return res.status(400).json({
        success:
          false,
        error:
          `Please wait ${remainingSeconds} more seconds before cancelling this number.`,
        remaining_seconds:
          remainingSeconds
      });
    }

    refundAmount =
      Number(order.price);

    if (
      !Number.isFinite(
        refundAmount
      ) ||
      refundAmount <= 0
    ) {
      return res.status(400).json({
        success:
          false,
        error:
          "Unable to determine the amount to refund."
      });
    }

    /*
     * Lock the order first so two cancellation requests
     * cannot both receive a refund.
     */
    const locked =
      await supabaseRequest(
        `orders?id=eq.${quote(
          order.id
        )}&user_id=eq.${quote(
          user.id
        )}&status=eq.${quote(
          order.status
        )}`,
        {
          method:
            "PATCH",
          body:
            JSON.stringify({
              status:
                "cancelling",
              updated_at:
                new Date().toISOString()
            })
        }
      );

    if (
      !Array.isArray(
        locked
      ) ||
      locked.length === 0
    ) {
      return res.status(409).json({
        success:
          false,
        error:
          "This number is already being processed. Please try again."
      });
    }

    /*
     * Cancel the actual SureVerification activation.
     */
    try {
      await sureVerificationRequest(
        `/verifications/cancel/${encodeURIComponent(
          verificationId
        )}`,
        {
          method:
            "DELETE"
        }
      );
    } catch (providerError) {
      /*
       * Release the lock if the provider cancellation failed.
       */
      try {
        await supabaseRequest(
          `orders?id=eq.${quote(
            order.id
          )}&user_id=eq.${quote(
            user.id
          )}&status=eq.cancelling`,
          {
            method:
              "PATCH",
            body:
              JSON.stringify({
                status:
                  order.status ||
                  "active",
                updated_at:
                  new Date().toISOString()
              })
          }
        );
      } catch (unlockError) {
        console.error(
          "Unable to release cancellation lock:",
          unlockError
        );
      }

      throw new Error(
        providerError?.message ||
        "Unable to cancel the number."
      );
    }

    /*
     * Provider cancellation succeeded.
     * Now refund exactly the amount charged to the customer.
     */
    const refund =
      await refundWallet(
        user.id,
        refundAmount
      );

    refundCompleted =
      true;

    /*
     * Mark the order as cancelled and refunded.
     */
    let finalOrder;

    try {
      const updatedOrders =
        await supabaseRequest(
          `orders?id=eq.${quote(
            order.id
          )}&user_id=eq.${quote(
            user.id
          )}&status=eq.cancelling`,
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

      finalOrder =
        updatedOrders?.[0] ||
        null;
    } catch (orderUpdateError) {
      console.error(
        "Order cancellation status update failed:",
        orderUpdateError
      );
    }

    await createRefundTransaction(
      user.id,
      refundAmount,
      refund.newBalance,
      `Refund: cancelled ${order.phone_number || verificationId}`
    );

    return res.status(200).json({
      success:
        true,
      message:
        "Number cancelled successfully. Your wallet has been refunded.",
      refunded:
        refundAmount,
      balance:
        refund.newBalance,
      order:
        finalOrder ||
        {
          ...order,
          status:
            "cancelled"
        }
    });

  } catch (error) {
    console.error(
      "Cancel number error:",
      error
    );

    /*
     * If the provider was cancelled and the wallet was refunded,
     * never issue another refund from this error path.
     */
    if (
      refundCompleted
    ) {
      return res.status(200).json({
        success:
          true,
        message:
          "Number cancelled and wallet refunded.",
        refunded:
          refundAmount
      });
    }

    const message =
      error?.message ||
      "Unable to cancel the number.";

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

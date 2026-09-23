// api/cancel.js

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C0-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_API_KEY =
  process.env.SUREVERIFICATION_API_KEY;

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

  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
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
    throw new Error("Unauthorized.");
  }

  const user =
    await response.json();

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
          "Content-Type":
            "application/json",
          Accept:
            "application/json",
          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
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
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


/*
  Cancel the actual SureVerification verification.

  IMPORTANT:
  SureVerification cancellation uses the
  verification REQUEST ID, not the Supabase
  orders.id.
*/
async function cancelProviderVerification(
  requestId
) {

  const cleanId =
    String(requestId || "").trim();

  if (!cleanId) {
    throw new Error(
      "SureVerification request ID is missing."
    );
  }

  if (!SURE_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const url =
    `${SURE_BASE_URL}/verifications/cancel/${encodeURIComponent(cleanId)}`;

  const response =
    await fetch(
      url,
      {
        method: "DELETE",
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

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    data = {
      message: text
    };
  }

  if (!response.ok) {

    const providerMessage =
      data?.message ||
      data?.error ||
      data?.details ||
      "Verification number cannot be cancelled.";

    throw new Error(
      providerMessage
    );
  }

  return data;
}


/*
  Refund wallet.
*/
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
    return null;
  }

  const wallets =
    await supabaseRequest(
      `wallets?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`
    );

  const wallet =
    wallets?.[0];

  if (!wallet) {
    throw new Error(
      "Wallet not found."
    );
  }

  const currentBalance =
    Number(wallet.balance || 0);

  const newBalance =
    currentBalance + refundAmount;

  const updated =
    await supabaseRequest(
      `wallets?user_id=eq.${encodeURIComponent(userId)}&balance=eq.${encodeURIComponent(currentBalance)}`,
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
    !Array.isArray(updated) ||
    updated.length === 0
  ) {
    throw new Error(
      "Unable to update wallet balance."
    );
  }

  return newBalance;
}


/*
  Record refund transaction.
*/
async function createRefundTransaction(
  userId,
  amount,
  balanceAfter,
  orderId
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
            `Refund for cancelled virtual number (${orderId})`
        })
      }
    );

  } catch (error) {

    /*
      Do not fail the cancellation if the
      transaction-history table has a different
      structure or is unavailable.
    */
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
      success: false,
      error:
        "Method not allowed."
    });
  }


  try {

    const user =
      await getAuthenticatedUser(req);


    const query =
      req.query || {};

    const body =
      req.body || {};


    /*
      The frontend may send:
      - provider_order_id
      - verificationId
      - orderId
      - id
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


    const cleanSuppliedId =
      String(
        suppliedId
      ).trim();


    if (!cleanSuppliedId) {

      return res.status(400).json({
        success: false,
        error:
          "Cancellation ID is required."
      });
    }


    /*
      FIRST:
      Try to find the order using provider_order_id.
    */
    let orders =
      await supabaseRequest(
        `orders?user_id=eq.${encodeURIComponent(user.id)}&provider_order_id=eq.${encodeURIComponent(cleanSuppliedId)}&select=*&limit=1`
      );


    /*
      SECOND:
      If that failed, the supplied value may
      actually be the Supabase order UUID.
    */
    if (
      !Array.isArray(orders) ||
      orders.length === 0
    ) {

      orders =
        await supabaseRequest(
          `orders?user_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(cleanSuppliedId)}&select=*&limit=1`
        );
    }


    const order =
      orders?.[0];


    if (!order) {

      return res.status(404).json({
        success: false,
        error:
          "Order not found for this account."
      });
    }


    /*
      Get the REAL SureVerification request ID.

      Priority:
      provider_order_id
      verification.request_id
      verification_id
      verificationId
    */
    const requestId =
      order.provider_order_id ||
      order.providerOrderId ||
      order.verification?.request_id ||
      order.verification?.requestId ||
      order.verification_id ||
      order.verificationId ||
      "";


    if (!requestId) {

      return res.status(400).json({
        success: false,
        error:
          "SureVerification request ID was not saved for this order."
      });
    }


    /*
      Do not cancel an already cancelled order.
    */
    const status =
      String(
        order.status || ""
      ).toLowerCase();


    if (
      status === "cancelled" ||
      status === "canceled"
    ) {

      return res.status(200).json({
        success: true,
        message:
          "Number is already cancelled.",
        refunded: false
      });
    }


    /*
      CANCEL THROUGH SUREVERIFICATION.
    */
    await cancelProviderVerification(
      requestId
    );


    /*
      Refund the customer's actual
      selling price.
    */
    const refundAmount =
      Number(
        order.customer_price ||
        order.selling_price ||
        order.amount ||
        0
      );


    let balanceAfter =
      null;


    if (
      Number.isFinite(refundAmount) &&
      refundAmount > 0
    ) {

      balanceAfter =
        await refundWallet(
          user.id,
          refundAmount
        );


      await createRefundTransaction(
        user.id,
        refundAmount,
        balanceAfter,
        order.id
      );
    }


    /*
      Mark order cancelled.
    */
    await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(order.id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status:
            "cancelled",
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


    return res.status(
      error?.message ===
      "Unauthorized."
        ? 401
        : 500
    ).json({

      success: false,

      error:
        error?.message ||
        "Unable to cancel number."

    });
  }
}

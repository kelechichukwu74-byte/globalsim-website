import { sureVerificationRequest } from "./_lib.js";

/*
 * EXISTING VERCEL ENVIRONMENT VARIABLES
 *
 * SUPABASE_URL
 * SUPABASE_ANON_KEY
 * SUPABASE_SERVICE_ROLE_KEY
 * SUREVERIFICATION_API_KEY
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =========================================================
   BASIC CONFIGURATION CHECK
   ========================================================= */

function checkConfiguration() {
  if (!SUPABASE_URL) {
    throw new Error(
      "SUPABASE_URL is not configured."
    );
  }

  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      "SUPABASE_ANON_KEY is not configured."
    );
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }
}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header
    .slice(7)
    .trim();
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
            SUPABASE_ANON_KEY,

          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json"
        }
      }
    );

  const responseText =
    await response.text();

  let user = {};

  try {
    user = responseText
      ? JSON.parse(responseText)
      : {};
  } catch {
    throw new Error(
      "Unable to verify your login session."
    );
  }

  if (!response.ok) {
    console.error(
      "Supabase auth error:",
      response.status,
      user
    );

    throw new Error(
      "Unauthorized."
    );
  }

  if (!user?.id) {
    throw new Error(
      "Unauthorized."
    );
  }

  return user;
}


/* =========================================================
   SUPABASE SERVICE-ROLE REQUEST
   ========================================================= */

async function supabaseRequest(
  path,
  options = {}
) {
  checkConfiguration();

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

          Prefer:
            "return=representation",

          ...(options.headers || {})
        }
      }
    );

  const responseText =
    await response.text();

  let data = {};

  try {
    data = responseText
      ? JSON.parse(responseText)
      : {};
  } catch {
    throw new Error(
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    console.error(
      "Supabase request failed:",
      response.status,
      data
    );

    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      data?.error_description ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


/* =========================================================
   URL VALUE ENCODING
   ========================================================= */

function q(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}


/* =========================================================
   PROVIDER RESPONSE HELPERS
   ========================================================= */

function getProviderRoot(data) {
  return (
    data?.data ??
    data
  );
}


function getOrderDetail(data) {
  const root =
    getProviderRoot(data);

  if (
    Array.isArray(
      root?.orderDetail
    )
  ) {
    return root.orderDetail[0];
  }

  if (
    Array.isArray(
      root?.order_detail
    )
  ) {
    return root.order_detail[0];
  }

  if (
    Array.isArray(
      root?.details
    )
  ) {
    return root.details[0];
  }

  if (
    Array.isArray(
      root?.activations
    )
  ) {
    return root.activations[0];
  }

  return (
    root?.orderDetail ||
    root?.order_detail ||
    root?.details ||
    root?.activation ||
    root ||
    {}
  );
}


/* =========================================================
   PROVIDER ORDER ID
   ========================================================= */

function getProviderOrderId(data) {
  const root =
    getProviderRoot(data);

  const detail =
    getOrderDetail(data);

  return (
    detail?.orderId ??
    detail?.order_id ??
    root?.orderId ??
    root?.order_id ??
    root?.id ??
    data?.orderId ??
    data?.order_id ??
    data?.id ??
    null
  );
}


/* =========================================================
   PROVIDER ACTIVATION / VERIFICATION ID
   ========================================================= */

function getProviderVerificationId(data) {
  const root =
    getProviderRoot(data);

  const detail =
    getOrderDetail(data);

  return (
    detail?.activationId ??
    detail?.activation_id ??
    detail?.verificationId ??
    detail?.verification_id ??
    detail?.id ??
    root?.activationId ??
    root?.activation_id ??
    root?.verificationId ??
    root?.verification_id ??
    root?.activation?.id ??
    root?.verification?.id ??
    null
  );
}


/* =========================================================
   PHONE NUMBER
   ========================================================= */

function getPhoneNumber(data) {
  const root =
    getProviderRoot(data);

  const detail =
    getOrderDetail(data);

  return (
    detail?.phoneNumber ??
    detail?.phone_number ??
    detail?.number ??
    detail?.phone ??
    root?.phoneNumber ??
    root?.phone_number ??
    root?.number ??
    root?.phone ??
    null
  );
}


/* =========================================================
   PROVIDER PRICE
   ========================================================= */

function getProviderPrice(data) {
  const root =
    getProviderRoot(data);

  const detail =
    getOrderDetail(data);

  const candidates = [
    detail?.price,
    detail?.amount,
    detail?.totalPrice,

    root?.totalPrice,
    root?.total_price,
    root?.price,
    root?.amount,

    data?.totalPrice,
    data?.total_price,
    data?.price,
    data?.amount
  ];

  for (const value of candidates) {
    const number =
      Number(value);

    if (
      Number.isFinite(number) &&
      number >= 0
    ) {
      return number;
    }
  }

  /*
   * orders.provider_cost is NOT NULL.
   * If the provider does not return a price,
   * use 0 rather than inserting NULL.
   */
  return 0;
}


/* =========================================================
   PROVIDER STATUS
   ========================================================= */

function getProviderStatus(data) {
  const root =
    getProviderRoot(data);

  const detail =
    getOrderDetail(data);

  const status =
    detail?.status ??
    root?.status ??
    data?.status;

  /*
   * Provider activation status:
   * 0 = PENDING
   * 1 = READY
   * 2 = RESEND
   * 3 = SUCCESS
   * 4 = COMPLETED
   * 5 = CANCELLED
   * 6 = EXPIRED
   * 7 = REFUNDED
   * 8 = CANCELLED_BUT_WAITING_CONFIRM
   */

  if (
    status === 5 ||
    status === 6 ||
    status === 7
  ) {
    return "expired";
  }

  if (
    status === 4
  ) {
    return "completed";
  }

  return "active";
}


/* =========================================================
   DEBIT WALLET
   ========================================================= */

async function debitWallet(
  userId,
  amount
) {
  const requiredAmount =
    Number(amount);

  if (
    !Number.isFinite(
      requiredAmount
    ) ||
    requiredAmount <= 0
  ) {
    throw new Error(
      "Invalid purchase amount."
    );
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const rows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
          userId
        )}&select=user_id,balance&limit=1`
      );

    const wallet =
      rows?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found. Please contact support."
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

    if (
      currentBalance <
      requiredAmount
    ) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      currentBalance -
      requiredAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
          userId
        )}&balance=eq.${q(
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
                new Date()
                  .toISOString()
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
    "Wallet is being updated by another transaction. Please try again."
  );
}


/* =========================================================
   REFUND WALLET
   ========================================================= */

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
    const rows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
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
      Number(
        wallet.balance || 0
      );

    const newBalance =
      currentBalance +
      refundAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
          userId
        )}&balance=eq.${q(
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
                new Date()
                  .toISOString()
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


/* =========================================================
   WALLET TRANSACTION
   ========================================================= */

async function createWalletTransaction({
  userId,
  amount,
  balanceAfter,
  description
}) {
  try {
    await supabaseRequest(
      "wallet_transactions",
      {
        method:
          "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            amount:
              amount,

            balance_after:
              balanceAfter,

            type:
              "order",

            description:
              description
          })
      }
    );
  } catch (error) {
    /*
     * Do not undo a successful provider purchase
     * because transaction-history insertion failed.
     */
    console.error(
      "Wallet transaction history error:",
      error
    );
  }
}


/* =========================================================
   CREATE ORDER
   ========================================================= */

async function createOrder(
  userId,
  order
) {
  const providerCost =
    Number(
      order.providerPrice
    );

  const safeProviderCost =
    Number.isFinite(
      providerCost
    ) &&
    providerCost >= 0
      ? providerCost
      : 0;

  const customerPrice =
    Number(
      order.sellingPrice
    );

  const safeCustomerPrice =
    Number.isFinite(
      customerPrice
    )
      ? customerPrice
      : 0;

  const profit =
    safeCustomerPrice -
    safeProviderCost;

  return await supabaseRequest(
    "orders",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          user_id:
            userId,

          provider_order_id:
            order.providerOrderId ||
            order.providerVerificationId,

          service_country_price_id:
            order.serviceCountryPriceId,

          service_name:
            order.serviceName,

          country_name:
            order.countryName,

          provider_cost:
            safeProviderCost,

          customer_price:
            safeCustomerPrice,

          profit:
            profit,

          status:
            order.status ||
            "active",

          phone

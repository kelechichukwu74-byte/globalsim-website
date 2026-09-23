const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_API_KEY =
  process.env.SUREVERIFICATION_API_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";


/* =========================================================
   AUTHENTICATION
========================================================= */

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
    throw new Error("Unauthorized.");
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
    throw new Error("Unauthorized.");
  }

  const user =
    await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}


/* =========================================================
   SUPABASE REST HELPER
========================================================= */

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
      message:
        text
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


/* =========================================================
   SUREVERIFICATION RESPONSE PARSER
========================================================= */

async function parseProviderResponse(
  response
) {
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
      message:
        text
    };
  }

  return {
    data,
    text
  };
}


/* =========================================================
   CANCEL THROUGH SUREVERIFICATION
========================================================= */

/*
 * The important point here is:
 *
 * provider_order_id is the primary provider identifier.
 *
 * For your current order:
 *
 * provider_order_id = 163804
 * provider_verification_id = null
 *
 * Therefore 163804 is tried first.
 *
 * If a verification ID exists, it is also retained
 * as a fallback.
 */

async function cancelWithSureVerification(
  providerOrderId,
  providerVerificationId
) {
  if (!SURE_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const candidates = [];

  function addCandidate(
    value,
    type
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return;
    }

    const cleaned =
      String(value).trim();

    if (!cleaned) {
      return;
    }

    const exists =
      candidates.some(
        item =>
          item.id === cleaned
      );

    if (!exists) {
      candidates.push({
        id:
          cleaned,

        type
      });
    }
  }


  /*
   * PRIMARY:
   * provider_order_id
   */
  addCandidate(
    providerOrderId,
    "provider_order_id"
  );


  /*
   * FALLBACK:
   * provider_verification_id
   */
  addCandidate(
    providerVerificationId,
    "provider_verification_id"
  );


  if (!candidates.length) {
    throw new Error(
      "SureVerification provider order ID is missing."
    );
  }


  let lastError =
    "Verification number cannot be cancelled.";

  const attempted =
    [];


  for (
    const candidate of candidates
  ) {
    const id =
      candidate.id;

    attempted.push(
      id
    );


    /*
     * This is the cancellation endpoint
     * currently used by the application.
     */
    const url =
      `${SURE_BASE_URL}/verifications/cancel/${encodeURIComponent(
        id
      )}`;


    try {
      console.log(
        "Trying SureVerification cancellation:",
        {
          id,
          type:
            candidate.type
        }
      );


      const response =
        await fetch(
          url,
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


      const {
        data,
        text
      } =
        await parseProviderResponse(
          response
        );


      console.log(
        "SureVerification cancellation response:",
        {
          id,
          status:
            response.status,
          ok:
            response.ok,
          response:
            data
        }
      );


      if (response.ok) {
        return {
          success:
            true,

          provider_response:
            data,

          cancelled_id:
            id,

          cancelled_id_type:
            candidate.type,

          attempted_ids:
            attempted
        };
      }


      lastError =
        data?.message ||
        data?.error ||
        data?.details ||
        data?.hint ||
        text ||
        `Provider cancellation failed (${response.status})`;

    } catch (error) {
      console.error(
        "SureVerification cancellation request error:",
        error
      );

      lastError =
        error?.message ||
        lastError;
    }
  }


  throw new Error(
    `${lastError}`
  );
}


/* =========================================================
   GET CUSTOMER WALLET
========================================================= */

async function getWallet(
  userId
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

  return wallet;
}


/* =========================================================
   REFUND CUSTOMER WALLET
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


  /*
   * Retry a few times to reduce the
   * possibility of a balance race.
   */
  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const wallet =
      await getWallet(
        userId
      );

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


    /*
     * Optimistic balance update.
     *
     * Only update if the balance is still
     * the same balance we originally read.
     */
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


/* =========================================================
   RECORD REFUND TRANSACTION
========================================================= */

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

    return true;

  } catch (error) {
    console.error(
      "Refund transaction error:",
      error
    );

    /*
     * Do not make the cancellation fail
     * just because transaction history
     * failed to record.
     */
    return false;
  }
}


/* =========================================================
   GET SUPPLIED CANCELLATION ID
========================================================= */

function getSuppliedId(
  req
) {
  const query =
    req.query || {};

  const body =
    req.body || {};


  /*
   * Support all existing frontend
   * parameter names.
   */
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


/* =========================================================
   FIND ORDER
========================================================= */

async function findOrder(
  userId,
  suppliedId
) {
  const cleanId =
    String(
      suppliedId
    ).trim();


  /*
   * 1. Provider order ID
   *
   * This is the most important lookup
   * for your current order.
   */
  let orders =
    await db(
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


  /*
   * 2. Provider verification ID
   */
  orders =
    await db(
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
   * 3. Supabase order UUID
   */
  orders =
    await db(
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


  return null;
}


/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  /*
   * Allow both DELETE and POST because
   * different frontend implementations
   * may use either one.
   */
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
    /* -----------------------------------------------------
       Authenticate customer
    ----------------------------------------------------- */

    const user =
      await authenticate(
        req
      );


    /* -----------------------------------------------------
       Get requested order ID
    ----------------------------------------------------- */

    const suppliedId =
      getSuppliedId(
        req
      );

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


    /* -----------------------------------------------------
       Find customer's order
    ----------------------------------------------------- */

    const order =
      await findOrder(
        user.id,
        cleanId
      );


    if (!order) {
      return res.status(404).json({
        success:
          false,

        error:
          "Order not found for this account."
      });
    }


    console.log(
      "Cancellation order:",
      {
        id:
          order.id,

        provider_order_id:
          order.provider_order_id,

        provider_verification_id:
          order.provider_verification_id,

        status:
          order.status
      }
    );


    /* -----------------------------------------------------
       Check current status
    ----------------------------------------------------- */

    const status =
      String(
        order.status || ""
      )
      .trim()
      .toLowerCase();


    if (
      status === "cancelled" ||
      status === "canceled"
    ) {
      return res.status(200).json({
        success:
          true,

        already_cancelled:
          true,

        message:
          "Number is already cancelled.",

        refunded:
          false
      });
    }


    /* -----------------------------------------------------
       Get provider identifiers
    ----------------------------------------------------- */

    const providerOrderId =
      order.provider_order_id ||
      order.providerOrderId ||
      order.request_id ||
      order.requestId ||
      null;


    const providerVerificationId =
      order.provider_verification_id ||
      order.providerVerificationId ||
      order.verification?.id ||
      order.verification?.verification_id ||
      order.verification?.verificationId ||
      null;


    if (
      !providerOrderId &&
      !providerVerificationId
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "SureVerification provider order ID is missing for this order."
      });
    }


    /* -----------------------------------------------------
       Cancel at provider
    ----------------------------------------------------- */

    const providerResult =
      await cancelWithSureVerification(
        providerOrderId,
        providerVerificationId
      );


    if (
      !providerResult?.success
    ) {
      throw new Error(
        "Unable to cancel number with SureVerification."
      );
    }


    /* -----------------------------------------------------
       Determine refund amount
    ----------------------------------------------------- */

    const refundAmount =
      Number(
        order.customer_price ??
        order.selling_price ??
        order.amount ??
        0
      );


    let balanceAfter =
      null;

    let refunded =
      false;


    /* -----------------------------------------------------
       Refund customer
    ----------------------------------------------------- */

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

      refunded =
        true;


      /*
       * Record transaction.
       */
      await recordRefund(
        user.id,
        refundAmount,
        balanceAfter,
        order.id
      );
    }


    /* -----------------------------------------------------
       Mark order cancelled
    ----------------------------------------------------- */

    const updatedOrders =
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


    if (
      !Array.isArray(
        updatedOrders
      ) ||
      updatedOrders.length === 0
    ) {
      /*
       * Provider cancellation already succeeded.
       *
       * We don't report the operation as
       * completely failed because that could
       * cause the frontend to retry and
       * potentially create a duplicate refund.
       */
      console.error(
        "Provider cancelled but database order update returned no rows.",
        {
          orderId:
            order.id,

          providerOrderId:
            providerOrderId
        }
      );
    }


    /* -----------------------------------------------------
       Success response
    ----------------------------------------------------- */

    return res.status(200).json({
      success:
        true,

      message:
        refunded
          ? `Number cancelled successfully. ₦${refundAmount.toLocaleString()} has been refunded to your wallet.`
          : "Number cancelled successfully.",

      order_id:
        order.id,

      provider_order_id:
        providerOrderId,

      provider_verification_id:
        providerVerificationId,

      provider_cancelled_id:
        providerResult?.cancelled_id ||
        null,

      provider_cancelled_id_type:
        providerResult?.cancelled_id_type ||
        null,

      refunded:
        refunded,

      refund_amount:
        refunded
          ? refundAmount
          : 0,

      balance_after:
        balanceAfter,

      status:
        "cancelled"
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

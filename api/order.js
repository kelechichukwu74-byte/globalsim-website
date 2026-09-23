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
   SUPABASE AUTHENTICATION
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
   READ PROVIDER RESPONSE
========================================================= */

async function readResponse(
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
   NORMALIZE SERVER NAME
========================================================= */

function normalizeServer(
  value
) {
  if (!value) {
    return null;
  }

  const server =
    String(value)
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")
      .replace(/\s+/g, "-");

  const aliases = {
    "usa1":
      "usa-server-1",

    "usa-1":
      "usa-server-1",

    "us1":
      "usa-server-1",

    "server-1":
      "usa-server-1",

    "usa-server-1":
      "usa-server-1",

    "usa2":
      "usa-server-2",

    "usa-2":
      "usa-server-2",

    "us2":
      "usa-server-2",

    "server-2":
      "usa-server-2",

    "usa-server-2":
      "usa-server-2",

    "global1":
      "global-server-1",

    "global-1":
      "global-server-1",

    "global-server-1":
      "global-server-1",

    "global2":
      "global-server-2",

    "global-2":
      "global-server-2",

    "global-server-2":
      "global-server-2"
  };

  return (
    aliases[server] ||
    server
  );
}

/* =========================================================
   SELECT PROVIDER SERVER
========================================================= */

function selectServer(
  requestedServer,
  countryId,
  countryName
) {
  const explicit =
    normalizeServer(
      requestedServer
    );

  const validServers = [
    "usa-server-1",
    "usa-server-2",
    "global-server-1",
    "global-server-2"
  ];

  if (
    explicit &&
    validServers.includes(
      explicit
    )
  ) {
    return explicit;
  }

  const country =
    String(
      countryName || ""
    )
      .trim()
      .toLowerCase();

  const isUSA =
    String(
      countryId || ""
    ) === "236" ||
    country === "united states" ||
    country === "usa" ||
    country === "us" ||
    country ===
      "united states of america";

  if (isUSA) {
    return "usa-server-2";
  }

  return "global-server-2";
}

/* =========================================================
   PROVIDER PURCHASE
========================================================= */

async function purchaseFromSureVerification({
  server,
  countryId,
  service
}) {
  if (!SURE_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  if (!countryId) {
    throw new Error(
      "Country ID is required."
    );
  }

  if (!service) {
    throw new Error(
      "Service is required."
    );
  }

  const params =
    new URLSearchParams();

  params.set(
    "country_id",
    String(countryId)
  );

  params.set(
    "service",
    String(service)
  );

  const url =
    `${SURE_BASE_URL}/${server}/purchase?${params.toString()}`;

  console.log(
    "SureVerification purchase:",
    {
      server,
      countryId,
      service
    }
  );

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

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
    await readResponse(
      response
    );

  console.log(
    "SureVerification purchase response:",
    {
      status:
        response.status,

      response:
        data
    }
  );

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.details ||
      data?.hint ||
      text ||
      `Provider purchase failed (${response.status})`
    );
  }

  const verification =
    data?.verification;

  if (!verification) {
    throw new Error(
      "Provider returned no verification data."
    );
  }

  if (
    verification.id ===
      undefined ||
    verification.id ===
      null ||
    String(
      verification.id
    ).trim() === ""
  ) {
    throw new Error(
      "Provider returned no verification ID. The number was not saved."
    );
  }

  if (
    verification.request_id ===
      undefined ||
    verification.request_id ===
      null ||
    String(
      verification.request_id
    ).trim() === ""
  ) {
    throw new Error(
      "Provider returned no request ID. The number was not saved."
    );
  }

  if (
    !verification.number
  ) {
    throw new Error(
      "Provider returned no phone number."
    );
  }

  return {
    raw:
      data,

    verification
  };
}

/* =========================================================
   GET WALLET
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
   DEDUCT WALLET
========================================================= */

async function deductWallet(
  userId,
  amount
) {
  const purchaseAmount =
    Number(amount);

  if (
    !Number.isFinite(
      purchaseAmount
    ) ||
    purchaseAmount <= 0
  ) {
    throw new Error(
      "Invalid purchase price."
    );
  }

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

    if (
      currentBalance <
      purchaseAmount
    ) {
      const error =
        new Error(
          "Insufficient wallet balance."
        );

      error.code =
        "INSUFFICIENT_FUNDS";

      throw error;
    }

    const newBalance =
      currentBalance -
      purchaseAmount;

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
      return {
        balanceBefore:
          currentBalance,

        balanceAfter:
          newBalance
      };
    }
  }

  throw new Error(
    "Unable to update wallet balance. Please try again."
  );
}

/* =========================================================
   RECORD PURCHASE TRANSACTION
========================================================= */

async function recordPurchaseTransaction({
  userId,
  amount,
  balanceBefore,
  balanceAfter,
  orderId
}) {
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

            type:
              "purchase",

            amount:
              -Math.abs(
                Number(amount)
              ),

            balance_before:
              Number(
                balanceBefore
              ),

            balance_after:
              Number(
                balanceAfter
              ),

            reference_id:
              orderId,

            description:
              `Virtual number purchase (${orderId})`,

            created_at:
              new Date().toISOString()
          })
      }
    );
  } catch (error) {
    console.error(
      "Purchase transaction history error:",
      error
    );

    /*
     * Do not undo the successful purchase
     * if transaction history fails.
     */
  }
}

/* =========================================================
   RECORD REFUND TRANSACTION
========================================================= */

async function recordRefundTransaction({
  userId,
  amount,
  balanceBefore,
  balanceAfter,
  referenceId
}) {
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

            type:
              "refund",

            amount:
              Math.abs(
                Number(amount)
              ),

            balance_before:
              Number(
                balanceBefore
              ),

            balance_after:
              Number(
                balanceAfter
              ),

            reference_id:
              referenceId,

            description:
              "Refund for failed virtual number order",

            created_at:
              new Date().toISOString()
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

/* =========================================================
   REFUND AFTER DATABASE FAILURE
========================================================= */

async function refundWalletAfterFailure(
  userId,
  amount,
  referenceId
) {
  try {
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
      const wallet =
        await getWallet(
          userId
        );

      const currentBalance =
        Number(
          wallet.balance || 0
        );

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
        await recordRefundTransaction({
          userId,

          amount:
            refundAmount,

          balanceBefore:
            currentBalance,

          balanceAfter:
            newBalance,

          referenceId
        });

        return newBalance;
      }
    }
  } catch (error) {
    console.error(
      "Automatic refund failed:",
      error
    );
  }

  return null;
}

/* =========================================================
   CANCEL PROVIDER NUMBER AFTER DATABASE FAILURE
========================================================= */

async function cancelProviderVerification(
  verificationId
) {
  if (!verificationId) {
    return false;
  }

  if (!SURE_API_KEY) {
    return false;
  }

  try {
    const response =
      await fetch(
        `${SURE_BASE_URL}/verifications/cancel/${encodeURIComponent(
          verificationId
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

    const {
      data
    } =
      await readResponse(
        response
      );

    console.log(
      "Provider rollback cancellation:",
      {
        verificationId,

        status:
          response.status,

        response:
          data
      }
    );

    return response.ok;
  } catch (error) {
    console.error(
      "Provider rollback cancellation error:",
      error
    );

    return false;
  }
}

/* =========================================================
   GET REQUEST DATA
========================================================= */

function getRequestData(
  req
) {
  const query =
    req.query || {};

  const body =
    req.body || {};

  const countryId =
    query.country_id ||
    query.countryId ||
    body.country_id ||
    body.countryId ||
    body.country ||
    "";

  /*
   * IMPORTANT:
   *
   * serviceCountryPriceId is now accepted.
   *
   * Example:
   *
   * WhatsApp = wa
   * Telegram = tg
   *
   * The provider needs the actual service ID.
   */

  const service =
    query.service ||
    query.service_id ||
    query.serviceId ||
    query.serviceCountryPriceId ||
    body.service ||
    body.service_id ||
    body.serviceId ||
    body.serviceCountryPriceId ||
    "";

  const serviceName =
    query.service_name ||
    query.serviceName ||
    body.service_name ||
    body.serviceName ||
    "";

  const server =
    query.server ||
    query.provider ||
    query.portal ||
    body.server ||
    body.provider ||
    body.portal ||
    "";

  const countryName =
    query.country_name ||
    query.countryName ||
    body.country_name ||
    body.countryName ||
    "";

  const customerPrice =
    query.customer_price ||
    query.customerPrice ||
    query.selling_price ||
    query.sellingPrice ||
    query.price ||
    body.customer_price ||
    body.customerPrice ||
    body.selling_price ||
    body.sellingPrice ||
    body.price ||
    "";

  return {
    countryId:
      String(
        countryId
      ).trim(),

    service:
      String(
        service
      ).trim(),

    serviceName:
      String(
        serviceName
      ).trim(),

    server:
      String(
        server
      ).trim(),

    countryName:
      String(
        countryName
      ).trim(),

    customerPrice:
      customerPrice === ""
        ? ""
        : Number(
            customerPrice
          )
  };
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed."
    });
  }

  let user = null;

  let providerVerificationId =
    null;

  let walletDeducted =
    false;

  let walletAmount =
    0;

  let purchaseBalanceBefore =
    null;

  let purchaseBalanceAfter =
    null;

  try {
    /* -----------------------------------------------------
       AUTHENTICATE
    ----------------------------------------------------- */

    user =
      await authenticate(
        req
      );

    /* -----------------------------------------------------
       REQUEST DATA
    ----------------------------------------------------- */

    const {
      countryId,
      service,
      serviceName,
      server:
        requestedServer,
      countryName,
      customerPrice
    } =
      getRequestData(
        req
      );

    if (!countryId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Country ID is required."
      });
    }

    if (!service) {
      return res.status(400).json({
        success:
          false,

        error:
          "Service is required."
      });
    }

    /*
     * Selling price comes from the existing
     * frontend/admin pricing system.
     *
     * Example:
     * 3000
     */

    if (
      !Number.isFinite(
        customerPrice
      ) ||
      customerPrice <= 0
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "A valid selling price is required."
      });
    }

    walletAmount =
      Number(
        customerPrice
      );

    /* -----------------------------------------------------
       SELECT PROVIDER SERVER
    ----------------------------------------------------- */

    const server =
      selectServer(
        requestedServer,
        countryId,
        countryName
      );

    console.log(
      "Selected SureVerification server:",
      {
        server,
        countryId,
        countryName,
        service,
        serviceName
      }
    );

    /* -----------------------------------------------------
       CHECK WALLET BEFORE BUYING
    ----------------------------------------------------- */

    const wallet =
      await getWallet(
        user.id
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
      return res.status(400).json({
        success:
          false,

        error:
          "Unable to read wallet balance."
      });
    }

    if (
      currentBalance <
      walletAmount
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Insufficient wallet balance."
      });
    }

    /* -----------------------------------------------------
       PURCHASE FROM SUREVERIFICATION
    ----------------------------------------------------- */

    const provider =
      await purchaseFromSureVerification({
        server,

        countryId,

        service
      });

    const verification =
      provider.verification;

    /* -----------------------------------------------------
       PROVIDER IDs
    ----------------------------------------------------- */

    /*
     * request_id:
     * Provider purchase/request reference.
     */

    const providerOrderId =
      String(
        verification.request_id
      ).trim();

    /*
     * verification.id:
     *
     * CRITICAL.
     *
     * SMS and CANCEL use this ID.
     */

    providerVerificationId =
      String(
        verification.id
      ).trim();

    const phoneNumber =
      String(
        verification.number
      ).trim();

    const providerStatus =
      verification.status ||
      "active";

    const providerExpiredAt =
      verification.expired_at ||
      null;

    if (
      !providerVerificationId
    ) {
      throw new Error(
        "Provider verification ID is missing. Purchase was not saved."
      );
    }

    if (
      !providerOrderId
    ) {
      throw new Error(
        "Provider request ID is missing. Purchase was not saved."
      );
    }

    if (!phoneNumber) {
      throw new Error(
        "Provider returned no phone number."
      );
    }

    /* -----------------------------------------------------
       DEDUCT CUSTOMER WALLET
    ----------------------------------------------------- */

    const walletResult =
      await deductWallet(
        user.id,
        walletAmount
      );

    purchaseBalanceBefore =
      walletResult.balanceBefore;

    purchaseBalanceAfter =
      walletResult.balanceAfter;

    walletDeducted =
      true;

    /* -----------------------------------------------------
       SAVE ORDER
    ----------------------------------------------------- */

    let insertedOrders;

    try {
      insertedOrders =
        await db(
          "orders",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                user_id:
                  user.id,

                provider_order_id:
                  providerOrderId,

                /*
                 * verification.id
                 *
                 * Used by SMS and Cancel.
                 */
                provider_verification_id:
                  providerVerificationId,

                /*
                 * Keep the country/service reference
                 * used by your pricing system.
                 */
                service_country_price_id:
                  `${countryId}:${service}`,

                phone_number:
                  phoneNumber,

                /*
                 * Save the readable service name.
                 *
                 * If frontend does not send it,
                 * provider service name is used.
                 */
                service_name:
                  serviceName ||
                  verification.service ||
                  service,

                country_name:
                  countryName ||
                  null,

                status:
                  providerStatus,

                customer_price:
                  walletAmount,

                provider_expired_at:
                  providerExpiredAt,

                created_at:
                  new Date().toISOString(),

                updated_at:
                  new Date().toISOString()
              })
          }
        );
    } catch (databaseError) {
      console.error(
        "Order insert failed:",
        databaseError
      );

      /*
       * Provider already supplied the number.
       * Cancel it so it is not left active.
       */
      await cancelProviderVerification(
        providerVerificationId
      );

      /*
       * Refund the customer's wallet.
       */
      if (
        walletDeducted
      ) {
        const refundedBalance =
          await refundWalletAfterFailure(
            user.id,

            walletAmount,

            providerOrderId
          );

        walletDeducted =
          false;

        console.error(
          "Purchase automatically refunded after order insert failure.",
          {
            refundedBalance
          }
        );
      }

      throw new Error(
        "The number was purchased but could not be saved. Your wallet has been refunded."
      );
    }

    /* -----------------------------------------------------
       SAVED ORDER
    ----------------------------------------------------- */

    const savedOrder =
      insertedOrders?.[0];

    /* -----------------------------------------------------
       RECORD PURCHASE TRANSACTION
    ----------------------------------------------------- */

    await recordPurchaseTransaction({
      userId:
        user.id,

      amount:
        walletAmount,

      balanceBefore:
        purchaseBalanceBefore,

      balanceAfter:
        purchaseBalanceAfter,

      orderId:
        savedOrder?.id ||
        providerOrderId
    });

    /* -----------------------------------------------------
       SUCCESS
    ----------------------------------------------------- */

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order:
        savedOrder ||
        null,

      provider_order_id:
        providerOrderId,

      provider_verification_id:
        providerVerificationId,

      phone_number:
        phoneNumber,

      service:
        verification.service ||
        serviceName ||
        service,

      service_id:
        service,

      status:
        providerStatus,

      expired_at:
        providerExpiredAt,

      server:
        server,

      customer_price:
        walletAmount,

      balance_before:
        purchaseBalanceBefore,

      balance_after:
        purchaseBalanceAfter
    });

  } catch (error) {
    console.error(
      "Purchase number error:",
      error
    );

    const message =
      error?.message ||
      "Unable to purchase number.";

    if (
      error?.code ===
      "INSUFFICIENT_FUNDS"
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Insufficient wallet balance."
      });
    }

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

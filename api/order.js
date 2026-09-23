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
    !header.toLowerCase().startsWith("bearer ")
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
   SUPABASE REST
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
    const error =
      new Error(
        data?.message ||
        data?.error ||
        data?.details ||
        data?.hint ||
        `Supabase request failed (${response.status})`
      );

    error.status =
      response.status;

    error.details =
      data;

    throw error;
  }

  return data;
}

/* =========================================================
   PROVIDER RESPONSE
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
   NORMALIZE SERVER
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
    usa1:
      "usa-server-1",

    "usa-1":
      "usa-server-1",

    us1:
      "usa-server-1",

    "server-1":
      "usa-server-1",

    "usa-server-1":
      "usa-server-1",

    usa2:
      "usa-server-2",

    "usa-2":
      "usa-server-2",

    us2:
      "usa-server-2",

    "server-2":
      "usa-server-2",

    "usa-server-2":
      "usa-server-2",

    global1:
      "global-server-1",

    "global-1":
      "global-server-1",

    "global-server-1":
      "global-server-1",

    global2:
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
   SELECT SERVER
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
    "SURE PURCHASE REQUEST:",
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
    "SURE PURCHASE RESPONSE:",
    {
      status:
        response.status,

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
      "Provider returned no verification ID."
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
      "Provider returned no request ID."
    );
  }

  if (!verification.number) {
    throw new Error(
      "Provider returned no phone number."
    );
  }

  return verification;
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

  if (!wallets?.[0]) {
    throw new Error(
      "Wallet not found."
    );
  }

  return wallets[0];
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
        before:
          currentBalance,

        after:
          newBalance
      };
    }
  }

  throw new Error(
    "Unable to update wallet balance. Please try again."
  );
}

/* =========================================================
   PURCHASE TRANSACTION
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
      "Transaction history error:",
      error
    );
  }
}

/* =========================================================
   REFUND WALLET
========================================================= */

async function refundWallet(
  userId,
  amount,
  referenceId
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
                  refundAmount,

                balance_before:
                  currentBalance,

                balance_after:
                  newBalance,

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

      return newBalance;
    }
  }

  return null;
}

/* =========================================================
   CANCEL PROVIDER NUMBER
========================================================= */

async function cancelProviderVerification(
  verificationId
) {
  if (
    !verificationId ||
    !SURE_API_KEY
  ) {
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

    const result =
      await readResponse(
        response
      );

    console.log(
      "Provider rollback:",
      {
        verificationId,

        status:
          response.status,

        response:
          result.data
      }
    );

    return response.ok;
  } catch (error) {
    console.error(
      "Provider rollback error:",
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
   * Accept all known frontend names.
   *
   * WhatsApp provider ID = wa
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

  const countryName =
    query.country_name ||
    query.countryName ||
    body.country_name ||
    body.countryName ||
    "";

  const requestedServer =
    query.server ||
    query.provider ||
    query.portal ||
    body.server ||
    body.provider ||
    body.portal ||
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

    countryName:
      String(
        countryName
      ).trim(),

    requestedServer:
      String(
        requestedServer
      ).trim(),

    customerPrice:
      customerPrice === ""
        ? null
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

  let balanceBefore =
    0;

  let balanceAfter =
    0;

  try {
    /* =====================================================
       AUTH
    ===================================================== */

    user =
      await authenticate(
        req
      );

    /* =====================================================
       REQUEST
    ===================================================== */

    const {
      countryId,
      service,
      serviceName,
      countryName,
      requestedServer,
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

    /* =====================================================
       SELLING PRICE
    ===================================================== */

    let finalPrice =
      Number(
        customerPrice
      );

    /*
     * If frontend didn't send price,
     * read the existing admin price.
     */

    if (
      !Number.isFinite(
        finalPrice
      ) ||
      finalPrice <= 0
    ) {
      const pricingRows =
        await db(
          `product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&service_id=eq.${encodeURIComponent(
            service
          )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
        );

      finalPrice =
        Number(
          pricingRows?.[0]
            ?.selling_price
        );
    }

    if (
      !Number.isFinite(
        finalPrice
      ) ||
      finalPrice <= 0
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Selling price is not configured for this country and service."
      });
    }

    walletAmount =
      finalPrice;

    /* =====================================================
       SERVER
    ===================================================== */

    const server =
      selectServer(
        requestedServer,
        countryId,
        countryName
      );

    console.log(
      "ORDER REQUEST:",
      {
        userId:
          user.id,

        countryId,

        countryName,

        service,

        serviceName,

        price:
          walletAmount,

        server
      }
    );

    /* =====================================================
       WALLET CHECK
    ===================================================== */

    const wallet =
      await getWallet(
        user.id
      );

    const currentBalance =
      Number(
        wallet.balance || 0
      );

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

    /* =====================================================
       PROVIDER PURCHASE
    ===================================================== */

    const verification =
      await purchaseFromSureVerification({
        server,

        countryId,

        service
      });

    providerVerificationId =
      String(
        verification.id
      ).trim();

    const providerOrderId =
      String(
        verification.request_id
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

    /*
     * Provider cost is not returned in the
     * purchase response, so keep it at zero
     * unless your existing pricing system supplies it.
     */

    const providerCost =
      0;

    const profit =
      walletAmount -
      providerCost;

    /* =====================================================
       WALLET DEDUCTION
    ===================================================== */

    const walletResult =
      await deductWallet(
        user.id,
        walletAmount
      );

    balanceBefore =
      walletResult.before;

    balanceAfter =
      walletResult.after;

    walletDeducted =
      true;

    /* =====================================================
       SAVE ORDER
    ===================================================== */

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

                provider_verification_id:
                  providerVerificationId,

                /*
                 * Keep the provider service ID.
                 */
                service_country_price_id:
                  service,

                phone_number:
                  phoneNumber,

                service_name:
                  serviceName ||
                  verification.service ||
                  service,

                country_name:
                  countryName ||
                  null,

                provider_cost:
                  providerCost,

                customer_price:
                  walletAmount,

                profit:
                  profit,

                status:
                  providerStatus,

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
        "ORDER DATABASE INSERT FAILED:",
        databaseError
      );

      /*
       * Cancel provider number.
       */

      await cancelProviderVerification(
        providerVerificationId
      );

      /*
       * Refund customer.
       */

      if (
        walletDeducted
      ) {
        await refundWallet(
          user.id,

          walletAmount,

          providerOrderId
        );

        walletDeducted =
          false;
      }

      /*
       * IMPORTANT:
       * Return the actual DB error so we can
       * see exactly what Supabase rejected.
       */

      const dbMessage =
        databaseError?.message ||
        "Database order insert failed.";

      const error =
        new Error(
          `Order could not be saved: ${dbMessage}`
        );

      error.status =
        databaseError?.status ||
        500;

      throw error;
    }

    const savedOrder =
      insertedOrders?.[0] ||
      null;

    /* =====================================================
       TRANSACTION
    ===================================================== */

    await recordPurchaseTransaction({
      userId:
        user.id,

      amount:
        walletAmount,

      balanceBefore:
        balanceBefore,

      balanceAfter:
        balanceAfter,

      orderId:
        savedOrder?.id ||
        providerOrderId
    });

    /* =====================================================
       SUCCESS
    ===================================================== */

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order:
        savedOrder,

      provider_order_id:
        providerOrderId,

      provider_verification_id:
        providerVerificationId,

      phone_number:
        phoneNumber,

      service_id:
        service,

      service:
        verification.service ||
        serviceName ||
        service,

      country_id:
        countryId,

      country_name:
        countryName,

      status:
        providerStatus,

      expired_at:
        providerExpiredAt,

      server:
        server,

      customer_price:
        walletAmount,

      balance_before:
        balanceBefore,

      balance_after:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "FINAL PURCHASE ERROR:",
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

    /*
     * Return the actual error.
     * This prevents the real problem from
     * being hidden as "Unable to purchase number."
     */

    return res.status(
      error?.status >= 400 &&
      error?.status < 600
        ? error.status
        : 500
    ).json({
      success:
        false,

      error:
        message
    });
  }
}

import {
  sureVerificationRequest,
  getServersForCountry,
  quote
} from "./_lib.js";

/* =========================================================
   CONFIG
========================================================= */

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_API_KEY =
  process.env.SUREVERIFICATION_API_KEY;

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getVerification(data) {
  if (!data) return null;

  if (
    data.verification &&
    typeof data.verification === "object"
  ) {
    return data.verification;
  }

  if (
    data.data?.verification &&
    typeof data.data.verification === "object"
  ) {
    return data.data.verification;
  }

  if (
    data.data &&
    typeof data.data === "object" &&
    (
      data.data.id ||
      data.data.request_id ||
      data.data.number
    )
  ) {
    return data.data;
  }

  return null;
}

function getErrorMessage(data) {
  if (!data) return "";

  return (
    data.error ||
    data.message ||
    data.msg ||
    data.detail ||
    data.data?.error ||
    data.data?.message ||
    ""
  );
}

/* =========================================================
   SUPABASE REST
========================================================= */

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
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body:
        options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined
    }
  );

  const text = await response.text();

  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text
      };
    }
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.hint ||
      data?.details ||
      data?.error ||
      `Supabase request failed (HTTP ${response.status})`;

    throw new Error(message);
  }

  return data;
}

/* =========================================================
   AUTHENTICATE USER
========================================================= */

async function getAuthenticatedUser(req) {
  const authHeader =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!authHeader) {
    throw new Error("Authorization is required.");
  }

  const token = authHeader.replace(
    /^Bearer\s+/i,
    ""
  ).trim();

  if (!token) {
    throw new Error("Authorization token is missing.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();

  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }

  if (!response.ok || !data?.id) {
    throw new Error(
      "Unable to authenticate user."
    );
  }

  return data;
}

/* =========================================================
   FIND SERVICE ID FROM PROVIDER
========================================================= */

async function resolveServiceId({
  countryId,
  requestedServiceId,
  requestedServiceName,
  servers
}) {
  const directId = clean(requestedServiceId);

  /*
   If frontend already sent the provider ID, use it.
   Example:
   Whatsapp -> wa
   Telegram -> tg
  */
  if (directId) {
    return directId;
  }

  const requestedName =
    normalizeName(requestedServiceName);

  if (!requestedName) {
    throw new Error("Service is required.");
  }

  let lastError = null;

  for (const server of servers) {
    try {
      const servicesResponse =
        await sureVerificationRequest(
          `/${server}/services?country_id=${encodeURIComponent(
            countryId
          )}`
        );

      const services =
        Array.isArray(servicesResponse?.services)
          ? servicesResponse.services
          : Array.isArray(
              servicesResponse?.data?.services
            )
          ? servicesResponse.data.services
          : Array.isArray(servicesResponse?.data)
          ? servicesResponse.data
          : [];

      if (!Array.isArray(services)) {
        continue;
      }

      const match = services.find((item) => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const id = normalizeName(item.id);
        const name = normalizeName(item.name);

        return (
          id === requestedName ||
          name === requestedName
        );
      });

      if (match?.id) {
        return String(match.id);
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(
      `Unable to find service "${requestedServiceName}" for this country.`
    );
  }

  throw new Error(
    `Service "${requestedServiceName}" is not available for this country.`
  );
}

/* =========================================================
   FIND SELLING PRICE
========================================================= */

async function getSellingPrice({
  countryId,
  serviceId,
  body
}) {
  /*
   Accept a valid price from the frontend if supplied.
  */
  const suppliedPrice =
    body.customerPrice ??
    body.customer_price ??
    body.sellingPrice ??
    body.selling_price ??
    body.price;

  const suppliedNumber = money(
    suppliedPrice
  );

  if (
    Number.isFinite(suppliedNumber) &&
    suppliedNumber > 0
  ) {
    return suppliedNumber;
  }

  /*
   Otherwise use the admin-configured price
   from product_prices.
  */
  const rows = await supabaseRequest(
    `product_prices?country_id=eq.${quote(
      countryId
    )}&service_id=eq.${quote(
      serviceId
    )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
  );

  if (
    !Array.isArray(rows) ||
    !rows[0]
  ) {
    throw new Error(
      "Selling price is not configured for this country and service."
    );
  }

  const price = money(
    rows[0].selling_price
  );

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    throw new Error(
      "A valid selling price is required."
    );
  }

  return price;
}

/* =========================================================
   GET WALLET
========================================================= */

async function getWallet(userId) {
  const rows = await supabaseRequest(
    `wallets?user_id=eq.${quote(
      userId
    )}&select=user_id,balance&limit=1`
  );

  if (
    !Array.isArray(rows) ||
    !rows[0]
  ) {
    throw new Error(
      "Wallet not found."
    );
  }

  return {
    user_id: rows[0].user_id,
    balance: Number(rows[0].balance || 0)
  };
}

/* =========================================================
   GET PROVIDER COST
========================================================= */

async function getProviderPrice({
  server,
  countryId,
  serviceId
}) {
  try {
    const data =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          serviceId
        )}`
      );

    const possiblePrices = [
      data?.price,
      data?.amount,
      data?.data?.price,
      data?.data?.amount
    ];

    for (const value of possiblePrices) {
      const n = Number(value);

      if (
        Number.isFinite(n) &&
        n >= 0
      ) {
        return n;
      }
    }
  } catch {
    // Provider price is optional for order storage.
  }

  return 0;
}

/* =========================================================
   REFUND WALLET
========================================================= */

async function refundWallet({
  userId,
  amount,
  orderId,
  reason
}) {
  try {
    const wallet =
      await getWallet(userId);

    const before =
      Number(wallet.balance || 0);

    const after =
      before + Number(amount || 0);

    await supabaseRequest(
      `wallets?user_id=eq.${quote(
        userId
      )}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal"
        },
        body: {
          balance: after,
          updated_at: new Date().toISOString()
        }
      }
    );

    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: {
          user_id: userId,
          type: "refund",
          amount: Number(amount || 0),
          balance_before: before,
          balance_after: after,
          reference_id: orderId || null,
          description:
            reason ||
            "Refund for failed virtual number purchase"
        }
      }
    );

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   CANCEL PROVIDER VERIFICATION
========================================================= */

async function cancelProviderVerification(
  verificationId
) {
  if (!verificationId) {
    return;
  }

  try {
    await sureVerificationRequest(
      `/verifications/cancel/${encodeURIComponent(
        verificationId
      )}`,
      {
        method: "DELETE"
      }
    );
  } catch {
    // Do not hide the original purchase/DB error.
  }
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let userId = null;
  let chargedAmount = 0;
  let providerVerificationId = null;
  let createdOrderId = null;

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not configured."
      });
    }

    if (!SURE_API_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "SUREVERIFICATION_API_KEY is not configured."
      });
    }

    /* -----------------------------------------
       AUTH
    ----------------------------------------- */

    const user =
      await getAuthenticatedUser(req);

    userId = user.id;

    /* -----------------------------------------
       BODY
    ----------------------------------------- */

    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const countryId = clean(
      body.countryId ??
      body.country_id
    );

    const countryName = clean(
      body.countryName ??
      body.country_name
    );

    /*
     * Accept ALL service formats used by
     * the existing frontend.
     */
    const requestedServiceId = clean(
      body.serviceCountryPriceId ??
      body.serviceId ??
      body.service_id ??
      ""
    );

    const requestedServiceName = clean(
      body.serviceName ??
      body.service_name ??
      body.service ??
      ""
    );

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country is required."
      });
    }

    if (
      !requestedServiceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    /* -----------------------------------------
       SERVER SELECTION
    ----------------------------------------- */

    let servers =
      getServersForCountry(
        countryName
      );

    if (
      !Array.isArray(servers) ||
      servers.length === 0
    ) {
      const normalizedCountry =
        normalizeName(countryName);

      if (
        normalizedCountry ===
          "unitedstates" ||
        normalizedCountry ===
          "usa" ||
        normalizedCountry ===
          "us"
      ) {
        servers = [
          "usa-server-2",
          "usa-server-1"
        ];
      } else {
        servers = [
          "global-server-2",
          "global-server-1"
        ];
      }
    }

    /* -----------------------------------------
       RESOLVE SERVICE ID
       Example: Whatsapp -> wa
    ----------------------------------------- */

    const serviceId =
      await resolveServiceId({
        countryId,
        requestedServiceId,
        requestedServiceName,
        servers
      });

    /* -----------------------------------------
       SELLING PRICE
    ----------------------------------------- */

    const customerPrice =
      await getSellingPrice({
        countryId,
        serviceId,
        body
      });

    if (
      !Number.isFinite(customerPrice) ||
      customerPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "A valid selling price is required."
      });
    }

    chargedAmount =
      Number(customerPrice);

    /* -----------------------------------------
       WALLET CHECK
    ----------------------------------------- */

    const wallet =
      await getWallet(userId);

    const balanceBefore =
      Number(wallet.balance || 0);

    if (
      balanceBefore <
      chargedAmount
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance: balanceBefore,
        required: chargedAmount
      });
    }

    /* -----------------------------------------
       PURCHASE FROM PROVIDER
    ----------------------------------------- */

    let providerData = null;
    let selectedServer = null;
    let lastProviderError = null;

    for (const server of servers) {
      try {
        const endpoint =
          `/${server}/purchase?country_id=${encodeURIComponent(
            countryId
          )}&service=${encodeURIComponent(
            serviceId
          )}`;

        const data =
          await sureVerificationRequest(
            endpoint,
            {
              method: "POST"
            }
          );

        const verification =
          getVerification(data);

        /*
         * Never assume verification exists.
         * This prevents:
         * "Trying to access array offset on null"
         */
        if (
          !verification ||
          typeof verification !== "object"
        ) {
          const providerMessage =
            getErrorMessage(data);

          throw new Error(
            providerMessage ||
            "Provider returned an invalid purchase response."
          );
        }

        /*
         * IMPORTANT:
         * verification.id is used by SMS/CANCEL.
         * request_id is stored separately as provider_order_id.
         */
        const verificationId =
          verification.id ??
          verification.verification_id ??
          verification.verificationId ??
          null;

        const requestId =
          verification.request_id ??
          verification.requestId ??
          null;

        const phoneNumber =
          verification.number ??
          verification.phone_number ??
          verification.phone ??
          null;

        if (!verificationId) {
          throw new Error(
            "Provider purchase succeeded but no verification ID was returned."
          );
        }

        if (!phoneNumber) {
          throw new Error(
            "Provider purchase succeeded but no phone number was returned."
          );
        }

        providerData = data;
        selectedServer = server;
        providerVerificationId =
          String(verificationId);

        break;
      } catch (error) {
        lastProviderError =
          error;

        /*
         * Try the next provider/server only if
         * this request clearly failed.
         */
        continue;
      }
    }

    if (
      !providerData ||
      !providerVerificationId
    ) {
      throw new Error(
        lastProviderError?.message ||
        "Unable to purchase number from the provider."
      );
    }

    /* -----------------------------------------
       READ VERIFICATION SAFELY
    ----------------------------------------- */

    const verification =
      getVerification(
        providerData
      );

    if (
      !verification ||
      typeof verification !== "object"
    ) {
      throw new Error(
        "Provider returned an invalid verification."
      );
    }

    const providerOrderId =
      clean(
        verification.request_id ??
        verification.requestId
      );

    const phoneNumber =
      clean(
        verification.number ??
        verification.phone_number ??
        verification.phone
      );

    const providerServiceName =
      clean(
        verification.service
      );

    const providerStatus =
      clean(
        verification.status
      ) || "active";

    const providerExpiredAt =
      verification.expired_at ??
      verification.expiredAt ??
      null;

    /* -----------------------------------------
       PROVIDER COST
    ----------------------------------------- */

    const providerCost =
      await getProviderPrice({
        server: selectedServer,
        countryId,
        serviceId
      });

    const profit =
      Number(
        customerPrice -
        providerCost
      );

    /* -----------------------------------------
       CREATE ORDER
    ----------------------------------------- */

    const orderPayload = {
      user_id: userId,

      provider_order_id:
        providerOrderId || null,

      provider_verification_id:
        providerVerificationId,

      service_country_price_id:
        serviceId,

      service_name:
        providerServiceName ||
        requestedServiceName ||
        serviceId,

      country_name:
        countryName || countryId,

      provider_cost:
        Number.isFinite(providerCost)
          ? providerCost
          : 0,

      customer_price:
        customerPrice,

      profit:
        Number.isFinite(profit)
          ? profit
          : customerPrice,

      status:
        providerStatus,

      phone_number:
        phoneNumber,

      provider_expired_at:
        providerExpiredAt,

      created_at:
        new Date().toISOString(),

      updated_at:
        new Date().toISOString()
    };

    let insertedOrders;

    try {
      insertedOrders =
        await supabaseRequest(
          "orders",
          {
            method: "POST",
            headers: {
              Prefer:
                "return=representation"
            },
            body: orderPayload
          }
        );
    } catch (dbError) {
      /*
       * DB failed after provider purchase.
       * Cancel provider and refund customer.
       */
      await cancelProviderVerification(
        providerVerificationId
      );

      await refundWallet({
        userId,
        amount: chargedAmount,
        orderId: null,
        reason:
          "Refund for failed virtual number order creation"
      });

      throw new Error(
        `Order could not be saved: ${dbError.message}`
      );
    }

    if (
      !Array.isArray(insertedOrders) ||
      !insertedOrders[0]
    ) {
      await cancelProviderVerification(
        providerVerificationId
      );

      await refundWallet({
        userId,
        amount: chargedAmount,
        orderId: null,
        reason:
          "Refund for failed virtual number order creation"
      });

      throw new Error(
        "Order was not created."
      );
    }

    const order =
      insertedOrders[0];

    createdOrderId =
      order.id;

    /* -----------------------------------------
       DEDUCT WALLET
    ----------------------------------------- */

    const balanceAfter =
      balanceBefore -
      chargedAmount;

    try {
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}`,
        {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal"
          },
          body: {
            balance:
              balanceAfter,
            updated_at:
              new Date().toISOString()
          }
        }
      );
    } catch (walletError) {
      /*
       * Wallet deduction failed.
       * Cancel provider and delete the newly
       * created order so the customer is not
       * charged incorrectly.
       */

      await cancelProviderVerification(
        providerVerificationId
      );

      try {
        await supabaseRequest(
          `orders?id=eq.${quote(
            createdOrderId
          )}`,
          {
            method: "DELETE",
            headers: {
              Prefer: "return=minimal"
            }
          }
        );
      } catch {
        // Keep original error.
      }

      throw new Error(
        `Wallet could not be updated: ${walletError.message}`
      );
    }

    /* -----------------------------------------
       TRANSACTION RECORD
    ----------------------------------------- */

    try {
      await supabaseRequest(
        "wallet_transactions",
        {
          method: "POST",
          headers: {
            Prefer: "return=minimal"
          },
          body: {
            user_id: userId,
            type: "purchase",
            amount: chargedAmount,
            balance_before:
              balanceBefore,
            balance_after:
              balanceAfter,
            reference_id:
              createdOrderId,
            description:
              `Purchase of ${providerServiceName || requestedServiceName || serviceId} virtual number`
          }
        }
      );
    } catch {
      /*
       * Do not fail a successful purchase merely
       * because transaction-history logging failed.
       */
    }

    /* -----------------------------------------
       SUCCESS
    ----------------------------------------- */

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order: {
        id: order.id,

        provider_order_id:
          order.provider_order_id,

        provider_verification_id:
          order.provider_verification_id,

        phone_number:
          order.phone_number,

        service_name:
          order.service_name,

        country_name:
          order.country_name,

        status:
          order.status,

        customer_price:
          order.customer_price,

        provider_expired_at:
          order.provider_expired_at
      },

      verification: {
        id:
          providerVerificationId,

        request_id:
          providerOrderId || null,

        number:
          phoneNumber,

        service:
          providerServiceName ||
          requestedServiceName ||
          serviceId,

        status:
          providerStatus,

        expired_at:
          providerExpiredAt
      },

      provider_server:
        selectedServer,

      service_id:
        serviceId,

      balance:
        balanceAfter
    });
  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    return res.status(400).json({
      success: false,
      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}

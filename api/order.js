import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const PROVIDER_BASE_URL =
  "https://sureverifications.com/api/v1";

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

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
      method: "GET",
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
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        ...(options.headers || {})
      },
      ...(options.body !== undefined
        ? { body: options.body }
        : {})
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

/* =========================================================
   VERIFICATION RESPONSE HELPERS
   ========================================================= */

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data ||
    {}
  );
}

/*
 * IMPORTANT:
 * The provider has:
 *
 * request_id = provider request/order reference
 * id         = numeric verification ID
 *
 * SMS and cancel use verification.id.
 */
function getVerificationId(data) {
  const verification = getVerification(data);

  return (
    verification?.id ??
    verification?.verification_id ??
    verification?.verificationId ??
    null
  );
}

function getProviderRequestId(data) {
  const verification = getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    null
  );
}

function getPhoneNumber(data) {
  const verification = getVerification(data);

  return (
    verification?.number ??
    verification?.phone_number ??
    verification?.phoneNumber ??
    verification?.phone ??
    null
  );
}

function getExpiredAt(data) {
  const verification = getVerification(data);

  return (
    verification?.expired_at ??
    verification?.expiredAt ??
    null
  );
}

function getProviderStatus(data) {
  const verification = getVerification(data);

  return (
    verification?.status ||
    "active"
  );
}

function getProviderPrice(data) {
  const verification = getVerification(data);

  const candidates = [
    data?.price,
    data?.amount,
    data?.data?.price,
    data?.data?.amount,
    verification?.price,
    verification?.amount
  ];

  for (const value of candidates) {
    const number = Number(value);

    if (
      Number.isFinite(number) &&
      number > 0
    ) {
      return number;
    }
  }

  return null;
}

/* =========================================================
   COUNTRY HELPERS
   ========================================================= */

function isUnitedStates(countryId, countryName) {
  const value = String(
    countryName || countryId || ""
  ).toLowerCase()
    .trim();

  return (
    value === "us" ||
    value === "usa" ||
    value === "united states" ||
    value === "united states of america" ||
    value === "236"
  );
}

/* =========================================================
   PRODUCT PRICE LOOKUP
   ========================================================= */

async function findPricing({
  countryId,
  serviceCountryPriceId,
  requestedServiceId,
  requestedServiceName,
  requestedServer,
  countryName
}) {
  const select =
    "id,country_id,country_name,service_id,service_name," +
    "provider_server,provider_service_id,provider_cost," +
    "provider_price,provider_base_url,selling_price,is_active";

  /*
   * First try the exact product_prices row ID.
   */
  if (serviceCountryPriceId) {
    try {
      const exactRows =
        await supabaseRequest(
          `product_prices?id=eq.${q(
            serviceCountryPriceId
          )}&is_active=eq.true&select=${select}&limit=1`
        );

      if (exactRows?.[0]) {
        const row = exactRows[0];

        if (
          String(row.country_id) ===
          String(countryId)
        ) {
          if (
            !requestedServer ||
            row.provider_server === requestedServer
          ) {
            return row;
          }
        }
      }
    } catch (error) {
      console.warn(
        "Exact product price lookup failed:",
        error?.message
      );
    }
  }

  /*
   * Get all active prices for this country.
   */
  const rows =
    await supabaseRequest(
      `product_prices?country_id=eq.${q(
        countryId
      )}&is_active=eq.true&select=${select}`
    );

  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }

  const requestedId =
    String(
      requestedServiceId ||
      serviceCountryPriceId ||
      ""
    ).trim()
    .toLowerCase();

  const requestedName =
    String(
      requestedServiceName || ""
    ).trim()
    .toLowerCase();

  let matches = rows.filter(row => {
    const providerServiceId =
      String(
        row.provider_service_id ??
        ""
      ).trim().toLowerCase();

    const serviceId =
      String(
        row.service_id ??
        ""
      ).trim().toLowerCase();

    const serviceName =
      String(
        row.service_name ??
        ""
      ).trim().toLowerCase();

    const id =
      String(
        row.id ??
        ""
      ).trim().toLowerCase();

    const idMatches =
      requestedId &&
      (
        providerServiceId === requestedId ||
        serviceId === requestedId ||
        id === requestedId
      );

    const nameMatches =
      requestedName &&
      serviceName === requestedName;

    return Boolean(
      idMatches ||
      nameMatches
    );
  });

  /*
   * If the frontend's service ID did not match,
   * use the service name.
   */
  if (!matches.length && requestedName) {
    matches = rows.filter(row =>
      String(
        row.service_name || ""
      ).toLowerCase().trim() ===
      requestedName
    );
  }

  if (!matches.length) {
    return null;
  }

  /*
   * If frontend explicitly supplied a server,
   * use it.
   */
  if (requestedServer) {
    const exactServer =
      matches.find(row =>
        row.provider_server ===
        requestedServer
      );

    if (exactServer) {
      return exactServer;
    }
  }

  /*
   * Automatically choose a provider server.
   *
   * USA:
   *   USA Server 2 -> USA Server 1
   *
   * Other countries:
   *   Global Server 2 -> Global Server 1
   */
  const preferredServers =
    isUnitedStates(
      countryId,
      countryName
    )
      ? [
          "usa-server-2",
          "usa-server-1"
        ]
      : [
          "global-server-2",
          "global-server-1"
        ];

  for (const server of preferredServers) {
    const row =
      matches.find(item =>
        item.provider_server ===
        server &&
        Number(item.selling_price) > 0
      );

    if (row) {
      return row;
    }
  }

  /*
   * Final fallback.
   */
  return (
    matches.find(row =>
      Number(row.selling_price) > 0
    ) ||
    matches[0]
  );
}

/* =========================================================
   PROVIDER PURCHASE
   ========================================================= */

async function purchaseFromProvider({
  server,
  countryId,
  providerServiceId
}) {
  if (!ALLOWED_SERVERS.has(server)) {
    throw new Error(
      "Invalid provider server."
    );
  }

  const country =
    q(countryId);

  const service =
    q(providerServiceId);

  /*
   * USA Server 1
   */
  if (server === "usa-server-1") {
    return await sureVerificationRequest(
      `/usa-server-1/purchase?country_id=${country}&service=${service}`,
      {
        method: "POST"
      }
    );
  }

  /*
   * USA Server 2
   */
  if (server === "usa-server-2") {
    return await sureVerificationRequest(
      `/usa-server-2/purchase?country_id=${country}&service=${service}`,
      {
        method: "POST"
      }
    );
  }

  /*
   * Global Server 1
   */
  if (server === "global-server-1") {
    return await sureVerificationRequest(
      `/global-server-1/purchase?country_id=${country}&service=${service}`,
      {
        method: "POST"
      }
    );
  }

  /*
   * Global Server 2
   *
   * Try the country/service form first so the selected
   * service can be respected.
   *
   * If the provider rejects those parameters, retry
   * the documented Global Server 2 purchase endpoint.
   */
  try {
    return await sureVerificationRequest(
      `/global-server-2/purchase?country_id=${country}&service=${service}`,
      {
        method: "POST"
      }
    );
  } catch (firstError) {
    const message =
      String(
        firstError?.message || ""
      ).toLowerCase();

    /*
     * Only attempt the bare Global Server 2
     * endpoint when the first request appears to
     * be a parameter/endpoint compatibility issue.
     */
    if (
      message.includes("country") ||
      message.includes("service") ||
      message.includes("parameter") ||
      message.includes("query") ||
      message.includes("required")
    ) {
      return await sureVerificationRequest(
        "/global-server-2/purchase",
        {
          method: "POST"
        }
      );
    }

    throw firstError;
  }
}

/* =========================================================
   WALLET
   ========================================================= */

async function debitWallet(
  userId,
  amount
) {
  const requiredAmount =
    Number(amount);

  if (
    !Number.isFinite(requiredAmount) ||
    requiredAmount <= 0
  ) {
    throw new Error(
      "Invalid purchase amount."
    );
  }

  /*
   * IMPORTANT:
   * wallets does NOT use wallets.id.
   *
   * The wallet is identified by user_id.
   */
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

    /*
     * Compare-and-set using user_id + current balance.
     *
     * NO wallets.id.
     */
    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance: newBalance
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
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance: newBalance
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
   WALLET TRANSACTION HISTORY
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
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          amount,
          balance_after:
            balanceAfter,
          type: "order",
          description
        })
      }
    );
  } catch (error) {
    /*
     * Do not undo a successful purchase just because
     * transaction-history insertion failed.
     */
    console.error(
      "Wallet transaction history error:",
      error
    );
  }
}

/* =========================================================
   ORDER
   ========================================================= */

async function createOrder(
  userId,
  order
) {
  const customerPrice =
    Number(
      order.customerPrice
    );

  const providerCost =
    Number(
      order.providerCost || 0
    );

  const profit =
    customerPrice -
    providerCost;

  const row = {
    user_id: userId,

    provider_order_id:
      order.providerOrderId,

    service_country_price_id:
      order.serviceCountryPriceId,

    service_name:
      order.serviceName,

    country_name:
      order.countryName,

    provider_cost:
      Number.isFinite(providerCost)
        ? providerCost
        : 0,

    customer_price:
      customerPrice,

    profit:
      Number.isFinite(profit)
        ? profit
        : 0,

    status:
      order.status || "active",

    phone_number:
      order.phoneNumber,

    provider_name:
      "SureVerification",

    provider_server:
      order.providerServer,

    provider_base_url:
      PROVIDER_BASE_URL,

    provider_verification_id:
      String(
        order.providerVerificationId
      ),

    provider_expired_at:
      order.providerExpiredAt || null
  };

  return await supabaseRequest(
    "orders",
    {
      method: "POST",
      body: JSON.stringify(row)
    }
  );
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
      error: "Method not allowed."
    });
  }

  let user = null;
  let debited = false;
  let debitAmount = 0;

  try {
    user =
      await getAuthenticatedUser(req);

    const body =
      req.body || {};

    const countryId =
      body.countryId ??
      body.country_id;

    const countryName =
      body.countryName ??
      body.country_name ??
      "";

    const serviceCountryPriceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      "";

    const requestedServiceId =
      body.serviceId ??
      body.service_id ??
      "";

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    const requestedServer =
      body.server ??
      body.providerServer ??
      body.provider_server ??
      "";

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country is required."
      });
    }

    if (
      !serviceCountryPriceId &&
      !requestedServiceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    /*
     * Find the admin-configured price.
     */
    const pricing =
      await findPricing({
        countryId,
        countryName,
        serviceCountryPriceId,
        requestedServiceId,
        requestedServiceName,
        requestedServer
      });

    if (!pricing) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase."
      });
    }

    const server =
      pricing.provider_server;

    if (
      !ALLOWED_SERVERS.has(server)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "No valid provider server is configured for this service."
      });
    }

    const sellingPrice =
      Number(
        pricing.selling_price
      );

    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase."
      });
    }

    const serviceName =
      pricing.service_name ||
      requestedServiceName ||
      String(
        pricing.provider_service_id ||
        pricing.service_id
      );

    const providerServiceId =
      pricing.provider_service_id ||
      pricing.service_id;

    if (!providerServiceId) {
      return res.status(400).json({
        success: false,
        error:
          "Provider service ID is missing."
      });
    }

    /*
     * Provider cost comes from admin/provider
     * pricing, not from the browser.
     */
    const configuredProviderCost =
      Number(
        pricing.provider_cost
      );

    const configuredProviderPrice =
      Number(
        pricing.provider_price
      );

    const providerCost =
      Number.isFinite(
        configuredProviderCost
      )
        ? configuredProviderCost
        : (
            Number.isFinite(
              configuredProviderPrice
            )
              ? configuredProviderPrice
              : 0
          );

    /*
     * Debit customer's selling price.
     */
    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited = true;
    debitAmount = sellingPrice;

    let providerData;

    try {
      providerData =
        await purchaseFromProvider({
          server,
          countryId,
          providerServiceId
        });
    } catch (providerError) {
      /*
       * Provider purchase failed.
       * Refund customer.
       */
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Automatic purchase refund failed:",
          refundError
        );
      }

      debited = false;

      throw new Error(
        providerError?.message ||
        "Unable to purchase number from the provider."
      );
    }

    const verification =
      getVerification(
        providerData
      );

    /*
     * THIS MUST BE verification.id.
     *
     * Do not use request_id here.
     */
    const verificationId =
      getVerificationId(
        providerData
      );

    const providerRequestId =
      getProviderRequestId(
        providerData
      );

    const phoneNumber =
      getPhoneNumber(
        providerData
      );

    const providerExpiredAt =
      getExpiredAt(
        providerData
      );

    const providerStatus =
      getProviderStatus(
        providerData
      );

    const actualProviderPrice =
      getProviderPrice(
        providerData
      );

    if (
      verificationId === null ||
      verificationId === undefined ||
      verificationId === "" ||
      !phoneNumber
    ) {
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Refund after incomplete provider response failed:",
          refundError
        );
      }

      debited = false;

      throw new Error(
        "The provider did not return a valid verification ID and number. Your wallet was refunded."
      );
    }

    /*
     * Use provider response cost if available.
     * Otherwise use admin-configured provider cost.
     */
    const finalProviderCost =
      Number.isFinite(
        actualProviderPrice
      ) &&
      actualProviderPrice > 0
        ? actualProviderPrice
        : providerCost;

    /*
     * Save the order using the ACTUAL orders schema.
     *
     * provider_order_id      = request_id
     * provider_verification_id = verification.id
     */
    let orderRows;

    try {
      orderRows =
        await createOrder(
          user.id,
          {
            providerOrderId:
              providerRequestId,

            providerVerificationId:
              verificationId,

            serviceCountryPriceId:
              pricing.id ||
              serviceCountryPriceId ||
              providerServiceId,

            serviceName,

            countryName:
              pricing.country_name ||
              countryName ||
              String(countryId),

            providerCost:
              finalProviderCost,

            customerPrice:
              sellingPrice,

            providerServer:
              server,

            providerExpiredAt,

            phoneNumber,

            status:
              providerStatus ||
              "active"
          }
        );
    } catch (orderError) {
      /*
       * If the database order insert fails after
       * provider purchase, refund the customer.
       */
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Refund after order insert failure failed:",
          refundError
        );
      }

      debited = false;

      throw new Error(
        orderError?.message ||
        "The number was purchased but the order could not be saved. Your wallet was refunded."
      );
    }

    /*
     * Read the resulting wallet balance.
     *
     * IMPORTANT:
     * wallets.user_id is used.
     * There is NO wallets.id here.
     */
    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
          user.id
        )}&select=user_id,balance&limit=1`
      );

    const balanceAfter =
      Number(
        walletRows?.[0]?.balance || 0
      );

    /*
     * Record wallet history.
     */
    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });

    debited = false;

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      verification: {
        request_id:
          providerRequestId,

        id:
          verificationId,

        number:
          phoneNumber,

        service:
          verification?.service ||
          serviceName,

        status:
          providerStatus,

        expired_at:
          providerExpiredAt
      },

      provider_server:
        server,

      provider_price:
        Number.isFinite(
          actualProviderPrice
        )
          ? actualProviderPrice
          : null,

      selling_price:
        sellingPrice,

      balance:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "Order purchase error:",
      error
    );

    /*
     * Safety refund if something unexpected
     * happens after the debit.
     */
    if (
      debited &&
      user?.id &&
      debitAmount > 0
    ) {
      try {
        await refundWallet(
          user.id,
          debitAmount
        );
      } catch (refundError) {
        console.error(
          "Safety refund failed:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

    if (
      String(message)
        .toLowerCase()
        .includes("insufficient")
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        message:
          "Insufficient wallet balance."
      });
    }

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success: false,
        error: message
      });
    }

    return res.status(500).json({
      success: false,
      error: message,
      message
    });
  }
}

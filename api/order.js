const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}


function json(res, status, data) {
  return res.status(status).json(data);
}


function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function isUSA(countryId, countryCode, countryName) {
  const id = String(countryId ?? "").trim();
  const code = normalize(countryCode);
  const name = normalize(countryName);

  return (
    id === "236" ||
    code === "us" ||
    code === "usa" ||
    name === "us" ||
    name === "usa" ||
    name === "united states" ||
    name === "united states of america"
  );
}


/* =========================================================
   SUPABASE AUTH
   ========================================================= */

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
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      "SUPABASE_ANON_KEY is not configured."
    );
  }

  const token = getBearerToken(req);

  if (!token) {
    throw new Error(
      "Unauthorized. Please log in again."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok || !data?.id) {
    throw new Error(
      data?.message ||
      data?.error_description ||
      "Unauthorized. Please log in again."
    );
  }

  return data;
}


/* =========================================================
   SUPABASE SERVICE ROLE REQUEST
   ========================================================= */

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
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer:
          options.prefer ||
          "return=representation",
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
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.hint ||
      data?.details ||
      data?.error ||
      data?.raw ||
      `Supabase request failed (${response.status}).`;

    throw new Error(message);
  }

  return data;
}


/* =========================================================
   SUREVERIFICATION REQUEST
   ========================================================= */

async function sureRequest(
  path,
  options = {}
) {
  const apiKey =
    process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SURE_BASE_URL}${path}`,
    {
      method: options.method || "GET",

      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
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
      `SureVerification returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    const providerMessage =
      data?.message ||
      data?.error ||
      data?.details ||
      `SureVerification returned HTTP ${response.status}.`;

    throw new Error(
      `${providerMessage} [HTTP ${response.status}]`
    );
  }

  return data;
}


/* =========================================================
   PROVIDER RESPONSE HELPERS
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


function getVerificationId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    verification?.verification_id ??
    verification?.verificationId ??
    verification?.id ??
    null
  );
}


function getPhoneNumber(data) {
  const verification =
    getVerification(data);

  return (
    verification?.number ??
    verification?.phone_number ??
    verification?.phoneNumber ??
    verification?.phone ??
    null
  );
}


function getExpiredAt(data) {
  const verification =
    getVerification(data);

  return (
    verification?.expired_at ??
    verification?.expiredAt ??
    null
  );
}


function getProviderPrice(data) {
  const candidates = [
    data?.price,
    data?.amount,
    data?.cost,

    data?.data?.price,
    data?.data?.amount,
    data?.data?.cost,

    data?.verification?.price,
    data?.verification?.amount,
    data?.verification?.cost
  ];

  for (const value of candidates) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}


/* =========================================================
   SERVICE RESOLUTION
   ========================================================= */

function extractServices(data) {
  if (Array.isArray(data?.services)) {
    return data.services;
  }

  if (Array.isArray(data?.data?.services)) {
    return data.data.services;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}


function resolveServiceId(
  data,
  requestedId,
  requestedName
) {
  const services =
    extractServices(data);

  if (!services.length) {
    return null;
  }

  const id =
    normalize(requestedId);

  const name =
    normalize(requestedName);

  /* Exact ID */
  let found =
    services.find(
      service =>
        normalize(service?.id) === id
    );

  if (found?.id) {
    return found.id;
  }

  /* Exact name */
  found =
    services.find(
      service =>
        normalize(service?.name) === name
    );

  if (found?.id) {
    return found.id;
  }

  /* Fuzzy name */
  found =
    services.find(service => {
      const providerName =
        normalize(service?.name);

      return (
        providerName &&
        name &&
        (
          providerName.includes(name) ||
          name.includes(providerName)
        )
      );
    });

  return found?.id || null;
}


/* =========================================================
   GET PROVIDER SERVICE
   ========================================================= */

async function getProviderService({
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
}) {
  const data =
    await sureRequest(
      `/${server}/services?country_id=${q(countryId)}`
    );

  const providerServiceId =
    resolveServiceId(
      data,
      requestedServiceId,
      requestedServiceName
    );

  if (!providerServiceId) {
    throw new Error(
      `Service "${requestedServiceName || requestedServiceId}" is not available on ${server}.`
    );
  }

  return providerServiceId;
}


/* =========================================================
   PROVIDER PRICE
   ========================================================= */

async function getProviderPriceFromServer({
  server,
  countryId,
  serviceId
}) {
  try {
    const data =
      await sureRequest(
        `/${server}/price?country_id=${q(countryId)}&service=${q(serviceId)}`
      );

    const price =
      getProviderPrice(data);

    return {
      data,
      price
    };

  } catch (error) {
    console.warn(
      `Provider price lookup failed on ${server}:`,
      error.message
    );

    return {
      data: null,
      price: null
    };
  }
}


/* =========================================================
   PURCHASE PROVIDER NUMBER
   ========================================================= */

async function purchaseOnServer({
  server,
  countryId,
  serviceId
}) {
  return await sureRequest(
    `/${server}/purchase?country_id=${q(countryId)}&service=${q(serviceId)}`,
    {
      method: "POST"
    }
  );
}


/*
 * IMPORTANT:
 *
 * USA:
 *   USA Server 2 first
 *   USA Server 1 fallback
 *
 * OTHER COUNTRIES:
 *   Global Server 1 is used because its documented
 *   purchase endpoint explicitly accepts country_id
 *   and service.
 *
 * Global Server 2 is checked for availability and
 * can be used separately when its price-tier ID is
 * available from your provider account.
 */
async function purchaseFromProvider({
  countryId,
  countryCode,
  countryName,
  serviceId,
  serviceName
}) {
  const usa =
    isUSA(
      countryId,
      countryCode,
      countryName
    );

  const servers = usa
    ? [
        "usa-server-2",
        "usa-server-1"
      ]
    : [
        "global-server-1"
      ];

  const errors = [];

  for (const server of servers) {
    try {
      /*
       * Resolve the actual provider service ID.
       */
      const providerServiceId =
        await getProviderService({
          server,
          countryId,
          requestedServiceId:
            serviceId,
          requestedServiceName:
            serviceName
        });

      /*
       * Get provider price before purchasing.
       */
      const providerPriceResult =
        await getProviderPriceFromServer({
          server,
          countryId,
          serviceId:
            providerServiceId
        });

      /*
       * Purchase.
       */
      const providerData =
        await purchaseOnServer({
          server,
          countryId,
          serviceId:
            providerServiceId
        });

      return {
        server,
        providerServiceId,
        providerData,
        providerPrice:
          providerPriceResult.price
      };

    } catch (error) {
      console.error(
        `${server} purchase failed:`,
        error
      );

      errors.push(
        `${server}: ${error.message}`
      );
    }
  }

  throw new Error(
    `Unable to purchase number from the provider. ${errors.join(" | ")}`
  );
}


/* =========================================================
   WALLET
   ========================================================= */

async function getWallet(userId) {
  const rows =
    await supabaseRequest(
      `wallets?user_id=eq.${q(userId)}&select=user_id,balance&limit=1`
    );

  return rows?.[0] || null;
}


async function debitWallet(
  userId,
  amount
) {
  const required =
    Number(amount);

  if (
    !Number.isFinite(required) ||
    required <= 0
  ) {
    throw new Error(
      "Invalid purchase amount."
    );
  }

  for (
    let attempt = 0;
    attempt < 8;
    attempt++
  ) {
    const wallet =
      await getWallet(userId);

    if (!wallet) {
      throw new Error(
        "Wallet not found. Please contact support."
      );
    }

    const current =
      Number(wallet.balance || 0);

    if (!Number.isFinite(current)) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    if (current < required) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const next =
      current - required;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(userId)}&balance=eq.${q(current)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance: next,
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
        previousBalance: current,
        newBalance: next
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
  const refund =
    Number(amount);

  if (
    !Number.isFinite(refund) ||
    refund <= 0
  ) {
    return null;
  }

  for (
    let attempt = 0;
    attempt < 8;
    attempt++
  ) {
    const wallet =
      await getWallet(userId);

    if (!wallet) {
      throw new Error(
        "Wallet not found while processing refund."
      );
    }

    const current =
      Number(wallet.balance || 0);

    const next =
      current + refund;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(userId)}&balance=eq.${q(current)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance: next,
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
        previousBalance: current,
        newBalance: next
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
    Number(order.providerPrice);

  const customerPrice =
    Number(order.sellingPrice);

  if (
    !Number.isFinite(providerCost)
  ) {
    throw new Error(
      "Provider price was not returned. Order was not created."
    );
  }

  const profit =
    customerPrice - providerCost;

  const payload = {
    user_id: userId,

    provider_order_id:
      order.verificationId,

    provider_verification_id:
      order.verificationId,

    service_country_price_id:
      order.serviceCountryPriceId,

    service_name:
      order.serviceName,

    country_name:
      order.countryName,

    provider_cost:
      providerCost,

    customer_price:
      customerPrice,

    profit,

    status:
      order.status || "active",

    phone_number:
      order.phoneNumber,

    provider_expired_at:
      order.expiredAt || null
  };

  return await supabaseRequest(
    "orders",
    {
      method: "POST",
      body: JSON.stringify(payload)
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
    return json(
      res,
      405,
      {
        success: false,
        error:
          "Method not allowed."
      }
    );
  }

  let user = null;
  let debited = false;
  let debitAmount = 0;

  try {
    /*
     * AUTH
     */
    user =
      await getAuthenticatedUser(req);

    const body =
      req.body || {};

    /*
     * COUNTRY
     */
    const countryId =
      body.countryId ??
      body.country_id;

    const countryCode =
      body.countryCode ??
      body.country_code ??
      "";

    const countryName =
      body.countryName ??
      body.country_name ??
      "";

    /*
     * SERVICE
     */
    const requestedServiceId =
      body.serviceId ??
      body.service_id ??
      body.serviceCountryPriceId ??
      body.service_country_price_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    if (!countryId) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Country is required."
        }
      );
    }

    if (!requestedServiceId) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "Service is required."
        }
      );
    }


    /* =====================================================
       FIND SELLING PRICE
       ===================================================== */

    let pricing = null;

    const exactRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${q(countryId)}&service_id=eq.${q(requestedServiceId)}&select=*&limit=1`
      );

    pricing =
      exactRows?.[0] || null;


    /*
     * Fallback by service name.
     */
    if (
      !pricing &&
      requestedServiceName
    ) {
      const nameRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${q(countryId)}&service_name=ilike.${q(requestedServiceName)}&select=*&limit=1`
        );

      pricing =
        nameRows?.[0] || null;
    }


    /*
     * Fallback by service_country_price_id.
     */
    if (
      !pricing &&
      body.serviceCountryPriceId
    ) {
      const idRows =
        await supabaseRequest(
          `product_prices?id=eq.${q(body.serviceCountryPriceId)}&select=*&limit=1`
        );

      pricing =
        idRows?.[0] || null;
    }


    const sellingPrice =
      Number(
        pricing?.selling_price
      );


    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      return json(
        res,
        400,
        {
          success: false,
          error:
            "This country and service is not currently available for purchase.",
          message:
            "This country and service is not currently available for purchase."
        }
      );
    }


    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(requestedServiceId);


    /*
     * Provider-facing service ID.
     *
     * Do not assume the customer's price-row ID
     * is the provider's service ID.
     */
    const providerServiceLookupId =
      pricing?.service_id ||
      requestedServiceId;


    /* =====================================================
       DEBIT WALLET
       ===================================================== */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited = true;
    debitAmount =
      sellingPrice;


    /* =====================================================
       PURCHASE FROM SUREVERIFICATION
       ===================================================== */

    let providerResult;

    try {
      providerResult =
        await purchaseFromProvider({
          countryId,
          countryCode,
          countryName,

          serviceId:
            providerServiceLookupId,

          serviceName
        });

    } catch (providerError) {
      console.error(
        "SureVerification purchase failed:",
        providerError
      );

      try {
        await refundWallet(
          user.id,
          sellingPrice
        );

        debited = false;

      } catch (refundError) {
        console.error(
          "Automatic refund failed:",
          refundError
        );
      }

      throw providerError;
    }


    const providerData =
      providerResult.providerData;

    const verification =
      getVerification(
        providerData
      );

    const verificationId =
      getVerificationId(
        providerData
      );

    const phoneNumber =
      getPhoneNumber(
        providerData
      );

    const expiredAt =
      getExpiredAt(
        providerData
      );


    /*
     * Provider price.
     *
     * The price endpoint is checked before
     * purchase. If the purchase response itself
     * contains a price, use that as fallback.
     */
    let providerPrice =
      Number(
        providerResult.providerPrice
      );

    if (
      !Number.isFinite(
        providerPrice
      )
    ) {
      providerPrice =
        getProviderPrice(
          providerData
        );
    }


    if (
      !verificationId ||
      !phoneNumber
    ) {
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );

        debited = false;

      } catch (refundError) {
        console.error(
          "Refund after invalid provider response failed:",
          refundError
        );
      }

      throw new Error(
        "The provider did not return a valid number. Your wallet was refunded."
      );
    }


    /*
     * We cannot insert NULL into provider_cost
     * or profit because your orders table defines
     * both columns as NOT NULL.
     */
    if (
      !Number.isFinite(
        providerPrice
      )
    ) {
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );

        debited = false;

      } catch (refundError) {
        console.error(
          "Refund after missing provider price failed:",
          refundError
        );
      }

      throw new Error(
        "Provider price could not be determined. Your wallet was refunded."
      );
    }


    /* =====================================================
       SAVE ORDER
       ===================================================== */

    let orderRows;

    try {
      orderRows =
        await createOrder(
          user.id,
          {
            verificationId,

            serviceCountryPriceId:
              pricing?.id ||
              body.serviceCountryPriceId ||
              providerServiceLookupId,

            serviceName,

            countryName:
              pricing?.country_name ||
              countryName ||
              String(countryId),

            providerPrice,

            sellingPrice,

            status:
              verification?.status ||
              "active",

            phoneNumber,

            expiredAt
          }
        );

    } catch (databaseError) {
      /*
       * Provider successfully supplied a number,
       * but database saving failed.
       *
       * Refund the customer rather than charging
       * them for an order that wasn't saved.
       */
      console.error(
        "Order database insert failed:",
        databaseError
      );

      try {
        await refundWallet(
          user.id,
          sellingPrice
        );

        debited = false;

      } catch (refundError) {
        console.error(
          "Database-failure refund failed:",
          refundError
        );
      }

      throw databaseError;
    }


    /* =====================================================
       WALLET BALANCE
       ===================================================== */

    const wallet =
      await getWallet(
        user.id
      );

    const balanceAfter =
      Number(
        wallet?.balance || 0
      );


    await createWalletTransaction({
      userId: user.id,

      amount:
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });


    debited = false;


    /* =====================================================
       SUCCESS
       ===================================================== */

    return json(
      res,
      200,
      {
        success: true,

        message:
          "Number purchased successfully.",

        order:
          orderRows?.[0] ||
          null,

        verification: {
          ...verification,

          request_id:
            verificationId,

          number:
            phoneNumber,

          expired_at:
            expiredAt
        },

        provider:
          providerResult.server,

        provider_service_id:
          providerResult.providerServiceId,

        provider_price:
          providerPrice,

        selling_price:
          sellingPrice,

        profit:
          sellingPrice -
          providerPrice,

        balance:
          balanceAfter
      }
    );

  } catch (error) {

    console.error(
      "Order purchase error:",
      error
    );


    /*
     * Last safety refund.
     */
    if (
      debited &&
      user &&
      debitAmount > 0
    ) {
      try {
        await refundWallet(
          user.id,
          debitAmount
        );

      } catch (refundError) {
        console.error(
          "Final safety refund failed:",
          refundError
        );
      }
    }


    const message =
      error?.message ||
      "Unable to purchase number.";


    return json(
      res,
      400,
      {
        success: false,

        error: message,

        message
      }
    );
  }
}

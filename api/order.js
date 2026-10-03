const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_API_KEY =
  process.env.SUREVERIFICATION_API_KEY ||
  process.env.SURE_VERIFICATION_API_KEY ||
  process.env.SURE_API_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";

const VALID_SERVERS = new Set([
  "global-server-1",
  "global-server-2",
  "usa-server-1",
  "usa-server-2"
]);

function enc(value) {
  return encodeURIComponent(String(value ?? ""));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}

function sameText(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    clean(value)
  );
}

/* =========================================================
   SUPABASE
========================================================= */

async function supabase(path, options = {}) {
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
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.hint ||
        `Supabase returned HTTP ${response.status}.`
    );
  }

  return data;
}

/* =========================================================
   SURE VERIFICATION
========================================================= */

async function sureRequest(path, options = {}) {
  if (!SURE_API_KEY) {
    throw new Error(
      "SureVerification API key is not configured."
    );
  }

  const response = await fetch(
    `${SURE_BASE_URL}${path}`,
    {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": SURE_API_KEY,
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    let message =
      data?.message ||
      data?.error ||
      data?.errors?.[0]?.message;

    if (Array.isArray(data?.errors)) {
      const messages = data.errors
        .map(error => {
          if (typeof error === "string") {
            return error;
          }

          return (
            error?.message ||
            error?.error ||
            null
          );
        })
        .filter(Boolean);

      if (messages.length) {
        message = messages.join("; ");
      }
    }

    throw new Error(
      message ||
        `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}

/* =========================================================
   AUTH
========================================================= */

async function getUser(accessToken) {
  if (!accessToken) {
    throw new Error(
      "Authentication token is missing."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    }
  );

  const data =
    await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error(
      "Unable to authenticate user."
    );
  }

  return data;
}

/* =========================================================
   GET ADMIN PRICE CONFIGURATION
========================================================= */

async function getConfiguredPrice({
  priceId,
  countryId,
  serviceName,
  providerServer
}) {
  const filters = [
    "is_active=eq.true",
    `country_id=eq.${enc(countryId)}`,
    `provider_server=eq.${enc(providerServer)}`
  ];

  let rows = [];

  if (priceId && isUuid(priceId)) {
    rows = await supabase(
      `product_prices?id=eq.${enc(priceId)}` +
        `&${filters.join("&")}` +
        `&select=*`
    );
  }

  if (!rows.length && serviceName) {
    rows = await supabase(
      `product_prices?service_name=ilike.${enc(
        serviceName
      )}` +
        `&${filters.join("&")}` +
        `&select=*` +
        `&limit=1`
    );
  }

  if (!Array.isArray(rows) || !rows[0]) {
    throw new Error(
      `No active price configuration found for ${serviceName || "this service"} on ${providerServer}.`
    );
  }

  const price = rows[0];

  if (!price.country_id) {
    throw new Error(
      "Country ID is missing from the price configuration."
    );
  }

  if (!price.service_name) {
    throw new Error(
      "Service name is missing from the price configuration."
    );
  }

  if (!price.provider_server) {
    throw new Error(
      "Provider server is missing from the price configuration."
    );
  }

  const sellingPrice =
    num(price.selling_price);

  if (sellingPrice <= 0) {
    throw new Error(
      "Selling price is not configured for this service."
    );
  }

  return price;
}

/* =========================================================
   GET PROVIDER SERVICES
========================================================= */

async function getProviderServices(
  server,
  countryId
) {
  const data = await sureRequest(
    `/${server}/services?country_id=${enc(
      countryId
    )}`
  );

  if (!Array.isArray(data?.services)) {
    throw new Error(
      `No services were returned by ${server}.`
    );
  }

  return data.services;
}

/* =========================================================
   RESOLVE PROVIDER SERVICE
========================================================= */

async function resolveProviderService({
  server,
  countryId,
  serviceName,
  configuredServiceId
}) {
  const services =
    await getProviderServices(
      server,
      countryId
    );

  let match = null;

  /*
   * First match using service name.
   */
  if (serviceName) {
    match = services.find(service =>
      sameText(
        service?.name,
        serviceName
      )
    );
  }

  /*
   * Fallback to configured provider service ID.
   */
  if (!match && configuredServiceId) {
    match = services.find(service =>
      sameText(
        service?.id,
        configuredServiceId
      )
    );
  }

  if (!match) {
    throw new Error(
      `${serviceName || "This service"} is not available on ${server} for country ${countryId}.`
    );
  }

  if (!match.id) {
    throw new Error(
      `Provider returned an invalid service ID for ${match.name || serviceName}.`
    );
  }

  return {
    id: String(match.id),
    name:
      match.name ||
      serviceName ||
      ""
  };
}

/* =========================================================
   GET PROVIDER PRICE
========================================================= */

async function getProviderPrice({
  server,
  countryId,
  providerServiceId
}) {
  /*
   * GLOBAL SERVER 2
   */

  if (server === "global-server-2") {
    const data =
      await sureRequest(
        "/global-server-2/price"
      );

    const prices =
      Array.isArray(data?.prices)
        ? data.prices
        : [];

    const matching =
      prices.filter(item =>
        sameText(
          item?.service?.id,
          providerServiceId
        )
      );

    if (!matching.length) {
      throw new Error(
        `No provider price was found for service ${providerServiceId} on Global Server 2.`
      );
    }

    const available =
      matching.filter(item =>
        num(item?.stocks) > 0
      );

    if (!available.length) {
      throw new Error(
        `No stock is available for service ${providerServiceId} on Global Server 2.`
      );
    }

    const selected =
      available[0];

    return {
      cost:
        num(selected.price),

      priceId:
        selected.id != null
          ? String(selected.id)
          : null,

      stocks:
        num(selected.stocks)
    };
  }

  /*
   * GLOBAL SERVER 1
   * USA SERVER 1
   * USA SERVER 2
   */

  const data =
    await sureRequest(
      `/${server}/price` +
        `?country_id=${enc(countryId)}` +
        `&service=${enc(providerServiceId)}`
    );

  const providerPrice =
    data?.price;

  if (!providerPrice) {
    throw new Error(
      `Provider price was not returned by ${server}.`
    );
  }

  const cost =
    num(providerPrice.price);

  if (cost <= 0) {
    throw new Error(
      `Provider returned an invalid price for ${providerServiceId} on ${server}.`
    );
  }

  const stocks =
    providerPrice?.service?.stocks;

  if (
    stocks !== null &&
    stocks !== undefined &&
    num(stocks) <= 0
  ) {
    throw new Error(
      `No stock is available for this service on ${server}.`
    );
  }

  return {
    cost,

    priceId: null,

    stocks:
      stocks == null
        ? null
        : num(stocks)
  };
}

/* =========================================================
   PURCHASE NUMBER
========================================================= */

async function purchaseNumber({
  server,
  countryId,
  providerServiceId,
  globalServer2PriceId
}) {
  /*
   * GLOBAL SERVER 2
   */

  if (server === "global-server-2") {
    const query =
      `?country_id=${enc(countryId)}` +
      `&service=${enc(providerServiceId)}` +
      (
        globalServer2PriceId != null
          ? `&id=${enc(globalServer2PriceId)}`
          : ""
      );

    return await sureRequest(
      `/global-server-2/purchase${query}`,
      {
        method: "POST",

        body: JSON.stringify({
          country_id:
            String(countryId),

          service:
            String(providerServiceId),

          ...(globalServer2PriceId != null
            ? {
                id:
                  globalServer2PriceId
              }
            : {})
        })
      }
    );
  }

  /*
   * GLOBAL SERVER 1
   * USA SERVER 1
   * USA SERVER 2
   */

  return await sureRequest(
    `/${server}/purchase` +
      `?country_id=${enc(countryId)}` +
      `&service=${enc(providerServiceId)}`,
    {
      method: "POST"
    }
  );
}

/* =========================================================
   EXTRACT PROVIDER RESPONSE
========================================================= */

function extractVerification(data) {
  const verification =
    data?.verification ||
    data?.data ||
    data ||
    null;

  if (!verification) {
    throw new Error(
      "Provider returned an empty purchase response."
    );
  }

  const phoneNumber =
    verification?.number ||
    verification?.phone_number ||
    verification?.phone ||
    data?.number ||
    data?.phone_number ||
    null;

  const providerOrderId =
    verification?.request_id != null
      ? String(
          verification.request_id
        )
      : verification?.id != null
      ? String(verification.id)
      : data?.request_id != null
      ? String(data.request_id)
      : data?.id != null
      ? String(data.id)
      : null;

  const status =
    verification?.status ||
    data?.status ||
    "active";

  if (!phoneNumber) {
    throw new Error(
      "Provider did not return a phone number."
    );
  }

  if (!providerOrderId) {
    throw new Error(
      "Provider did not return a request/order ID."
    );
  }

  return {
    phoneNumber:
      String(phoneNumber),

    providerOrderId,

    status,

    raw: data
  };
}

/* =========================================================
   WALLET
========================================================= */

async function getWallet(userId) {
  /*
   * wallets has:
   *
   * user_id
   * balance
   * created_at
   * updated_at
   *
   * There is NO wallets.id.
   */

  const rows =
    await supabase(
      `wallets?user_id=eq.${enc(userId)}` +
        `&select=user_id,balance,created_at,updated_at` +
        `&limit=1`
    );

  if (!Array.isArray(rows) ||
      !rows[0]) {
    throw new Error(
      "Wallet account was not found."
    );
  }

  return rows[0];
}

async function updateWallet(
  userId,
  balance
) {
  const rows =
    await supabase(
      `wallets?user_id=eq.${enc(userId)}`,
      {
        method: "PATCH",

        headers: {
          Prefer:
            "return=representation"
        },

        body: JSON.stringify({
          balance
        })
      }
    );

  if (!Array.isArray(rows) ||
      !rows[0]) {
    throw new Error(
      "Wallet balance could not be updated."
    );
  }

  return rows[0];
}

/* =========================================================
   WALLET TRANSACTION
========================================================= */

async function createWalletTransaction({
  userId,
  amount,
  balanceBefore,
  balanceAfter,
  description
}) {
  /*
   * IMPORTANT:
   *
   * Your database CHECK constraint allows:
   *
   * deposit
   * number_purchase
   * refund
   * adjustment
   *
   * Therefore the correct type is:
   * number_purchase
   */

  await supabase(
    "wallet_transactions",
    {
      method: "POST",

      headers: {
        Prefer:
          "return=minimal"
      },

      body: JSON.stringify({
        user_id:
          userId,

        type:
          "number_purchase",

        amount:
          amount,

        balance_before:
          balanceBefore,

        balance_after:
          balanceAfter,

        reference_id:
          null,

        description:
          description
      })
    }
  );
}

/* =========================================================
   CREATE ORDER
========================================================= */

async function createOrder({
  userId,
  providerOrderId,
  price,
  providerCost,
  customerPrice,
  phoneNumber,
  status
}) {
  const profit =
    customerPrice -
    providerCost;

  const rows =
    await supabase(
      "orders",
      {
        method: "POST",

        headers: {
          Prefer:
            "return=representation"
        },

        body: JSON.stringify({
          user_id:
            userId,

          provider_order_id:
            providerOrderId,

          service_country_price_id:
            price.service_country_price_id ||
            null,

          service_name:
            price.service_name ||
            null,

          country_name:
            price.country_name ||
            null,

          provider_cost:
            providerCost,

          customer_price:
            customerPrice,

          profit:
            profit,

          status:
            status,

          phone_number:
            phoneNumber
        })
      }
    );

  return Array.isArray(rows)
    ? rows[0] || null
    : null;
}

/* =========================================================
   MAIN API HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error:
        "Method not allowed."
    });
  }

  try {
    /* -----------------------------------------
       AUTHENTICATION
    ----------------------------------------- */

    const authorization =
      req.headers.authorization ||
      "";

    const accessToken =
      authorization.startsWith(
        "Bearer "
      )
        ? authorization.slice(7)
        : null;

    const user =
      await getUser(accessToken);

    /* -----------------------------------------
       REQUEST DATA
    ----------------------------------------- */

    const body =
      req.body || {};

    const priceId =
      body.priceId ||
      body.productPriceId ||
      null;

    const countryId =
      body.countryId ||
      body.country_id ||
      null;

    const serviceId =
      body.serviceId ||
      body.service_id ||
      null;

    const serviceName =
      body.serviceName ||
      body.service_name ||
      null;

    const providerServer =
      body.providerServer ||
      body.provider_server ||
      null;

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "Country ID is required."
      });
    }

    if (!serviceName &&
        !serviceId) {
      return res.status(400).json({
        success: false,
        error:
          "Service ID or service name is required."
      });
    }

    if (!providerServer) {
      return res.status(400).json({
        success: false,
        error:
          "Provider server is required."
      });
    }

    const server =
      clean(providerServer)
        .toLowerCase();

    if (!VALID_SERVERS.has(server)) {
      return res.status(400).json({
        success: false,
        error:
          `Invalid provider server: ${server}`
      });
    }

    /* -----------------------------------------
       LOAD SELLING PRICE
    ----------------------------------------- */

    const price =
      await getConfiguredPrice({
        priceId,

        countryId,

        serviceName,

        providerServer:
          server
      });

    /* -----------------------------------------
       RESOLVE PROVIDER SERVICE ID
    ----------------------------------------- */

    const providerService =
      await resolveProviderService({
        server,

        countryId:
          String(price.country_id),

        serviceName:
          price.service_name ||
          serviceName,

        configuredServiceId:
          price.provider_service_id ||
          serviceId
      });

    const actualProviderServiceId =
      providerService.id;

    /* -----------------------------------------
       GET PROVIDER COST
    ----------------------------------------- */

    const providerPrice =
      await getProviderPrice({
        server,

        countryId:
          String(price.country_id),

        providerServiceId:
          actualProviderServiceId
      });

    const providerCost =
      num(providerPrice.cost);

    if (providerCost <= 0) {
      throw new Error(
        "Provider returned an invalid price."
      );
    }

    /* -----------------------------------------
       CUSTOMER PRICE
    ----------------------------------------- */

    const customerPrice =
      num(price.selling_price);

    if (customerPrice <= 0) {
      throw new Error(
        "Selling price is not configured."
      );
    }

    /* -----------------------------------------
       WALLET CHECK
    ----------------------------------------- */

    const wallet =
      await getWallet(user.id);

    const balanceBefore =
      num(wallet.balance);

    if (
      balanceBefore <
      customerPrice
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Insufficient wallet balance.",

        balance:
          balanceBefore,

        required:
          customerPrice
      });
    }

    /* -----------------------------------------
       PURCHASE NUMBER
    ----------------------------------------- */

    const providerResponse =
      await purchaseNumber({
        server,

        countryId:
          String(price.country_id),

        providerServiceId:
          actualProviderServiceId,

        globalServer2PriceId:
          providerPrice.priceId
      });

    /* -----------------------------------------
       READ PROVIDER RESPONSE
    ----------------------------------------- */

    const verification =
      extractVerification(
        providerResponse
      );

    /* -----------------------------------------
       DEDUCT WALLET
    ----------------------------------------- */

    const balanceAfter =
      balanceBefore -
      customerPrice;

    await updateWallet(
      user.id,
      balanceAfter
    );

    /* -----------------------------------------
       RECORD WALLET TRANSACTION
    ----------------------------------------- */

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        customerPrice,

      balanceBefore:
        balanceBefore,

      balanceAfter:
        balanceAfter,

      description:
        `Number purchase - ${providerService.name} - ${price.country_name} - ${server}`
    });

    /* -----------------------------------------
       RECORD ORDER
    ----------------------------------------- */

    const order =
      await createOrder({
        userId:
          user.id,

        providerOrderId:
          verification.providerOrderId,

        price:
          price,

        providerCost:
          providerCost,

        customerPrice:
          customerPrice,

        phoneNumber:
          verification.phoneNumber,

        status:
          verification.status
      });

    /* -----------------------------------------
       SUCCESS
    ----------------------------------------- */

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order,

      verification: {
        request_id:
          verification.providerOrderId,

        number:
          verification.phoneNumber,

        service:
          providerService.name,

        provider_service_id:
          actualProviderServiceId,

        status:
          verification.status,

        provider_server:
          server
      },

      pricing: {
        provider_cost:
          providerCost,

        selling_price:
          customerPrice,

        profit:
          customerPrice -
          providerCost
      },

      wallet: {
        balance_before:
          balanceBefore,

        amount:
          customerPrice,

        balance_after:
          balanceAfter
      }
    });

  } catch (error) {
    console.error(
      "ORDER PURCHASE ERROR:",
      error
    );

    return res.status(500).json({
      success:
        false,

      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}

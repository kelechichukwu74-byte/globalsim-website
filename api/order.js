// api/order.js
//
// Global Virtual Sim Web
// Purchase API for:
// - usa-server-1
// - usa-server-2
// - global-server-1
// - global-server-2
//
// Uses native fetch only.
// No @supabase/supabase-js import is required.

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_API_KEY =
  process.env.SUREVERIFICATION_API_KEY ||
  process.env.SURE_VERIFICATION_API_KEY ||
  process.env.SURE_API_KEY;

const SURE_BASE =
  "https://sureverifications.com/api/v1";

function json(res, status, data) {
  return res.status(status).json(data);
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function supabaseFetch(path, options = {}) {
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
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      text ||
      `Supabase HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

async function sureFetch(path, options = {}) {
  if (!SURE_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SURE_BASE}${path}`,
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
    const error = new Error(
      data?.message ||
        data?.error ||
        data?.errors?.[0]?.message ||
        text ||
        `SureVerification HTTP ${response.status}`
    );

    error.status = response.status;
    error.providerData = data;

    throw error;
  }

  return data;
}

function normalizeServer(server) {
  const value = clean(server).toLowerCase();

  if (
    value === "usa-server-1" ||
    value === "us-server-1" ||
    value === "usa1" ||
    value === "us1"
  ) {
    return "usa-server-1";
  }

  if (
    value === "usa-server-2" ||
    value === "us-server-2" ||
    value === "usa2" ||
    value === "us2"
  ) {
    return "usa-server-2";
  }

  if (
    value === "global-server-1" ||
    value === "global1" ||
    value === "global-server1"
  ) {
    return "global-server-1";
  }

  if (
    value === "global-server-2" ||
    value === "global2" ||
    value === "global-server2"
  ) {
    return "global-server-2";
  }

  return value;
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function getUserFromToken(token) {
  if (!token) {
    throw new Error("Authentication token is missing.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error("Invalid or expired authentication session.");
  }

  return data;
}

async function findProductPrice({
  priceId,
  countryId,
  serviceId,
  serviceName,
  server
}) {
  /*
   * IMPORTANT:
   * provider service IDs such as "wa" are NOT UUIDs.
   *
   * Therefore "wa" is never sent to:
   * product_prices.id
   */

  let rows = [];

  if (isUUID(priceId)) {
    rows = await supabaseFetch(
      `product_prices?id=eq.${encode(priceId)}&select=*`
    );
  }

  if (!rows.length && serviceId) {
    let path =
      `product_prices?provider_service_id=eq.${encode(
        serviceId
      )}` +
      `&select=*` +
      `&order=provider_server.asc`;

    if (countryId && isUUID(countryId)) {
      path += `&country_id=eq.${encode(countryId)}`;
    }

    rows = await supabaseFetch(path);
  }

  if (!rows.length && serviceName) {
    let path =
      `product_prices?service_name=ilike.${encode(
        serviceName
      )}` +
      `&select=*` +
      `&order=provider_server.asc`;

    if (countryId && isUUID(countryId)) {
      path += `&country_id=eq.${encode(countryId)}`;
    }

    rows = await supabaseFetch(path);
  }

  if (!rows.length) {
    throw new Error(
      "No matching product price was found."
    );
  }

  const wantedServer = normalizeServer(server);

  let row =
    rows.find(
      (item) =>
        normalizeServer(item.provider_server) ===
        wantedServer
    ) || null;

  if (!row) {
    row =
      rows.find(
        (item) =>
          clean(item.provider_service_id) ===
          clean(serviceId)
      ) || null;
  }

  if (!row) {
    throw new Error(
      `No price is configured for ${wantedServer}.`
    );
  }

  if (row.is_active === false) {
    throw new Error(
      "This number service is currently unavailable."
    );
  }

  return row;
}

async function getProviderServices(
  server,
  providerCountryId
) {
  if (!providerCountryId) {
    throw new Error(
      "Provider country ID is missing."
    );
  }

  return await sureFetch(
    `/${server}/services?country_id=${encode(
      providerCountryId
    )}`,
    {
      method: "GET"
    }
  );
}

function serviceMatches(service, serviceId, serviceName) {
  const wantedId = clean(serviceId).toLowerCase();
  const wantedName = clean(serviceName).toLowerCase();

  const id = clean(
    service?.id ??
      service?.service_id ??
      service?.code
  ).toLowerCase();

  const name = clean(
    service?.name ??
      service?.service_name
  ).toLowerCase();

  return (
    (wantedId && id === wantedId) ||
    (wantedName && name === wantedName)
  );
}

async function getGlobal2PriceTier(
  serviceId,
  serviceName
) {
  const result = await sureFetch(
    "/global-server-2/price",
    {
      method: "GET"
    }
  );

  const prices = Array.isArray(result?.prices)
    ? result.prices
    : [];

  const matching = prices.filter((item) => {
    const service = item?.service || {};

    return serviceMatches(
      service,
      serviceId,
      serviceName
    );
  });

  const available = matching.filter(
    (item) =>
      numberValue(item?.service?.stocks) > 0
  );

  if (!available.length) {
    throw new Error(
      "No available price tier was found for this service on Global Server 2."
    );
  }

  /*
   * Use the first available tier.
   * The provider supplies the actual tier ID.
   */
  return available[0];
}

async function purchaseNumber({
  server,
  providerCountryId,
  serviceId,
  serviceName
}) {
  const normalizedServer =
    normalizeServer(server);

  /*
   * GLOBAL SERVER 2
   *
   * The provider's price endpoint supplies
   * the numeric price-tier ID.
   */
  if (normalizedServer === "global-server-2") {
    const tier =
      await getGlobal2PriceTier(
        serviceId,
        serviceName
      );

    const tierId = tier?.id;

    const attempts = [];

    /*
     * First attempt: provider-style query.
     */
    attempts.push(
      async () =>
        await sureFetch(
          `/global-server-2/purchase?country_id=${encode(
            providerCountryId
          )}&service=${encode(
            serviceId
          )}&id=${encode(tierId)}`,
          {
            method: "POST"
          }
        )
    );

    /*
     * Second attempt: JSON body.
     */
    attempts.push(
      async () =>
        await sureFetch(
          "/global-server-2/purchase",
          {
            method: "POST",
            body: JSON.stringify({
              country_id: providerCountryId,
              service: serviceId,
              id: tierId
            })
          }
        )
    );

    let lastError = null;

    for (const attempt of attempts) {
      try {
        const result = await attempt();

        if (
          result?.verification ||
          result?.number ||
          result?.phone_number
        ) {
          return {
            result,
            providerCost:
              numberValue(
                tier?.price
              ),
            tierId
          };
        }

        if (result?.message) {
          return {
            result,
            providerCost:
              numberValue(
                tier?.price
              ),
            tierId
          };
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ||
      new Error(
        "Global Server 2 purchase failed."
      );
  }

  /*
   * OTHER THREE SERVERS
   */
  const query =
    `?country_id=${encode(
      providerCountryId
    )}` +
    `&service=${encode(serviceId)}`;

  const result = await sureFetch(
    `/${normalizedServer}/purchase${query}`,
    {
      method: "POST"
    }
  );

  return {
    result,
    providerCost: 0
  };
}

function extractVerification(result) {
  const verification =
    result?.verification ||
    result?.data?.verification ||
    result?.activation ||
    result?.data ||
    result;

  const phone =
    verification?.number ||
    verification?.phone_number ||
    verification?.phone ||
    result?.number ||
    result?.phone_number ||
    null;

  const providerOrderId =
    verification?.request_id ||
    verification?.id ||
    result?.request_id ||
    result?.id ||
    null;

  const status =
    verification?.status ||
    result?.status ||
    "active";

  return {
    verification,
    phone: phone ? String(phone) : null,
    providerOrderId:
      providerOrderId !== null
        ? String(providerOrderId)
        : null,
    status: String(status)
  };
}

async function getWallet(userId) {
  const rows = await supabaseFetch(
    `wallets?user_id=eq.${encode(
      userId
    )}&select=*&limit=1`
  );

  if (!rows?.length) {
    throw new Error(
      "Wallet account was not found."
    );
  }

  return rows[0];
}

async function updateWallet(
  walletId,
  balance
) {
  const rows = await supabaseFetch(
    `wallets?id=eq.${encode(walletId)}&select=id,balance`,
    {
      method: "PATCH",
      body: JSON.stringify({
        balance
      }),
      headers: {
        Prefer: "return=representation"
      }
    }
  );

  if (!rows?.length) {
    throw new Error(
      "Unable to update wallet balance."
    );
  }

  return rows[0];
}

async function insertWalletTransaction({
  userId,
  walletId,
  amount,
  balanceBefore,
  balanceAfter,
  orderId,
  description
}) {
  try {
    await supabaseFetch(
      "wallet_transactions",
      {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          user_id: userId,
          wallet_id: walletId,
          amount,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          type: "purchase",
          description,
          reference:
            orderId || null
        })
      }
    );
  } catch (error) {
    /*
     * Wallet has already been updated.
     * Do not make the purchase fail only because
     * transaction-history insertion failed.
     */
    console.error(
      "wallet_transactions insert:",
      error.message
    );
  }
}

async function createOrder(data) {
  const rows = await supabaseFetch(
    "orders",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify(data)
    }
  );

  return rows?.[0] || null;
}

async function refundWallet({
  wallet,
  amount,
  userId,
  reason
}) {
  const currentBalance =
    numberValue(wallet.balance);

  const newBalance =
    currentBalance + amount;

  await updateWallet(
    wallet.id,
    newBalance
  );

  try {
    await supabaseFetch(
      "wallet_transactions",
      {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          user_id: userId,
          wallet_id: wallet.id,
          amount,
          balance_before: currentBalance,
          balance_after: newBalance,
          type: "refund",
          description: reason
        })
      }
    );
  } catch (error) {
    console.error(
      "Refund transaction history:",
      error.message
    );
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, {
        success: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not configured."
      });
    }

    if (!SURE_API_KEY) {
      return json(res, 500, {
        success: false,
        error:
          "SUREVERIFICATION_API_KEY is not configured."
      });
    }

    /*
     * Authentication
     */
    const authHeader =
      req.headers?.authorization ||
      req.headers?.Authorization ||
      "";

    const token = authHeader
      .replace(/^Bearer\s+/i, "")
      .trim();

    const user =
      await getUserFromToken(token);

    const userId = user.id;

    /*
     * Frontend payload
     */
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const priceId =
      clean(
        body.priceId ||
          body.productPriceId ||
          body.serviceCountryPriceId
      );

    const countryId =
      clean(
        body.countryId ||
          body.country_id
      );

    const providerCountryId =
      clean(
        body.providerCountryId ||
          body.provider_country_id ||
          body.providerCountryID
      );

    const serviceId =
      clean(
        body.providerServiceId ||
          body.provider_service_id ||
          body.serviceId ||
          body.service_id ||
          body.service
      );

    const serviceName =
      clean(
        body.serviceName ||
          body.service_name
      );

    const requestedServer =
      clean(
        body.providerServer ||
          body.provider_server ||
          body.server
      );

    if (!countryId && !providerCountryId) {
      return json(res, 400, {
        success: false,
        error:
          "Country information is required."
      });
    }

    if (!serviceId && !serviceName) {
      return json(res, 400, {
        success: false,
        error:
          "Service information is required."
      });
    }

    if (!requestedServer) {
      return json(res, 400, {
        success: false,
        error:
          "Provider server is required."
      });
    }

    const server =
      normalizeServer(requestedServer);

    const allowedServers = [
      "usa-server-1",
      "usa-server-2",
      "global-server-1",
      "global-server-2"
    ];

    if (!allowedServers.includes(server)) {
      return json(res, 400, {
        success: false,
        error:
          `Unsupported provider server: ${server}`
      });
    }

    /*
     * Find the exact selling-price record.
     */
    const priceRow =
      await findProductPrice({
        priceId,
        countryId,
        serviceId,
        serviceName,
        server
      });

    /*
     * Provider country ID can come directly from
     * the frontend or from product_prices.
     */
    const actualProviderCountryId =
      clean(
        providerCountryId ||
          priceRow.provider_country_id ||
          priceRow.country_provider_id ||
          priceRow.provider_country_id_value
      );

    if (!actualProviderCountryId) {
      return json(res, 400, {
        success: false,
        error:
          "Provider country ID is missing from the price configuration."
      });
    }

    /*
     * Provider service ID.
     */
    const actualServiceId =
      clean(
        serviceId ||
          priceRow.provider_service_id
      );

    const actualServiceName =
      clean(
        serviceName ||
          priceRow.service_name
      );

    if (!actualServiceId) {
      return json(res, 400, {
        success: false,
        error:
          "Provider service ID is missing."
      });
    }

    /*
     * Confirm that the service exists on the selected
     * provider for this country.
     *
     * This also fixes the Global Server 2
     * "country id field is required" issue by making
     * sure country_id is supplied to its services endpoint.
     */
    const servicesResult =
      await getProviderServices(
        server,
        actualProviderCountryId
      );

    const providerServices =
      Array.isArray(
        servicesResult?.services
      )
        ? servicesResult.services
        : [];

    if (providerServices.length) {
      const serviceExists =
        providerServices.some(
          (service) =>
            serviceMatches(
              service,
              actualServiceId,
              actualServiceName
            )
        );

      if (!serviceExists) {
        return json(res, 400, {
          success: false,
          error:
            "The selected service is not available on this provider for the selected country."
        });
      }
    }

    /*
     * Customer selling price.
     */
    const customerPrice =
      numberValue(
        priceRow.selling_price ??
          priceRow.customer_price ??
          priceRow.price
      );

    if (customerPrice <= 0) {
      return json(res, 400, {
        success: false,
        error:
          "Selling price is not configured for this service."
      });
    }

    /*
     * Wallet
     */
    const wallet =
      await getWallet(userId);

    const balanceBefore =
      numberValue(wallet.balance);

    if (balanceBefore < customerPrice) {
      return json(res, 400, {
        success: false,
        error: "Insufficient wallet balance.",
        balance: balanceBefore,
        required: customerPrice
      });
    }

    /*
     * Reserve the customer's money BEFORE
     * requesting the provider number.
     */
    const balanceAfter =
      balanceBefore - customerPrice;

    await updateWallet(
      wallet.id,
      balanceAfter
    );

    let providerResult;

    try {
      providerResult =
        await purchaseNumber({
          server,
          providerCountryId:
            actualProviderCountryId,
          serviceId: actualServiceId,
          serviceName: actualServiceName
        });
    } catch (providerError) {
      /*
       * Provider purchase failed.
       * Automatically return customer's money.
       */
      await refundWallet({
        wallet,
        amount: customerPrice,
        userId,
        reason:
          `Number purchase failed on ${server}: ${providerError.message}`
      });

      console.error(
        "Provider purchase error:",
        providerError
      );

      return json(res, 502, {
        success: false,
        error:
          providerError?.message ||
          "Provider purchase failed.",
        server,
        provider_status:
          providerError?.status || null,
        provider_response:
          providerError?.providerData || null,
        refunded: true
      });
    }

    const extracted =
      extractVerification(
        providerResult.result
      );

    /*
     * Provider must return a number.
     */
    if (!extracted.phone) {
      await refundWallet({
        wallet,
        amount: customerPrice,
        userId,
        reason:
          `Provider returned no phone number on ${server}.`
      });

      return json(res, 502, {
        success: false,
        error:
          "Provider did not return a phone number.",
        provider_response:
          providerResult.result,
        refunded: true
      });
    }

    const providerCost =
      numberValue(
        providerResult.providerCost
      );

    const profit =
      customerPrice - providerCost;

    /*
     * Save order.
     */
    let order = null;

    try {
      order = await createOrder({
        user_id: userId,
        provider_order_id:
          extracted.providerOrderId,
        service_country_price_id:
          priceRow.id
            ? String(priceRow.id)
            : null,
        service_name:
          actualServiceName ||
          actualServiceId,
        country_name:
          priceRow.country_name ||
          null,
        provider_cost:
          providerCost,
        customer_price:
          customerPrice,
        profit,
        status:
          extracted.status || "active",
        phone_number:
          extracted.phone
      });
    } catch (orderError) {
      /*
       * Do not leave the customer's wallet charged
       * if the order cannot be recorded.
       */
      await refundWallet({
        wallet,
        amount: customerPrice,
        userId,
        reason:
          `Order record failed: ${orderError.message}`
      });

      console.error(
        "Order insert error:",
        orderError
      );

      return json(res, 500, {
        success: false,
        error:
          "The number was purchased but the order could not be recorded. Your wallet has been refunded.",
        refunded: true
      });
    }

    /*
     * Wallet transaction history.
     */
    await insertWalletTransaction({
      userId,
      walletId: wallet.id,
      amount: -customerPrice,
      balanceBefore,
      balanceAfter,
      orderId: order?.id || null,
      description:
        `Purchased ${actualServiceName || actualServiceId} number from ${server}`
    });

    return json(res, 200, {
      success: true,

      server,

      order,

      number:
        extracted.phone,

      phone_number:
        extracted.phone,

      provider_order_id:
        extracted.providerOrderId,

      status:
        extracted.status,

      customer_price:
        customerPrice,

      provider_cost:
        providerCost,

      profit,

      balance:
        balanceAfter,

      verification:
        extracted.verification,

      provider_response:
        providerResult.result
    });
  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    return json(res, 500, {
      success: false,
      error:
        error?.message ||
        "A server error occurred.",
      details:
        process.env.NODE_ENV === "development"
          ? String(error?.stack || "")
          : undefined
    });
  }
}

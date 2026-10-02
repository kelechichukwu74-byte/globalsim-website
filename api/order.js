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

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- SUPABASE ---------------- */

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
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
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

/* ---------------- SURE VERIFICATION ---------------- */

async function sureRequest(
  path,
  options = {}
) {
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
    throw new Error(
      data?.message ||
        data?.error ||
        data?.errors?.[0]?.message ||
        `Provider returned HTTP ${response.status}.`
    );
  }

  return data;
}

/* ---------------- AUTH ---------------- */

async function getUser(accessToken) {
  if (!accessToken) {
    throw new Error("Authentication token is missing.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error("Unable to authenticate user.");
  }

  return data;
}

/* ---------------- PRICE CONFIGURATION ---------------- */

async function getPriceConfiguration({
  priceId,
  countryId,
  serviceId,
  serviceName,
  providerServer
}) {
  const filters = [
    `is_active=eq.true`
  ];

  if (countryId) {
    filters.push(
      `country_id=eq.${encode(countryId)}`
    );
  }

  if (providerServer) {
    filters.push(
      `provider_server=eq.${encode(providerServer)}`
    );
  }

  let rows = [];

  /*
   * IMPORTANT:
   * serviceId such as "wa" is NOT a UUID.
   * Therefore we only use priceId as product_prices.id
   * when it is actually a UUID.
   */

  if (priceId && isUuid(priceId)) {
    rows = await supabase(
      `product_prices?id=eq.${encode(
        priceId
      )}&${filters.join("&")}&select=*`
    );
  }

  /*
   * If no UUID price was found, search using
   * provider_service_id.
   */
  if (!rows.length && serviceId) {
    rows = await supabase(
      `product_prices?provider_service_id=eq.${encode(
        serviceId
      )}&${filters.join("&")}&select=*`
    );
  }

  /*
   * Finally allow matching by service name.
   */
  if (!rows.length && serviceName) {
    rows = await supabase(
      `product_prices?service_name=ilike.${encode(
        serviceName
      )}&${filters.join("&")}&select=*`
    );
  }

  if (!rows.length) {
    throw new Error(
      "No active price configuration was found for this country, service and provider."
    );
  }

  /*
   * If multiple records exist, prefer the exact provider server.
   */
  let price = rows[0];

  if (providerServer) {
    const exact = rows.find(
      row =>
        String(row.provider_server || "")
          .toLowerCase() ===
        String(providerServer).toLowerCase()
    );

    if (exact) {
      price = exact;
    }
  }

  if (!price.country_id) {
    throw new Error(
      "Provider country ID is missing from the price configuration."
    );
  }

  if (!price.provider_service_id) {
    throw new Error(
      "Provider service ID is missing from the price configuration."
    );
  }

  if (number(price.selling_price) <= 0) {
    throw new Error(
      "Selling price is not configured for this service."
    );
  }

  return price;
}

/* ---------------- PROVIDER SERVICES ---------------- */

async function getProviderServices(
  server,
  countryId
) {
  if (!server) {
    return [];
  }

  const path =
    `/${encode(server)}/services` +
    `?country_id=${encode(countryId)}`;

  const data = await sureRequest(path);

  return Array.isArray(data?.services)
    ? data.services
    : [];
}

/* ---------------- GLOBAL SERVER 2 PRICE ---------------- */

async function getGlobalServer2ProviderPrice(
  serviceId,
  serviceName
) {
  const data = await sureRequest(
    "/global-server-2/price"
  );

  const prices = Array.isArray(data?.prices)
    ? data.prices
    : [];

  const matching = prices.filter(item => {
    const id =
      item?.service?.id != null
        ? String(item.service.id)
        : "";

    const name =
      item?.service?.name != null
        ? String(item.service.name)
        : "";

    const idMatch =
      serviceId &&
      id.toLowerCase() ===
        String(serviceId).toLowerCase();

    const nameMatch =
      serviceName &&
      name.toLowerCase() ===
        String(serviceName).toLowerCase();

    return idMatch || nameMatch;
  });

  const available = matching.filter(
    item => number(item?.stocks) > 0
  );

  if (!available.length) {
    throw new Error(
      "No stock is currently available for this service on Global Server 2."
    );
  }

  /*
   * Use the first available provider price option.
   */
  const selected = available[0];

  return {
    providerPrice: number(selected.price),
    providerPriceId:
      selected.id != null
        ? String(selected.id)
        : null,
    stocks: number(selected.stocks)
  };
}

/* ---------------- PURCHASE ---------------- */

async function purchaseNumber({
  server,
  countryId,
  serviceId,
  serviceName,
  providerPriceId
}) {
  if (!server) {
    throw new Error(
      "Provider server is missing."
    );
  }

  if (!countryId) {
    throw new Error(
      "Provider country ID is missing."
    );
  }

  if (!serviceId) {
    throw new Error(
      "Provider service ID is missing."
    );
  }

  /*
   * Global Server 2
   *
   * The provider has previously returned:
   * "The country id field is required."
   *
   * Therefore send country_id explicitly.
   *
   * We also send the service ID.
   */
  if (
    server.toLowerCase() ===
    "global-server-2"
  ) {
    const query =
      `?country_id=${encode(countryId)}` +
      `&service=${encode(serviceId)}` +
      (
        providerPriceId
          ? `&id=${encode(providerPriceId)}`
          : ""
      );

    try {
      return await sureRequest(
        `/global-server-2/purchase${query}`,
        {
          method: "POST",
          body: JSON.stringify({
            country_id: String(countryId),
            service: String(serviceId),
            ...(providerPriceId
              ? {
                  id: providerPriceId
                }
              : {})
          })
        }
      );
    } catch (firstError) {
      /*
       * Some deployments of the provider expect
       * the parameters in the request body only.
       */
      try {
        return await sureRequest(
          "/global-server-2/purchase",
          {
            method: "POST",
            body: JSON.stringify({
              country_id: String(countryId),
              service: String(serviceId),
              ...(providerPriceId
                ? {
                    id: providerPriceId
                  }
                : {})
            })
          }
        );
      } catch {
        throw firstError;
      }
    }
  }

  /*
   * Other SureVerification servers.
   */
  return await sureRequest(
    `/${encode(server)}/purchase` +
      `?country_id=${encode(countryId)}` +
      `&service=${encode(serviceId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        country_id: String(countryId),
        service: String(serviceId)
      })
    }
  );
}

/* ---------------- PROVIDER RESPONSE ---------------- */

function extractVerification(data) {
  const verification =
    data?.verification ||
    data?.data ||
    data;

  const phoneNumber =
    verification?.number ||
    verification?.phone_number ||
    verification?.phone ||
    data?.number ||
    data?.phone_number ||
    null;

  const providerOrderId =
    verification?.request_id != null
      ? String(verification.request_id)
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

  return {
    phoneNumber,
    providerOrderId,
    status,
    raw: data
  };
}

/* ---------------- WALLET ---------------- */

async function getWallet(userId) {
  /*
   * IMPORTANT:
   * wallets has NO id column.
   * user_id is the wallet identifier.
   */
  const rows = await supabase(
    `wallets?user_id=eq.${encode(
      userId
    )}&select=user_id,balance,created_at,updated_at&limit=1`
  );

  if (!rows?.length) {
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
  /*
   * IMPORTANT:
   * Update by user_id, NOT wallets.id.
   */
  const rows = await supabase(
    `wallets?user_id=eq.${encode(userId)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        balance
      })
    }
  );

  if (!rows?.length) {
    throw new Error(
      "Wallet balance could not be updated."
    );
  }

  return rows[0];
}

/* ---------------- WALLET TRANSACTION ---------------- */

async function createWalletTransaction({
  userId,
  amount,
  balanceBefore,
  balanceAfter,
  description
}) {
  /*
   * reference_id is nullable and is UUID.
   * Do NOT put provider_order_id here because that
   * is not necessarily a UUID.
   */
  return await supabase(
    "wallet_transactions",
    {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: userId,
        type: "purchase",
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reference_id: null,
        description
      })
    }
  );
}

/* ---------------- ORDER ---------------- */

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
    customerPrice - providerCost;

  const rows = await supabase(
    "orders",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        user_id: userId,
        provider_order_id:
          providerOrderId,
        service_country_price_id:
          price.id || null,
        service_name:
          price.service_name || null,
        country_name:
          price.country_name || null,
        provider_cost: providerCost,
        customer_price: customerPrice,
        profit,
        status,
        phone_number: phoneNumber
      })
    }
  );

  return rows?.[0] || null;
}

/* ---------------- HANDLER ---------------- */

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

  try {
    const authHeader =
      req.headers.authorization ||
      "";

    const accessToken =
      authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    const user =
      await getUser(accessToken);

    const body =
      req.body || {};

    /*
     * Accept both camelCase and common alternatives.
     */
    const priceId =
      body.priceId ||
      body.productPriceId ||
      body.serviceCountryPriceId ||
      null;

    const countryId =
      body.countryId ||
      body.country_id ||
      null;

    const serviceId =
      body.serviceId ||
      body.service_id ||
      body.providerServiceId ||
      body.provider_service_id ||
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
        error: "Country ID is required."
      });
    }

    if (!serviceId && !serviceName) {
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

    /* Find the admin-configured selling price. */
    const price =
      await getPriceConfiguration({
        priceId,
        countryId,
        serviceId,
        serviceName,
        providerServer
      });

    /*
     * Always use the configured provider service ID.
     * This prevents "wa" from being treated as a UUID.
     */
    const actualServiceId =
      price.provider_service_id ||
      serviceId;

    const actualCountryId =
      price.country_id ||
      countryId;

    const actualServiceName =
      price.service_name ||
      serviceName;

    let providerCost =
      number(price.provider_price);

    let providerPriceId =
      null;

    /*
     * Global Server 2 has a separate /price endpoint.
     */
    if (
      providerServer.toLowerCase() ===
      "global-server-2"
    ) {
      const providerPrice =
        await getGlobalServer2ProviderPrice(
          actualServiceId,
          actualServiceName
        );

      providerCost =
        providerPrice.providerPrice;

      providerPriceId =
        providerPrice.providerPriceId;
    }

    /*
     * The selling price comes from product_prices.
     */
    const customerPrice =
      number(price.selling_price);

    if (customerPrice <= 0) {
      return res.status(400).json({
        success: false,
        error:
          "Selling price is not configured."
      });
    }

    /* Check wallet before purchasing. */
    const walletData =
      await getWallet(user.id);

    const balanceBefore =
      number(walletData.balance);

    if (balanceBefore < customerPrice) {
      return res.status(400).json({
        success: false,
        error: "Insufficient wallet balance.",
        balance: balanceBefore,
        required: customerPrice
      });
    }

    /*
     * Purchase the number from the provider.
     */
    const providerResponse =
      await purchaseNumber({
        server: providerServer,
        countryId: actualCountryId,
        serviceId: actualServiceId,
        serviceName: actualServiceName,
        providerPriceId
      });

    const verification =
      extractVerification(
        providerResponse
      );

    if (!verification.phoneNumber) {
      throw new Error(
        "Provider purchased the number but did not return a phone number."
      );
    }

    if (!verification.providerOrderId) {
      throw new Error(
        "Provider purchased the number but did not return a request/order ID."
      );
    }

    /*
     * Deduct customer selling price.
     */
    const balanceAfter =
      balanceBefore - customerPrice;

    await updateWallet(
      user.id,
      balanceAfter
    );

    /*
     * Record wallet transaction.
     */
    await createWalletTransaction({
      userId: user.id,
      amount: customerPrice,
      balanceBefore,
      balanceAfter,
      description:
        `Number purchase - ${actualServiceName} - ${price.country_name || countryId}`
    });

    /*
     * Record order.
     */
    const order =
      await createOrder({
        userId: user.id,
        providerOrderId:
          verification.providerOrderId,
        price,
        providerCost,
        customerPrice,
        phoneNumber:
          verification.phoneNumber,
        status:
          verification.status || "active"
      });

    return res.status(200).json({
      success: true,
      message:
        "Number purchased successfully.",
      order,
      verification: {
        request_id:
          verification.providerOrderId,
        number:
          verification.phoneNumber,
        service:
          actualServiceName,
        status:
          verification.status,
        provider_server:
          providerServer
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
      success: false,
      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}

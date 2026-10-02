// api/order.js

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

function clean(value) {
  return String(value ?? "").trim();
}

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function serverName(value) {
  const v = clean(value).toLowerCase();

  if (["usa-server-1", "us-server-1", "usa1", "us1"].includes(v))
    return "usa-server-1";

  if (["usa-server-2", "us-server-2", "usa2", "us2"].includes(v))
    return "usa-server-2";

  if (["global-server-1", "global1", "global-server1"].includes(v))
    return "global-server-1";

  if (["global-server-2", "global2", "global-server2"].includes(v))
    return "global-server-2";

  return v;
}

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

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        text ||
        `Supabase HTTP ${response.status}`
    );
  }

  return data;
}

async function sure(path, options = {}) {
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

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        data?.error ||
        text ||
        `SureVerification HTTP ${response.status}`
    );

    error.status = response.status;
    error.providerData = data;

    throw error;
  }

  return data;
}

async function getUser(token) {
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

  const data =
    await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error(
      "Invalid or expired authentication session."
    );
  }

  return data;
}

async function getPrice({
  priceId,
  countryId,
  serviceId,
  serviceName,
  providerServer
}) {
  let rows = [];

  /*
   * If the frontend sends the UUID price ID,
   * use it directly.
   */
  if (isUUID(priceId)) {
    rows = await supabase(
      `product_prices?id=eq.${encode(priceId)}&select=*`
    );
  }

  /*
   * Otherwise find by provider service ID.
   * Example: wa
   */
  if (!rows.length && serviceId) {
    let path =
      `product_prices?provider_service_id=eq.${encode(
        serviceId
      )}` +
      `&select=*`;

    if (countryId) {
      path +=
        `&country_id=eq.${encode(countryId)}`;
    }

    rows = await supabase(path);
  }

  /*
   * Fallback to service name.
   */
  if (!rows.length && serviceName) {
    let path =
      `product_prices?service_name=ilike.${encode(
        serviceName
      )}` +
      `&select=*`;

    if (countryId) {
      path +=
        `&country_id=eq.${encode(countryId)}`;
    }

    rows = await supabase(path);
  }

  if (!rows.length) {
    throw new Error(
      "No matching product price was found."
    );
  }

  const wantedServer =
    serverName(providerServer);

  let row = rows.find(
    (item) =>
      serverName(item.provider_server) ===
      wantedServer
  );

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

async function providerServices(
  server,
  providerCountryId
) {
  if (!providerCountryId) {
    throw new Error(
      "Provider country ID is missing."
    );
  }

  return await sure(
    `/${server}/services?country_id=${encode(
      providerCountryId
    )}`,
    {
      method: "GET"
    }
  );
}

function serviceMatches(
  service,
  serviceId,
  serviceName
) {
  const wantedId =
    clean(serviceId).toLowerCase();

  const wantedName =
    clean(serviceName).toLowerCase();

  const id =
    clean(
      service?.id ||
        service?.service_id ||
        service?.code
    ).toLowerCase();

  const name =
    clean(
      service?.name ||
        service?.service_name
    ).toLowerCase();

  return (
    (wantedId && id === wantedId) ||
    (wantedName && name === wantedName)
  );
}

async function global2Price(
  serviceId,
  serviceName
) {
  const result = await sure(
    "/global-server-2/price",
    {
      method: "GET"
    }
  );

  const prices = Array.isArray(result?.prices)
    ? result.prices
    : [];

  const matches = prices.filter(
    (item) =>
      serviceMatches(
        item?.service || {},
        serviceId,
        serviceName
      )
  );

  const available = matches.filter(
    (item) =>
      num(item?.service?.stocks) > 0
  );

  if (!available.length) {
    throw new Error(
      "No available price tier was found for this service on Global Server 2."
    );
  }

  return available[0];
}

async function purchase({
  server,
  providerCountryId,
  serviceId,
  serviceName
}) {
  /*
   * GLOBAL SERVER 2
   */
  if (server === "global-server-2") {
    const tier =
      await global2Price(
        serviceId,
        serviceName
      );

    const tierId = tier?.id;

    let lastError = null;

    /*
     * Attempt 1
     */
    try {
      const result = await sure(
        `/global-server-2/purchase?country_id=${encode(
          providerCountryId
        )}&service=${encode(
          serviceId
        )}&id=${encode(tierId)}`,
        {
          method: "POST"
        }
      );

      return {
        result,
        providerCost:
          num(tier?.price)
      };
    } catch (error) {
      lastError = error;
    }

    /*
     * Attempt 2
     */
    try {
      const result = await sure(
        "/global-server-2/purchase",
        {
          method: "POST",
          body: JSON.stringify({
            country_id:
              providerCountryId,
            service: serviceId,
            id: tierId
          })
        }
      );

      return {
        result,
        providerCost:
          num(tier?.price)
      };
    } catch (error) {
      lastError = error;
    }

    throw (
      lastError ||
      new Error(
        "Global Server 2 purchase failed."
      )
    );
  }

  /*
   * USA SERVER 1
   * USA SERVER 2
   * GLOBAL SERVER 1
   */
  const result = await sure(
    `/${server}/purchase?country_id=${encode(
      providerCountryId
    )}&service=${encode(serviceId)}`,
    {
      method: "POST"
    }
  );

  return {
    result,
    providerCost: 0
  };
}

function extract(result) {
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
    phone: phone
      ? String(phone)
      : null,
    providerOrderId:
      providerOrderId !== null
        ? String(providerOrderId)
        : null,
    status: String(status)
  };
}

async function wallet(userId) {
  const rows = await supabase(
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
  const rows = await supabase(
    `wallets?id=eq.${encode(walletId)}`,
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
      "Unable to update wallet balance."
    );
  }

  return rows[0];
}

async function transaction({
  userId,
  walletId,
  amount,
  before,
  after,
  orderId,
  description,
  type
}) {
  try {
    await supabase(
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
          balance_before: before,
          balance_after: after,
          type,
          description,
          reference: orderId || null
        })
      }
    );
  } catch (error) {
    console.error(
      "Wallet transaction error:",
      error.message
    );
  }
}

async function refund({
  walletData,
  amount,
  userId,
  reason
}) {
  const before =
    num(walletData.balance);

  const after =
    before + amount;

  await updateWallet(
    walletData.id,
    after
  );

  await transaction({
    userId,
    walletId: walletData.id,
    amount,
    before,
    after,
    description: reason,
    type: "refund"
  });
}

async function createOrder(data) {
  const rows = await supabase(
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

    /*
     * Authentication
     */
    const auth =
      req.headers?.authorization ||
      req.headers?.Authorization ||
      "";

    const token = auth
      .replace(/^Bearer\s+/i, "")
      .trim();

    const user =
      await getUser(token);

    const userId = user.id;

    const body =
      req.body &&
      typeof req.body === "object"
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
          body.provider_country_id
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
      return res.status(400).json({
        success: false,
        error:
          "Country information is required."
      });
    }

    if (!serviceId && !serviceName) {
      return res.status(400).json({
        success: false,
        error:
          "Service information is required."
      });
    }

    if (!requestedServer) {
      return res.status(400).json({
        success: false,
        error:
          "Provider server is required."
      });
    }

    const server =
      serverName(requestedServer);

    const allowed = [
      "usa-server-1",
      "usa-server-2",
      "global-server-1",
      "global-server-2"
    ];

    if (!allowed.includes(server)) {
      return res.status(400).json({
        success: false,
        error:
          `Unsupported provider server: ${server}`
      });
    }

    /*
     * Get configured price.
     */
    const priceRow =
      await getPrice({
        priceId,
        countryId,
        serviceId,
        serviceName,
        providerServer: server
      });

    /*
     * IMPORTANT:
     *
     * Your database already stores the provider
     * country ID inside product_prices.country_id.
     *
     * Example:
     * United States = 236
     *
     * Therefore country_id is used directly here.
     */
    const actualProviderCountryId =
      clean(
        providerCountryId ||
          priceRow.country_id
      );

    if (!actualProviderCountryId) {
      return res.status(400).json({
        success: false,
        error:
          "Provider country ID is missing from the price configuration."
      });
    }

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
      return res.status(400).json({
        success: false,
        error:
          "Provider service ID is missing."
      });
    }

    /*
     * Confirm service exists for the country.
     */
    const services =
      await providerServices(
        server,
        actualProviderCountryId
      );

    const serviceList =
      Array.isArray(services?.services)
        ? services.services
        : [];

    if (serviceList.length) {
      const exists =
        serviceList.some(
          (service) =>
            serviceMatches(
              service,
              actualServiceId,
              actualServiceName
            )
        );

      if (!exists) {
        return res.status(400).json({
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
      num(
        priceRow.selling_price
      );

    if (customerPrice <= 0) {
      return res.status(400).json({
        success: false,
        error:
          "Selling price is not configured for this service."
      });
    }

    /*
     * Wallet.
     */
    const walletData =
      await wallet(userId);

    const before =
      num(walletData.balance);

    if (before < customerPrice) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance: before,
        required: customerPrice
      });
    }

    const after =
      before - customerPrice;

    /*
     * Deduct wallet.
     */
    await updateWallet(
      walletData.id,
      after
    );

    let purchased;

    try {
      purchased =
        await purchase({
          server,
          providerCountryId:
            actualProviderCountryId,
          serviceId: actualServiceId,
          serviceName:
            actualServiceName
        });
    } catch (error) {
      await refund({
        walletData,
        amount: customerPrice,
        userId,
        reason:
          `Number purchase failed on ${server}: ${error.message}`
      });

      console.error(
        "Provider purchase error:",
        error
      );

      return res.status(502).json({
        success: false,
        error:
          error?.message ||
          "Provider purchase failed.",
        server,
        provider_status:
          error?.status || null,
        provider_response:
          error?.providerData || null,
        refunded: true
      });
    }

    const data =
      extract(purchased.result);

    if (!data.phone) {
      await refund({
        walletData,
        amount: customerPrice,
        userId,
        reason:
          `Provider returned no phone number on ${server}.`
      });

      return res.status(502).json({
        success: false,
        error:
          "Provider did not return a phone number.",
        provider_response:
          purchased.result,
        refunded: true
      });
    }

    const providerCost =
      num(purchased.providerCost);

    const profit =
      customerPrice - providerCost;

    /*
     * Save order.
     */
    let order;

    try {
      order =
        await createOrder({
          user_id: userId,
          provider_order_id:
            data.providerOrderId,
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
            data.status || "active",
          phone_number:
            data.phone
        });
    } catch (error) {
      await refund({
        walletData,
        amount: customerPrice,
        userId,
        reason:
          `Order record failed: ${error.message}`
      });

      return res.status(500).json({
        success: false,
        error:
          "The number was purchased but the order could not be recorded. Your wallet has been refunded.",
        refunded: true
      });
    }

    /*
     * Transaction history.
     */
    await transaction({
      userId,
      walletId: walletData.id,
      amount: -customerPrice,
      before,
      after,
      orderId: order?.id || null,
      description:
        `Purchased ${
          actualServiceName ||
          actualServiceId
        } number from ${server}`,
      type: "purchase"
    });

    return res.status(200).json({
      success: true,
      server,
      order,
      number: data.phone,
      phone_number: data.phone,
      provider_order_id:
        data.providerOrderId,
      status: data.status,
      customer_price:
        customerPrice,
      provider_cost:
        providerCost,
      profit,
      balance: after,
      verification:
        data.verification,
      provider_response:
        purchased.result
    });
  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "A server error occurred."
    });
  }
}

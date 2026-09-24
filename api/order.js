import {
  sureVerificationRequest,
  getServersForCountry
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbJHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function token(req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  return auth.slice(7).trim();
}

async function user(req) {
  const accessToken = token(req);

  if (!accessToken) {
    return null;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

async function db(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer:
        options.prefer ||
        "return=representation"
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {})
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Database returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.details ||
        `Database request failed (HTTP ${response.status}).`
    );
  }

  return data;
}

function enc(value) {
  return encodeURIComponent(String(value ?? ""));
}

function usa(countryId, countryCode, countryName) {
  const id = String(countryId || "").trim().toLowerCase();
  const code = String(countryCode || "").trim().toLowerCase();
  const name = String(countryName || "").trim().toLowerCase();

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

function verification(result) {
  return result?.verification || result?.data?.verification || null;
}

function numberFromResult(result) {
  const v = verification(result);

  return (
    v?.number ||
    result?.number ||
    result?.phone ||
    result?.data?.number ||
    null
  );
}

function requestIdFromResult(result) {
  const v = verification(result);

  return (
    v?.request_id ||
    v?.verification_id ||
    v?.id ||
    result?.request_id ||
    result?.verification_id ||
    result?.id ||
    null
  );
}

function providerCostFromResult(result) {
  const v = verification(result);

  const value =
    v?.price ??
    v?.cost ??
    result?.price ??
    result?.cost ??
    result?.amount ??
    null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function serviceIdFromResult(result) {
  const v = verification(result);

  return (
    v?.service_id ||
    v?.service ||
    result?.service_id ||
    result?.service ||
    null
  );
}

function serviceNameFromResult(result) {
  const v = verification(result);

  return (
    v?.service_name ||
    v?.service ||
    result?.service_name ||
    result?.service ||
    null
  );
}

function getServices(result) {
  return (
    result?.services ||
    result?.data?.services ||
    []
  );
}

async function providerService(
  server,
  countryId,
  requestedId,
  requestedName
) {
  const result = await sureVerificationRequest(
    `/${server}/services?country_id=${enc(countryId)}`
  );

  const services = getServices(result);

  if (!Array.isArray(services) || services.length === 0) {
    throw new Error(
      `No services returned by ${server}.`
    );
  }

  const wantedId = String(requestedId || "")
    .trim()
    .toLowerCase();

  const wantedName = String(requestedName || "")
    .trim()
    .toLowerCase();

  let match = null;

  if (wantedId) {
    match = services.find(
      item =>
        String(item?.id || "")
          .trim()
          .toLowerCase() === wantedId
    );
  }

  if (!match && wantedName) {
    match = services.find(
      item =>
        String(item?.name || "")
          .trim()
          .toLowerCase() === wantedName
    );
  }

  if (!match && wantedName) {
    match = services.find(item => {
      const name = String(item?.name || "")
        .trim()
        .toLowerCase();

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  if (!match) {
    throw new Error(
      `Service "${requestedName || requestedId}" is not available on ${server}.`
    );
  }

  return match;
}

async function debitWallet(userId, amount) {
  const rows = await db(
    `profiles?id=eq.${enc(userId)}&select=id,balance,wallet_balance`,
    {
      method: "GET"
    }
  );

  const profile = Array.isArray(rows) ? rows[0] : null;

  if (!profile) {
    throw new Error("Customer profile not found.");
  }

  const currentBalance = Number(
    profile.wallet_balance ??
      profile.balance ??
      0
  );

  if (!Number.isFinite(currentBalance)) {
    throw new Error("Invalid wallet balance.");
  }

  if (currentBalance < amount) {
    throw new Error("Insufficient wallet balance.");
  }

  const newBalance = currentBalance - amount;

  const update = {};

  if (
    Object.prototype.hasOwnProperty.call(
      profile,
      "wallet_balance"
    )
  ) {
    update.wallet_balance = newBalance;
  } else {
    update.balance = newBalance;
  }

  await db(`profiles?id=eq.${enc(userId)}`, {
    method: "PATCH",
    body: update
  });

  return {
    oldBalance: currentBalance,
    newBalance
  };
}

async function refundWallet(userId, amount) {
  if (!amount || amount <= 0) {
    return;
  }

  const rows = await db(
    `profiles?id=eq.${enc(userId)}&select=id,balance,wallet_balance`,
    {
      method: "GET"
    }
  );

  const profile = Array.isArray(rows) ? rows[0] : null;

  if (!profile) {
    return;
  }

  const currentBalance = Number(
    profile.wallet_balance ??
      profile.balance ??
      0
  );

  const newBalance = currentBalance + amount;

  const update = {};

  if (
    Object.prototype.hasOwnProperty.call(
      profile,
      "wallet_balance"
    )
  ) {
    update.wallet_balance = newBalance;
  } else {
    update.balance = newBalance;
  }

  await db(`profiles?id=eq.${enc(userId)}`, {
    method: "PATCH",
    body: update
  });
}

async function createOrder(data) {
  const order = {
    user_id: data.userId,
    provider_order_id: data.providerOrderId,
    verification_id: data.verificationId,
    country_id: data.countryId,
    country_code: data.countryCode,
    country_name: data.countryName,
    service: data.serviceName,
    service_id: data.serviceId,
    phone_number: data.phone,
    provider: data.provider,
    provider_cost: data.providerCost,
    customer_price: data.customerPrice,
    profit: data.profit,
    status: "active"
  };

  return await db("orders", {
    method: "POST",
    body: order
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    /*
     * KEEP AUTHENTICATION FLOW
     */
    const currentUser = await user(req);

    if (!currentUser?.id) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const body = req.body || {};

    const countryId =
      body.country_id ??
      body.countryId ??
      body.country?.id ??
      "";

    const countryCode =
      body.country_code ??
      body.countryCode ??
      body.country?.code ??
      "";

    const countryName =
      body.country_name ??
      body.countryName ??
      body.country?.name ??
      "";

    const serviceId =
      body.service_id ??
      body.serviceId ??
      body.service?.id ??
      "";

    const serviceName =
      body.service_name ??
      body.serviceName ??
      body.service?.name ??
      "";

    if (!countryId && !countryName) {
      return res.status(400).json({
        error: "Country is required."
      });
    }

    if (!serviceId && !serviceName) {
      return res.status(400).json({
        error: "Service is required."
      });
    }

    /*
     * FIND CUSTOMER SELLING PRICE
     */
    let prices = await db(
      `product_prices?country_id=eq.${enc(countryId)}&service_id=eq.${enc(serviceId)}&select=*`,
      {
        method: "GET"
      }
    );

    if (!Array.isArray(prices) || prices.length === 0) {
      prices = await db(
        `product_prices?country_id=eq.${enc(countryId)}&select=*`,
        {
          method: "GET"
        }
      );
    }

    let priceRow = null;

    if (Array.isArray(prices)) {
      priceRow =
        prices.find(row => {
          const rowServiceId = String(
            row?.service_id || ""
          ).toLowerCase();

          const rowServiceName = String(
            row?.service_name ||
              row?.service ||
              ""
          ).toLowerCase();

          return (
            (serviceId &&
              rowServiceId ===
                String(serviceId).toLowerCase()) ||
            (serviceName &&
              rowServiceName ===
                String(serviceName).toLowerCase())
          );
        }) || prices[0];
    }

    const sellingPrice = Number(
      priceRow?.selling_price ??
        priceRow?.price ??
        priceRow?.customer_price ??
        0
    );

    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      return res.status(400).json({
        error: "Price not available for this service."
      });
    }

    /*
     * PROVIDER ROUTING
     *
     * USA  -> USA SERVER 2
     * OTHER COUNTRIES -> GLOBAL SERVER 2
     */
    const isUnitedStates = usa(
      countryId,
      countryCode,
      countryName
    );

    const servers = isUnitedStates
      ? ["usa-server-2"]
      : ["global-server-2"];

    /*
     * DEBIT CUSTOMER FIRST
     */
    let wallet;

    try {
      wallet = await debitWallet(
        currentUser.id,
        sellingPrice
      );
    } catch (error) {
      return res.status(400).json({
        error:
          error?.message ||
          "Unable to debit wallet."
      });
    }

    let successfulResult = null;
    let selectedProviderService = null;
    let selectedServer = null;

    try {
      for (const server of servers) {
        try {
          /*
           * USA SERVER 2
           *
           * It requires:
           * country_id
           * provider service ID
           */
          if (server === "usa-server-2") {
            selectedProviderService =
              await providerService(
                server,
                countryId,
                serviceId,
                serviceName
              );

            const providerServiceId =
              selectedProviderService?.id;

            if (!providerServiceId) {
              throw new Error(
                "USA Server 2 did not return a valid service ID."
              );
            }

            successfulResult =
              await sureVerificationRequest(
                `/usa-server-2/purchase?country_id=${enc(
                  countryId
                )}&service=${enc(
                  providerServiceId
                )}`,
                {
                  method: "POST"
                }
              );

            selectedServer = server;

            break;
          }

          /*
           * GLOBAL SERVER 2
           *
           * IMPORTANT:
           * Do NOT send country_id or service
           * to this purchase endpoint.
           */
          if (server === "global-server-2") {
            successfulResult =
              await sureVerificationRequest(
                "/global-server-2/purchase",
                {
                  method: "POST"
                }
              );

            selectedServer = server;

            break;
          }
        } catch (providerError) {
          console.error(
            `${server} purchase failed:`,
            providerError?.message
          );
        }
      }

      if (!successfulResult) {
        throw new Error(
          "No number is currently available from the provider."
        );
      }

      const phone =
        numberFromResult(successfulResult);

      const verificationId =
        requestIdFromResult(successfulResult);

      if (!phone) {
        throw new Error(
          "Provider did not return a phone number."
        );
      }

      if (!verificationId) {
        throw new Error(
          "Provider did not return a verification ID."
        );
      }

      const providerServiceId =
        selectedProviderService?.id ||
        serviceIdFromResult(
          successfulResult
        ) ||
        serviceId;

      const providerServiceName =
        selectedProviderService?.name ||
        serviceNameFromResult(
          successfulResult
        ) ||
        serviceName;

      const providerCost =
        providerCostFromResult(
          successfulResult
        );

      const profit =
        sellingPrice - providerCost;

      /*
       * SAVE ORDER
       */
      let savedOrder;

      try {
        savedOrder = await createOrder({
          userId: currentUser.id,
          providerOrderId: verificationId,
          verificationId,
          countryId,
          countryCode,
          countryName,
          serviceName:
            providerServiceName || serviceName,
          serviceId:
            providerServiceId || serviceId,
          phone,
          provider: selectedServer,
          providerCost,
          customerPrice: sellingPrice,
          profit
        });
      } catch (saveError) {
        /*
         * If provider succeeded but database save fails,
         * refund the customer rather than charging them
         * without an order.
         */
        await refundWallet(
          currentUser.id,
          sellingPrice
        );

        throw new Error(
          saveError?.message ||
            "Unable to save purchased number."
        );
      }

      return res.status(200).json({
        success: true,
        message: "Number purchased successfully.",
        order: Array.isArray(savedOrder)
          ? savedOrder[0]
          : savedOrder,
        provider: selectedServer,
        provider_service_id:
          providerServiceId || null,
        provider_service_name:
          providerServiceName || null,
        number: phone,
        phone,
        verification_id: verificationId,
        request_id: verificationId,
        provider_cost: providerCost,
        selling_price: sellingPrice,
        profit,
        balance: wallet.newBalance
      });
    } catch (providerError) {
      /*
       * PROVIDER FAILED -> REFUND CUSTOMER
       */
      await refundWallet(
        currentUser.id,
        sellingPrice
      );

      return res.status(400).json({
        error:
          providerError?.message ||
          "Unable to purchase number."
      });
    }
  } catch (error) {
    console.error("ORDER API ERROR:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Internal server error."
    });
  }
}

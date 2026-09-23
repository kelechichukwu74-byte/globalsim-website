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
  const auth =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  return auth.slice(7).trim();
}

async function user(req) {
  const accessToken = token(req);

  if (!accessToken) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    throw new Error("Unauthorized");
  }

  return await response.json();
}

function db(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

function enc(value) {
  return encodeURIComponent(String(value ?? ""));
}

function usa(countryId, countryCode, countryName) {
  const id = String(countryId ?? "").trim().toLowerCase();
  const code = String(countryCode ?? "").trim().toLowerCase();
  const name = String(countryName ?? "").trim().toLowerCase();

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

function verification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.order ||
    data?.data?.order ||
    data?.result ||
    data?.data ||
    data
  );
}

function number(data) {
  const v = verification(data);

  return (
    v?.phone_number ||
    v?.phone ||
    v?.number ||
    v?.msisdn ||
    data?.phone_number ||
    data?.phone ||
    data?.number ||
    data?.msisdn ||
    null
  );
}

function verificationId(data) {
  const v = verification(data);

  return (
    v?.verification_id ||
    v?.verificationId ||
    v?.verificationID ||
    v?.id ||
    v?.request_id ||
    v?.requestId ||
    data?.verification_id ||
    data?.verificationId ||
    data?.id ||
    data?.request_id ||
    data?.requestId ||
    null
  );
}

function requestId(data) {
  return (
    data?.request_id ||
    data?.requestId ||
    data?.verification_id ||
    data?.verificationId ||
    data?.id ||
    null
  );
}

function providerCost(data) {
  const v = verification(data);

  const value =
    v?.price ??
    v?.cost ??
    v?.amount ??
    data?.price ??
    data?.cost ??
    data?.amount ??
    0;

  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}

function services(data) {
  return (
    data?.services ||
    data?.data?.services ||
    data?.result?.services ||
    []
  );
}

function serviceId(item) {
  return (
    item?.id ||
    item?.service_id ||
    item?.serviceId ||
    item?.code ||
    null
  );
}

function serviceName(item) {
  return (
    item?.name ||
    item?.service_name ||
    item?.serviceName ||
    item?.title ||
    ""
  );
}

async function providerService(
  server,
  countryId,
  requestedId,
  requestedName
) {
  const data = await sureVerificationRequest(
    `/${server}/services?country_id=${enc(countryId)}`
  );

  const list = services(data);

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `No services returned by ${server} for country ${countryId}.`
    );
  }

  const wantedId = String(requestedId ?? "")
    .trim()
    .toLowerCase();

  const wantedName = String(requestedName ?? "")
    .trim()
    .toLowerCase();

  let match = null;

  if (wantedId) {
    match = list.find(
      item =>
        String(serviceId(item) ?? "")
          .trim()
          .toLowerCase() === wantedId
    );
  }

  if (!match && wantedName) {
    match = list.find(
      item =>
        String(serviceName(item) ?? "")
          .trim()
          .toLowerCase() === wantedName
    );
  }

  if (!match && wantedName) {
    match = list.find(item =>
      String(serviceName(item) ?? "")
        .trim()
        .toLowerCase()
        .includes(wantedName)
    );
  }

  if (!match) {
    throw new Error(
      `Service "${requestedName || requestedId}" is not available on ${server}.`
    );
  }

  const id = serviceId(match);

  if (!id) {
    throw new Error(
      `Provider service ID is missing on ${server}.`
    );
  }

  return {
    id,
    name: serviceName(match)
  };
}

async function getPrice(countryId, serviceIdValue, serviceNameValue) {
  let response = await db(
    `product_prices?country_id=eq.${enc(countryId)}&service_id=eq.${enc(
      serviceIdValue
    )}&select=*`
  );

  if (response.ok) {
    const rows = await response.json();

    if (Array.isArray(rows) && rows.length > 0) {
      return rows[0];
    }
  }

  if (serviceNameValue) {
    response = await db(
      `product_prices?country_id=eq.${enc(
        countryId
      )}&service_name=ilike.${enc(serviceNameValue)}&select=*`
    );

    if (response.ok) {
      const rows = await response.json();

      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0];
      }
    }
  }

  return null;
}

async function walletBalance(userId) {
  const response = await db(
    `profiles?id=eq.${enc(userId)}&select=balance`
  );

  if (!response.ok) {
    throw new Error("Unable to read wallet balance.");
  }

  const rows = await response.json();

  if (!rows.length) {
    throw new Error("User profile not found.");
  }

  return Number(rows[0].balance || 0);
}

async function debitWallet(userId, amount) {
  const balance = await walletBalance(userId);

  if (balance < amount) {
    throw new Error("Insufficient wallet balance.");
  }

  const newBalance = balance - amount;

  const response = await db(
    `profiles?id=eq.${enc(userId)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        balance: newBalance
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "Unable to debit wallet."
    );
  }

  return newBalance;
}

async function refundWallet(userId, amount) {
  const balance = await walletBalance(userId);
  const newBalance = balance + amount;

  const response = await db(
    `profiles?id=eq.${enc(userId)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        balance: newBalance
      })
    }
  );

  if (!response.ok) {
    throw new Error("Unable to refund wallet.");
  }

  return newBalance;
}

async function createOrder({
  userId,
  countryId,
  countryCode,
  countryName,
  serviceId: internalServiceId,
  serviceName: internalServiceName,
  providerServer,
  providerServiceId,
  providerServiceName,
  providerOrderId,
  verificationId: providerVerificationId,
  phone,
  providerCost: cost,
  sellingPrice
}) {
  const profit = Number(sellingPrice) - Number(cost);

  const payload = {
    user_id: userId,
    country_id: String(countryId),
    country_code: countryCode || null,
    country_name: countryName || null,
    service_id: internalServiceId || null,
    service_name: internalServiceName || null,
    provider_server: providerServer,
    provider_service_id: providerServiceId || null,
    provider_service_name: providerServiceName || null,
    provider_order_id: providerOrderId || null,
    verification_id: providerVerificationId || null,
    phone_number: phone || null,
    provider_cost: Number(cost || 0),
    selling_price: Number(sellingPrice || 0),
    profit: Number(profit || 0),
    status: "active"
  };

  const response = await db(
    "orders",
    {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "Unable to save order."
    );
  }

  const rows = await response.json();

  return Array.isArray(rows) ? rows[0] : rows;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    /*
     * KEEPING THE ORIGINAL AUTHENTICATION FLOW
     */
    const currentUser = await user(req);

    if (!currentUser?.id) {
      throw new Error("Unauthorized");
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const countryId =
      body.country_id ??
      body.countryId ??
      body.country;

    const countryCode =
      body.country_code ??
      body.countryCode ??
      "";

    const countryName =
      body.country_name ??
      body.countryName ??
      "";

    const internalServiceId =
      body.service_id ??
      body.serviceId ??
      body.service;

    const serviceNameValue =
      body.service_name ??
      body.serviceName ??
      "";

    if (!countryId) {
      return res.status(400).json({
        error: "Country is required."
      });
    }

    if (!internalServiceId && !serviceNameValue) {
      return res.status(400).json({
        error: "Service is required."
      });
    }

    /*
     * GET THE CUSTOMER SELLING PRICE
     */
    const priceRow = await getPrice(
      countryId,
      internalServiceId,
      serviceNameValue
    );

    if (!priceRow) {
      return res.status(400).json({
        error: "Price not available for this country/service."
      });
    }

    const sellingPrice = Number(
      priceRow.selling_price ??
      priceRow.price ??
      priceRow.amount ??
      0
    );

    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      return res.status(400).json({
        error: "Price not available for this country/service."
      });
    }

    /*
     * ============================================================
     * PROVIDER ROUTING
     * ============================================================
     *
     * USA:
     *   Portal 2 / USA Server 2 ONLY
     *
     * Other countries:
     *   Global Server 2 first
     *   Global Server 1 as fallback
     */
    const isUnitedStates = usa(
      countryId,
      countryCode,
      countryName
    );

    let servers;

    if (isUnitedStates) {
      servers = ["usa-server-2"];
    } else {
      servers = getServersForCountry(countryName);

      if (
        !Array.isArray(servers) ||
        servers.length === 0
      ) {
        servers = [
          "global-server-2",
          "global-server-1"
        ];
      }
    }

    /*
     * Make absolutely sure USA never falls through to a global portal.
     */
    if (isUnitedStates) {
      servers = ["usa-server-2"];
    }

    /*
     * Check wallet BEFORE contacting provider.
     */
    const startingBalance =
      await walletBalance(currentUser.id);

    if (startingBalance < sellingPrice) {
      return res.status(400).json({
        error: "Insufficient wallet balance.",
        balance: startingBalance,
        required: sellingPrice
      });
    }

    await debitWallet(
      currentUser.id,
      sellingPrice
    );

    let lastError = null;

    try {
      for (const server of servers) {
        try {
          /*
           * Get the correct service ID from the selected portal.
           *
           * Important:
           * Global Server 2 may use:
           *   Whatsapp -> wa
           *
           * USA Server 2 may use:
           *   Whatsapp -> 69c05c2e27c5759c68a8135e
           *
           * Therefore we DO NOT hard-code the service ID.
           */
          const selectedProviderService =
            await providerService(
              server,
              countryId,
              internalServiceId,
              serviceNameValue
            );

          /*
           * Purchase from the selected provider portal.
           *
           * USA -> usa-server-2
           * Other countries -> global servers
           */
          const purchasePath =
            `/${server}/purchase` +
            `?country_id=${enc(countryId)}` +
            `&service=${enc(
              selectedProviderService.id
            )}`;

          const result =
            await sureVerificationRequest(
              purchasePath,
              {
                method: "POST"
              }
            );

          const phone = number(result);

          const providerVerificationId =
            verificationId(result);

          const providerRequestId =
            requestId(result);

          if (!phone) {
            throw new Error(
              `${server} did not return a phone number.`
            );
          }

          if (
            !providerVerificationId &&
            !providerRequestId
          ) {
            throw new Error(
              `${server} did not return a verification ID.`
            );
          }

          const finalVerificationId =
            providerVerificationId ||
            providerRequestId;

          const cost =
            providerCost(result);

          const savedOrder =
            await createOrder({
              userId: currentUser.id,
              countryId,
              countryCode,
              countryName,
              serviceId: internalServiceId,
              serviceName: serviceNameValue,
              providerServer: server,
              providerServiceId:
                selectedProviderService.id,
              providerServiceName:
                selectedProviderService.name,
              providerOrderId:
                providerRequestId,
              verificationId:
                finalVerificationId,
              phone,
              providerCost: cost,
              sellingPrice
            });

          const balanceAfter =
            await walletBalance(
              currentUser.id
            );

          return res.status(200).json({
            success: true,
            order: savedOrder,
            server,
            provider_server: server,
            provider_service_id:
              selectedProviderService.id,
            provider_service_name:
              selectedProviderService.name,
            phone,
            number: phone,
            verification_id:
              finalVerificationId,
            balance: balanceAfter
          });
        } catch (error) {
          lastError =
            error instanceof Error
              ? error.message
              : String(error);

          /*
           * USA has ONLY Portal 2.
           * Do not silently send a USA purchase
           * to another portal.
           */
          if (isUnitedStates) {
            break;
          }
        }
      }

      throw new Error(
        lastError ||
          "Unable to purchase number."
      );
    } catch (providerError) {
      /*
       * Provider purchase failed:
       * return customer's money.
       */
      try {
        await refundWallet(
          currentUser.id,
          sellingPrice
        );
      } catch {
        // Keep original provider error.
      }

      throw providerError;
    }
  } catch (error) {
    console.error("ORDER ERROR:", error);

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    if (
      message === "Unauthorized" ||
      message.toLowerCase().includes("unauthorized")
    ) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    return res.status(400).json({
      error: message || "Unable to purchase number."
    });
  }
}

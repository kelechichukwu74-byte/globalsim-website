// api/order.js

import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

function isUUID(value) {
  return UUID_RE.test(String(value || "").trim());
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

  const data =
    await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Supabase returned HTTP ${response.status}.`
    );
  }

  return data;
}

function getServiceId(body) {
  return String(
    body.providerServiceId ??
    body.provider_service_id ??
    body.serviceId ??
    body.service_id ??
    body.serviceCode ??
    body.service_code ??
    ""
  ).trim();
}

function getServiceName(body) {
  return String(
    body.serviceName ??
    body.service_name ??
    ""
  ).trim();
}

function getCountryName(body) {
  return String(
    body.countryName ??
    body.country_name ??
    ""
  ).trim();
}

function getProviderServer(body) {
  return String(
    body.providerServer ??
    body.provider_server ??
    ""
  ).trim();
}

function getProviderCountryId(body) {
  return String(
    body.providerCountryId ??
    body.provider_country_id ??
    body.countryId ??
    body.country_id ??
    ""
  ).trim();
}

function extractPhone(data) {
  return (
    data?.phone_number ||
    data?.phoneNumber ||
    data?.number ||
    data?.phone ||
    data?.tel ||
    data?.data?.phone_number ||
    data?.data?.phoneNumber ||
    data?.data?.number ||
    data?.data?.phone ||
    null
  );
}

function extractVerificationId(data) {
  return (
    data?.id ||
    data?.activation_id ||
    data?.activationId ||
    data?.order_id ||
    data?.orderId ||
    data?.data?.id ||
    data?.data?.activation_id ||
    data?.data?.activationId ||
    data?.data?.order_id ||
    data?.data?.orderId ||
    null
  );
}

function extractProviderPrice(data) {
  const value =
    data?.price ??
    data?.cost ??
    data?.amount ??
    data?.data?.price ??
    data?.data?.cost ??
    data?.data?.amount;

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function extractExpiry(data) {
  return (
    data?.expires_at ||
    data?.expiresAt ||
    data?.expiry ||
    data?.expiration ||
    data?.data?.expires_at ||
    data?.data?.expiresAt ||
    null
  );
}

/*
 * IMPORTANT:
 * provider service IDs such as "wa" are TEXT.
 *
 * NEVER use:
 *
 *   product_prices?id=eq.wa
 *
 * because product_prices.id is a UUID.
 */
async function findCustomerPrice({
  countryName,
  server,
  providerServiceId,
  serviceName
}) {
  const base =
    `product_prices?is_active=eq.true` +
    `&provider_server=eq.${q(server)}`;

  // First lookup by provider service ID.
  // "wa" is allowed here because provider_service_id is text.
  if (providerServiceId) {
    const rows = await supabaseRequest(
      `${base}` +
      `&provider_service_id=eq.${q(providerServiceId)}` +
      (countryName
        ? `&country_name=ilike.${q(countryName)}`
        : "") +
      `&select=id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id` +
      `&limit=1`
    );

    if (rows?.length) {
      return rows[0];
    }
  }

  // Fallback by service name.
  if (serviceName) {
    const rows = await supabaseRequest(
      `${base}` +
      `&service_name=ilike.${q(serviceName)}` +
      (countryName
        ? `&country_name=ilike.${q(countryName)}`
        : "") +
      `&select=id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id` +
      `&limit=1`
    );

    if (rows?.length) {
      return rows[0];
    }
  }

  return null;
}

async function resolveProviderService({
  server,
  countryId,
  serviceId,
  serviceName
}) {
  const response =
    await sureVerificationRequest(
      `/${server}/services?country_id=${q(countryId)}`
    );

  const list =
    Array.isArray(response)
      ? response
      : response?.data ||
        response?.services ||
        response?.results ||
        [];

  if (!Array.isArray(list) || !list.length) {
    throw new Error(
      `No services returned by ${server}.`
    );
  }

  const wantedId =
    String(serviceId || "").toLowerCase();

  const wantedName =
    String(serviceName || "").toLowerCase();

  const match = list.find((row) => {
    const ids = [
      row?.id,
      row?.service_id,
      row?.serviceId,
      row?.code,
      row?.service_code
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());

    const names = [
      row?.name,
      row?.service_name,
      row?.serviceName,
      row?.title
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());

    if (wantedId && ids.includes(wantedId)) {
      return true;
    }

    if (wantedName && names.includes(wantedName)) {
      return true;
    }

    return false;
  });

  if (!match) {
    throw new Error(
      `Service "${serviceId || serviceName}" was not found on ${server}.`
    );
  }

  return match;
}

async function getGlobal2PriceTier({
  serviceId,
  serviceName
}) {
  const response =
    await sureVerificationRequest(
      "/global-server-2/price"
    );

  const list =
    Array.isArray(response)
      ? response
      : response?.data ||
        response?.prices ||
        response?.results ||
        [];

  if (!Array.isArray(list) || !list.length) {
    throw new Error(
      "Global Server 2 returned no price tiers."
    );
  }

  const wantedId =
    String(serviceId || "").toLowerCase();

  const wantedName =
    String(serviceName || "").toLowerCase();

  const matches = list.filter((row) => {
    const ids = [
      row?.id,
      row?.service_id,
      row?.serviceId,
      row?.code,
      row?.service_code
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());

    const names = [
      row?.name,
      row?.service_name,
      row?.serviceName,
      row?.title
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());

    return (
      (wantedId && ids.includes(wantedId)) ||
      (wantedName && names.includes(wantedName))
    );
  });

  if (!matches.length) {
    throw new Error(
      `Global Server 2 has no price for "${serviceId || serviceName}".`
    );
  }

  const tier =
    matches.find(
      (row) =>
        Number(
          row?.count ??
          row?.stock ??
          row?.available ??
          0
        ) > 0
    ) || matches[0];

  return tier;
}

async function purchaseFromProvider({
  server,
  countryId,
  serviceId,
  serviceName
}) {
  if (!SERVERS.includes(server)) {
    throw new Error(
      `Unsupported provider server: ${server}`
    );
  }

  const providerService =
    await resolveProviderService({
      server,
      countryId,
      serviceId,
      serviceName
    });

  const actualServiceId =
    providerService?.id ??
    providerService?.service_id ??
    providerService?.serviceId ??
    providerService?.code ??
    providerService?.service_code ??
    serviceId;

  const actualServiceName =
    providerService?.name ??
    providerService?.service_name ??
    providerService?.serviceName ??
    serviceName;

  /*
   * GLOBAL SERVER 2
   */
  if (server === "global-server-2") {
    const tier =
      await getGlobal2PriceTier({
        serviceId: actualServiceId,
        serviceName: actualServiceName
      });

    const tierId =
      tier?.id ??
      tier?.price_id ??
      tier?.priceId;

    if (!tierId) {
      throw new Error(
        "Global Server 2 returned a price tier without an ID."
      );
    }

    const purchase =
      await sureVerificationRequest(
        `/global-server-2/purchase?id=${q(tierId)}`
      );

    return {
      providerResponse: purchase,
      providerService,
      providerServiceId: actualServiceId,
      providerServiceName: actualServiceName,
      providerCost: extractProviderPrice(
        purchase
      ),
      providerOrderId:
        extractVerificationId(purchase),
      phoneNumber:
        extractPhone(purchase),
      expiresAt:
        extractExpiry(purchase)
    };
  }

  /*
   * USA SERVER 1
   * USA SERVER 2
   * GLOBAL SERVER 1
   */
  const priceResponse =
    await sureVerificationRequest(
      `/${server}/price?country_id=${q(countryId)}&service=${q(actualServiceId)}`
    );

  const providerCost =
    extractProviderPrice(priceResponse);

  const purchase =
    await sureVerificationRequest(
      `/${server}/purchase?country_id=${q(countryId)}&service=${q(actualServiceId)}`
    );

  return {
    providerResponse: purchase,
    providerService,
    providerServiceId: actualServiceId,
    providerServiceName: actualServiceName,
    providerCost:
      extractProviderPrice(purchase) ||
      providerCost,
    providerOrderId:
      extractVerificationId(purchase),
    phoneNumber:
      extractPhone(purchase),
    expiresAt:
      extractExpiry(purchase)
  };
}

async function getAuthenticatedUser(req) {
  const auth =
    req.headers.authorization ||
    req.headers.Authorization;

  if (!auth) {
    throw new Error("Authorization header is required.");
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            process.env.SUPABASE_ANON_KEY ||
            process.env.SUPABASE_PUBLISHABLE_KEY ||
            "",
          Authorization: auth
        }
      }
    );

  const user =
    await response.json().catch(() => null);

  if (!response.ok || !user?.id) {
    throw new Error("Authentication required.");
  }

  return user;
}

async function getProfile(userId) {
  const rows =
    await supabaseRequest(
      `profiles?id=eq.${q(userId)}&select=id,email,balance,role&limit=1`
    );

  if (!rows?.length) {
    throw new Error("Customer profile not found.");
  }

  return rows[0];
}

async function debitBalance({
  userId,
  currentBalance,
  amount
}) {
  const newBalance =
    Number(currentBalance) - Number(amount);

  if (newBalance < 0) {
    throw new Error("Insufficient wallet balance.");
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${q(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
          Prefer:
            "return=representation"
        },
        body: JSON.stringify({
          balance: newBalance
        })
      }
    );

  const data =
    await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      "Unable to debit wallet."
    );
  }

  return data?.[0] || {
    balance: newBalance
  };
}

async function refundBalance({
  userId,
  amount
}) {
  const rows =
    await supabaseRequest(
      `profiles?id=eq.${q(userId)}&select=balance&limit=1`
    );

  const balance =
    Number(rows?.[0]?.balance || 0);

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${q(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
          Prefer:
            "return=representation"
        },
        body: JSON.stringify({
          balance:
            balance + Number(amount)
        })
      }
    );

  if (!response.ok) {
    console.error(
      "Wallet refund failed:",
      await response.text()
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  let debited = false;
  let userId = null;
  let customerPrice = null;

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const user =
      await getAuthenticatedUser(req);

    userId = user.id;

    const profile =
      await getProfile(userId);

    const providerServer =
      getProviderServer(body);

    const providerCountryId =
      getProviderCountryId(body);

    const countryName =
      getCountryName(body);

    const serviceName =
      getServiceName(body);

    /*
     * "wa" belongs here.
     * It is NOT a UUID.
     */
    const providerServiceId =
      getServiceId(body);

    if (!SERVERS.includes(providerServer)) {
      return res.status(400).json({
        success: false,
        error:
          "A valid provider server is required.",
        servers: SERVERS
      });
    }

    if (!providerCountryId) {
      return res.status(400).json({
        success: false,
        error:
          "providerCountryId is required."
      });
    }

    if (!providerServiceId && !serviceName) {
      return res.status(400).json({
        success: false,
        error:
          "providerServiceId or serviceName is required."
      });
    }

    /*
     * CRITICAL FIX:
     *
     * Never use providerServiceId ("wa")
     * as product_prices.id.
     *
     * Price lookup uses provider_service_id,
     * which is a TEXT value.
     */
    customerPrice =
      await findCustomerPrice({
        countryName,
        server: providerServer,
        providerServiceId,
        serviceName
      });

    if (!customerPrice) {
      return res.status(404).json({
        success: false,
        error:
          `No active selling price found for ${serviceName || providerServiceId} on ${providerServer}.`
      });
    }

    const sellingPrice =
      Number(customerPrice.selling_price);

    if (
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Selling price is not configured correctly."
      });
    }

    const balance =
      Number(profile.balance || 0);

    if (balance < sellingPrice) {
      return res.status(400).json({
        success: false,
        error: "Insufficient wallet balance.",
        balance,
        price: sellingPrice
      });
    }

    /*
     * Debit customer first.
     */
    await debitBalance({
      userId,
      currentBalance: balance,
      amount: sellingPrice
    });

    debited = true;

    /*
     * Purchase actual number from provider.
     */
    const provider =
      await purchaseFromProvider({
        server: providerServer,
        countryId: providerCountryId,
        serviceId: providerServiceId,
        serviceName
      });

    if (!provider.phoneNumber) {
      throw new Error(
        "Provider did not return a phone number."
      );
    }

    const providerCost =
      Number(provider.providerCost || 0);

    const profit =
      sellingPrice - providerCost;

    /*
     * Save order.
     *
     * service_country_price_id is the actual
     * product_prices UUID, when available.
     *
     * We NEVER put "wa" into this field.
     */
    const order = {
      user_id: userId,
      provider_order_id:
        provider.providerOrderId
          ? String(provider.providerOrderId)
          : null,

      service_country_price_id:
        isUUID(customerPrice.id)
          ? customerPrice.id
          : null,

      service_name:
        customerPrice.service_name ||
        provider.providerServiceName ||
        serviceName ||
        providerServiceId,

      country_name:
        customerPrice.country_name ||
        countryName ||
        null,

      provider_cost:
        Number.isFinite(providerCost)
          ? providerCost
          : 0,

      customer_price:
        sellingPrice,

      profit:
        Number.isFinite(profit)
          ? profit
          : sellingPrice,

      status:
        "active",

      phone_number:
        String(provider.phoneNumber)
    };

    const inserted =
      await supabaseRequest(
        "orders",
        {
          method: "POST",
          headers: {
            Prefer:
              "return=representation"
          },
          body:
            JSON.stringify(order)
        }
      );

    return res.status(200).json({
      success: true,
      order:
        inserted?.[0] || order,

      phoneNumber:
        provider.phoneNumber,

      verificationId:
        provider.providerOrderId,

      expiresAt:
        provider.expiresAt,

      providerServer,

      providerServiceId:
        provider.providerServiceId,

      serviceName:
        provider.providerServiceName ||
        serviceName,

      countryName:
        customerPrice.country_name ||
        countryName,

      customerPrice:
        sellingPrice,

      providerCost,

      profit
    });

  } catch (error) {
    console.error(
      "ORDER ERROR:",
      error
    );

    if (debited && userId) {
      await refundBalance({
        userId,
        amount:
          Number(
            customerPrice?.selling_price || 0
          )
      });
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}

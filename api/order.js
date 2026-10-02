import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);

const BASE_PROVIDER_URL =
  "https://sureverifications.com/api/v1";

/* =========================================================
   AUTH
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
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
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

/* =========================================================
   SUPABASE REST
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

        "Content-Type":
          "application/json",

        Accept:
          "application/json",

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

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
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

function quote(value) {
  return encodeURIComponent(
    String(value)
  );
}

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function normalizeServiceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getArray(data, keys = []) {
  if (Array.isArray(data)) {
    return data;
  }

  for (const key of keys) {
    if (Array.isArray(data?.[key])) {
      return data[key];
    }
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.data?.data)) {
    return data.data.data;
  }

  return [];
}

function getServiceId(service) {
  return (
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.code ??
    service?.key ??
    null
  );
}

function getServiceName(service) {
  return (
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service ??
    ""
  );
}

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data
  );
}

function getVerificationId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.id ??
    verification?.verification_id ??
    verification?.verificationId ??
    data?.verification_id ??
    data?.verificationId ??
    null
  );
}

function getRequestId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    data?.request_id ??
    data?.requestId ??
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
    verification?.expires_at ??
    verification?.expiredAt ??
    verification?.expiresAt ??
    null
  );
}

function isUSA(
  countryId,
  countryCode,
  countryName
) {
  const values = [
    countryId,
    countryCode,
    countryName
  ].map((value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
  );

  return (
    values.includes("us") ||
    values.includes("usa") ||
    values.includes("united states") ||
    values.includes(
      "united states of america"
    )
  );
}

/* =========================================================
   PROVIDER SERVICE RESOLUTION
   ========================================================= */

/*
 * IMPORTANT:
 *
 * Never trust a service ID belonging to another server.
 *
 * Example:
 *
 * Global Server 2:
 *     Whatsapp = "wa"
 *
 * Global Server 1:
 *     Whatsapp = "69c05c2e27c5759c68a8135e"
 *
 * Therefore we always ask the selected server for
 * its own services first.
 */

async function resolveProviderService(
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${quote(
        countryId
      )}`
    );

  const services =
    getArray(
      data,
      [
        "services",
        "items",
        "results"
      ]
    );

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  const requestedId =
    String(
      requestedServiceId ?? ""
    ).trim();

  /*
   * First try the exact provider ID.
   */
  if (requestedId) {
    const direct =
      services.find(
        (service) =>
          String(
            getServiceId(service) ??
            ""
          ).trim() ===
          requestedId
      );

    if (direct) {
      return {
        id: String(
          getServiceId(direct)
        ).trim(),

        name:
          getServiceName(direct)
      };
    }
  }

  /*
   * Then match by service name.
   */
  const wantedName =
    normalizeServiceName(
      requestedServiceName
    );

  if (wantedName) {
    const exact =
      services.find(
        (service) =>
          normalizeServiceName(
            getServiceName(service)
          ) === wantedName
      );

    if (exact) {
      return {
        id: String(
          getServiceId(exact)
        ).trim(),

        name:
          getServiceName(exact)
      };
    }

    /*
     * Partial match for names such as:
     * WhatsApp / Whatsapp
     */
    const partial =
      services.find(
        (service) => {
          const providerName =
            normalizeServiceName(
              getServiceName(service)
            );

          return (
            providerName &&
            (
              providerName.includes(
                wantedName
              ) ||
              wantedName.includes(
                providerName
              )
            )
          );
        }
      );

    if (partial) {
      return {
        id: String(
          getServiceId(partial)
        ).trim(),

        name:
          getServiceName(partial)
      };
    }
  }

  throw new Error(
    `The selected service (${requestedServiceName || requestedServiceId}) is not available on ${server} for country ${countryId}.`
  );
}

/* =========================================================
   GLOBAL SERVER 2 PRICE TIER
   ========================================================= */

/*
 * Global Server 2 is different.
 *
 * Its price endpoint returns:
 *
 * {
 *   service: {
 *      id: "...",
 *      name: "Whatsapp"
 *   },
 *   price: 1234,
 *   id: 1
 * }
 *
 * The purchase endpoint documents an optional
 * price-tier ID.
 *
 * Because the provider returned:
 *
 * "The id field is required."
 *
 * we obtain the matching tier ID and send it
 * explicitly to Global Server 2.
 */

async function getGlobalServer2PriceTier(
  providerService
) {
  const data =
    await sureVerificationRequest(
      "/global-server-2/price"
    );

  const prices =
    getArray(
      data,
      [
        "prices",
        "items",
        "results"
      ]
    );

  if (!prices.length) {
    throw new Error(
      "Global Server 2 returned no price options."
    );
  }

  const wantedId =
    String(
      providerService.id ?? ""
    ).trim();

  const wantedName =
    normalizeServiceName(
      providerService.name
    );

  /*
   * Match service ID first.
   */
  let matching =
    prices.filter(
      (row) =>
        String(
          row?.service?.id ??
          ""
        ).trim() === wantedId
    );

  /*
   * Otherwise match service name.
   */
  if (!matching.length && wantedName) {
    matching =
      prices.filter(
        (row) =>
          normalizeServiceName(
            row?.service?.name
          ) === wantedName
      );
  }

  /*
   * Partial name fallback.
   */
  if (!matching.length && wantedName) {
    matching =
      prices.filter(
        (row) => {
          const name =
            normalizeServiceName(
              row?.service?.name
            );

          return (
            name &&
            (
              name.includes(
                wantedName
              ) ||
              wantedName.includes(
                name
              )
            )
          );
        }
      );
  }

  if (!matching.length) {
    throw new Error(
      `Global Server 2 has no price tier for ${providerService.name}.`
    );
  }

  /*
   * Prefer a tier with stock.
   */
  const withStock =
    matching.find(
      (row) =>
        row?.service?.stocks === null ||
        row?.service?.stocks === undefined ||
        Number(row?.service?.stocks) > 0
    );

  const tier =
    withStock ||
    matching[0];

  const tierId =
    tier?.id;

  if (
    tierId === undefined ||
    tierId === null ||
    String(tierId).trim() === ""
  ) {
    throw new Error(
      `Global Server 2 did not return a price-tier id for ${providerService.name}.`
    );
  }

  return {
    id: tierId,
    providerPrice:
      Number(tier?.price)
  };
}

/* =========================================================
   WALLET DEBIT
   ========================================================= */

async function debitWallet(
  userId,
  amount
) {
  const requiredAmount =
    Number(amount);

  if (
    !Number.isFinite(
      requiredAmount
    ) ||
    requiredAmount <= 0
  ) {
    throw new Error(
      "Invalid purchase amount."
    );
  }

  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {
    const rows =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
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

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date()
                  .toISOString()
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

/* =========================================================
   WALLET REFUND
   ========================================================= */

async function refundWallet(
  userId,
  amount
) {
  const refundAmount =
    Number(amount);

  if (
    !Number.isFinite(
      refundAmount
    ) ||
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
        `wallets?user_id=eq.${quote(
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
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date()
                  .toISOString()
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
        method:
          "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            amount:
              amount,

            balance_after:
              balanceAfter,

            type:
              "order",

            description:
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
  const providerPrice =
    Number(
      order.providerPrice
    );

  const sellingPrice =
    Number(
      order.sellingPrice
    );

  const profit =
    Number.isFinite(
      providerPrice
    )
      ? sellingPrice -
        providerPrice
      : 0;

  const row = {
    user_id:
      userId,

    provider_order_id:
      order.requestId ||
      null,

    provider_verification_id:
      order.verificationId ||
      null,

    service_country_price_id:
      order.serviceCountryPriceId ||
      null,

    service_name:
      order.serviceName ||
      null,

    country_name:
      order.countryName ||
      null,

    provider_cost:
      Number.isFinite(
        providerPrice
      )
        ? providerPrice
        : 0,

    customer_price:
      sellingPrice,

    profit:
      profit,

    status:
      order.status ||
      "active",

    phone_number:
      order.phoneNumber ||
      null,

    provider_name:
      "SureVerification",

    provider_server:
      order.providerServer ||
      null,

    provider_base_url:
      order.providerBaseUrl ||
      BASE_PROVIDER_URL,

    provider_expired_at:
      order.expiredAt ||
      null
  };

  return await supabaseRequest(
    "orders",
    {
      method:
        "POST",

      body:
        JSON.stringify(row)
    }
  );
}

/* =========================================================
   FIND PRODUCT PRICE
   ========================================================= */

async function findPricing({
  countryId,
  providerServer,
  requestedServiceId,
  requestedServiceName
}) {
  /*
   * First get every active price for the exact
   * country + exact provider server.
   */
  const rows =
    await supabaseRequest(
      `product_prices?country_id=eq.${quote(
        countryId
      )}&provider_server=eq.${quote(
        providerServer
      )}&is_active=eq.true&select=*&order=id.asc`
    );

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    throw new Error(
      `No selling price has been configured for this service on ${providerServer}.`
    );
  }

  const wantedId =
    String(
      requestedServiceId ??
      ""
    ).trim();

  const wantedName =
    normalizeServiceName(
      requestedServiceName
    );

  /*
   * Exact provider service ID.
   */
  let match =
    rows.find(
      (row) =>
        wantedId &&
        (
          String(
            row?.provider_service_id ??
            ""
          ).trim() === wantedId ||
          String(
            row?.service_id ??
            ""
          ).trim() === wantedId
        )
    );

  /*
   * Exact service name.
   */
  if (!match && wantedName) {
    match =
      rows.find(
        (row) =>
          normalizeServiceName(
            row?.service_name
          ) === wantedName
      );
  }

  /*
   * Partial service name.
   */
  if (!match && wantedName) {
    match =
      rows.find(
        (row) => {
          const name =
            normalizeServiceName(
              row?.service_name
            );

          return (
            name &&
            (
              name.includes(
                wantedName
              ) ||
              wantedName.includes(
                name
              )
            )
          );
        }
      );
  }

  if (!match) {
    throw new Error(
      `No selling price is configured for ${requestedServiceName || requestedServiceId} on ${providerServer}.`
    );
  }

  const sellingPrice =
    Number(
      match.selling_price
    );

  if (
    !Number.isFinite(
      sellingPrice
    ) ||
    sellingPrice <= 0
  ) {
    throw new Error(
      `The selling price for ${match.service_name || requestedServiceName} on ${providerServer} is invalid.`
    );
  }

  return {
    ...match,

    sellingPrice
  };
}

/* =========================================================
   PROVIDER PURCHASE
   ========================================================= */

async function purchaseFromProvider({
  server,
  countryId,
  providerService
}) {
  /*
   * -------------------------------------------------------
   * GLOBAL SERVER 2
   * -------------------------------------------------------
   *
   * Global Server 2 uses price tiers.
   */
  if (
    server ===
    "global-server-2"
  ) {
    const tier =
      await getGlobalServer2PriceTier(
        providerService
      );

    const tierId =
      tier.id;

    /*
     * The official docs expose the purchase route
     * without mandatory country/service parameters and
     * state that a price-tier ID can be supplied.
     *
     * We send the tier ID explicitly.
     *
     * country_id/service are also supplied because the
     * service catalogue is country-specific.
     */
    const query =
      `/${server}/purchase` +
      `?id=${quote(tierId)}` +
      `&country_id=${quote(countryId)}` +
      `&service=${quote(
        providerService.id
      )}`;

    const response =
      await sureVerificationRequest(
        query,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              id:
                tierId,

              country_id:
                countryId,

              service:
                providerService.id
            })
        }
      );

    return {
      response,

      providerPrice:
        Number.isFinite(
          tier.providerPrice
        )
          ? tier.providerPrice
          : null
    };
  }

  /*
   * -------------------------------------------------------
   * USA SERVER 1
   * USA SERVER 2
   * GLOBAL SERVER 1
   * -------------------------------------------------------
   *
   * These use country_id + service.
   */
  const query =
    `/${server}/purchase` +
    `?country_id=${quote(
      countryId
    )}` +
    `&service=${quote(
      providerService.id
    )}`;

  const response =
    await sureVerificationRequest(
      query,
      {
        method:
          "POST"
      }
    );

  return {
    response,

    providerPrice:
      null
  };
}

/* =========================================================
   MAIN API
   ========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !==
    "POST"
  ) {
    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed"
    });
  }

  let user =
    null;

  let debited =
    false;

  let debitAmount =
    0;

  try {
    user =
      await getAuthenticatedUser(
        req
      );

    const body =
      req.body || {};

    const countryId =
      body.countryId ??
      body.country_id;

    const countryName =
      body.countryName ??
      body.country_name ??
      "";

    const countryCode =
      body.countryCode ??
      body.country_code ??
      "";

    const requestedServiceId =
      body.serviceCountryPriceId ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    /*
     * IMPORTANT:
     *
     * The frontend already sends the exact server selected
     * by the customer.
     */
    const providerServer =
      String(
        body.providerServer ??
        body.provider_server ??
        ""
      ).trim();

    if (!countryId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Country is required."
      });
    }

    if (!requestedServiceId &&
        !requestedServiceName) {
      return res.status(400).json({
        success:
          false,

        error:
          "Service is required."
      });
    }

    if (!providerServer) {
      return res.status(400).json({
        success:
          false,

        error:
          "Provider server is required."
      });
    }

    if (
      !ALLOWED_SERVERS.has(
        providerServer
      )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          `Invalid provider server "${providerServer}".`
      });
    }

    /*
     * -------------------------------------------------------
     * FIND CUSTOMER PRICE
     * -------------------------------------------------------
     *
     * Notice provider_server is part of this query.
     *
     * This prevents:
     *
     * Global Server 2 price
     * being used with Global Server 1
     *
     * or:
     *
     * USA Server 1 price
     * being used with USA Server 2.
     */
    const pricing =
      await findPricing({
        countryId,
        providerServer,
        requestedServiceId,
        requestedServiceName
      });

    const sellingPrice =
      pricing.sellingPrice;

    const serviceName =
      pricing.service_name ||
      requestedServiceName ||
      String(
        requestedServiceId ||
        ""
      );

    /*
     * -------------------------------------------------------
     * PROVIDER SERVICE
     * -------------------------------------------------------
     *
     * Always resolve the service from the EXACT server.
     */
    const providerService =
      await resolveProviderService(
        providerServer,
        countryId,
        pricing.provider_service_id ||
          pricing.service_id ||
          requestedServiceId,
        serviceName
      );

    /*
     * -------------------------------------------------------
     * WALLET DEBIT
     * -------------------------------------------------------
     */
    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited =
      true;

    debitAmount =
      sellingPrice;

    console.log(
      "GLOBAL VIRTUAL SIM PURCHASE",
      {
        userId:
          user.id,

        countryId,

        countryName,

        providerServer,

        requestedServiceId,

        requestedServiceName,

        providerServiceId:
          providerService.id,

        providerServiceName:
          providerService.name,

        sellingPrice
      }
    );

    /*
     * -------------------------------------------------------
     * PURCHASE
     * -------------------------------------------------------
     */
    let providerResult;

    try {
      providerResult =
        await purchaseFromProvider({
          server:
            providerServer,

          countryId,

          providerService
        });
    } catch (providerError) {
      /*
       * Provider purchase failed.
       * Refund immediately because no number was returned.
       */
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Provider failure refund failed:",
          refundError
        );
      }

      debited =
        false;

      throw providerError;
    }

    const providerData =
      providerResult?.response;

    console.log(
      "SureVerification purchase response:",
      JSON.stringify(
        providerData
      )
    );

    /*
     * -------------------------------------------------------
     * EXTRACT VERIFICATION
     * -------------------------------------------------------
     */
    const verification =
      getVerification(
        providerData
      );

    const verificationId =
      getVerificationId(
        providerData
      );

    const requestId =
      getRequestId(
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

    if (
      !verificationId ||
      !phoneNumber
    ) {
      /*
       * The provider did not return a usable number.
       */
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Incomplete provider response refund failed:",
          refundError
        );
      }

      debited =
        false;

      throw new Error(
        "The provider did not return a valid number. Your wallet was refunded."
      );
    }

    /*
     * -------------------------------------------------------
     * PROVIDER COST
     * -------------------------------------------------------
     *
     * Use the admin-configured provider price first.
     *
     * This is important because the purchase response
     * normally does not contain the provider price.
     */
    let providerPrice =
      Number(
        pricing.provider_price ??
        pricing.provider_cost
      );

    /*
     * For Global Server 2 we already obtained the provider
     * price from the matching price tier.
     */
    if (
      !Number.isFinite(
        providerPrice
      ) &&
      Number.isFinite(
        providerResult?.providerPrice
      )
    ) {
      providerPrice =
        providerResult.providerPrice;
    }

    /*
     * Never allow NaN into numeric database columns.
     */
    if (
      !Number.isFinite(
        providerPrice
      )
    ) {
      providerPrice =
        0;
    }

    /*
     * -------------------------------------------------------
     * CREATE ORDER
     * -------------------------------------------------------
     */
    let orderRows;

    try {
      orderRows =
        await createOrder(
          user.id,
          {
            requestId:
              requestId ||
              verificationId,

            verificationId,

            serviceCountryPriceId:
              pricing.id ||
              requestedServiceId ||
              null,

            serviceName,

            countryName:
              pricing.country_name ||
              countryName ||
              String(
                countryId
              ),

            phoneNumber,

            sellingPrice,

            providerPrice,

            providerServer,

            providerBaseUrl:
              BASE_PROVIDER_URL,

            expiredAt,

            status:
              verification?.status ||
              "active"
          }
        );
    } catch (orderError) {
      /*
       * IMPORTANT:
       *
       * The provider already gave us a number.
       * Do NOT pretend the provider purchase failed.
       *
       * Log the database failure so it can be corrected
       * without purchasing another number.
       */
      console.error(
        "NUMBER PURCHASED BUT ORDER SAVE FAILED:",
        {
          orderError:
            orderError?.message,

          providerServer,

          verificationId,

          requestId,

          phoneNumber,

          expiredAt
        }
      );

      /*
       * Refund the customer because the site's order
       * record could not be created.
       */
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Order-save refund failed:",
          refundError
        );
      }

      debited =
        false;

      throw new Error(
        `Number was obtained from ${providerServer}, but the order could not be saved. Please contact support with verification ID ${verificationId}.`
      );
    }

    /*
     * -------------------------------------------------------
     * GET NEW WALLET BALANCE
     * -------------------------------------------------------
     */
    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          user.id
        )}&select=balance&limit=1`
      );

    const balanceAfter =
      Number(
        walletRows?.[0]?.balance ||
        0
      );

    /*
     * -------------------------------------------------------
     * WALLET TRANSACTION
     * -------------------------------------------------------
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

    debited =
      false;

    /*
     * -------------------------------------------------------
     * SUCCESS
     * -------------------------------------------------------
     */
    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      verification: {
        ...verification,

        request_id:
          requestId ||
          null,

        id:
          verificationId,

        number:
          phoneNumber,

        expired_at:
          expiredAt ||
          null
      },

      provider_server:
        providerServer,

      provider_name:
        "SureVerification",

      provider_service_id:
        providerService.id,

      provider_service_name:
        providerService.name,

      provider_price:
        providerPrice,

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
     * Safety refund if the wallet was debited and
     * the provider never returned a number.
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

    /*
     * Insufficient balance.
     */
    if (
      String(message)
        .toLowerCase()
        .includes(
          "insufficient"
        )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Insufficient wallet balance.",

        message:
          "Insufficient wallet balance."
      });
    }

    /*
     * Authentication.
     */
    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,

        error:
          message
      });
    }

    return res.status(500).json({
      success:
        false,

      error:
        message,

      message
    });
  }
}

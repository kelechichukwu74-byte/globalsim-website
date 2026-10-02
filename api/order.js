import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const PROVIDER_BASE_URL =
  "https://sureverifications.com/api/v1";

const VALID_SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeServiceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header) return null;

  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  return null;
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

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Unauthorized.");
  }

  if (!response.ok || !data?.id) {
    throw new Error("Unauthorized.");
  }

  return data;
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

function isUSA(countryId, countryCode, countryName) {
  const values = [
    countryId,
    countryCode,
    countryName
  ].map(normalize);

  return (
    values.includes("us") ||
    values.includes("usa") ||
    values.includes("236") ||
    values.includes("united states") ||
    values.includes("united states of america")
  );
}

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
    null
  );
}

function getProviderStatus(data) {
  const verification =
    getVerification(data);

  return (
    verification?.status ||
    "active"
  );
}

function getProviderArray(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.services)) {
    return data.services;
  }

  if (Array.isArray(data?.prices)) {
    return data.prices;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.data?.services)) {
    return data.data.services;
  }

  if (Array.isArray(data?.data?.prices)) {
    return data.data.prices;
  }

  return [];
}

function getProviderServiceId(service) {
  return (
    service?.id ??
    service?.service_id ??
    service?.serviceId ??
    service?.code ??
    null
  );
}

function getProviderServiceName(service) {
  return (
    service?.name ??
    service?.service_name ??
    service?.serviceName ??
    service?.title ??
    service?.service ??
    ""
  );
}

async function getProviderServices(
  server,
  countryId
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${quote(
        countryId
      )}`
    );

  return getProviderArray(data);
}

async function resolveProviderServiceId(
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
) {
  const services =
    await getProviderServices(
      server,
      countryId
    );

  if (!services.length) {
    throw new Error(
      `No services are available on ${server} for this country.`
    );
  }

  const wantedId =
    String(requestedServiceId ?? "").trim();

  if (wantedId) {
    const direct =
      services.find(
        (service) =>
          String(
            getProviderServiceId(service) ?? ""
          ).trim() === wantedId
      );

    if (direct) {
      return String(
        getProviderServiceId(direct)
      ).trim();
    }
  }

  const wantedName =
    normalizeServiceName(
      requestedServiceName
    );

  if (wantedName) {
    const exact =
      services.find(
        (service) =>
          normalizeServiceName(
            getProviderServiceName(service)
          ) === wantedName
      );

    if (exact) {
      return String(
        getProviderServiceId(exact)
      ).trim();
    }

    const partial =
      services.find(
        (service) => {
          const providerName =
            normalizeServiceName(
              getProviderServiceName(service)
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
      return String(
        getProviderServiceId(partial)
      ).trim();
    }
  }

  throw new Error(
    `Service "${requestedServiceName || requestedServiceId}" is not available on ${server} for this country.`
  );
}

/*
 * Get the provider's real current cost BEFORE
 * debiting the customer's wallet.
 */
async function getProviderPrice(
  server,
  countryId,
  providerServiceId,
  serviceName
) {
  /*
   * USA Server 1
   * USA Server 2
   * Global Server 1
   *
   * These use:
   * /price?country_id=...&service=...
   */
  if (
    server === "usa-server-1" ||
    server === "usa-server-2" ||
    server === "global-server-1"
  ) {
    const data =
      await sureVerificationRequest(
        `/${server}/price?country_id=${quote(
          countryId
        )}&service=${quote(
          providerServiceId
        )}`
      );

    const value =
      data?.price?.price ??
      data?.price ??
      data?.data?.price?.price ??
      data?.data?.price ??
      data?.amount ??
      data?.data?.amount;

    const price =
      Number(value);

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new Error(
        `Provider price is unavailable on ${server}.`
      );
    }

    return {
      price,
      tierId: null
    };
  }

  /*
   * Global Server 2 uses its price list.
   */
  if (
    server === "global-server-2"
  ) {
    const data =
      await sureVerificationRequest(
        "/global-server-2/price"
      );

    const prices =
      getProviderArray(data);

    const wantedId =
      String(
        providerServiceId ?? ""
      ).trim();

    const wantedName =
      normalizeServiceName(
        serviceName
      );

    const matches =
      prices.filter(
        (item) => {
          const itemId =
            String(
              item?.service?.id ??
              item?.service_id ??
              item?.serviceId ??
              ""
            ).trim();

          const itemName =
            normalizeServiceName(
              item?.service?.name ??
              item?.service_name ??
              item?.serviceName ??
              ""
            );

          return (
            (wantedId &&
              itemId === wantedId) ||
            (wantedName &&
              itemName === wantedName)
          );
        }
      );

    const available =
      matches.filter(
        (item) => {
          const stock =
            Number(
              item?.service?.stocks ??
              item?.stocks ??
              0
            );

          return (
            !Number.isFinite(stock) ||
            stock > 0
          );
        }
      );

    const candidates =
      available.length
        ? available
        : matches;

    if (!candidates.length) {
      throw new Error(
        `No Global Server 2 price is available for ${serviceName}.`
      );
    }

    candidates.sort(
      (a, b) =>
        Number(a?.price || 0) -
        Number(b?.price || 0)
    );

    const selected =
      candidates[0];

    const price =
      Number(selected?.price);

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new Error(
        "Global Server 2 provider price is invalid."
      );
    }

    return {
      price,
      tierId:
        selected?.id ?? null
    };
  }

  throw new Error(
    `Unsupported provider server "${server}".`
  );
}

/*
 * Global Server 2's public purchase endpoint accepts
 * the purchase information through the request body.
 *
 * We also put country_id/service in the query string
 * for compatibility with provider deployments that
 * still validate those query parameters.
 */
async function purchaseFromProvider(
  server,
  countryId,
  providerServiceId,
  providerPriceTierId
) {
  const query =
    `?country_id=${quote(
      countryId
    )}&service=${quote(
      providerServiceId
    )}`;

  if (
    server === "global-server-2"
  ) {
    const body = {
      country_id: String(countryId),
      service: String(
        providerServiceId
      )
    };

    /*
     * Only send a tier ID when the provider
     * actually returned one.
     */
    if (
      providerPriceTierId !== null &&
      providerPriceTierId !== undefined &&
      providerPriceTierId !== ""
    ) {
      body.price_id =
        providerPriceTierId;
    }

    try {
      return await sureVerificationRequest(
        `/global-server-2/purchase${query}`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify(body)
        }
      );
    } catch (firstError) {
      /*
       * Fallback to the documented no-query
       * Global Server 2 endpoint.
       */
      try {
        return await sureVerificationRequest(
          "/global-server-2/purchase",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify(body)
          }
        );
      } catch {
        throw firstError;
      }
    }
  }

  /*
   * USA Server 1 / USA Server 2 /
   * Global Server 1.
   */
  return await sureVerificationRequest(
    `/${server}/purchase${query}`,
    {
      method: "POST"
    }
  );
}

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

  /*
   * IMPORTANT:
   * Do NOT select wallets.id.
   *
   * Your wallets table does not have an id
   * column. The wallet is identified by user_id.
   */
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
        )}&balance=eq.${quote(
          currentBalance
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance: newBalance,
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
        )}&balance=eq.${quote(
          currentBalance
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            balance: newBalance,
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

async function createOrder(
  userId,
  order
) {
  const payload = {
    user_id: userId,

    provider_order_id:
      order.requestId,

    provider_verification_id:
      order.verificationId,

    service_country_price_id:
      order.serviceCountryPriceId,

    service_name:
      order.serviceName,

    country_name:
      order.countryName,

    provider_cost:
      order.providerCost,

    customer_price:
      order.customerPrice,

    profit:
      order.customerPrice -
      order.providerCost,

    status:
      order.status || "active",

    phone_number:
      order.phoneNumber,

    provider_name:
      "SureVerification",

    provider_server:
      order.providerServer,

    provider_base_url:
      PROVIDER_BASE_URL
  };

  /*
   * Save provider expiry when the column exists
   * in your orders table.
   */
  if (order.expiredAt) {
    payload.provider_expired_at =
      order.expiredAt;
  }

  return await supabaseRequest(
    "orders",
    {
      method: "POST",
      body: JSON.stringify(
        payload
      )
    }
  );
}

async function tryCancelProvider(
  verificationId
) {
  if (!verificationId) {
    return;
  }

  try {
    await sureVerificationRequest(
      `/verifications/cancel/${quote(
        verificationId
      )}`,
      {
        method: "DELETE"
      }
    );
  } catch (error) {
    console.error(
      "Provider cancellation after database failure:",
      error
    );
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let user = null;
  let walletDebited = false;
  let debitAmount = 0;
  let providerVerificationId =
    null;

  try {
    user =
      await getAuthenticatedUser(
        req
      );

    let body =
      req.body || {};

    if (
      typeof body === "string"
    ) {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

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

    const serviceCountryPriceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    const requestedServer =
      body.providerServer ??
      body.provider_server ??
      body.server ??
      "";

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "The country id field is required."
      });
    }

    if (
      !serviceCountryPriceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The service field is required."
      });
    }

    /*
     * Get all matching admin prices.
     *
     * IMPORTANT:
     * provider_server is included so USA Server 1,
     * USA Server 2, Global Server 1 and Global Server 2
     * can each have their own selling price.
     */
    const priceRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}&select=*`
      );

    if (
      !Array.isArray(priceRows) ||
      !priceRows.length
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This country is not configured for purchase."
      });
    }

    const wantedName =
      normalizeServiceName(
        requestedServiceName
      );

    let matchingRows =
      priceRows.filter(
        (row) => {
          const sameId =
            serviceCountryPriceId &&
            (
              String(
                row?.service_id ?? ""
              ).trim() ===
              String(
                serviceCountryPriceId
              ).trim()
            );

          const sameName =
            wantedName &&
            normalizeServiceName(
              row?.service_name
            ) === wantedName;

          return (
            sameId ||
            sameName
          );
        }
      );

    if (
      !matchingRows.length
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This service is not configured for the selected country."
      });
    }

    /*
     * If the customer selected a server,
     * use THAT server and do not silently change it.
     */
    let selectedServer =
      String(
        requestedServer
      )
        .trim()
        .toLowerCase();

    if (
      selectedServer &&
      !VALID_SERVERS.includes(
        selectedServer
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          `Invalid provider server "${selectedServer}".`
      });
    }

    /*
     * If the frontend did not send a server,
     * automatically try the appropriate servers.
     *
     * For USA we allow all four portals because your
     * provider account is exposing USA through the
     * global portals as well.
     */
    let serverCandidates;

    if (selectedServer) {
      serverCandidates = [
        selectedServer
      ];
    } else if (
      isUSA(
        countryId,
        countryCode,
        countryName
      )
    ) {
      serverCandidates = [
        "usa-server-2",
        "usa-server-1",
        "global-server-2",
        "global-server-1"
      ];
    } else {
      serverCandidates = [
        "global-server-2",
        "global-server-1"
      ];
    }

    let pricing = null;

    for (
      const server of
      serverCandidates
    ) {
      const exactServerRows =
        matchingRows.filter(
          (row) =>
            normalize(
              row?.provider_server
            ) ===
            normalize(server)
        );

      if (
        exactServerRows.length
      ) {
        pricing =
          exactServerRows[0];
        selectedServer =
          server;
        break;
      }
    }

    /*
     * If no provider_server was stored in product_prices,
     * use the first matching price row rather than blocking
     * the purchase.
     */
    if (!pricing) {
      pricing =
        matchingRows[0];

      if (!selectedServer) {
        selectedServer =
          serverCandidates[0];
      }
    }

    const customerPrice =
      Number(
        pricing?.selling_price
      );

    if (
      !Number.isFinite(
        customerPrice
      ) ||
      customerPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The selling price for this service is invalid."
      });
    }

    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(
        serviceCountryPriceId
      );

    /*
     * Resolve the provider's REAL service ID.
     */
    const providerServiceId =
      pricing?.provider_service_id ||
      await resolveProviderServiceId(
        selectedServer,
        countryId,
        serviceCountryPriceId,
        serviceName
      );

    if (!providerServiceId) {
      throw new Error(
        `Unable to resolve the provider service for ${serviceName}.`
      );
    }

    /*
     * Get provider cost before taking money.
     */
    let providerPriceInfo;

    try {
      providerPriceInfo =
        await getProviderPrice(
          selectedServer,
          countryId,
          providerServiceId,
          serviceName
        );
    } catch (priceError) {
      /*
       * If admin already has a provider_cost saved,
       * use it as a safe fallback.
       */
      const savedProviderCost =
        Number(
          pricing?.provider_cost
        );

      if (
        Number.isFinite(
          savedProviderCost
        ) &&
        savedProviderCost > 0
      ) {
        providerPriceInfo = {
          price:
            savedProviderCost,
          tierId: null
        };
      } else {
        throw priceError;
      }
    }

    /*
     * Take the customer's money ONLY after the
     * provider service and provider price are valid.
     */
    const debit =
      await debitWallet(
        user.id,
        customerPrice
      );

    walletDebited = true;
    debitAmount =
      customerPrice;

    console.log(
      "PURCHASE START",
      {
        countryId,
        countryName,
        serviceName,
        providerServer:
          selectedServer,
        providerServiceId,
        providerCost:
          providerPriceInfo.price,
        customerPrice
      }
    );

    let providerResponse;

    try {
      providerResponse =
        await purchaseFromProvider(
          selectedServer,
          countryId,
          providerServiceId,
          providerPriceInfo.tierId
        );
    } catch (providerError) {
      console.error(
        "PROVIDER PURCHASE FAILED",
        {
          server:
            selectedServer,
          countryId,
          providerServiceId,
          error:
            providerError?.message
        }
      );

      /*
       * Provider purchase failed, so immediately
       * return the customer's money.
       */
      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited =
          false;
      } catch (refundError) {
        console.error(
          "Refund failed:",
          refundError
        );
      }

      throw providerError;
    }

    providerVerificationId =
      getVerificationId(
        providerResponse
      );

    const requestId =
      getRequestId(
        providerResponse
      );

    const phoneNumber =
      getPhoneNumber(
        providerResponse
      );

    const expiredAt =
      getExpiredAt(
        providerResponse
      );

    const providerStatus =
      getProviderStatus(
        providerResponse
      );

    if (
      !providerVerificationId ||
      !phoneNumber
    ) {
      /*
       * The provider answered, but did not give us
       * a usable verification/number.
       */
      await tryCancelProvider(
        providerVerificationId
      );

      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited =
          false;
      } catch (refundError) {
        console.error(
          "Refund after invalid provider response failed:",
          refundError
        );
      }

      throw new Error(
        "Provider did not return a valid phone number."
      );
    }

    /*
     * Save the purchased number in orders.
     *
     * provider_expired_at is saved so Active/SMS
     * can respect the exact provider expiry time.
     */
    let orderRows;

    try {
      orderRows =
        await createOrder(
          user.id,
          {
            requestId:
              requestId ||
              String(
                providerVerificationId
              ),

            verificationId:
              providerVerificationId,

            serviceCountryPriceId:
              serviceCountryPriceId ||
              providerServiceId,

            serviceName,

            countryName:
              pricing?.country_name ||
              countryName ||
              String(countryId),

            providerCost:
              Number(
                providerPriceInfo.price
              ),

            customerPrice,

            status:
              providerStatus,

            phoneNumber,

            expiredAt,

            providerServer:
              selectedServer
          }
        );
    } catch (databaseError) {
      console.error(
        "ORDER DATABASE INSERT FAILED:",
        databaseError
      );

      /*
       * Try to cancel the provider number so your
       * SureVerification balance is not unnecessarily
       * consumed by an order we failed to save.
       */
      await tryCancelProvider(
        providerVerificationId
      );

      /*
       * Return the customer's wallet money.
       */
      try {
        await refundWallet(
          user.id,
          customerPrice
        );

        walletDebited =
          false;
      } catch (refundError) {
        console.error(
          "Database-failure refund failed:",
          refundError
        );
      }

      throw databaseError;
    }

    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          user.id
        )}&select=user_id,balance&limit=1`
      );

    const balanceAfter =
      Number(
        walletRows?.[0]?.balance ||
        0
      );

    await createWalletTransaction({
      userId:
        user.id,
      amount:
        -customerPrice,
      balanceAfter,
      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });

    walletDebited =
      false;

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      verification: {
        ...getVerification(
          providerResponse
        ),

        id:
          providerVerificationId,

        request_id:
          requestId ||
          null,

        number:
          phoneNumber,

        expired_at:
          expiredAt ||
          null,

        status:
          providerStatus
      },

      provider_server:
        selectedServer,

      provider_service_id:
        providerServiceId,

      provider_cost:
        Number(
          providerPriceInfo.price
        ),

      customer_price:
        customerPrice,

      profit:
        customerPrice -
        Number(
          providerPriceInfo.price
        ),

      balance:
        balanceAfter
    });
  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    /*
     * Safety refund for unexpected failures that
     * happen after wallet debit.
     */
    if (
      walletDebited &&
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

    const lower =
      String(message)
        .toLowerCase();

    if (
      lower.includes(
        "insufficient"
      )
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

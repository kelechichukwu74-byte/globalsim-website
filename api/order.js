import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbJHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

function getBearerToken(req) {
  const raw =
    req?.headers?.authorization ||
    req?.headers?.Authorization ||
    "";

  const match = String(raw).match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
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
    data = {};
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
      data?.error ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}

function isUSA(
  countryId,
  countryCode,
  countryName
) {
  const id =
    String(countryId ?? "").trim();

  const code =
    String(countryCode ?? "")
      .trim()
      .toLowerCase();

  const name =
    String(countryName ?? "")
      .trim()
      .toLowerCase();

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

function normalizeServiceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

/*
 * IMPORTANT:
 * SureVerification returns:
 *
 * request_id = request/reference string
 * id         = numeric verification ID
 *
 * SMS and CANCEL require the verification ID.
 */
function getProviderVerificationId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.id ??
    verification?.verification_id ??
    verification?.verificationId ??
    null
  );
}

function getProviderRequestId(data) {
  const verification =
    getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
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

function getProviderServiceName(data) {
  const verification =
    getVerification(data);

  return (
    verification?.service ??
    verification?.service_name ??
    verification?.serviceName ??
    null
  );
}

function getProviderPrice(data) {
  const value =
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount ??
    data?.verification?.price ??
    data?.verification?.amount;

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

/* =========================================================
   WALLET
   ========================================================= */

async function debitWallet(
  userId,
  amount
) {
  const requiredAmount =
    Number(amount);

  if (
    !Number.isFinite(requiredAmount) ||
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
        `wallets?user_id=eq.${q(
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
      Number(wallet.balance || 0);

    if (
      !Number.isFinite(currentBalance)
    ) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    if (
      currentBalance < requiredAmount
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
        `wallets?user_id=eq.${q(
          userId
        )}&balance=eq.${q(
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
    !Number.isFinite(refundAmount) ||
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
        `wallets?user_id=eq.${q(
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
      Number(wallet.balance || 0);

    const newBalance =
      currentBalance +
      refundAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
          userId
        )}&balance=eq.${q(
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

/* =========================================================
   PROVIDER SERVICE RESOLUTION
   ========================================================= */

async function getServerServices(
  server,
  countryId
) {
  let path =
    `/${server}/services`;

  if (countryId) {
    path +=
      `?country_id=${q(countryId)}`;
  }

  const data =
    await sureVerificationRequest(
      path,
      {
        method: "GET"
      }
    );

  const services =
    Array.isArray(data?.services)
      ? data.services
      : Array.isArray(data?.data?.services)
        ? data.data.services
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];

  return services;
}

function resolveProviderService(
  services,
  requestedId,
  requestedName
) {
  if (!Array.isArray(services)) {
    return null;
  }

  const id =
    String(requestedId ?? "")
      .trim();

  const name =
    normalizeServiceName(
      requestedName
    );

  let match =
    services.find(
      service =>
        String(
          service?.id ??
          service?.service_id ??
          service?.serviceId ??
          ""
        ).trim() === id
    );

  if (match) {
    return match;
  }

  match =
    services.find(
      service =>
        normalizeServiceName(
          service?.name ??
          service?.service_name ??
          service?.serviceName
        ) === name
    );

  if (match) {
    return match;
  }

  match =
    services.find(
      service => {
        const providerName =
          normalizeServiceName(
            service?.name ??
            service?.service_name ??
            service?.serviceName
          );

        return (
          providerName &&
          name &&
          (
            providerName.includes(name) ||
            name.includes(providerName)
          )
        );
      }
    );

  return match || null;
}

/* =========================================================
   PROVIDER PURCHASE
   ========================================================= */

async function purchaseUSA(
  server,
  countryId,
  serviceId,
  serviceName
) {
  const services =
    await getServerServices(
      server,
      countryId
    );

  const service =
    resolveProviderService(
      services,
      serviceId,
      serviceName
    );

  if (!service) {
    throw new Error(
      `${server} service not found for "${serviceName || serviceId}".`
    );
  }

  const providerServiceId =
    service.id ??
    service.service_id ??
    service.serviceId;

  if (!providerServiceId) {
    throw new Error(
      `${server} returned an invalid service ID.`
    );
  }

  return await sureVerificationRequest(
    `/${server}/purchase?country_id=${q(
      countryId
    )}&service=${q(
      providerServiceId
    )}`,
    {
      method: "POST"
    }
  );
}

async function purchaseGlobal1(
  countryId,
  serviceId,
  serviceName
) {
  const services =
    await getServerServices(
      "global-server-1",
      countryId
    );

  const service =
    resolveProviderService(
      services,
      serviceId,
      serviceName
    );

  if (!service) {
    throw new Error(
      `Global Server 1 service not found for "${serviceName || serviceId}".`
    );
  }

  const providerServiceId =
    service.id ??
    service.service_id ??
    service.serviceId;

  return await sureVerificationRequest(
    `/global-server-1/purchase?country_id=${q(
      countryId
    )}&service=${q(
      providerServiceId
    )}`,
    {
      method: "POST"
    }
  );
}

async function purchaseGlobal2(
  serviceId,
  serviceName
) {
  /*
   * Global Server 2 has a different API design.
   * Its documented purchase endpoint does not require
   * country_id/service query parameters.
   *
   * We therefore call its documented purchase endpoint
   * directly instead of sending USA-style parameters.
   */
  const data =
    await sureVerificationRequest(
      "/global-server-2/purchase",
      {
        method: "POST"
      }
    );

  /*
   * Verify that the provider returned the requested
   * service when possible.
   */
  const providerService =
    getProviderServiceName(data);

  if (
    providerService &&
    serviceName
  ) {
    const requested =
      normalizeServiceName(
        serviceName
      );

    const returned =
      normalizeServiceName(
        providerService
      );

    if (
      requested &&
      returned &&
      !(
        returned === requested ||
        returned.includes(requested) ||
        requested.includes(returned)
      )
    ) {
      throw new Error(
        `Global Server 2 returned "${providerService}" instead of "${serviceName}".`
      );
    }
  }

  return data;
}

async function purchaseFromProvider({
  providerServer,
  countryId,
  serviceId,
  serviceName
}) {
  if (
    !ALLOWED_SERVERS.has(
      providerServer
    )
  ) {
    throw new Error(
      "Invalid provider server."
    );
  }

  switch (providerServer) {
    case "usa-server-1":
      return await purchaseUSA(
        "usa-server-1",
        countryId,
        serviceId,
        serviceName
      );

    case "usa-server-2":
      return await purchaseUSA(
        "usa-server-2",
        countryId,
        serviceId,
        serviceName
      );

    case "global-server-1":
      return await purchaseGlobal1(
        countryId,
        serviceId,
        serviceName
      );

    case "global-server-2":
      return await purchaseGlobal2(
        serviceId,
        serviceName
      );

    default:
      throw new Error(
        "Unsupported provider server."
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
  return await supabaseRequest(
    "orders",
    {
      method: "POST",
      body: JSON.stringify({
        user_id:
          userId,

        provider_order_id:
          order.providerRequestId,

        provider_verification_id:
          order.providerVerificationId,

        service_country_price_id:
          order.serviceCountryPriceId,

        service_name:
          order.serviceName,

        country_name:
          order.countryName,

        provider_cost:
          order.providerPrice ?? 0,

        customer_price:
          order.sellingPrice,

        profit:
          Number.isFinite(
            order.providerPrice
          )
            ? order.sellingPrice -
              order.providerPrice
            : 0,

        status:
          order.status ||
          "active",

        phone_number:
          order.phoneNumber,

        provider_name:
          "SureVerification",

        provider_server:
          order.providerServer,

        provider_base_url:
          "https://sureverifications.com/api/v1",

        provider_expired_at:
          order.expiredAt
      })
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
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let user = null;
  let debited = false;
  let debitAmount = 0;

  try {
    user =
      await getAuthenticatedUser(req);

    const body =
      req.body || {};

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

    const requestedServiceId =
      body.serviceId ??
      body.service_id ??
      body.serviceCountryPriceId;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country is required."
      });
    }

    if (
      !requestedServiceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    /*
     * IMPORTANT:
     * Find the exact pricing row, including provider server.
     */
    let pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${q(
          countryId
        )}&or=(service_id.eq.${q(
          requestedServiceId || ""
        )},provider_service_id.eq.${q(
          requestedServiceId || ""
        )})&select=id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id,provider_cost,is_active&order=provider_server.asc&limit=20`
      );

    /*
     * Fallback by service name.
     */
    if (
      (!Array.isArray(pricingRows) ||
        !pricingRows.length) &&
      requestedServiceName
    ) {
      const allRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${q(
            countryId
          )}&select=id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id,provider_cost,is_active&limit=100`
        );

      const wanted =
        normalizeServiceName(
          requestedServiceName
        );

      pricingRows =
        Array.isArray(allRows)
          ? allRows.filter(
              row =>
                normalizeServiceName(
                  row?.service_name
                ) === wanted
            )
          : [];
    }

    if (
      !Array.isArray(pricingRows) ||
      !pricingRows.length
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase."
      });
    }

    /*
     * Respect the server selected by the customer.
     * If the frontend sends server, use it.
     * Otherwise use the saved provider_server row.
     */
    const requestedServer =
      String(
        body.server ||
        body.providerServer ||
        ""
      ).trim();

    let pricing =
      requestedServer
        ? pricingRows.find(
            row =>
              String(
                row?.provider_server ||
                ""
              ).trim() ===
              requestedServer
          )
        : null;

    if (!pricing) {
      /*
       * If no explicit server was sent,
       * use the preferred server already configured
       * for this pricing row.
       */
      pricing =
        pricingRows.find(
          row =>
            row?.is_active !== false &&
            row?.provider_server
        ) ||
        pricingRows[0];
    }

    if (!pricing) {
      return res.status(400).json({
        success: false,
        error:
          "No provider server is configured for this service."
      });
    }

    const providerServer =
      String(
        pricing.provider_server ||
        requestedServer ||
        ""
      ).trim();

    if (
      !ALLOWED_SERVERS.has(
        providerServer
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid provider server configuration."
      });
    }

    const sellingPrice =
      Number(
        pricing.selling_price
      );

    if (
      !Number.isFinite(
        sellingPrice
      ) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase."
      });
    }

    const serviceName =
      pricing.service_name ||
      requestedServiceName ||
      String(
        requestedServiceId
      );

    /*
     * The provider service ID must come from
     * the provider-specific pricing row.
     */
    const providerServiceId =
      pricing.provider_service_id ||
      pricing.service_id ||
      requestedServiceId;

    if (!providerServiceId) {
      return res.status(400).json({
        success: false,
        error:
          "Provider service ID is missing."
      });
    }

    /*
     * Debit customer's selling price.
     */
    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited = true;
    debitAmount =
      sellingPrice;

    let providerData;

    try {
      providerData =
        await purchaseFromProvider({
          providerServer,
          countryId,
          serviceId:
            providerServiceId,
          serviceName
        });
    } catch (providerError) {
      console.error(
        `SureVerification ${providerServer} purchase error:`,
        providerError
      );

      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Automatic purchase refund failed:",
          refundError
        );
      }

      debited = false;

      throw providerError;
    }

    /*
     * Read provider response correctly.
     */
    const verification =
      getVerification(
        providerData
      );

    const providerVerificationId =
      getProviderVerificationId(
        providerData
      );

    const providerRequestId =
      getProviderRequestId(
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

    const returnedService =
      getProviderServiceName(
        providerData
      );

    /*
     * The numeric verification ID is mandatory
     * because SMS and cancel use it.
     */
    if (
      providerVerificationId === null ||
      providerVerificationId === undefined ||
      providerVerificationId === "" ||
      !phoneNumber
    ) {
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Refund after incomplete provider response failed:",
          refundError
        );
      }

      debited = false;

      throw new Error(
        "The provider did not return a valid number. Your wallet was refunded."
      );
    }

    /*
     * Save provider cost if returned.
     * Otherwise retain configured provider cost.
     */
    const returnedProviderPrice =
      getProviderPrice(
        providerData
      );

    const configuredProviderPrice =
      Number(
        pricing.provider_cost
      );

    const providerPrice =
      Number.isFinite(
        returnedProviderPrice
      )
        ? returnedProviderPrice
        : (
            Number.isFinite(
              configuredProviderPrice
            )
              ? configuredProviderPrice
              : null
          );

    /*
     * Create order.
     */
    const orderRows =
      await createOrder(
        user.id,
        {
          serviceCountryPriceId:
            pricing.id ||
            pricing.service_id ||
            requestedServiceId,

          serviceName,

          countryName:
            pricing.country_name ||
            countryName ||
            String(countryId),

          providerServer,

          providerRequestId:
            providerRequestId ||
            String(
              providerVerificationId
            ),

          providerVerificationId,

          phoneNumber,

          expiredAt,

          sellingPrice,

          providerPrice,

          status:
            verification?.status ||
            "active"
        }
      );

    /*
     * Get final wallet balance.
     */
    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
          user.id
        )}&select=balance&limit=1`
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
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });

    debited = false;

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order:
        orderRows?.[0] ||
        null,

      provider_server:
        providerServer,

      verification: {
        ...verification,

        request_id:
          providerRequestId,

        id:
          providerVerificationId,

        number:
          phoneNumber,

        expired_at:
          expiredAt,

        service:
          returnedService ||
          verification?.service ||
          serviceName
      },

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

    if (
      String(message)
        .toLowerCase()
        .includes("insufficient")
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
        error:
          "Unauthorized."
      });
    }

    return res.status(500).json({
      success: false,
      error: message,
      message
    });
  }
}

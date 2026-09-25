import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        ...(options.headers || {})
      }
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

function quote(value) {
  return encodeURIComponent(String(value));
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
  return Number.isFinite(number) ? number : NaN;
}

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data
  );
}

/*
 * IMPORTANT:
 * SureVerification uses verification.id for SMS/cancel.
 * request_id is the purchase/request reference and is kept separately.
 */
function getVerificationId(data) {
  const verification = getVerification(data);

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
  const verification = getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    data?.request_id ??
    data?.requestId ??
    null
  );
}

function getPhoneNumber(data) {
  const verification = getVerification(data);

  return (
    verification?.number ??
    verification?.phone_number ??
    verification?.phoneNumber ??
    verification?.phone ??
    null
  );
}

function isUSA(countryId, countryCode, countryName) {
  const values = [
    countryId,
    countryCode,
    countryName
  ].map((value) =>
    String(value ?? "").trim().toLowerCase()
  );

  return (
    values.includes("us") ||
    values.includes("usa") ||
    values.includes("united states") ||
    values.includes("united states of america")
  );
}

function normalizeServiceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getArrayFromProvider(data, keys = []) {
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

  if (Array.isArray(data?.providerResponse)) {
    return data.providerResponse;
  }

  if (Array.isArray(data?.providerResponse?.services)) {
    return data.providerResponse.services;
  }

  if (Array.isArray(data?.providerResponse?.data)) {
    return data.providerResponse.data;
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

/*
 * The browser's serviceCountryPriceId is our internal pricing key.
 * It is NOT assumed to be the provider's service ID.
 *
 * We first ask the exact provider server for its service catalogue,
 * then match by ID or by service name. This prevents an internal
 * value such as "wa" from being sent to a provider that expects
 * a different service identifier.
 */
async function resolveProviderServiceId(
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${quote(countryId)}`
    );

  const services = getArrayFromProvider(
    data,
    ["services", "items", "results"]
  );

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  const requestedId =
    String(requestedServiceId ?? "").trim();

  if (requestedId) {
    const direct = services.find(
      (service) =>
        String(
          getServiceId(service) ?? ""
        ).trim() === requestedId
    );

    if (direct) {
      return String(
        getServiceId(direct)
      ).trim();
    }
  }

  const wantedName =
    normalizeServiceName(
      requestedServiceName
    );

  if (wantedName) {
    const exactName = services.find(
      (service) =>
        normalizeServiceName(
          getServiceName(service)
        ) === wantedName
    );

    if (exactName) {
      return String(
        getServiceId(exactName)
      ).trim();
    }

    /*
     * Handle common provider naming differences such as:
     * "WhatsApp" vs "Whatsapp", "Telegram" vs "Telegram App".
     */
    const partialName = services.find(
      (service) => {
        const providerName =
          normalizeServiceName(
            getServiceName(service)
          );

        return (
          providerName &&
          (providerName.includes(wantedName) ||
            wantedName.includes(providerName))
        );
      }
    );

    if (partialName) {
      return String(
        getServiceId(partialName)
      ).trim();
    }
  }

  throw new Error(
    `The selected service (${requestedServiceName || requestedServiceId}) is not available on ${server} for country ${countryId}.`
  );
}

async function debitWallet(userId, amount) {
  const requiredAmount = Number(amount);

  if (
    !Number.isFinite(requiredAmount) ||
    requiredAmount <= 0
  ) {
    throw new Error("Invalid purchase amount.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await supabaseRequest(
      `wallets?user_id=eq.${quote(
        userId
      )}&select=user_id,balance&limit=1`
    );

    const wallet = rows?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found. Please contact support."
      );
    }

    const currentBalance =
      Number(wallet.balance || 0);

    if (!Number.isFinite(currentBalance)) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    if (currentBalance < requiredAmount) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      currentBalance - requiredAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
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
        previousBalance: currentBalance,
        newBalance
      };
    }
  }

  throw new Error(
    "Wallet is being updated by another transaction. Please try again."
  );
}

async function refundWallet(userId, amount) {
  const refundAmount = Number(amount);

  if (
    !Number.isFinite(refundAmount) ||
    refundAmount <= 0
  ) {
    return null;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await supabaseRequest(
      `wallets?user_id=eq.${quote(
        userId
      )}&select=user_id,balance&limit=1`
    );

    const wallet = rows?.[0];

    if (!wallet) {
      throw new Error(
        "Wallet not found while processing refund."
      );
    }

    const currentBalance =
      Number(wallet.balance || 0);

    const newBalance =
      currentBalance + refundAmount;

    const updated =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          userId
        )}&balance=eq.${encodeURIComponent(
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
        previousBalance: currentBalance,
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
          balance_after: balanceAfter,
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

async function createOrder(userId, order) {
  return await supabaseRequest(
    "orders",
    {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,

        /*
         * request_id identifies the purchase/request.
         */
        provider_order_id:
          order.requestId,

        /*
         * verification.id is the ID required by the
         * SMS and cancellation endpoints.
         */
        provider_verification_id:
          order.verificationId,

        service_country_price_id:
          order.serviceCountryPriceId,

        service_name:
          order.serviceName,

        country_name:
          order.countryName,

        provider_cost:
          order.providerPrice,

        customer_price:
          order.sellingPrice,

        profit:
          Number.isFinite(order.providerPrice)
            ? order.sellingPrice -
              order.providerPrice
            : null,

        status:
          order.status || "active",

        phone_number:
          order.phoneNumber,
        provider_server:
          order.providerServer,
        provider_base_url:
          "https://sureverifications.com/api/v1"
      })
    }
  );
}

export default async function handler(req, res) {
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

    const body = req.body || {};

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

    /*
     * This is the internal pricing/service key
     * sent by your existing frontend.
     */
    const serviceId =
      body.serviceCountryPriceId ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";

    const selectedServer =
      String(
        body.providerServer ??
        body.server ??
        ""
      ).trim();

    const allowedServers = new Set([
      "usa-server-1",
      "usa-server-2",
      "global-server-1",
      "global-server-2"
    ]);

    if (!selectedServer || !allowedServers.has(selectedServer)) {
      return res.status(400).json({
        success: false,
        error: "Seller / server is required."
      });
    }

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country is required."
      });
    }

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    /*
     * The customer price always comes from your admin
     * product_prices table. The browser cannot choose it.
     */
    let pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}&provider_server=eq.${quote(
          selectedServer
        )}&service_id=eq.${quote(
          serviceId
        )}&select=country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id&limit=1`
      );

    /*
     * If the service ID stored by the frontend is not the
     * same value stored in product_prices, try matching the
     * configured service name for the same country.
     */
    if (
      (!Array.isArray(pricingRows) ||
        !pricingRows.length) &&
      requestedServiceName
    ) {
      const countryRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${quote(
            countryId
          )}&provider_server=eq.${quote(
            selectedServer
          )}&select=country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id`
        );

      const wanted =
        normalizeServiceName(
          requestedServiceName
        );

      pricingRows =
        Array.isArray(countryRows)
          ? countryRows.filter(
              (row) =>
                normalizeServiceName(
                  row?.service_name
                ) === wanted
            )
          : [];
    }

    const pricing =
      pricingRows?.[0];

    const sellingPrice =
      Number(pricing?.selling_price);

    if (
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase."
      });
    }

    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(serviceId);

    const usa = isUSA(countryId, countryCode, countryName);

    /* The customer-selected server is the ONLY server used. */
    const servers = [selectedServer];

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited = true;
    debitAmount = sellingPrice;

    let providerData = null;
    let providerError = null;
    let selectedServer = null;
    let providerServiceId = null;

    for (const server of servers) {
      try {
        providerServiceId =
          await resolveProviderServiceId(
            server,
            countryId,
            serviceId,
            serviceName
          );

        console.log(
          "SureVerification purchase:",
          {
            server,
            countryId,
            requestedServiceId:
              serviceId,
            providerServiceId,
            serviceName
          }
        );

        const candidate =
          await sureVerificationRequest(
            `/${server}/purchase?country_id=${quote(
              countryId
            )}&service=${quote(
              providerServiceId
            )}`,
            {
              method: "POST"
            }
          );

        console.log(
          "SureVerification response:",
          JSON.stringify(candidate)
        );

        const candidateVerificationId =
          getVerificationId(
            candidate
          );

        const candidatePhoneNumber =
          getPhoneNumber(candidate);

        if (
          candidateVerificationId &&
          candidatePhoneNumber
        ) {
          providerData =
            candidate;
          selectedServer =
            server;
          break;
        }

        providerError =
          new Error(
            "Provider did not return a valid number."
          );
      } catch (error) {
        providerError =
          error;

        console.error(
          "SureVerification purchase attempt failed:",
          {
            server,
            countryId,
            requestedServiceId:
              serviceId,
            providerServiceId,
            message:
              error?.message
          }
        );

        // No fallback: never switch away from the customer's selected server.
      }
    }

    if (!providerData) {
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

      throw new Error(
        providerError?.message ||
        "No number is currently available from the provider."
      );
    }

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

    if (
      !verificationId ||
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

    const providerPrice =
      getProviderPrice(
        providerData
      );

    const orderRows =
      await createOrder(
        user.id,
        {
          requestId:
            requestId ||
            verificationId,

          verificationId,

          serviceCountryPriceId:
            serviceId,

          serviceName,

          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),

          phoneNumber,

          providerServer: selectedServer,

          sellingPrice,

          providerPrice:
            Number.isFinite(
              providerPrice
            )
              ? providerPrice
              : null,

          status:
            verification?.status ||
            "active"
        }
      );

    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${quote(
          user.id
        )}&select=balance&limit=1`
      );

    const balanceAfter =
      Number(
        walletRows?.[0]?.balance || 0
      );

    await createWalletTransaction({
      userId: user.id,
      amount: -sellingPrice,
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

      verification: {
        ...verification,

        /*
         * Keep request_id in the response for
         * compatibility with your existing frontend,
         * but the real verification ID is also returned.
         */
        request_id:
          requestId ||
          null,

        id:
          verificationId,

        number:
          phoneNumber
      },

      provider_server:
        selectedServer,

      provider_service_id:
        providerServiceId,

      provider_price:
        Number.isFinite(
          providerPrice
        )
          ? providerPrice
          : null,

      selling_price:
        sellingPrice,

      sellingPrice:
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
     * Safety refund if an unexpected error occurs
     * after the wallet was debited.
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
      message === "Unauthorized."
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

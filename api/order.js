import { sureVerificationRequest } from "./sms/_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbJHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(req) {
  const headers = req?.headers || {};

  const raw =
    headers.authorization ||
    headers.Authorization ||
    headers["x-authorization"] ||
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
    console.error(
      "Supabase auth verification failed:",
      response.status,
      data
    );
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
      body: options.body,
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

function q(value) {
  return encodeURIComponent(String(value));
}

function isUSA(countryId, countryCode, countryName) {
  const id = String(countryId ?? "").trim();
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

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data
  );
}

function getVerificationId(data) {
  const verification = getVerification(data);

  return (
    verification?.request_id ??
    verification?.requestId ??
    verification?.verification_id ??
    verification?.verificationId ??
    verification?.id ??
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

function getProviderPrice(data) {
  const value =
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount ??
    data?.verification?.price ??
    data?.verification?.amount;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function getServiceIdFromList(data, requestedId, requestedName) {
  const services =
    Array.isArray(data?.services)
      ? data.services
      : Array.isArray(data?.data?.services)
        ? data.data.services
        : Array.isArray(data?.data)
          ? data.data
          : [];

  if (!services.length) {
    return null;
  }

  const id = String(requestedId ?? "").trim();
  const name = String(requestedName ?? "").trim().toLowerCase();

  const exactId = services.find(
    item => String(item?.id ?? "").trim() === id
  );

  if (exactId?.id) {
    return exactId.id;
  }

  const exactName = services.find(
    item =>
      String(item?.name ?? "").trim().toLowerCase() === name
  );

  if (exactName?.id) {
    return exactName.id;
  }

  const fuzzyName = services.find(
    item => {
      const providerName =
        String(item?.name ?? "").trim().toLowerCase();

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

  return fuzzyName?.id || null;
}

async function getUSProviderService(countryId, requestedId, requestedName) {
  const data = await sureVerificationRequest(
    `/usa-server-2/services?country_id=${q(countryId)}`,
    { method: "GET" }
  );

  const providerServiceId =
    getServiceIdFromList(
      data,
      requestedId,
      requestedName
    );

  if (!providerServiceId) {
    throw new Error(
      `USA provider service not found for "${requestedName || requestedId}".`
    );
  }

  return providerServiceId;
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
      `wallets?user_id=eq.${q(userId)}&select=user_id,balance&limit=1`
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

    const updated = await supabaseRequest(
      `wallets?user_id=eq.${q(userId)}&balance=eq.${q(currentBalance)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          balance: newBalance,
          updated_at: new Date().toISOString()
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
      `wallets?user_id=eq.${q(userId)}&select=user_id,balance&limit=1`
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

    const updated = await supabaseRequest(
      `wallets?user_id=eq.${q(userId)}&balance=eq.${q(currentBalance)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          balance: newBalance,
          updated_at: new Date().toISOString()
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
        provider_order_id: order.verificationId,
        service_country_price_id:
          order.serviceCountryPriceId,
        service_name: order.serviceName,
        country_name: order.countryName,
        provider_cost: order.providerPrice,
        customer_price: order.sellingPrice,
        profit:
          Number.isFinite(order.providerPrice)
            ? order.sellingPrice - order.providerPrice
            : null,
        status: order.status || "active",
        phone_number: order.phoneNumber
      })
    }
  );
}

async function purchaseFromProvider({
  countryId,
  countryCode,
  countryName,
  serviceId,
  serviceName
}) {
  /*
   * USA:
   * 1. Resolve the provider's USA Server 2 service ID dynamically.
   * 2. Purchase using country_id + provider service ID.
   */
  if (
    isUSA(
      countryId,
      countryCode,
      countryName
    )
  ) {
    const providerServiceId =
      await getUSProviderService(
        countryId,
        serviceId,
        serviceName
      );

    return await sureVerificationRequest(
      `/usa-server-2/purchase?country_id=${q(
        countryId
      )}&service=${q(providerServiceId)}`,
      {
        method: "POST"
      }
    );
  }

  /*
   * All non-USA countries use Global Server 2.
   *
   * IMPORTANT:
   * SureVerification's documented Global Server 2
   * purchase endpoint takes NO query parameters.
   */
  return await sureVerificationRequest(
    "/global-server-2/purchase",
    {
      method: "POST"
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
    user = await getAuthenticatedUser(req);

    const body = req.body || {};

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

    const serviceId =
      body.serviceCountryPriceId ??
      body.serviceId ??
      body.service_id;

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

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    /*
     * Price is read from the database.
     * The browser cannot choose the amount to debit.
     */
    const pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${q(
          countryId
        )}&service_id=eq.${q(
          serviceId
        )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
      );

    let pricing =
      pricingRows?.[0] || null;

    /*
     * Some older frontend rows use a provider/internal service ID
     * instead of service_country_price_id. If the exact ID is not found,
     * fall back to country + service name.
     */
    if (!pricing && requestedServiceName) {
      const fallbackRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${q(
            countryId
          )}&service_name=ilike.${q(
            requestedServiceName
          )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
        );

      pricing =
        fallbackRows?.[0] || null;
    }

    const sellingPrice =
      Number(pricing?.selling_price);

    if (
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase.",
        message:
          "This country and service is not currently available for purchase."
      });
    }

    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(serviceId);

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited = true;
    debitAmount = sellingPrice;

    let providerData = null;

    try {
      providerData =
        await purchaseFromProvider({
          countryId,
          countryCode,
          countryName,
          serviceId:
            pricing?.service_id ||
            serviceId,
          serviceName
        });
    } catch (providerError) {
      console.error(
        "SureVerification purchase error:",
        providerError
      );

      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (refundError) {
        console.error(
          "Automatic refund failed:",
          refundError
        );
      }

      debited = false;

      throw providerError;
    }

    const verification =
      getVerification(providerData);

    const verificationId =
      getVerificationId(providerData);

    const phoneNumber =
      getPhoneNumber(providerData);

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
      getProviderPrice(providerData);

    const orderRows =
      await createOrder(
        user.id,
        {
          serviceCountryPriceId:
            pricing?.service_id ||
            serviceId,
          serviceName,
          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),
          verificationId,
          phoneNumber,
          sellingPrice,
          providerPrice,
          status:
            verification?.status ||
            "active"
        }
      );

    const walletRows =
      await supabaseRequest(
        `wallets?user_id=eq.${q(
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
        orderRows?.[0] || null,
      verification: {
        ...verification,
        request_id: verificationId,
        number: phoneNumber
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
      message === "Unauthorized."
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized."
      });
    }

    return res.status(500).json({
      success: false,
      error: message,
      message
    });
  }
}

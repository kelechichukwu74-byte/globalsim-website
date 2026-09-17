import {
  sureVerificationRequest,
  getServerForCountry
} from "./_lib.js";

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
  return Number(
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount ??
    data?.verification?.price ??
    data?.verification?.amount
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
      `wallets?user_id=eq.${quote(userId)}&select=user_id,balance&limit=1`
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
      `wallets?user_id=eq.${quote(userId)}&balance=eq.${encodeURIComponent(
        currentBalance
      )}`,
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
      `wallets?user_id=eq.${quote(userId)}&select=user_id,balance&limit=1`
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
      `wallets?user_id=eq.${quote(userId)}&balance=eq.${encodeURIComponent(
        currentBalance
      )}`,
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
        country_id: order.countryId,
        country_name: order.countryName,
        service_id: order.serviceId,
        service_name: order.serviceName,
        verification_id: order.verificationId,
        phone_number: order.phoneNumber,
        price: order.sellingPrice,
        provider_price: order.providerPrice,
        status: order.status || "active"
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
    user = await getAuthenticatedUser(req);

    const body = req.body || {};

    const countryId =
      body.countryId ??
      body.country_id;

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
     * The customer price MUST come from Admin Pricing.
     * Never trust a price sent from the browser.
     */
    const pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}&service_id=eq.${quote(
          serviceId
        )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
      );

    const pricing =
      pricingRows?.[0];

    const sellingPrice =
      Number(
        pricing?.selling_price
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
      pricing?.service_name ||
      requestedServiceName ||
      String(serviceId);

    const server =
      body.server ||
      getServerForCountry(
        countryId
      );

    /*
     * Debit the customer's selling price first.
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
        await sureVerificationRequest(
          `/${server}/purchase?country_id=${quote(
            countryId
          )}&service=${quote(
            serviceId
          )}`,
          {
            method: "POST"
          }
        );
    } catch (providerError) {
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
        "Unable to purchase number from the provider."
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
          countryId,
          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),
          serviceId,
          serviceName,
          verificationId,
          phoneNumber,
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
      verification: {
        ...verification,
        request_id:
          verificationId,
        number:
          phoneNumber
      },
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
     * Safety refund if an unexpected error happens
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

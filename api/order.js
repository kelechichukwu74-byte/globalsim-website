const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_API_KEY =
  process.env.SUREVERIFICATION_API_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";


/* =========================================================
   AUTH
========================================================= */

function getToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}


async function authenticate(req) {
  const token = getToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
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
   SUPABASE
========================================================= */

async function db(path, options = {}) {
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
    data = {
      message: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.details ||
      data?.hint ||
      `Supabase request failed (${response.status})`
    );
  }

  return data;
}


/* =========================================================
   BODY
========================================================= */

function getBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "object") {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}


function firstValue(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return String(value).trim();
    }
  }

  return "";
}


/* =========================================================
   WALLET
========================================================= */

async function getWallet(userId) {
  const rows = await db(
    `wallets?user_id=eq.${encodeURIComponent(
      userId
    )}&select=*&limit=1`
  );

  if (!rows?.[0]) {
    throw new Error("Wallet not found.");
  }

  return rows[0];
}


async function deductWallet(
  userId,
  amount
) {
  const value = Number(amount);

  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet =
      await getWallet(userId);

    const balance =
      Number(wallet.balance || 0);

    if (!Number.isFinite(balance)) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    if (balance < value) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      balance - value;

    const updated =
      await db(
        `wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&balance=eq.${encodeURIComponent(
          balance
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
        before: balance,
        after: newBalance
      };
    }
  }

  throw new Error(
    "Unable to update wallet balance."
  );
}


async function refundWallet(
  userId,
  amount
) {
  const value = Number(amount);

  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet =
      await getWallet(userId);

    const balance =
      Number(wallet.balance || 0);

    const newBalance =
      balance + value;

    const updated =
      await db(
        `wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&balance=eq.${encodeURIComponent(
          balance
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
        before: balance,
        after: newBalance
      };
    }
  }

  throw new Error(
    "Unable to refund wallet."
  );
}


/* =========================================================
   TRANSACTION
========================================================= */

async function recordTransaction(
  userId,
  type,
  amount,
  before,
  after,
  referenceId,
  description
) {
  try {
    await db(
      "wallet_transactions",
      {
        method: "POST",

        body: JSON.stringify({
          user_id: userId,
          type,
          amount: Number(amount),
          balance_before: Number(before),
          balance_after: Number(after),
          reference_id:
            referenceId || null,
          description
        })
      }
    );
  } catch (error) {
    console.error(
      "Transaction recording error:",
      error
    );
  }
}


/* =========================================================
   GET SELLING PRICE
========================================================= */

async function getSellingPrice(
  countryId,
  service
) {
  const rows =
    await db(
      `product_prices?country_id=eq.${encodeURIComponent(
        countryId
      )}&service_id=eq.${encodeURIComponent(
        service
      )}&select=selling_price&limit=1`
    );

  const price =
    Number(
      rows?.[0]?.selling_price
    );

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    throw new Error(
      "Selling price is not configured for this country and service."
    );
  }

  return price;
}


/* =========================================================
   PROVIDER SERVER
========================================================= */

function selectServer(
  countryId,
  countryName
) {
  const country =
    String(countryName || "")
      .toLowerCase()
      .trim();

  const isUSA =
    country === "united states" ||
    country === "usa" ||
    country === "us" ||
    String(countryId) === "236";

  if (isUSA) {
    return {
      name: "usa-server-2",
      path: "/usa-server-2"
    };
  }

  return {
    name: "global-server-2",
    path: "/global-server-2"
  };
}


/* =========================================================
   PROVIDER PURCHASE
========================================================= */

async function purchaseFromProvider(
  countryId,
  service,
  countryName
) {
  if (!SURE_API_KEY) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const server =
    selectServer(
      countryId,
      countryName
    );

  const url =
    `${SURE_BASE_URL}${server.path}/purchase` +
    `?country_id=${encodeURIComponent(
      countryId
    )}` +
    `&service=${encodeURIComponent(
      service
    )}`;

  console.log(
    "SureVerification purchase:",
    {
      server: server.name,
      countryId,
      service
    }
  );

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "x-api-key":
            SURE_API_KEY,

          Accept:
            "application/json"
        }
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
    data = {
      message: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.details ||
      data?.hint ||
      `SureVerification purchase failed (${response.status})`
    );
  }

  const verification =
    data?.verification ||
    data?.data?.verification ||
    data;

  return {
    server: server.name,
    raw: data,
    verification
  };
}


/* =========================================================
   PROVIDER CANCEL / ROLLBACK
========================================================= */

async function cancelProvider(
  verificationId
) {
  if (!verificationId) return;

  try {
    await fetch(
      `${SURE_BASE_URL}/verifications/cancel/${encodeURIComponent(
        verificationId
      )}`,
      {
        method: "DELETE",

        headers: {
          "x-api-key":
            SURE_API_KEY,

          Accept:
            "application/json"
        }
      }
    );
  } catch (error) {
    console.error(
      "Provider rollback failed:",
      error
    );
  }
}


/* =========================================================
   MAIN
========================================================= */

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
    /* -----------------------------------------------------
       USER
    ----------------------------------------------------- */

    const user =
      await authenticate(req);

    const body =
      getBody(req);

    const query =
      req.query || {};


    /* -----------------------------------------------------
       COUNTRY
    ----------------------------------------------------- */

    const countryId =
      firstValue(
        body.countryId,
        body.country_id,
        body.countryID,
        query.countryId,
        query.country_id
      );

    const countryName =
      firstValue(
        body.countryName,
        body.country_name,
        body.country,
        query.countryName,
        query.country_name
      );


    /* -----------------------------------------------------
       SERVICE
    ----------------------------------------------------- */

    const service =
      firstValue(
        body.service,
        body.serviceId,
        body.service_id,
        body.serviceCode,
        body.service_code,
        body.serviceName,
        body.service_name,
        query.service,
        query.serviceId,
        query.service_id,
        query.serviceCode,
        query.service_code,
        query.serviceName,
        query.service_name
      );


    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country is required."
      });
    }

    if (!service) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }


    /* -----------------------------------------------------
       GET SELLING PRICE FROM DATABASE
    ----------------------------------------------------- */

    const customerPrice =
      await getSellingPrice(
        countryId,
        service
      );


    console.log(
      "Resolved selling price:",
      {
        countryId,
        service,
        customerPrice
      }
    );


    /* -----------------------------------------------------
       CHECK WALLET BEFORE PROVIDER PURCHASE
    ----------------------------------------------------- */

    const wallet =
      await getWallet(user.id);

    const currentBalance =
      Number(wallet.balance || 0);

    if (
      !Number.isFinite(currentBalance) ||
      currentBalance < customerPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance."
      });
    }


    /* -----------------------------------------------------
       PROVIDER PURCHASE
    ----------------------------------------------------- */

    const provider =
      await purchaseFromProvider(
        countryId,
        service,
        countryName
      );

    const verification =
      provider.verification || {};


    const providerOrderId =
      verification.request_id ||
      verification.requestId ||
      null;


    const providerVerificationId =
      verification.id ||
      verification.verification_id ||
      verification.verificationId ||
      null;


    const phoneNumber =
      verification.number ||
      verification.phone_number ||
      verification.phone ||
      null;


    const providerService =
      verification.service ||
      service;


    const providerStatus =
      verification.status ||
      "active";


    const providerExpiredAt =
      verification.expired_at ||
      verification.expiredAt ||
      null;


    if (
      !providerVerificationId &&
      !providerOrderId
    ) {
      throw new Error(
        "Provider did not return a valid verification ID."
      );
    }


    if (!phoneNumber) {
      if (providerVerificationId) {
        await cancelProvider(
          providerVerificationId
        );
      }

      throw new Error(
        "Provider did not return a phone number."
      );
    }


    /* -----------------------------------------------------
       DEDUCT WALLET
    ----------------------------------------------------- */

    let walletResult;

    try {
      walletResult =
        await deductWallet(
          user.id,
          customerPrice
        );
    } catch (error) {
      if (providerVerificationId) {
        await cancelProvider(
          providerVerificationId
        );
      }

      throw error;
    }


    /* -----------------------------------------------------
       SAVE ORDER
    ----------------------------------------------------- */

    let savedOrder;

    try {
      const inserted =
        await db(
          "orders",
          {
            method: "POST",

            body: JSON.stringify({
              user_id:
                user.id,

              provider_order_id:
                providerOrderId,

              provider_verification_id:
                providerVerificationId,

              service_country_price_id:
                `${countryId}:${service}`,

              service_name:
                providerService,

              country_name:
                countryName,

              provider_cost:
                0,

              customer_price:
                customerPrice,

              profit:
                customerPrice,

              status:
                providerStatus,

              phone_number:
                phoneNumber,

              provider_expired_at:
                providerExpiredAt,

              created_at:
                new Date().toISOString(),

              updated_at:
                new Date().toISOString()
            })
          }
        );

      savedOrder =
        Array.isArray(inserted)
          ? inserted[0]
          : inserted;

    } catch (error) {
      console.error(
        "Order save failed:",
        error
      );

      if (providerVerificationId) {
        await cancelProvider(
          providerVerificationId
        );
      }

      const refund =
        await refundWallet(
          user.id,
          customerPrice
        );

      await recordTransaction(
        user.id,
        "refund",
        customerPrice,
        walletResult.after,
        refund.after,
        null,
        "Refund for failed virtual number order"
      );

      throw error;
    }


    /* -----------------------------------------------------
       PURCHASE TRANSACTION
    ----------------------------------------------------- */

    await recordTransaction(
      user.id,
      "purchase",
      customerPrice,
      walletResult.before,
      walletResult.after,
      savedOrder?.id ||
        providerOrderId,
      `Purchase of ${providerService} virtual number`
    );


    /* -----------------------------------------------------
       SUCCESS
    ----------------------------------------------------- */

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order: {
        id:
          savedOrder?.id || null,

        provider_order_id:
          providerOrderId,

        provider_verification_id:
          providerVerificationId,

        number:
          phoneNumber,

        phone_number:
          phoneNumber,

        service:
          providerService,

        service_name:
          providerService,

        country:
          countryName,

        country_name:
          countryName,

        status:
          providerStatus,

        customer_price:
          customerPrice,

        selling_price:
          customerPrice,

        expired_at:
          providerExpiredAt,

        provider_expired_at:
          providerExpiredAt
      },

      verification: {
        request_id:
          providerOrderId,

        id:
          providerVerificationId,

        number:
          phoneNumber,

        service:
          providerService,

        status:
          providerStatus,

        expired_at:
          providerExpiredAt
      },

      balance:
        walletResult.after
    });

  } catch (error) {
    console.error(
      "Purchase/order error:",
      error
    );

    const message =
      error?.message ||
      "Unable to purchase number.";

    return res.status(
      message === "Unauthorized."
        ? 401
        : 500
    ).json({
      success: false,
      error: message
    });
  }
}

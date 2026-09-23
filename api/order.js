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

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
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
    data = { message: text };
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
   REQUEST BODY
========================================================= */

function getBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}


/* =========================================================
   GET VALUE FROM BODY OR QUERY
========================================================= */

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
   GET WALLET
========================================================= */

async function getWallet(userId) {
  const wallets = await db(
    `wallets?user_id=eq.${encodeURIComponent(
      userId
    )}&select=*&limit=1`
  );

  const wallet = wallets?.[0];

  if (!wallet) {
    throw new Error("Wallet not found.");
  }

  return wallet;
}


/* =========================================================
   DEDUCT WALLET
========================================================= */

async function deductWallet(
  userId,
  amount
) {
  const purchaseAmount = Number(amount);

  if (
    !Number.isFinite(purchaseAmount) ||
    purchaseAmount <= 0
  ) {
    throw new Error("Invalid purchase amount.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet = await getWallet(userId);

    const balance =
      Number(wallet.balance || 0);

    if (!Number.isFinite(balance)) {
      throw new Error(
        "Unable to read wallet balance."
      );
    }

    if (balance < purchaseAmount) {
      throw new Error(
        "Insufficient wallet balance."
      );
    }

    const newBalance =
      balance - purchaseAmount;

    const updated = await db(
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
        balanceBefore: balance,
        balanceAfter: newBalance
      };
    }
  }

  throw new Error(
    "Unable to update wallet balance."
  );
}


/* =========================================================
   REFUND WALLET IF PROVIDER PURCHASE FAILS
========================================================= */

async function refundWallet(
  userId,
  amount
) {
  const refundAmount = Number(amount);

  if (
    !Number.isFinite(refundAmount) ||
    refundAmount <= 0
  ) {
    return null;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet = await getWallet(userId);

    const balance =
      Number(wallet.balance || 0);

    const newBalance =
      balance + refundAmount;

    const updated = await db(
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
      return newBalance;
    }
  }

  throw new Error(
    "Unable to refund wallet."
  );
}


/* =========================================================
   WALLET TRANSACTION
========================================================= */

async function recordTransaction(
  userId,
  type,
  amount,
  balanceBefore,
  balanceAfter,
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
          balance_before:
            Number(balanceBefore),
          balance_after:
            Number(balanceAfter),
          reference_id:
            referenceId || null,
          description
        })
      }
    );
  } catch (error) {
    console.error(
      "Wallet transaction error:",
      error
    );
  }
}


/* =========================================================
   SELECT PROVIDER SERVER
========================================================= */

function selectServer(countryId, countryName) {
  const country =
    String(countryName || "").toLowerCase();

  const isUSA =
    country === "united states" ||
    country === "usa" ||
    country === "us" ||
    String(countryId) === "236";

  /*
   * USA:
   * Use USA Server 2.
   *
   * Other countries:
   * Use Global Server 2.
   */
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

async function purchaseFromSureVerification(
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

  /*
   * SureVerification requires:
   *
   * country_id
   * service
   *
   * as query parameters.
   */
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

  const response = await fetch(
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

  if (
    !verification?.request_id &&
    !verification?.id
  ) {
    throw new Error(
      "SureVerification returned an invalid purchase response."
    );
  }

  return {
    server: server.name,
    providerResponse: data,
    verification
  };
}


/* =========================================================
   CANCEL PROVIDER PURCHASE ON DB FAILURE
========================================================= */

async function cancelProviderVerification(
  verificationId
) {
  if (
    !verificationId ||
    !SURE_API_KEY
  ) {
    return;
  }

  try {
    const response =
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

    console.log(
      "Provider rollback cancellation:",
      {
        verificationId,
        status:
          response.status
      }
    );

  } catch (error) {
    console.error(
      "Provider rollback cancellation failed:",
      error
    );
  }
}


/* =========================================================
   MAIN ORDER HANDLER
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
       AUTH
    ----------------------------------------------------- */

    const user =
      await authenticate(req);


    /* -----------------------------------------------------
       READ REQUEST
    ----------------------------------------------------- */

    const body =
      getBody(req);

    const query =
      req.query || {};


    /* -----------------------------------------------------
       COUNTRY
    ----------------------------------------------------- */

    const countryId =
      firstValue(
        body.country_id,
        body.countryId,
        body.countryID,
        body.country,
        query.country_id,
        query.countryId
      );


    const countryName =
      firstValue(
        body.country_name,
        body.countryName,
        body.countryName,
        body.country,
        query.country_name,
        query.countryName
      );


    /* -----------------------------------------------------
       SERVICE
       Accept ALL common names used by the frontend.
    ----------------------------------------------------- */

    const service =
      firstValue(
        body.service,
        body.service_id,
        body.serviceId,
        body.service_code,
        body.serviceCode,
        body.service_key,
        body.serviceKey,
        body.service_name,
        body.serviceName,

        query.service,
        query.service_id,
        query.serviceId,
        query.service_code,
        query.serviceCode,
        query.service_name,
        query.serviceName
      );


    /* -----------------------------------------------------
       CUSTOMER PRICE
    ----------------------------------------------------- */

    const customerPriceRaw =
      firstValue(
        body.customer_price,
        body.customerPrice,
        body.selling_price,
        body.sellingPrice,
        body.price,
        query.customer_price,
        query.customerPrice,
        query.selling_price,
        query.sellingPrice,
        query.price
      );

    const customerPrice =
      Number(customerPriceRaw);


    /* -----------------------------------------------------
       SERVICE/COUNTRY PRICE ID
    ----------------------------------------------------- */

    const serviceCountryPriceId =
      firstValue(
        body.service_country_price_id,
        body.serviceCountryPriceId,
        body.price_id,
        body.priceId,
        query.service_country_price_id,
        query.serviceCountryPriceId,
        query.price_id,
        query.priceId
      ) || null;


    console.log(
      "Purchase request received:",
      {
        userId:
          user.id,

        countryId,

        countryName,

        service,

        customerPrice,

        serviceCountryPriceId
      }
    );


    /* -----------------------------------------------------
       VALIDATION
    ----------------------------------------------------- */

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

    if (
      !Number.isFinite(customerPrice) ||
      customerPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid selling price."
      });
    }


    /* -----------------------------------------------------
       GET WALLET
    ----------------------------------------------------- */

    const wallet =
      await getWallet(user.id);

    const walletBalance =
      Number(wallet.balance || 0);


    if (
      !Number.isFinite(walletBalance) ||
      walletBalance < customerPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance."
      });
    }


    /* -----------------------------------------------------
       PURCHASE FROM SUREVERIFICATION
    ----------------------------------------------------- */

    const provider =
      await purchaseFromSureVerification(
        countryId,
        service,
        countryName
      );

    const verification =
      provider.verification;


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
      !providerOrderId &&
      !providerVerificationId
    ) {
      throw new Error(
        "Provider did not return a valid verification ID."
      );
    }


    if (!phoneNumber) {
      if (providerVerificationId) {
        await cancelProviderVerification(
          providerVerificationId
        );
      }

      throw new Error(
        "Provider did not return a phone number."
      );
    }


    /* -----------------------------------------------------
       DEDUCT CUSTOMER WALLET
    ----------------------------------------------------- */

    let walletResult;

    try {
      walletResult =
        await deductWallet(
          user.id,
          customerPrice
        );

    } catch (walletError) {
      /*
       * We already purchased the provider
       * number, so cancel it if wallet
       * deduction fails.
       */
      if (providerVerificationId) {
        await cancelProviderVerification(
          providerVerificationId
        );
      }

      throw walletError;
    }


    /* -----------------------------------------------------
       CALCULATE PROFIT
    ----------------------------------------------------- */

    const providerCost =
      Number(
        body.provider_cost ??
        body.providerCost ??
        0
      );

    const profit =
      customerPrice -
      (
        Number.isFinite(providerCost)
          ? providerCost
          : 0
      );


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
                serviceCountryPriceId,

              service_name:
                providerService,

              country_name:
                countryName,

              provider_cost:
                Number.isFinite(
                  providerCost
                )
                  ? providerCost
                  : 0,

              customer_price:
                customerPrice,

              profit,

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

    } catch (databaseError) {
      /*
       * Database save failed after provider
       * purchase. Cancel provider number and
       * refund customer.
       */

      console.error(
        "Order database save failed:",
        databaseError
      );

      if (providerVerificationId) {
        await cancelProviderVerification(
          providerVerificationId
        );
      }

      const refundedBalance =
        await refundWallet(
          user.id,
          customerPrice
        );

      await recordTransaction(
        user.id,
        "refund",
        customerPrice,
        walletResult.balanceAfter,
        refundedBalance,
        null,
        "Refund for failed virtual number order"
      );

      throw databaseError;
    }


    /* -----------------------------------------------------
       RECORD PURCHASE TRANSACTION
    ----------------------------------------------------- */

    await recordTransaction(
      user.id,
      "purchase",
      customerPrice,
      walletResult.balanceBefore,
      walletResult.balanceAfter,
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
          savedOrder?.id ||
          null,

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
        walletResult.balanceAfter
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

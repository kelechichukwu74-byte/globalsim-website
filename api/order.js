import {
  sureVerificationRequest,
  getServersForCountry
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

/* =========================================================
   BASIC HELPERS
========================================================= */

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function quote(value) {
  return encodeURIComponent(String(value));
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/* =========================================================
   SUPABASE
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
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        ...(options.headers || {})
      },
      body:
        options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
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

/* =========================================================
   AUTH
========================================================= */

async function getAuthenticatedUser(req) {
  const authorization =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!authorization.startsWith("Bearer ")) {
    throw new Error("Unauthorized.");
  }

  const token =
    authorization.slice(7).trim();

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

  let user = {};

  try {
    user = text ? JSON.parse(text) : {};
  } catch {
    user = {};
  }

  if (!response.ok || !user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}

/* =========================================================
   PROVIDER RESPONSE HELPERS
========================================================= */

function getVerification(data) {
  if (!data) return null;

  if (
    data.verification &&
    typeof data.verification === "object"
  ) {
    return data.verification;
  }

  if (
    data.data?.verification &&
    typeof data.data.verification === "object"
  ) {
    return data.data.verification;
  }

  if (
    data.data &&
    typeof data.data === "object" &&
    (
      data.data.id ||
      data.data.request_id ||
      data.data.number
    )
  ) {
    return data.data;
  }

  return null;
}

function getProviderError(data) {
  if (!data) return "";

  return (
    data.error ||
    data.message ||
    data.msg ||
    data.detail ||
    data.data?.error ||
    data.data?.message ||
    ""
  );
}

/* =========================================================
   SERVICE RESOLUTION
========================================================= */

async function resolveServiceId({
  countryId,
  serviceId,
  serviceName,
  servers
}) {
  const directId = clean(serviceId);

  /*
   * If frontend already supplied the provider service ID,
   * use it directly.
   */
  if (directId) {
    return directId;
  }

  const wantedName =
    normalize(serviceName);

  if (!wantedName) {
    throw new Error("Service is required.");
  }

  for (const server of servers) {
    try {
      const response =
        await sureVerificationRequest(
          `/${server}/services?country_id=${quote(
            countryId
          )}`
        );

      const services =
        Array.isArray(response?.services)
          ? response.services
          : Array.isArray(response?.data?.services)
          ? response.data.services
          : Array.isArray(response?.data)
          ? response.data
          : [];

      const match = services.find(service => {
        if (!service) return false;

        return (
          normalize(service.id) === wantedName ||
          normalize(service.name) === wantedName
        );
      });

      if (match?.id) {
        return String(match.id);
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    `Service "${serviceName}" is not available for this country.`
  );
}

/* =========================================================
   WALLET
========================================================= */

async function getWallet(userId) {
  const rows =
    await supabaseRequest(
      `wallets?user_id=eq.${quote(
        userId
      )}&select=user_id,balance&limit=1`
    );

  if (!Array.isArray(rows) || !rows[0]) {
    throw new Error("Wallet not found.");
  }

  return {
    balance: Number(rows[0].balance || 0)
  };
}

/* =========================================================
   DEBIT WALLET
========================================================= */

async function debitWallet(
  userId,
  amount,
  orderId = null
) {
  const wallet =
    await getWallet(userId);

  const before =
    Number(wallet.balance || 0);

  const price =
    Number(amount);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(
      "A valid selling price is required."
    );
  }

  if (before < price) {
    throw new Error(
      "Insufficient wallet balance."
    );
  }

  const after =
    before - price;

  await supabaseRequest(
    `wallets?user_id=eq.${quote(
      userId
    )}`,
    {
      method: "PATCH",
      body: {
        balance: after,
        updated_at:
          new Date().toISOString()
      }
    }
  );

  try {
    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",
        body: {
          user_id: userId,
          type: "purchase",
          amount: price,
          balance_before: before,
          balance_after: after,
          reference_id: orderId,
          description:
            "Virtual number purchase"
        }
      }
    );
  } catch {
    /*
     * Transaction history failure must not
     * cancel a successful wallet deduction.
     */
  }

  return {
    before,
    after
  };
}

/* =========================================================
   REFUND WALLET
========================================================= */

async function refundWallet(
  userId,
  amount,
  referenceId = null
) {
  try {
    const wallet =
      await getWallet(userId);

    const before =
      Number(wallet.balance || 0);

    const refund =
      Number(amount || 0);

    const after =
      before + refund;

    await supabaseRequest(
      `wallets?user_id=eq.${quote(
        userId
      )}`,
      {
        method: "PATCH",
        body: {
          balance: after,
          updated_at:
            new Date().toISOString()
        }
      }
    );

    try {
      await supabaseRequest(
        "wallet_transactions",
        {
          method: "POST",
          body: {
            user_id: userId,
            type: "refund",
            amount: refund,
            balance_before: before,
            balance_after: after,
            reference_id: referenceId,
            description:
              "Refund for failed virtual number purchase"
          }
        }
      );
    } catch {}

    return true;
  } catch (error) {
    console.error(
      "Refund error:",
      error
    );

    return false;
  }
}

/* =========================================================
   CANCEL PROVIDER NUMBER
========================================================= */

async function cancelProvider(
  verificationId
) {
  if (!verificationId) return;

  try {
    await sureVerificationRequest(
      `/verifications/cancel/${encodeURIComponent(
        verificationId
      )}`,
      {
        method: "DELETE"
      }
    );
  } catch (error) {
    console.error(
      "Provider cancellation error:",
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
      error: "Method not allowed"
    });
  }

  let userId = null;
  let charged = false;
  let chargedAmount = 0;
  let providerVerificationId = null;
  let createdOrderId = null;

  try {
    /* -----------------------------------------
       AUTH
    ----------------------------------------- */

    const user =
      await getAuthenticatedUser(req);

    userId = user.id;

    /* -----------------------------------------
       BODY
    ----------------------------------------- */

    const body =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};

    const countryId =
      clean(
        body.countryId ??
        body.country_id
      );

    const countryName =
      clean(
        body.countryName ??
        body.country_name
      );

    const suppliedServiceId =
      clean(
        body.serviceCountryPriceId ??
        body.serviceId ??
        body.service_id
      );

    const suppliedServiceName =
      clean(
        body.serviceName ??
        body.service_name ??
        body.service
      );

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "Country is required."
      });
    }

    if (
      !suppliedServiceId &&
      !suppliedServiceName
    ) {
      return res.status(400).json({
        success: false,
        error: "Service is required."
      });
    }

    /* -----------------------------------------
       SERVER SELECTION
    ----------------------------------------- */

    const normalizedCountryName =
      normalize(countryName);

    const normalizedCountryId =
      normalize(countryId);

    const countryIsUSA =
      normalizedCountryName ===
        "unitedstates" ||
      normalizedCountryName === "usa" ||
      normalizedCountryName === "us" ||
      normalizedCountryId === "us" ||
      normalizedCountryId === "usa" ||
      normalizedCountryId ===
        "unitedstates";

    let servers;

    if (countryIsUSA) {
      /*
       * =================================================
       * UNITED STATES
       * =================================================
       *
       * US NUMBERS ARE FORCED THROUGH USA SERVER 2.
       *
       * THERE IS NO FALLBACK TO USA SERVER 1.
       *
       * This ensures that a US number purchased by
       * this website comes from Portal / USA Server 2.
       */
      servers = [
        "usa-server-2"
      ];
    } else {
      /*
       * =================================================
       * NON-USA COUNTRIES
       * =================================================
       *
       * Keep international numbers on the global
       * provider servers.
       */
      servers = [
        "global-server-2",
        "global-server-1"
      ];
    }

    /*
     * Keep the existing helper available.
     * We deliberately do NOT allow it to override the
     * USA Server 2 requirement above.
     */
    try {
      getServersForCountry(countryName);
    } catch {}

    /* -----------------------------------------
       RESOLVE SERVICE
    ----------------------------------------- */

    const serviceId =
      await resolveServiceId({
        countryId,
        serviceId:
          suppliedServiceId,
        serviceName:
          suppliedServiceName,
        servers
      });

    /* -----------------------------------------
       GET ADMIN SELLING PRICE
    ----------------------------------------- */

    const pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}&service_id=eq.${quote(
          serviceId
        )}&select=country_id,country_name,service_id,service_name,selling_price&limit=1`
      );

    const pricing =
      Array.isArray(pricingRows)
        ? pricingRows[0]
        : null;

    const sellingPrice =
      Number(
        pricing?.selling_price
      );

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

    chargedAmount =
      sellingPrice;

    const serviceName =
      pricing?.service_name ||
      suppliedServiceName ||
      serviceId;

    /* -----------------------------------------
       CHECK WALLET
    ----------------------------------------- */

    const wallet =
      await getWallet(userId);

    if (
      Number(wallet.balance || 0) <
      sellingPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance."
      });
    }

    /* -----------------------------------------
       PROVIDER PURCHASE
    ----------------------------------------- */

    let providerData = null;
    let selectedServer = null;
    let providerError = null;

    for (const server of servers) {
      try {
        const endpoint =
          `/${server}/purchase?country_id=${quote(
            countryId
          )}&service=${quote(
            serviceId
          )}`;

        console.log(
          "SureVerification purchase server:",
          server
        );

        console.log(
          "SureVerification purchase endpoint:",
          endpoint
        );

        const candidate =
          await sureVerificationRequest(
            endpoint,
            {
              method: "POST"
            }
          );

        const verification =
          getVerification(
            candidate
          );

        if (
          !verification ||
          typeof verification !==
            "object"
        ) {
          providerError =
            new Error(
              getProviderError(
                candidate
              ) ||
              "Provider returned an invalid purchase response."
            );

          continue;
        }

        const candidateVerificationId =
          verification.id ??
          verification.verification_id ??
          verification.verificationId;

        const candidatePhone =
          verification.number ??
          verification.phone_number ??
          verification.phone;

        if (
          !candidateVerificationId ||
          !candidatePhone
        ) {
          providerError =
            new Error(
              "Provider did not return a valid number."
            );

          continue;
        }

        providerData =
          candidate;

        selectedServer =
          server;

        providerVerificationId =
          String(
            candidateVerificationId
          );

        break;

      } catch (error) {
        providerError =
          error;

        console.error(
          `${server} purchase failed:`,
          error
        );
      }
    }

    if (
      !providerData ||
      !providerVerificationId
    ) {
      return res.status(400).json({
        success: false,
        error:
          providerError?.message ||
          "No number is currently available from the provider."
      });
    }

    /* -----------------------------------------
       PROVIDER DATA
    ----------------------------------------- */

    const verification =
      getVerification(
        providerData
      );

    const providerOrderId =
      clean(
        verification.request_id ??
        verification.requestId
      );

    const phoneNumber =
      clean(
        verification.number ??
        verification.phone_number ??
        verification.phone
      );

    const providerStatus =
      clean(
        verification.status
      ) || "active";

    const providerExpiredAt =
      verification.expired_at ??
      verification.expiredAt ??
      null;

    /* -----------------------------------------
       DEBIT WALLET
    ----------------------------------------- */

    try {
      const debit =
        await debitWallet(
          userId,
          sellingPrice,
          null
        );

      charged = true;

      var balanceAfter =
        debit.after;

    } catch (walletError) {
      await cancelProvider(
        providerVerificationId
      );

      return res.status(400).json({
        success: false,
        error:
          walletError?.message ||
          "Unable to debit wallet."
      });
    }

    /* -----------------------------------------
       CREATE ORDER
    ----------------------------------------- */

    const providerCost = 0;

    const profit =
      sellingPrice -
      providerCost;

    const orderPayload = {
      user_id: userId,

      provider_order_id:
        providerOrderId || null,

      provider_verification_id:
        providerVerificationId,

      service_country_price_id:
        serviceId,

      service_name:
        serviceName,

      country_name:
        pricing?.country_name ||
        countryName ||
        countryId,

      provider_cost:
        providerCost,

      customer_price:
        sellingPrice,

      profit:
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
    };

    let orderRows;

    try {
      orderRows =
        await supabaseRequest(
          "orders",
          {
            method: "POST",
            body: orderPayload
          }
        );
    } catch (databaseError) {
      await cancelProvider(
        providerVerificationId
      );

      await refundWallet(
        userId,
        sellingPrice,
        null
      );

      return res.status(500).json({
        success: false,
        error:
          `Order could not be saved: ${databaseError.message}`
      });
    }

    if (
      !Array.isArray(orderRows) ||
      !orderRows[0]
    ) {
      await cancelProvider(
        providerVerificationId
      );

      await refundWallet(
        userId,
        sellingPrice,
        null
      );

      return res.status(500).json({
        success: false,
        error:
          "Order was not created. Your wallet was refunded."
      });
    }

    const order =
      orderRows[0];

    createdOrderId =
      order.id;

    /* -----------------------------------------
       UPDATE PURCHASE TRANSACTION
    ----------------------------------------- */

    try {
      await supabaseRequest(
        `wallet_transactions?user_id=eq.${quote(
          userId
        )}&type=eq.purchase&reference_id=is.null&order=created_at.desc&limit=1`,
        {
          method: "PATCH",
          body: {
            reference_id:
              createdOrderId
          }
        }
      );
    } catch {}

    /* -----------------------------------------
       SUCCESS
    ----------------------------------------- */

    return res.status(200).json({
      success: true,

      message:
        "Number purchased successfully.",

      order: {
        id:
          order.id,

        provider_order_id:
          order.provider_order_id,

        provider_verification_id:
          order.provider_verification_id,

        phone_number:
          order.phone_number,

        service_name:
          order.service_name,

        country_name:
          order.country_name,

        status:
          order.status,

        customer_price:
          order.customer_price,

        provider_expired_at:
          order.provider_expired_at
      },

      verification: {
        id:
          providerVerificationId,

        request_id:
          providerOrderId || null,

        number:
          phoneNumber,

        service:
          serviceName,

        status:
          providerStatus,

        expired_at:
          providerExpiredAt
      },

      service_id:
        serviceId,

      /*
       * This will now be:
       *
       * "usa-server-2"
       *
       * for every US purchase.
       */
      provider_server:
        selectedServer,

      balance:
        balanceAfter
    });

  } catch (error) {
    console.error(
      "ORDER ERROR:",
      error
    );

    if (
      charged &&
      userId &&
      chargedAmount > 0 &&
      !createdOrderId
    ) {
      await cancelProvider(
        providerVerificationId
      );

      await refundWallet(
        userId,
        chargedAmount,
        null
      );
    }

    return res.status(400).json({
      success: false,
      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}

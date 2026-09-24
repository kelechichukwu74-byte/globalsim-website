import { sureVerificationRequest } from "./sms/_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbJHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =========================================================
   GET BEARER TOKEN
========================================================= */

function getBearerToken(req) {
  const headers = req?.headers || {};

  const authorization =
    headers.authorization ||
    headers.Authorization ||
    headers["x-authorization"] ||
    "";

  const match =
    String(authorization)
      .match(/^Bearer\s+(.+)$/i);

  return match
    ? match[1].trim()
    : "";
}


/* =========================================================
   AUTHENTICATE USER
========================================================= */

async function getAuthenticatedUser(req) {
  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          apikey:
            SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${token}`,

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
    data = {};
  }

  console.log(
    "Supabase auth status:",
    response.status
  );

  if (!response.ok || !data?.id) {
    console.error(
      "Supabase auth verification failed:",
      response.status,
      data
    );

    throw new Error(
      "Unauthorized."
    );
  }

  return data;
}


/* =========================================================
   SUPABASE DATABASE REQUEST
========================================================= */

async function supabaseRequest(
  path,
  options = {}
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${path}`,
      {
        method:
          options.method || "GET",

        body:
          options.body,

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          Prefer:
            "return=representation",

          ...(options.headers || {})
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
    throw new Error(
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    console.error(
      "Supabase database error:",
      response.status,
      data
    );

    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


/* =========================================================
   URL ENCODER
========================================================= */

function q(value) {
  return encodeURIComponent(
    String(value)
  );
}


/* =========================================================
   USA CHECK
========================================================= */

function isUSA(
  countryId,
  countryCode,
  countryName
) {
  const id =
    String(countryId ?? "")
      .trim();

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
    name ===
      "united states of america"
  );
}


/* =========================================================
   PROVIDER RESPONSE
========================================================= */

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
    verification?.request_id ??
    verification?.requestId ??
    verification?.verification_id ??
    verification?.verificationId ??
    verification?.id ??
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


function getProviderPrice(data) {
  const value =
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount ??
    data?.verification?.price ??
    data?.verification?.amount;

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


/* =========================================================
   FIND USA PROVIDER SERVICE
========================================================= */

function findProviderService(
  data,
  requestedId,
  requestedName
) {
  const services =
    Array.isArray(data?.services)
      ? data.services
      : Array.isArray(
          data?.data?.services
        )
        ? data.data.services
        : Array.isArray(data?.data)
          ? data.data
          : [];

  if (!services.length) {
    return null;
  }

  const id =
    String(
      requestedId ?? ""
    ).trim();

  const name =
    String(
      requestedName ?? ""
    )
      .trim()
      .toLowerCase();

  const exactId =
    services.find(
      service =>
        String(
          service?.id ?? ""
        ).trim() === id
    );

  if (exactId?.id) {
    return exactId.id;
  }

  const exactName =
    services.find(
      service =>
        String(
          service?.name ?? ""
        )
          .trim()
          .toLowerCase() === name
    );

  if (exactName?.id) {
    return exactName.id;
  }

  const fuzzy =
    services.find(
      service => {
        const providerName =
          String(
            service?.name ?? ""
          )
            .trim()
            .toLowerCase();

        return (
          providerName &&
          name &&
          (
            providerName.includes(
              name
            ) ||
            name.includes(
              providerName
            )
          )
        );
      }
    );

  return fuzzy?.id || null;
}


async function getUSAService(
  countryId,
  serviceId,
  serviceName
) {
  const result =
    await sureVerificationRequest(
      `/usa-server-2/services?country_id=${q(
        countryId
      )}`,
      {
        method: "GET"
      }
    );

  const providerServiceId =
    findProviderService(
      result,
      serviceId,
      serviceName
    );

  if (!providerServiceId) {
    throw new Error(
      `USA provider service not found for "${serviceName || serviceId}".`
    );
  }

  return providerServiceId;
}


/* =========================================================
   PURCHASE FROM PROVIDER
========================================================= */

async function purchaseFromProvider({
  countryId,
  countryCode,
  countryName,
  serviceId,
  serviceName
}) {

  /*
   * USA
   */

  if (
    isUSA(
      countryId,
      countryCode,
      countryName
    )
  ) {

    const providerServiceId =
      await getUSAService(
        countryId,
        serviceId,
        serviceName
      );

    return await sureVerificationRequest(
      `/usa-server-2/purchase?country_id=${q(
        countryId
      )}&service=${q(
        providerServiceId
      )}`,
      {
        method: "POST"
      }
    );
  }


  /*
   * NON-USA
   *
   * Global Server 2 purchase
   * requires NO query parameters.
   */

  return await sureVerificationRequest(
    "/global-server-2/purchase",
    {
      method: "POST"
    }
  );
}


/* =========================================================
   GET WALLET
========================================================= */

async function getWallet(
  userId
) {
  const rows =
    await supabaseRequest(
      `wallets?user_id=eq.${q(
        userId
      )}&select=*&limit=1`
    );

  return rows?.[0] || null;
}


/* =========================================================
   DEBIT WALLET
========================================================= */

async function debitWallet(
  userId,
  amount
) {
  const purchaseAmount =
    Number(amount);

  if (
    !Number.isFinite(
      purchaseAmount
    ) ||
    purchaseAmount <= 0
  ) {
    throw new Error(
      "Invalid purchase amount."
    );
  }

  const wallet =
    await getWallet(
      userId
    );

  if (!wallet) {
    throw new Error(
      "Wallet not found. Please contact support."
    );
  }

  const balance =
    Number(
      wallet.balance || 0
    );

  if (
    !Number.isFinite(balance)
  ) {
    throw new Error(
      "Unable to read wallet balance."
    );
  }

  if (
    balance <
    purchaseAmount
  ) {
    throw new Error(
      "Insufficient wallet balance."
    );
  }

  const newBalance =
    balance -
    purchaseAmount;

  const updated =
    await supabaseRequest(
      `wallets?user_id=eq.${q(
        userId
      )}`,
      {
        method: "PATCH",

        body:
          JSON.stringify({
            balance:
              newBalance,

            updated_at:
              new Date().toISOString()
          })
      }
    );

  if (
    !Array.isArray(updated) ||
    !updated.length
  ) {
    throw new Error(
      "Unable to debit wallet."
    );
  }

  return {
    previousBalance:
      balance,

    newBalance
  };
}


/* =========================================================
   REFUND WALLET
========================================================= */

async function refundWallet(
  userId,
  amount
) {
  const refund =
    Number(amount);

  if (
    !Number.isFinite(refund) ||
    refund <= 0
  ) {
    return;
  }

  const wallet =
    await getWallet(
      userId
    );

  if (!wallet) {
    throw new Error(
      "Wallet not found while refunding."
    );
  }

  const balance =
    Number(
      wallet.balance || 0
    );

  const newBalance =
    balance +
    refund;

  await supabaseRequest(
    `wallets?user_id=eq.${q(
      userId
    )}`,
    {
      method: "PATCH",

      body:
        JSON.stringify({
          balance:
            newBalance,

          updated_at:
            new Date().toISOString()
        })
    }
  );
}


/* =========================================================
   SAVE TRANSACTION
========================================================= */

async function saveWalletTransaction({
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

        body:
          JSON.stringify({
            user_id:
              userId,

            amount,

            balance_after:
              balanceAfter,

            type:
              "order",

            description
          })
      }
    );

  } catch (error) {

    console.error(
      "Transaction history error:",
      error
    );
  }
}


/* =========================================================
   SAVE ORDER
========================================================= */

async function saveOrder({
  userId,
  serviceCountryPriceId,
  serviceName,
  countryName,
  providerOrderId,
  providerPrice,
  sellingPrice,
  phoneNumber,
  status
}) {

  const profit =
    Number.isFinite(
      providerPrice
    )
      ? sellingPrice -
        providerPrice
      : null;

  return await supabaseRequest(
    "orders",
    {
      method: "POST",

      body:
        JSON.stringify({
          user_id:
            userId,

          provider_order_id:
            providerOrderId,

          service_country_price_id:
            serviceCountryPriceId,

          service_name:
            serviceName,

          country_name:
            countryName,

          provider_cost:
            providerPrice,

          customer_price:
            sellingPrice,

          profit,

          status:
            status ||
            "active",

          phone_number:
            phoneNumber
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

  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      success: false,
      error:
        "Method not allowed"
    });
  }


  let user = null;
  let debitAmount = 0;
  let moneyDebited = false;


  try {

    /* ---------------------------------------
       AUTHENTICATION
    --------------------------------------- */

    user =
      await getAuthenticatedUser(
        req
      );


    console.log(
      "Authenticated purchase user:",
      user.id
    );


    /* ---------------------------------------
       REQUEST BODY
    --------------------------------------- */

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

    const serviceCountryPriceId =
      body.serviceCountryPriceId ??
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";


    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "Country is required."
      });
    }


    if (
      !serviceCountryPriceId
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Service is required."
      });
    }


    /* ---------------------------------------
       GET SELLING PRICE
    --------------------------------------- */

    let pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${q(
          countryId
        )}&service_id=eq.${q(
          serviceCountryPriceId
        )}&select=*&limit=1`
      );

    let pricing =
      pricingRows?.[0] ||
      null;


    /*
     * FALLBACK BY SERVICE NAME
     */

    if (
      !pricing &&
      requestedServiceName
    ) {

      pricingRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${q(
            countryId
          )}&service_name=ilike.${q(
            requestedServiceName
          )}&select=*&limit=1`
        );

      pricing =
        pricingRows?.[0] ||
        null;
    }


    if (!pricing) {
      return res.status(400).json({
        success: false,
        error:
          "This country and service is not currently available for purchase."
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
          "This country and service does not have a valid selling price."
      });
    }


    const serviceName =
      pricing.service_name ||
      requestedServiceName ||
      String(
        serviceCountryPriceId
      );


    /* ---------------------------------------
       DEBIT CUSTOMER
    --------------------------------------- */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    moneyDebited = true;
    debitAmount =
      sellingPrice;


    /* ---------------------------------------
       PROVIDER PURCHASE
    --------------------------------------- */

    let providerResult;


    try {

      providerResult =
        await purchaseFromProvider({
          countryId,

          countryCode,

          countryName,

          serviceId:
            pricing.service_id ||
            serviceCountryPriceId,

          serviceName
        });

    } catch (providerError) {

      console.error(
        "Provider purchase failed:",
        providerError
      );


      /*
       * AUTOMATIC REFUND
       */

      try {

        await refundWallet(
          user.id,
          sellingPrice
        );

      } catch (refundError) {

        console.error(
          "Refund failed:",
          refundError
        );
      }


      moneyDebited = false;

      throw providerError;
    }


    /* ---------------------------------------
       READ PROVIDER NUMBER
    --------------------------------------- */

    const verification =
      getVerification(
        providerResult
      );

    const verificationId =
      getVerificationId(
        providerResult
      );

    const phoneNumber =
      getPhoneNumber(
        providerResult
      );


    console.log(
      "Provider verification:",
      verification
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
          "Refund after invalid provider response failed:",
          refundError
        );
      }


      moneyDebited = false;

      throw new Error(
        "The provider did not return a valid number. Your wallet was refunded."
      );
    }


    /* ---------------------------------------
       PROVIDER COST
    --------------------------------------- */

    const providerPrice =
      getProviderPrice(
        providerResult
      );


    /* ---------------------------------------
       SAVE ORDER
    --------------------------------------- */

    const orderRows =
      await saveOrder({
        userId:
          user.id,

        serviceCountryPriceId:
          pricing.service_id ||
          serviceCountryPriceId,

        serviceName,

        countryName:
          pricing.country_name ||
          countryName ||
          String(countryId),

        providerOrderId:
          verificationId,

        providerPrice,

        sellingPrice,

        phoneNumber,

        status:
          verification.status ||
          "active"
      });


    /* ---------------------------------------
       GET UPDATED BALANCE
    --------------------------------------- */

    const wallet =
      await getWallet(
        user.id
      );

    const balanceAfter =
      Number(
        wallet?.balance || 0
      );


    /* ---------------------------------------
       SAVE TRANSACTION
    --------------------------------------- */

    await saveWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });


    moneyDebited = false;


    /* ---------------------------------------
       SUCCESS
    --------------------------------------- */

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
        providerPrice,

      selling_price:
        sellingPrice,

      balance:
        balanceAfter
    });


  } catch (error) {

    console.error(
      "ORDER ENDPOINT ERROR:",
      error
    );


    /* ---------------------------------------
       SAFETY REFUND
    --------------------------------------- */

    if (
      moneyDebited &&
      user?.id &&
      debitAmount > 0
    ) {

      try {

        await refundWallet(
          user.id,
          debitAmount
        );

      } catch (
        refundError
      ) {

        console.error(
          "Safety refund failed:",
          refundError
        );
      }
    }


    const message =
      error?.message ||
      "Unable to purchase number.";


    /* ---------------------------------------
       UNAUTHORIZED
    --------------------------------------- */

    if (
      String(message)
        .toLowerCase()
        .includes(
          "unauthorized"
        )
    ) {

      return res.status(401).json({
        success: false,

        error:
          "Unauthorized.",

        message:
          "Unauthorized."
      });
    }


    /* ---------------------------------------
       INSUFFICIENT BALANCE
    --------------------------------------- */

    if (
      String(message)
        .toLowerCase()
        .includes(
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


    /* ---------------------------------------
       NORMAL ERROR
    --------------------------------------- */

    return res.status(500).json({
      success: false,

      error:
        message,

      message:
        message
    });
  }
}

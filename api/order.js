import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =========================================================
   AUTHENTICATION
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
      ...options,

      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,

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

  const text = await response.text();

  let data = {};

  try {
    data = text
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
   COUNTRY / SERVER ROUTING
   ========================================================= */

function isUSA(countryId, countryCode, countryName) {
  const values = [
    countryId,
    countryCode,
    countryName
  ]
    .filter(Boolean)
    .map(value =>
      String(value)
        .trim()
        .toLowerCase()
    );

  return values.some(value =>
    value === "us" ||
    value === "usa" ||
    value === "united states" ||
    value === "united states of america"
  );
}


function getServers(
  countryId,
  countryCode,
  countryName
) {
  /*
   * USA:
   * ONLY USA SERVER 2.
   *
   * Other countries:
   * Global Server 2 first, then Global Server 1
   * as fallback.
   */

  if (
    isUSA(
      countryId,
      countryCode,
      countryName
    )
  ) {
    return [
      "usa-server-2"
    ];
  }

  return [
    "global-server-2",
    "global-server-1"
  ];
}


/* =========================================================
   PROVIDER RESPONSE HELPERS
   ========================================================= */

function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data
  );
}


/*
 * request_id is the provider order/request identifier.
 */
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


/*
 * IMPORTANT:
 * This is the actual verification ID used by
 * the SMS and cancellation endpoints.
 */
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
  const verification =
    getVerification(data);

  const value =
    data?.price ??
    data?.data?.price ??
    data?.amount ??
    data?.data?.amount ??
    verification?.price ??
    verification?.amount;

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
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
          method: "PATCH",

          body: JSON.stringify({
            balance:
              newBalance,

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
          method: "PATCH",

          body: JSON.stringify({
            balance:
              newBalance,

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
        method: "POST",

        body: JSON.stringify({
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
  return await supabaseRequest(
    "orders",
    {
      method: "POST",

      body: JSON.stringify({
        user_id:
          userId,

        /*
         * Provider request/order ID.
         */
        provider_order_id:
          order.requestId,

        /*
         * This is the REAL verification ID
         * used by SMS/cancel.
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
          Number.isFinite(
            order.providerPrice
          )
            ? order.sellingPrice -
              order.providerPrice
            : null,

        status:
          order.status ||
          "active",

        phone_number:
          order.phoneNumber
      })
    }
  );
}


/* =========================================================
   MAIN ORDER HANDLER
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
        error:
          "Country is required."
      });
    }

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        error:
          "Service is required."
      });
    }


    /* =====================================================
       FIND ADMIN PRICE
       ===================================================== */

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


    /* =====================================================
       SERVER SELECTION
       ===================================================== */

    const servers =
      body.server
        ? [body.server]
        : getServers(
            countryId,
            countryCode,
            countryName
          );


    console.log(
      "Purchase routing:",
      {
        countryId,
        countryCode,
        countryName,
        serviceId,
        serviceName,
        servers
      }
    );


    /* =====================================================
       DEBIT WALLET
       ===================================================== */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited =
      true;

    debitAmount =
      sellingPrice;


    /* =====================================================
       PROVIDER PURCHASE
       ===================================================== */

    let providerData =
      null;

    let providerError =
      null;

    let selectedServer =
      null;


    for (
      const server of servers
    ) {
      try {
        console.log(
          "Trying SureVerification server:",
          server
        );

        const endpoint =
          `/${server}/purchase?country_id=${quote(
            countryId
          )}&service=${quote(
            serviceId
          )}`;

        console.log(
          "Provider purchase endpoint:",
          endpoint
        );


        const candidate =
          await sureVerificationRequest(
            endpoint,
            {
              method:
                "POST"
            }
          );


        console.log(
          "Provider purchase response:",
          JSON.stringify(
            candidate
          )
        );


        const candidateRequestId =
          getRequestId(
            candidate
          );

        const candidateVerificationId =
          getVerificationId(
            candidate
          );

        const candidatePhoneNumber =
          getPhoneNumber(
            candidate
          );


        /*
         * A successful purchase MUST contain
         * the actual verification ID and phone.
         */
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
        console.error(
          `Provider error on ${server}:`,
          error
        );

        providerError =
          error;
      }
    }


    /* =====================================================
       PROVIDER PURCHASE FAILED
       ===================================================== */

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

      debited =
        false;

      throw new Error(
        providerError?.message ||
        "No number is currently available from the provider."
      );
    }


    /* =====================================================
       EXTRACT PROVIDER DATA
       ===================================================== */

    const verification =
      getVerification(
        providerData
      );

    const requestId =
      getRequestId(
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

      debited =
        false;

      throw new Error(
        "The provider did not return a valid number. Your wallet was refunded."
      );
    }


    const providerPrice =
      getProviderPrice(
        providerData
      );


    /* =====================================================
       SAVE ORDER
       ===================================================== */

    const orderRows =
      await createOrder(
        user.id,
        {
          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),

          serviceCountryPriceId:
            serviceId,

          serviceName:
            serviceName,

          requestId:
            requestId,

          verificationId:
            verificationId,

          phoneNumber:
            phoneNumber,

          sellingPrice:
            sellingPrice,

          providerPrice:
            providerPrice,

          status:
            verification?.status ||
            "active"
        }
      );


    /* =====================================================
       GET BALANCE
       ===================================================== */

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


    /* =====================================================
       TRANSACTION HISTORY
       ===================================================== */

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter:
        balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });


    debited =
      false;


    /* =====================================================
       SUCCESS
       ===================================================== */

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

        /*
         * Keep both IDs available.
         */
        request_id:
          requestId,

        id:
          verificationId,

        number:
          phoneNumber
      },

      provider_server:
        selectedServer,

      provider_price:
        Number.isFinite(
          providerPrice
        )
          ? providerPrice
          : null,

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


    /* =====================================================
       SAFETY REFUND
       ===================================================== */

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


    /*
     * Return the actual provider error so
     * the frontend does not hide the reason
     * behind "Unable to purchase number."
     */
    return res.status(500).json({
      success:
        false,

      error:
        message,

      message:
        message
    });
  }
}

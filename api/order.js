import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

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

  if (!header) {
    return null;
  }

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}


async function getAuthenticatedUser(req) {

  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  /*
   * Validate the customer's actual Supabase access token.
   *
   * The service-role key is used only as the project API key.
   * The customer's bearer token is still what identifies the user.
   */

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json"
        }
      }
    );

  const text =
    await response.text();

  let user = null;

  try {
    user =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    throw new Error(
      "Unauthorized."
    );
  }

  if (
    !response.ok ||
    !user?.id
  ) {
    console.error(
      "Supabase authentication failed:",
      {
        status: response.status,
        response: user
      }
    );

    throw new Error(
      "Unauthorized."
    );
  }

  return user;
}


/* =========================================================
   SUPABASE DATABASE
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
        ...options,

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
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


/* =========================================================
   HELPERS
   ========================================================= */

function quote(value) {
  return encodeURIComponent(
    String(value)
  );
}


function isUSCountry(
  countryCode,
  countryName
) {

  const code =
    String(countryCode || "")
      .trim()
      .toLowerCase();

  const name =
    String(countryName || "")
      .trim()
      .toLowerCase();

  return (
    code === "us" ||
    code === "usa" ||
    name === "united states" ||
    name === "united states of america"
  );
}


/*
 * All four SureVerification portals are supported.
 *
 * US:
 *   Server 2
 *   Server 1
 *   Global 1
 *   Global 2
 *
 * Other countries:
 *   Global 1
 *   Global 2
 */

function getProviderServers(
  countryCode,
  countryName,
  availableServers
) {

  const preferred =
    isUSCountry(
      countryCode,
      countryName
    )
      ? [
          "usa-server-2",
          "usa-server-1",
          "global-server-1",
          "global-server-2"
        ]
      : [
          "global-server-1",
          "global-server-2"
        ];


  const supplied =
    Array.isArray(availableServers)
      ? availableServers
          .map(value =>
            String(value || "").trim()
          )
          .filter(Boolean)
      : [];


  /*
   * If the service catalog supplied provider
   * information, respect it, but never lose the
   * normal fallback portals.
   */

  const combined = [
    ...supplied,
    ...preferred
  ];


  return [
    ...new Set(
      combined.filter(
        server =>
          preferred.includes(server)
      )
    )
  ];
}


/* =========================================================
   PROVIDER PRICE
   ========================================================= */

function getProviderPrice(data) {

  const price =
    Number(
      data?.price ??
      data?.data?.price ??
      data?.amount ??
      data?.data?.amount ??
      data?.verification?.price ??
      data?.verification?.amount
    );

  return Number.isFinite(price)
    ? price
    : null;
}


/* =========================================================
   PROVIDER VERIFICATION
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
   WALLET TRANSACTION HISTORY
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

        provider_order_id:
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

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error:
        "Method not allowed"
    });
  }


  let user = null;
  let debited = false;
  let debitAmount = 0;


  try {

    /* -----------------------------------------
       AUTHENTICATE CUSTOMER
       ----------------------------------------- */

    user =
      await getAuthenticatedUser(
        req
      );


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


    /* -----------------------------------------
       PROVIDER SERVERS
       ----------------------------------------- */

    const servers =
      getProviderServers(
        countryCode,
        countryName,
        body.availableServers
      );


    /* -----------------------------------------
       DEBIT WALLET
       ----------------------------------------- */

    await debitWallet(
      user.id,
      sellingPrice
    );

    debited = true;
    debitAmount =
      sellingPrice;


    /* -----------------------------------------
       PURCHASE NUMBER
       ----------------------------------------- */

    let providerData =
      null;

    let providerPrice =
      null;

    let selectedServer =
      null;

    let lastProviderError =
      null;


    for (
      const server
      of servers
    ) {

      try {

        /*
         * Provider price is optional.
         * A missing provider price must NOT prevent
         * the actual number purchase.
         */

        try {

          const priceData =
            await sureVerificationRequest(
              `/${server}/price?country_id=${quote(
                countryId
              )}&service=${quote(
                serviceId
              )}`
            );


          const parsedPrice =
            getProviderPrice(
              priceData
            );


          if (
            Number.isFinite(
              parsedPrice
            ) &&
            parsedPrice > 0
          ) {

            providerPrice =
              parsedPrice;
          }

        } catch (priceError) {

          console.warn(
            `Provider price unavailable on ${server}:`,
            priceError?.message ||
            priceError
          );
        }


        /*
         * Actual number purchase.
         */

        const candidate =
          await sureVerificationRequest(
            `/${server}/purchase?country_id=${quote(
              countryId
            )}&service=${quote(
              serviceId
            )}`,
            {
              method:
                "POST"
            }
          );


        const candidateId =
          getVerificationId(
            candidate
          );


        const candidateNumber =
          getPhoneNumber(
            candidate
          );


        if (
          candidateId &&
          candidateNumber
        ) {

          providerData =
            candidate;

          selectedServer =
            server;

          break;
        }


        lastProviderError =
          new Error(
            `${server}: provider did not return a valid number.`
          );

      } catch (providerError) {

        lastProviderError =
          providerError;

        console.error(
          `Provider purchase failed on ${server}:`,
          providerError?.message ||
          providerError
        );
      }
    }


    /* -----------------------------------------
       ALL PROVIDERS FAILED
       ----------------------------------------- */

    if (!providerData) {

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


      throw new Error(
        lastProviderError?.message ||
        "No number is currently available from the provider."
      );
    }


    /* -----------------------------------------
       VERIFY NUMBER
       ----------------------------------------- */

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


    /* -----------------------------------------
       SAVE ORDER
       ----------------------------------------- */

    const orderRows =
      await createOrder(
        user.id,
        {
          verificationId,

          serviceCountryPriceId:
            serviceId,

          serviceName,

          countryName:
            pricing?.country_name ||
            countryName ||
            String(countryId),

          providerPrice,

          sellingPrice,

          status:
            verification?.status ||
            "active",

          phoneNumber
        }
      );


    /* -----------------------------------------
       GET NEW BALANCE
       ----------------------------------------- */

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


    /* -----------------------------------------
       TRANSACTION HISTORY
       ----------------------------------------- */

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


    /* -----------------------------------------
       SUCCESS
       ----------------------------------------- */

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
        balanceAfter,

      provider_server:
        selectedServer
    });


  } catch (error) {

    console.error(
      "Order purchase error:",
      error
    );


    /* -----------------------------------------
       SAFETY REFUND
       ----------------------------------------- */

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
          "Unauthorized.",

        message:
          "Unauthorized."
      });
    }


    return res.status(500).json({
      success: false,

      error:
        message,

      message
    });
  }
}

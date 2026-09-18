import {
  sureVerificationRequest,
  getServerForCountry
} from "./_lib.js";

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

  const token =
    header.slice(7).trim();

  return token || null;
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
   * The service-role key is used only by this server-side
   * Vercel function. It is NEVER sent to the browser.
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

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    throw new Error(
      "Supabase authentication returned invalid data."
    );
  }

  if (!response.ok) {
    console.error(
      "Supabase authentication failed:",
      response.status,
      data
    );

    throw new Error(
      "Unauthorized."
    );
  }

  if (!data?.id) {
    throw new Error(
      "Unauthorized."
    );
  }

  return data;
}


/* =========================================================
   SUPABASE REST
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

  /*
   * Optimistic compare-and-set.
   *
   * The amount is taken from the server-side
   * admin pricing table, not from the browser.
   */
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

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date()
                  .toISOString()
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

          body:
            JSON.stringify({
              balance:
                newBalance,

              updated_at:
                new Date()
                  .toISOString()
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

        body:
          JSON.stringify({
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

    /*
     * Do not turn a successful purchase
     * into a failed purchase merely because
     * transaction history has a schema issue.
     */
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

      body:
        JSON.stringify({
          user_id:
            userId,

          country_id:
            order.countryId,

          country_name:
            order.countryName,

          service_id:
            order.serviceId,

          service_name:
            order.serviceName,

          verification_id:
            order.verificationId,

          phone_number:
            order.phoneNumber,

          price:
            order.sellingPrice,

          provider_price:
            order.providerPrice,

          provider_server:
            order.providerServer,

          status:
            order.status ||
            "active"
        })
    }
  );
}


/* =========================================================
   PURCHASE FROM SUREVERIFICATION
   ========================================================= */

async function purchaseFromServer({
  server,
  countryId,
  serviceId
}) {
  return await sureVerificationRequest(
    `/${server}/purchase?country_id=${quote(
      countryId
    )}&service=${quote(
      serviceId
    )}`,
    {
      method: "POST"
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

  let debited =
    false;

  let debitAmount =
    0;

  try {

    /* -----------------------------------------------------
       AUTHENTICATE USER
       ----------------------------------------------------- */

    user =
      await getAuthenticatedUser(
        req
      );


    /* -----------------------------------------------------
       READ REQUEST
       ----------------------------------------------------- */

    const body =
      req.body || {};

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


    /* -----------------------------------------------------
       GET ADMIN SELLING PRICE
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       DETERMINE PROVIDER SERVERS
       ----------------------------------------------------- */

    const serverList = [];

    /*
     * For USA use the USA servers.
     * For other countries use the global servers.
     *
     * getServerForCountry()
     * remains the fallback.
     */

    if (
      String(countryId)
        .toLowerCase()
        .trim() === "us"
    ) {

      serverList.push(
        "usa-server-1",
        "usa-server-2"
      );

    } else {

      serverList.push(
        "global-server-1",
        "global-server-2"
      );

    }


    const fallbackServer =
      getServerForCountry(
        countryId
      );

    if (
      fallbackServer &&
      !serverList.includes(
        fallbackServer
      )
    ) {
      serverList.push(
        fallbackServer
      );
    }


    /* -----------------------------------------------------
       DEBIT CUSTOMER WALLET
       ----------------------------------------------------- */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited =
      true;

    debitAmount =
      sellingPrice;


    /* -----------------------------------------------------
       PURCHASE NUMBER
       ----------------------------------------------------- */

    let providerData =
      null;

    let providerServer =
      null;

    let lastProviderError =
      null;


    for (
      const server of serverList
    ) {

      try {

        const result =
          await purchaseFromServer({
            server,
            countryId,
            serviceId
          });

        const verification =
          getVerification(
            result
          );

        const verificationId =
          getVerificationId(
            result
          );

        const phoneNumber =
          getPhoneNumber(
            result
          );


        /*
         * A successful response must contain
         * both a verification ID and number.
         */
        if (
          verificationId &&
          phoneNumber
        ) {

          providerData =
            result;

          providerServer =
            server;

          break;
        }


        lastProviderError =
          new Error(
            "Provider did not return a valid number."
          );

      } catch (error) {

        lastProviderError =
          error;

        console.error(
          `SureVerification purchase failed on ${server}:`,
          error
        );
      }
    }


    /* -----------------------------------------------------
       NO NUMBER FOUND
       ----------------------------------------------------- */

    if (
      !providerData ||
      !providerServer
    ) {

      try {

        await refundWallet(
          user.id,
          sellingPrice
        );

        debited =
          false;

      } catch (refundError) {

        console.error(
          "Purchase refund failed:",
          refundError
        );

        throw new Error(
          "No number was purchased and the automatic wallet refund could not be completed. Please contact support."
        );
      }


      const providerMessage =
        lastProviderError?.message ||
        "";

      const lowerMessage =
        String(
          providerMessage
        ).toLowerCase();


      if (
        lowerMessage.includes(
          "no number"
        ) ||
        lowerMessage.includes(
          "no numbers"
        ) ||
        lowerMessage.includes(
          "unavailable"
        ) ||
        lowerMessage.includes(
          "out of stock"
        ) ||
        lowerMessage.includes(
          "stock"
        ) ||
        lowerMessage.includes(
          "no available"
        )
      ) {

        throw new Error(
          "No numbers are currently available for this service/country."
        );
      }


      throw new Error(
        "No numbers available for this service/country. Your wallet was refunded."
      );
    }


    /* -----------------------------------------------------
       EXTRACT PURCHASE DETAILS
       ----------------------------------------------------- */

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

    const providerPrice =
      getProviderPrice(
        providerData
      );


    /* -----------------------------------------------------
       CREATE ORDER
       ----------------------------------------------------- */

    let orderRows;

    try {

      orderRows =
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

            providerPrice,

            providerServer,

            status:
              verification?.status ||
              "active"
          }
        );

    } catch (orderError) {

      /*
       * Provider successfully gave us a number,
       * but our database order creation failed.
       *
       * Refund the customer.
       */
      try {

        await refundWallet(
          user.id,
          sellingPrice
        );

        debited =
          false;

      } catch (refundError) {

        console.error(
          "Refund after order creation failure failed:",
          refundError
        );

        throw new Error(
          "The number was received from the provider, but the order could not be saved and the automatic refund failed. Please contact support immediately."
        );
      }

      throw orderError;
    }


    /* -----------------------------------------------------
       GET CURRENT WALLET BALANCE
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       RECORD WALLET TRANSACTION
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       SUCCESS
       ----------------------------------------------------- */

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

      provider_server:
        providerServer,

      provider_price:
        providerPrice,

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


    /* -----------------------------------------------------
       SAFETY REFUND
       ----------------------------------------------------- */

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

        debited =
          false;

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


    /* -----------------------------------------------------
       INSUFFICIENT BALANCE
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       UNAUTHORIZED
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       OTHER ERROR
       ----------------------------------------------------- */

    return res.status(500).json({
      success: false,

      error:
        message,

      message:
        message
    });
  }
}

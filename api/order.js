import {
  sureVerificationRequest,
  getServersForCountry,
  getServerForCountry
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExv7Q_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =========================================================
   AUTH
   ========================================================= */

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header) {
    return null;
  }

  if (!header.startsWith("Bearer ")) {
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

  if (!response.ok) {
    console.error(
      "Supabase auth verification failed:",
      response.status,
      data
    );

    throw new Error("Unauthorized.");
  }

  if (!data?.id) {
    console.error(
      "Supabase auth returned no user ID:",
      data
    );

    throw new Error("Unauthorized.");
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
    console.error(
      "Supabase REST error:",
      response.status,
      data
    );

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
    data?.verification?.amount ??
    null;

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function getProviderMessage(data) {
  return (
    data?.message ||
    data?.error ||
    data?.details ||
    data?.data?.message ||
    ""
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
          method:
            "PATCH",

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

    if (
      !Number.isFinite(
        currentBalance
      )
    ) {
      throw new Error(
        "Unable to read wallet balance while processing refund."
      );
    }

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
          method:
            "PATCH",

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
        method:
          "POST",

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
    console.error(
      "Wallet transaction history error:",
      error
    );
  }
}


/* =========================================================
   CREATE ORDER
   =========================================================
   
   IMPORTANT:
   This matches the ACTUAL orders table schema:

   id
   user_id
   provider_order_id
   service_country_price_id
   service_name
   country_name
   provider_cost
   customer_price
   profit
   status
   phone_number
   created_at
   updated_at
   ========================================================= */

async function createOrder(
  userId,
  order
) {
  const providerCost =
    Number(order.providerPrice);

  const customerPrice =
    Number(order.sellingPrice);

  const profit =
    Number.isFinite(providerCost)
      ? customerPrice - providerCost
      : customerPrice;

  return await supabaseRequest(
    "orders",
    {
      method:
        "POST",

      body:
        JSON.stringify({
          user_id:
            userId,

          provider_order_id:
            String(
              order.verificationId
            ),

          service_country_price_id:
            String(
              order.serviceId
            ),

          service_name:
            order.serviceName,

          country_name:
            order.countryName,

          provider_cost:
            Number.isFinite(
              providerCost
            )
              ? providerCost
              : 0,

          customer_price:
            customerPrice,

          profit:
            profit,

          status:
            order.status ||
            "active",

          phone_number:
            order.phoneNumber,

          created_at:
            new Date().toISOString(),

          updated_at:
            new Date().toISOString()
        })
    }
  );
}


/* =========================================================
   PROVIDER PURCHASE
   ========================================================= */

async function purchaseFromServer({
  server,
  countryId,
  serviceId
}) {
  console.log(
    "Trying SureVerification server:",
    server
  );

  return await sureVerificationRequest(
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
}


/* =========================================================
   MAIN ORDER HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !==
    "POST"
  ) {
    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed"
    });
  }

  let user =
    null;

  let debited =
    false;

  let debitAmount =
    0;

  try {

    /* -------------------------------------------------------
       1. AUTHENTICATE USER
       ------------------------------------------------------- */

    user =
      await getAuthenticatedUser(
        req
      );

    console.log(
      "Authenticated purchase user:",
      user.id
    );


    /* -------------------------------------------------------
       2. READ REQUEST
       ------------------------------------------------------- */

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
      body.service_country_price_id ??
      body.serviceId ??
      body.service_id;

    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";


    /* -------------------------------------------------------
       3. VALIDATE
       ------------------------------------------------------- */

    if (!countryId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Country is required."
      });
    }

    if (!serviceId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Service is required."
      });
    }


    /* -------------------------------------------------------
       4. GET ADMIN SELLING PRICE
       ------------------------------------------------------- */

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
        success:
          false,

        error:
          "This country and service is not currently available for purchase."
      });
    }

    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(serviceId);

    const finalCountryName =
      pricing?.country_name ||
      countryName ||
      String(countryId);


    /* -------------------------------------------------------
       5. DETERMINE AVAILABLE SERVERS
       ------------------------------------------------------- */

    let servers = [];

    try {
      servers =
        getServersForCountry(
          countryId
        );
    } catch (error) {
      console.error(
        "Unable to determine server list:",
        error
      );
    }

    if (
      !Array.isArray(servers) ||
      servers.length === 0
    ) {
      servers = [
        getServerForCountry(
          countryId
        )
      ];
    }

    /* -------------------------------------------------------
       If frontend specifically supplied a server, try it
       first, then the remaining applicable servers.
       ------------------------------------------------------- */

    const requestedServer =
      body.server ||
      body.providerServer ||
      null;

    if (requestedServer) {
      servers = [
        requestedServer,
        ...servers.filter(
          server =>
            server !==
            requestedServer
        )
      ];
    }


    /* -------------------------------------------------------
       6. DEBIT CUSTOMER WALLET
       ------------------------------------------------------- */

    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );

    debited =
      true;

    debitAmount =
      sellingPrice;


    /* -------------------------------------------------------
       7. TRY SUREVERIFICATION SERVERS
       ------------------------------------------------------- */

    let providerData =
      null;

    let successfulServer =
      null;

    let lastProviderError =
      null;

    for (
      const server of servers
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
         * A successful purchase must contain
         * BOTH the verification ID and number.
         */

        if (
          verificationId &&
          phoneNumber
        ) {
          providerData =
            result;

          successfulServer =
            server;

          console.log(
            "SureVerification purchase succeeded on:",
            server
          );

          break;
        }

        const message =
          getProviderMessage(
            result
          );

        lastProviderError =
          new Error(
            message ||
            `Server ${server} did not return a valid number.`
          );

      } catch (providerError) {

        lastProviderError =
          providerError;

        console.error(
          `SureVerification purchase failed on ${server}:`,
          providerError
        );
      }
    }


    /* -------------------------------------------------------
       8. NO PROVIDER NUMBER
       ------------------------------------------------------- */

    if (
      !providerData ||
      !successfulServer
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
          "Automatic purchase refund failed:",
          refundError
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
          "unauthorized"
        )
      ) {
        throw new Error(
          "SureVerification authentication failed."
        );
      }

      if (
        lowerMessage.includes(
          "insufficient"
        )
      ) {
        throw new Error(
          "Provider balance is insufficient."
        );
      }

      throw new Error(
        "No numbers are currently available for this service/country. Your wallet was refunded."
      );
    }


    /* -------------------------------------------------------
       9. EXTRACT PROVIDER RESULT
       ------------------------------------------------------- */

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


    /* -------------------------------------------------------
       10. CREATE ORDER USING ACTUAL DB SCHEMA
       ------------------------------------------------------- */

    let orderRows;

    try {

      orderRows =
        await createOrder(
          user.id,
          {
            countryName:
              finalCountryName,

            serviceId:
              serviceId,

            serviceName:
              serviceName,

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

    } catch (orderError) {

      console.error(
        "Order database creation failed. Refunding customer:",
        orderError
      );

      try {
        await refundWallet(
          user.id,
          sellingPrice
        );

        debited =
          false;

      } catch (refundError) {

        console.error(
          "Refund after order database failure failed:",
          refundError
        );
      }

      throw new Error(
        orderError?.message ||
        "Unable to save the purchased number."
      );
    }


    /* -------------------------------------------------------
       11. GET FINAL WALLET BALANCE
       ------------------------------------------------------- */

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


    /* -------------------------------------------------------
       12. RECORD WALLET TRANSACTION
       ------------------------------------------------------- */

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


    /* -------------------------------------------------------
       13. PURCHASE COMPLETED
       ------------------------------------------------------- */

    debited =
      false;

    const profit =
      Number.isFinite(
        providerPrice
      )
        ? sellingPrice -
          providerPrice
        : sellingPrice;

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

      provider_server:
        successfulServer,

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

      profit:
        profit,

      balance:
        balanceAfter
    });

  } catch (error) {

    console.error(
      "Order purchase error:",
      error
    );


    /* -------------------------------------------------------
       SAFETY REFUND
       ------------------------------------------------------- */

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

        console.log(
          "Safety refund completed."
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

    const lowerMessage =
      String(
        message
      ).toLowerCase();


    /* -------------------------------------------------------
       INSUFFICIENT BALANCE
       ------------------------------------------------------- */

    if (
      lowerMessage.includes(
        "insufficient wallet"
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


    /* -------------------------------------------------------
       UNAUTHORIZED
       ------------------------------------------------------- */

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,

        error:
          "Unauthorized.",

        message:
          "Unauthorized."
      });
    }


    /* -------------------------------------------------------
       PROVIDER AUTHENTICATION
       ------------------------------------------------------- */

    if (
      lowerMessage.includes(
        "sureverification authentication failed"
      )
    ) {
      return res.status(502).json({
        success:
          false,

        error:
          "SureVerification authentication failed.",

        message:
          "SureVerification authentication failed."
      });
    }


    /* -------------------------------------------------------
       NO NUMBER
       ------------------------------------------------------- */

    if (
      lowerMessage.includes(
        "no numbers"
      )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          message,

        message:
          message
      });
    }


    /* -------------------------------------------------------
       GENERAL ERROR
       ------------------------------------------------------- */

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

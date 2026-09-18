import {
  sureVerificationRequest,
  getServerForCountry,
  getServersForCountry
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExv7Q_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
  =========================================================
  AUTHENTICATION
  =========================================================
*/

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
  const token =
    getBearerToken(req);

  if (!token) {
    throw new Error(
      "Unauthorized."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
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

  if (!response.ok) {
    throw new Error(
      "Unauthorized."
    );
  }

  const user =
    await response.json();

  if (!user?.id) {
    throw new Error(
      "Unauthorized."
    );
  }

  return user;
}


/*
  =========================================================
  SUPABASE
  =========================================================
*/

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


/*
  =========================================================
  HELPERS
  =========================================================
*/

function quote(value) {
  return encodeURIComponent(
    String(value)
  );
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


/*
  =========================================================
  WALLET DEBIT
  =========================================================
*/

async function debitWallet(
  userId,
  amount
) {
  const requiredAmount =
    Number(amount);

  if (
    !Number.isFinite(
      requiredAmount
    ) ||
    requiredAmount <= 0
  ) {
    throw new Error(
      "Invalid purchase amount."
    );
  }

  /*
    Optimistic compare-and-set debit.

    The balance is checked and changed on the server,
    scoped to the authenticated user.

    The browser can never choose the amount to debit.
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


/*
  =========================================================
  WALLET REFUND
  =========================================================
*/

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


/*
  =========================================================
  WALLET TRANSACTION HISTORY
  =========================================================
*/

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
    /*
      Do not turn a successful provider purchase
      into a failed customer purchase merely because
      transaction-history insertion has a schema problem.
    */

    console.error(
      "Wallet transaction history error:",
      error
    );
  }
}


/*
  =========================================================
  CREATE ORDER
  =========================================================
*/

async function createOrder(
  userId,
  order
) {
  return await supabaseRequest(
    "orders",
    {
      method:
        "POST",

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


/*
  =========================================================
  PROVIDER PURCHASE
  =========================================================
*/

/*
  Purchase from one specific SureVerification server.
*/
async function purchaseFromServer({
  server,
  countryId,
  serviceId
}) {
  try {
    const providerData =
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

    /*
      A successful provider response must contain
      both the verification ID and phone number.
    */
    if (
      !verificationId ||
      !phoneNumber
    ) {
      return {
        success:
          false,

        server,

        providerData,

        verification,

        verificationId:
          null,

        phoneNumber:
          null,

        providerPrice:
          getProviderPrice(
            providerData
          ),

        error:
          "The provider did not return a valid number."
      };
    }

    return {
      success:
        true,

      server,

      providerData,

      verification,

      verificationId,

      phoneNumber,

      providerPrice:
        getProviderPrice(
          providerData
        ),

      error:
        null
    };

  } catch (error) {
    return {
      success:
        false,

      server,

      providerData:
        null,

      verification:
        null,

      verificationId:
        null,

      phoneNumber:
        null,

      providerPrice:
        null,

      error:
        error?.message ||
        "Unable to purchase from this provider server."
    };
  }
}


/*
  =========================================================
  MULTI-SERVER PURCHASE
  =========================================================
*/

/*
  Try every applicable SureVerification server.

  USA:
    usa-server-1
    usa-server-2

  Other countries:
    global-server-1
    global-server-2

  The servers are attempted one at a time.
*/
async function purchaseFromAvailableServer({
  countryId,
  serviceId,
  requestedServer
}) {
  const servers =
    requestedServer
      ? [requestedServer]
      : getServersForCountry(
          countryId
        );


  if (
    !Array.isArray(servers) ||
    !servers.length
  ) {
    throw new Error(
      "No SureVerification server is available for this country."
    );
  }


  const attempts = [];


  for (
    const server of servers
  ) {
    const result =
      await purchaseFromServer({
        server,
        countryId,
        serviceId
      });


    attempts.push(
      {
        server:
          result.server,

        success:
          result.success,

        provider_price:
          result.providerPrice,

        error:
          result.error
      }
    );


    /*
      Stop immediately when a valid number
      has been purchased.

      We do NOT call another server after
      a successful purchase.
    */
    if (
      result.success
    ) {
      return {
        ...result,

        servers,

        attempts
      };
    }
  }


  /*
    None of the servers produced a number.
  */
  const meaningfulErrors =
    attempts
      .map(
        attempt =>
          attempt.error
      )
      .filter(Boolean);


  /*
    If one of the provider servers explicitly
    reports no numbers, give the customer a
    useful message rather than a generic error.
  */
  const noNumberError =
    meaningfulErrors.find(
      message => {
        const value =
          String(
            message
          ).toLowerCase();

        return (
          value.includes(
            "no number"
          ) ||
          value.includes(
            "no numbers"
          ) ||
          value.includes(
            "unavailable"
          ) ||
          value.includes(
            "out of stock"
          ) ||
          value.includes(
            "stock"
          ) ||
          value.includes(
            "not available"
          ) ||
          value.includes(
            "no available"
          )
        );
      }
    );


  throw new Error(
    noNumberError ||
    "No numbers are currently available for this service/country."
  );
}


/*
  =========================================================
  MAIN ORDER ENDPOINT
  =========================================================
*/

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "POST"
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
    /*
      Authenticate customer.
    */
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


    const serviceId =
      body.serviceCountryPriceId ??
      body.serviceId ??
      body.service_id;


    const requestedServiceName =
      body.serviceName ??
      body.service_name ??
      "";


    const requestedServer =
      body.server ||
      null;


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


    /*
      =====================================================
      ADMIN SELLING PRICE
      =====================================================

      The browser cannot choose the amount.

      The price stored in product_prices is authoritative.
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
        success:
          false,

        error:
          "This country and service is not currently available for purchase."
      });
    }


    const serviceName =
      pricing?.service_name ||
      requestedServiceName ||
      String(
        serviceId
      );


    /*
      =====================================================
      WALLET DEBIT
      =====================================================

      Customer pays the configured selling price.

      Provider cost is separate.
    */
    const debit =
      await debitWallet(
        user.id,
        sellingPrice
      );


    debited =
      true;

    debitAmount =
      sellingPrice;


    /*
      =====================================================
      SUREVERIFICATION
      =====================================================

      Check all applicable servers.

      USA:
        usa-server-1
        usa-server-2

      Other countries:
        global-server-1
        global-server-2
    */
    let providerResult;


    try {
      providerResult =
        await purchaseFromAvailableServer({
          countryId,
          serviceId,
          requestedServer
        });

    } catch (providerError) {
      /*
        Provider purchase failed on all available
        servers, so refund the customer.
      */
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
        "Unable to purchase number from the provider."
      );
    }


    /*
      =====================================================
      VERIFY PROVIDER RESPONSE
      =====================================================
    */

    const verification =
      providerResult.verification;


    const verificationId =
      providerResult.verificationId;


    const phoneNumber =
      providerResult.phoneNumber;


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


    /*
      Provider's actual cost.
    */
    const providerPrice =
      Number(
        providerResult.providerPrice
      );


    /*
      =====================================================
      CREATE ORDER
      =====================================================
    */

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
              String(
                countryId
              ),

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

            providerServer:
              providerResult.server,

            status:
              verification?.status ||
              "active"
          }
        );

    } catch (orderError) {
      /*
        IMPORTANT:

        If the provider already gave us a real number
        but our database order creation fails, refund
        the customer.

        The provider number may still exist at the
        provider, but the customer's wallet will not
        be charged for an order that we failed to record.
      */

      try {
        await refundWallet(
          user.id,
          sellingPrice
        );

      } catch (refundError) {
        console.error(
          "Refund after order creation failure failed:",
          refundError
        );
      }


      debited =
        false;


      throw new Error(
        orderError?.message ||
        "Unable to save your order. Your wallet was refunded."
      );
    }


    /*
      =====================================================
      BALANCE AFTER PURCHASE
      =====================================================
    */

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


    /*
      =====================================================
      TRANSACTION HISTORY
      =====================================================
    */

    await createWalletTransaction({
      userId:
        user.id,

      amount:
        -sellingPrice,

      balanceAfter,

      description:
        `Purchase: ${serviceName} ${phoneNumber}`
    });


    /*
      Debit has now been successfully
      converted into a completed order.
    */
    debited =
      false;


    /*
      =====================================================
      SUCCESS
      =====================================================
    */

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

      /*
        Provider server used.
      */
      provider_server:
        providerResult.server,

      providerServer:
        providerResult.server,

      /*
        Actual provider cost.
      */
      provider_price:
        Number.isFinite(
          providerPrice
        )
          ? providerPrice
          : null,

      providerPrice:
        Number.isFinite(
          providerPrice
        )
          ? providerPrice
          : null,

      /*
        Customer selling price.
      */
      selling_price:
        sellingPrice,

      sellingPrice:
        sellingPrice,

      /*
        Applicable servers that were checked.
      */
      servers:
        providerResult.servers,

      serverAttempts:
        providerResult.attempts,

      /*
        Remaining wallet balance.
      */
      balance:
        balanceAfter
    });


  } catch (error) {
    console.error(
      "Order purchase error:",
      error
    );


    /*
      =====================================================
      SAFETY REFUND
      =====================================================

      If an unexpected error happened after the wallet
      was debited, attempt to refund the customer.
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


    /*
      Exact insufficient-balance message
      requested for the website.
    */
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
      Provider ran out of numbers on all
      applicable servers.
    */
    if (
      String(message)
        .toLowerCase()
        .includes(
          "no numbers"
        )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "No numbers are currently available for this service/country.",

        message:
          "No numbers are currently available for this service/country."
      });
    }


    return res.status(500).json({
      success:
        false,

      error:
        message,

      message
    });
  }
}

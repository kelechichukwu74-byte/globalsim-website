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
  "sb_publishable_erjKhsDOoyhbHDExv7Q_gpGcK0C-";


function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  return token || null;
}


/*
  Authenticate the customer using the actual Supabase
  access token sent by the browser.
*/
async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    throw new Error("Unauthorized.");
  }

  /*
    Use the service-role key only on the server when
    asking Supabase Auth who owns this access token.
  */
  const apiKey =
    SUPABASE_SERVICE_ROLE_KEY ||
    SUPABASE_PUBLISHABLE_KEY;

  if (!apiKey) {
    throw new Error(
      "Supabase authentication is not configured."
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          apikey: apiKey,
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
    console.error(
      "Supabase auth returned invalid JSON:",
      text
    );

    throw new Error(
      "Supabase authentication failed."
    );
  }

  if (!response.ok) {
    console.error(
      "Supabase auth verification failed:",
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


/*
  Server-side Supabase REST helper.
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
        method:
          options.method || "GET",

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
        },

        ...(options.body !== undefined
          ? {
              body:
                options.body
            }
          : {})
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


/*
  Provider price extraction.
*/
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


/*
  Extract verification object.
*/
function getVerification(data) {
  return (
    data?.verification ||
    data?.data?.verification ||
    data?.data ||
    data ||
    {}
  );
}


/*
  Extract provider verification ID.
*/
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


/*
  Extract purchased phone number.
*/
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
  Debit wallet safely using compare-and-set.
*/
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


/*
  Refund wallet.
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
  Save wallet transaction history.
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


/*
  IMPORTANT:
  These are the REAL columns from your orders table.
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

          provider_order_id:
            order.providerOrderId,

          service_country_price_id:
            order.serviceCountryPriceId,

          service_name:
            order.serviceName,

          country_name:
            order.countryName,

          provider_cost:
            order.providerCost,

          customer_price:
            order.customerPrice,

          profit:
            order.profit,

          status:
            order.status,

          phone_number:
            order.phoneNumber
        })
    }
  );
}


/*
  Main purchase endpoint.
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

  let user = null;

  let debited =
    false;

  let debitAmount =
    0;

  try {

    /*
      STEP 1
      Authenticate the actual logged-in user.
    */
    user =
      await getAuthenticatedUser(
        req
      );


    const body =
      req.body || {};


    /*
      STEP 2
      Read country/service information.
    */
    const countryId =
      body.countryId ??
      body.country_id;


    const countryName =
      body.countryName ??
      body.country_name ??
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
        success:
          false,

        error:
          "Country is required."
      });
    }


    if (!serviceCountryPriceId) {
      return res.status(400).json({
        success:
          false,

        error:
          "Service is required."
      });
    }


    /*
      STEP 3
      NEVER trust selling price from browser.

      Get the admin-configured selling price
      from product_prices.
    */
    const pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${quote(
          countryId
        )}&service_id=eq.${quote(
          serviceCountryPriceId
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
        serviceCountryPriceId
      );


    /*
      STEP 4
      Work out which SureVerification servers
      can serve this country.
    */
    const providerServers =
      getServersForCountry(
        countryId
      );


    /*
      If frontend requested a particular server,
      try it first.
    */
    const requestedServer =
      body.server ||
      body.providerServer ||
      null;


    const servers = [
      ...(requestedServer
        ? [requestedServer]
        : []),

      ...providerServers.filter(
        server =>
          server !==
          requestedServer
      )
    ];


    if (
      servers.length === 0
    ) {
      throw new Error(
        "No SureVerification server is configured for this country."
      );
    }


    /*
      STEP 5
      Debit customer's selling price.
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
      STEP 6
      Try the available provider servers.
    */
    let providerData =
      null;

    let selectedServer =
      null;

    let lastProviderError =
      null;


    for (
      const server of servers
    ) {
      try {

        const data =
          await sureVerificationRequest(
            `/${server}/purchase?country_id=${quote(
              countryId
            )}&service=${quote(
              serviceCountryPriceId
            )}`,
            {
              method:
                "POST"
            }
          );


        const verification =
          getVerification(
            data
          );


        const verificationId =
          getVerificationId(
            data
          );


        const phoneNumber =
          getPhoneNumber(
            data
          );


        if (
          verificationId &&
          phoneNumber
        ) {
          providerData =
            data;

          selectedServer =
            server;

          break;
        }


        lastProviderError =
          new Error(
            "Provider did not return a valid number."
          );

      } catch (
        providerError
      ) {
        console.error(
          `SureVerification ${server} purchase error:`,
          providerError
        );

        lastProviderError =
          providerError;
      }
    }


    /*
      STEP 7
      If every provider server failed,
      refund the customer.
    */
    if (
      !providerData
    ) {
      try {
        await refundWallet(
          user.id,
          sellingPrice
        );
      } catch (
        refundError
      ) {
        console.error(
          "Purchase refund failed:",
          refundError
        );
      }

      debited =
        false;


      throw new Error(
        lastProviderError?.message ||
        "No numbers available for this service/country. Try another country or service."
      );
    }


    /*
      STEP 8
      Extract successful purchase.
    */
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
      } catch (
        refundError
      ) {
        console.error(
          "Incomplete purchase refund failed:",
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
      Provider cost.
    */
    const providerPrice =
      getProviderPrice(
        providerData
      );


    const providerCost =
      Number.isFinite(
        providerPrice
      )
        ? providerPrice
        : 0;


    const profit =
      sellingPrice -
      providerCost;


    /*
      STEP 9
      Save order using the ACTUAL DB schema.
    */
    const orderRows =
      await createOrder(
        user.id,
        {
          providerOrderId:
            String(
              verificationId
            ),

          serviceCountryPriceId:
            String(
              serviceCountryPriceId
            ),

          serviceName:
            serviceName,

          countryName:
            pricing?.country_name ||
            countryName ||
            String(
              countryId
            ),

          providerCost:
            providerCost,

          customerPrice:
            sellingPrice,

          profit:
            profit,

          status:
            verification?.status ||
            "active",

          phoneNumber:
            phoneNumber
        }
      );


    /*
      STEP 10
      Read final wallet balance.
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
      STEP 11
      Record wallet transaction.
    */
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


    /*
      Purchase completed.
      No refund should happen now.
    */
    debited =
      false;


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
        selectedServer,

      provider_price:
        Number.isFinite(
          providerPrice
        )
          ? providerPrice
          : null,

      selling_price:
        sellingPrice,

      profit:
        profit,

      balance:
        balanceAfter
    });


  } catch (
    error
  ) {

    console.error(
      "Order purchase error:",
      error
    );


    /*
      Safety refund if something failed after
      the wallet was debited.
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

        console.log(
          "Safety purchase refund completed."
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


    if (
      String(message)
        .toLowerCase()
        .includes(
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


    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success:
          false,

        error:
          "Unauthorized."
      });
    }


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

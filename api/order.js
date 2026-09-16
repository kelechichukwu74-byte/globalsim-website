import {
  sureVerificationRequest
} from "./_lib.js";


const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";


const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";


const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
  -------------------------------------------------------
  Supabase request using the service-role key.
  This is used only on the server.
  -------------------------------------------------------
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
  -------------------------------------------------------
  Get the customer's access token.
  -------------------------------------------------------
*/

function getToken(req) {

  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";


  if (
    !header.startsWith(
      "Bearer "
    )
  ) {

    return null;

  }


  return header.slice(7);

}


/*
  -------------------------------------------------------
  Verify the logged-in Supabase user.
  -------------------------------------------------------
*/

async function getAuthenticatedUser(
  req
) {

  const token =
    getToken(req);


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


  return await response.json();

}


/*
  -------------------------------------------------------
  Choose the correct SureVerification server.
  -------------------------------------------------------
*/

function getServer(
  countryId,
  countryName
) {

  const name =
    String(
      countryName || ""
    ).toLowerCase()
     .trim();


  if (
    name === "united states" ||
    name ===
      "united states of america" ||
    name === "usa" ||
    name === "us" ||
    String(countryId).toLowerCase() ===
      "us"
  ) {

    return "usa-server-1";

  }


  return "global-server-1";

}


/*
  -------------------------------------------------------
  Change wallet balance safely.

  Uses an optimistic balance check so another wallet
  transaction cannot silently overwrite this operation.
  -------------------------------------------------------
*/

async function adjustWalletBalance(
  userId,
  amount
) {

  const numericAmount =
    Number(amount);


  if (
    !Number.isFinite(
      numericAmount
    )
  ) {

    throw new Error(
      "Invalid wallet amount."
    );

  }


  for (
    let attempt = 0;
    attempt < 5;
    attempt++
  ) {

    const wallets =
      await supabaseRequest(
        `wallets?user_id=eq.${encodeURIComponent(
          userId
        )}&select=id,user_id,balance&limit=1`
      );


    const wallet =
      wallets?.[0];


    if (!wallet) {

      throw new Error(
        "Wallet not found."
      );

    }


    const currentBalance =
      Number(
        wallet.balance || 0
      );


    const newBalance =
      currentBalance +
      numericAmount;


    if (
      newBalance < 0
    ) {

      return {
        success: false,
        insufficient: true,
        balance:
          currentBalance
      };

    }


    const updated =
      await supabaseRequest(
        `wallets?id=eq.${encodeURIComponent(
          wallet.id
        )}&user_id=eq.${encodeURIComponent(
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
        success: true,

        balance:
          Number(
            updated[0].balance
          )
      };

    }

    /*
      Someone changed the wallet between
      our read and update. Try again.
    */

  }


  throw new Error(
    "Wallet balance changed. Please try again."
  );

}


/*
  -------------------------------------------------------
  Save a wallet transaction.
  -------------------------------------------------------
*/

async function createWalletTransaction(
  values
) {

  return await supabaseRequest(
    "wallet_transactions",
    {
      method:
        "POST",

      body:
        JSON.stringify(
          values
        )
    }
  );

}


/*
  -------------------------------------------------------
  MAIN ORDER HANDLER
  -------------------------------------------------------
*/

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

  let sellingPrice = 0;

  let walletDebited = false;

  let refundCompleted = false;


  try {

    /*
      ---------------------------------------------------
      1. Verify customer
      ---------------------------------------------------
    */

    user =
      await getAuthenticatedUser(
        req
      );


    if (!user?.id) {

      return res.status(401).json({
        success: false,
        error:
          "Unauthorized."
      });

    }


    /*
      ---------------------------------------------------
      2. Read request body
      ---------------------------------------------------
    */

    const {
      countryId,
      countryName,
      serviceCountryPriceId,
      serviceName,
      quantity
    } =
      req.body || {};


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


    const orderQuantity =
      Number(
        quantity || 1
      );


    if (
      !Number.isInteger(
        orderQuantity
      ) ||
      orderQuantity < 1
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Invalid quantity."
      });

    }


    /*
      ---------------------------------------------------
      3. Get configured ADMIN SELLING PRICE
      ---------------------------------------------------

      IMPORTANT:

      The customer is charged this price.

      SureVerification's provider price is NOT
      used as the customer's selling price.
      ---------------------------------------------------
    */

    const pricingRows =
      await supabaseRequest(
        `product_prices?country_id=eq.${encodeURIComponent(
          countryId
        )}&service_id=eq.${encodeURIComponent(
          serviceCountryPriceId
        )}&select=id,country_id,country_name,service_id,service_name,selling_price&limit=1`
      );


    const pricing =
      pricingRows?.[0];


    if (!pricing) {

      return res.status(400).json({
        success: false,
        error:
          "Selling price is not configured for this country and service."
      });

    }


    sellingPrice =
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
          "Selling price is not configured for this country and service."
      });

    }


    /*
      ---------------------------------------------------
      4. Calculate customer's total
      ---------------------------------------------------
    */

    const totalSellingPrice =
      sellingPrice *
      orderQuantity;


    /*
      ---------------------------------------------------
      5. Select SureVerification server
      ---------------------------------------------------
    */

    const server =
      getServer(
        countryId,
        countryName
      );


    /*
      ---------------------------------------------------
      6. Get provider price.

      This is ONLY used internally.

      It is NOT charged to the customer.
      ---------------------------------------------------
    */

    const providerPriceData =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          serviceCountryPriceId
        )}`
      );


    const providerPrice =
      Number(
        providerPriceData?.price ??
        providerPriceData?.data?.price ??
        providerPriceData?.amount ??
        providerPriceData?.data?.amount
      );


    if (
      !Number.isFinite(
        providerPrice
      ) ||
      providerPrice <= 0
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Unable to determine the provider price."
      });

    }


    /*
      ---------------------------------------------------
      7. Debit customer's wallet.

      ONLY the ADMIN SELLING PRICE is charged.
      ---------------------------------------------------
    */

    const debit =
      await adjustWalletBalance(
        user.id,
        -totalSellingPrice
      );


    if (
      debit.insufficient
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance:
          debit.balance
      });

    }


    walletDebited =
      true;


    const newBalance =
      debit.balance;


    /*
      ---------------------------------------------------
      8. Purchase number from SureVerification
      ---------------------------------------------------
    */

    let providerResult;


    try {

      providerResult =
        await sureVerificationRequest(
          `/${server}/purchase?country_id=${encodeURIComponent(
            countryId
          )}&service=${encodeURIComponent(
            serviceCountryPriceId
          )}`,
          {
            method:
              "POST"
          }
        );

    } catch (providerError) {

      /*
        Provider purchase failed.

        Refund the EXACT amount charged
        to the customer.
      */

      try {

        const refund =
          await adjustWalletBalance(
            user.id,
            totalSellingPrice
          );


        if (
          refund.success
        ) {

          refundCompleted =
            true;


          try {

            await createWalletTransaction({
              user_id:
                user.id,

              amount:
                totalSellingPrice,

              type:
                "refund",

              description:
                `Refund for failed ${serviceName || "number"} purchase`,

              reference:
                `refund-${Date.now()}`
            });

          } catch (
            transactionError
          ) {

            console.error(
              "Refund transaction record error:",
              transactionError
            );

          }


          return res.status(400).json({
            success: false,

            error:
              providerError?.message ||
              "Unable to purchase number.",

            refunded:
              true,

            balance:
              refund.balance
          });

        }

      } catch (
        refundError
      ) {

        console.error(
          "Automatic refund error:",
          refundError
        );

      }


      return res.status(500).json({
        success: false,

        error:
          providerError?.message ||
          "Unable to purchase number.",

        refunded:
          false
      });

    }


    /*
      ---------------------------------------------------
      9. Extract verification information
      ---------------------------------------------------
    */

    const verification =
      providerResult?.verification ||
      providerResult?.data?.verification ||
      providerResult?.data ||
      providerResult;


    const number =
      verification?.number ||
      verification?.phone_number ||
      verification?.phone ||
      providerResult?.number ||
      providerResult?.phone_number ||
      "";


    const requestId =
      verification?.request_id ||
      verification?.requestId ||
      providerResult?.request_id ||
      providerResult?.requestId ||
      "";


    const verificationId =
      verification?.id ||
      verification?.verification_id ||
      verification?.verificationId ||
      providerResult?.verification_id ||
      providerResult?.verificationId ||
      "";


    const providerStatus =
      verification?.status ||
      "active";


    /*
      ---------------------------------------------------
      10. Create order in Supabase
      ---------------------------------------------------
    */

    let createdOrder;


    try {

      const orderRows =
        await supabaseRequest(
          "orders",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                user_id:
                  user.id,

                country_id:
                  countryId,

                country_name:
                  countryName ||
                  pricing.country_name ||
                  "",

                service:
                  serviceCountryPriceId,

                service_name:
                  serviceName ||
                  pricing.service_name ||
                  "",

                number:
                  number,

                /*
                  SAVE ADMIN SELLING PRICE.
                */

                price:
                  totalSellingPrice,

                status:
                  providerStatus,

                request_id:
                  requestId,

                verification_id:
                  verificationId,

                server:
                  server
              })
          }
        );


      createdOrder =
        orderRows?.[0] ||
        orderRows;

    } catch (
      orderError
    ) {

      /*
        The provider has already created the
        number. Do NOT silently refund the
        customer here because the provider
        purchase succeeded.
      */

      console.error(
        "Order database insert error:",
        orderError
      );


      return res.status(500).json({
        success: false,

        error:
          "Number was purchased, but the order could not be saved. Please contact support.",

        requestId,
        verificationId
      });

    }


    /*
      ---------------------------------------------------
      11. Record wallet purchase transaction
      ---------------------------------------------------
    */

    try {

      await createWalletTransaction({
        user_id:
          user.id,

        amount:
          -totalSellingPrice,

        type:
          "purchase",

        description:
          `Purchased ${serviceName || pricing.service_name || "number"} number for ${countryName || pricing.country_name || "selected country"}`,

        reference:
          requestId ||
          verificationId ||
          `order-${Date.now()}`
      });

    } catch (
      transactionError
    ) {

      /*
        The order and wallet debit already succeeded.
        Log the transaction error rather than making
        another wallet change that could cause problems.
      */

      console.error(
        "Purchase wallet transaction error:",
        transactionError
      );

    }


    /*
      ---------------------------------------------------
      12. Return successful purchase
      ---------------------------------------------------
    */

    return res.status(200).json({

      success:
        true,

      message:
        "Number purchased successfully.",

      price:
        totalSellingPrice,

      sellingPrice:
        sellingPrice,

      quantity:
        orderQuantity,

      balance:
        newBalance,

      order:
        createdOrder,

      verification: {

        ...verification,

        number:
          number,

        request_id:
          requestId,

        verification_id:
          verificationId,

        status:
          providerStatus

      }

    });


  } catch (error) {

    console.error(
      "SureVerification order error:",
      error
    );


    /*
      If something unexpected happened after
      the wallet was debited but before the
      provider purchase completed, attempt a refund.
    */

    if (
      walletDebited &&
      !refundCompleted
    ) {

      try {

        const refund =
          await adjustWalletBalance(
            user?.id,
            sellingPrice
          );


        if (
          refund.success
        ) {

          refundCompleted =
            true;


          try {

            await createWalletTransaction({
              user_id:
                user.id,

              amount:
                sellingPrice,

              type:
                "refund",

              description:
                "Refund for failed number purchase",

              reference:
                `refund-${Date.now()}`
            });

          } catch (
            transactionError
          ) {

            console.error(
              "Refund transaction record error:",
              transactionError
            );

          }


          return res.status(500).json({
            success: false,

            error:
              error?.message ||
              "Unable to purchase number.",

            refunded:
              true,

            balance:
              refund.balance
          });

        }

      } catch (
        refundError
      ) {

        console.error(
          "Unexpected automatic refund error:",
          refundError
        );

      }

    }


    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Unable to purchase number.",

      refunded:
        refundCompleted
    });

  }

}

import {
  sureVerificationRequest
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";


async function supabaseRequest(
  path,
  accessToken,
  options = {}
) {

  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      method: options.method || "GET",

      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },

      ...(options.body !== undefined
        ? {
            body: JSON.stringify(options.body)
          }
        : {})
    }
  );


  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }


  if (!response.ok) {

    const message =
      data?.message ||
      data?.error_description ||
      data?.hint ||
      text ||
      `Supabase request failed (${response.status})`;

    throw new Error(message);
  }


  return data;
}


function getServer(countryName) {

  const name =
    String(countryName || "")
      .trim()
      .toLowerCase();


  if (
    name === "united states" ||
    name === "united states of america" ||
    name === "usa" ||
    name === "us"
  ) {
    return "usa-server-1";
  }


  return "global-server-1";
}


export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  }


  const authorization =
    req.headers?.authorization || "";


  if (
    !authorization
      .toLowerCase()
      .startsWith("bearer ")
  ) {

    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });

  }


  const accessToken =
    authorization
      .slice(7)
      .trim();


  if (!accessToken) {

    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });

  }


  try {

    /*
     * ----------------------------------------------------
     * 1. Verify the logged-in user
     * ----------------------------------------------------
     */

    const user =
      await supabaseRequest(
        "/auth/v1/user",
        accessToken
      );


    if (!user?.id) {

      return res.status(401).json({
        success: false,
        error:
          "Your session has expired. Please log in again."
      });

    }


    const body =
      req.body || {};


    const countryId =
      body.countryId;

    const countryName =
      body.countryName || "";

    const serviceId =
      body.serviceCountryPriceId ||
      body.serviceId ||
      body.service;

    const serviceName =
      body.serviceName || "";


    if (!countryId) {

      return res.status(400).json({
        success: false,
        error: "Country is required."
      });

    }


    if (!serviceId) {

      return res.status(400).json({
        success: false,
        error: "Service is required."
      });

    }


    if (!serviceName) {

      return res.status(400).json({
        success: false,
        error: "Service is required."
      });

    }


    /*
     * ----------------------------------------------------
     * 2. Get wallet
     * ----------------------------------------------------
     */

    const wallets =
      await supabaseRequest(
        `/rest/v1/wallets?select=*&user_id=eq.${encodeURIComponent(
          user.id
        )}&limit=1`,
        accessToken
      );


    const wallet =
      Array.isArray(wallets)
        ? wallets[0]
        : null;


    if (!wallet) {

      return res.status(400).json({
        success: false,
        error: "Wallet not found."
      });

    }


    const currentBalance =
      Number(wallet.balance || 0);


    /*
     * ----------------------------------------------------
     * 3. Get provider price
     *
     * This is temporary until the Admin Pricing system
     * is connected. The Admin Pricing system will later
     * supply the customer's actual selling price.
     * ----------------------------------------------------
     */

    const server =
      getServer(countryName);


    const priceResponse =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          serviceId
        )}`
      );


    const providerPrice =
      Number(
        priceResponse?.price ??
        priceResponse?.data?.price ??
        priceResponse?.amount ??
        priceResponse?.data?.amount
      );


    if (
      !Number.isFinite(providerPrice) ||
      providerPrice <= 0
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Unable to determine the number price."
      });

    }


    const totalPrice =
      providerPrice;


    /*
     * ----------------------------------------------------
     * 4. Check wallet BEFORE purchase
     * ----------------------------------------------------
     */

    if (
      !Number.isFinite(currentBalance) ||
      currentBalance < totalPrice
    ) {

      return res.status(400).json({

        success: false,

        code:
          "INSUFFICIENT_FUNDS",

        error:
          "Insufficient wallet balance.",

        balance:
          currentBalance,

        price:
          totalPrice

      });

    }


    /*
     * ----------------------------------------------------
     * 5. Debit wallet
     * ----------------------------------------------------
     */

    const newBalance =
      currentBalance - totalPrice;


    const walletUpdate =
      await supabaseRequest(
        `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
          user.id
        )}&balance=eq.${encodeURIComponent(
          currentBalance
        )}`,
        accessToken,
        {
          method: "PATCH",

          headers: {
            Prefer:
              "return=representation"
          },

          body: {
            balance:
              newBalance
          }
        }
      );


    if (
      !Array.isArray(walletUpdate) ||
      walletUpdate.length === 0
    ) {

      return res.status(409).json({

        success: false,

        error:
          "Your wallet balance changed. Please try again."

      });

    }


    /*
     * ----------------------------------------------------
     * 6. Purchase number
     * ----------------------------------------------------
     */

    let purchaseResponse;


    try {

      purchaseResponse =
        await sureVerificationRequest(
          `/${server}/purchase?country_id=${encodeURIComponent(
            countryId
          )}&service=${encodeURIComponent(
            serviceId
          )}`,
          {
            method: "POST"
          }
        );

    } catch (providerError) {

      /*
       * Provider failed.
       * Refund the wallet automatically.
       */

      try {

        await supabaseRequest(
          `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
            user.id
          )}&balance=eq.${encodeURIComponent(
            newBalance
          )}`,
          accessToken,
          {
            method: "PATCH",

            body: {
              balance:
                currentBalance
            }
          }
        );

      } catch (refundError) {

        console.error(
          "CRITICAL wallet refund error:",
          refundError
        );

      }


      throw providerError;

    }


    /*
     * ----------------------------------------------------
     * 7. Read purchased verification
     * ----------------------------------------------------
     */

    const verification =
      purchaseResponse?.verification ||
      purchaseResponse?.data?.verification ||
      purchaseResponse?.data ||
      null;


    const number =
      verification?.number ||
      purchaseResponse?.number ||
      "";


    const requestId =
      verification?.request_id ||
      verification?.requestId ||
      purchaseResponse?.request_id ||
      "";


    const verificationId =
      verification?.id ||
      verification?.verification_id ||
      verification?.verificationId ||
      null;


    const providerStatus =
      verification?.status ||
      "active";


    /*
     * ----------------------------------------------------
     * 8. Save order
     * ----------------------------------------------------
     */

    let order = null;


    try {

      order =
        await supabaseRequest(
          "/rest/v1/orders",
          accessToken,
          {
            method: "POST",

            headers: {
              Prefer:
                "return=representation"
            },

            body: {

              user_id:
                user.id,

              country_id:
                String(countryId),

              country_name:
                countryName,

              service:
                String(serviceId),

              service_name:
                serviceName,

              number:
                number || null,

              price:
                totalPrice,

              status:
                providerStatus,

              request_id:
                requestId || null,

              verification_id:
                verificationId,

              server:
                server

            }

          }
        );

    } catch (orderError) {

      console.error(
        "Order database error:",
        orderError
      );

    }


    /*
     * ----------------------------------------------------
     * 9. Record wallet transaction
     * ----------------------------------------------------
     */

    try {

      await supabaseRequest(
        "/rest/v1/wallet_transactions",
        accessToken,
        {
          method: "POST",

          body: {

            user_id:
              user.id,

            amount:
              -totalPrice,

            type:
              "purchase",

            description:
              `Purchased ${serviceName} number for ${countryName}`,

            reference:
              requestId || null

          }

        }
      );

    } catch (transactionError) {

      console.error(
        "Wallet transaction error:",
        transactionError
      );

    }


    /*
     * ----------------------------------------------------
     * 10. SUCCESS
     * ----------------------------------------------------
     */

    return res.status(200).json({

      success:
        true,

      message:
        "Number purchased successfully.",

      server:
        server,

      price:
        totalPrice,

      balance:
        newBalance,

      number:
        number,

      request_id:
        requestId,

      verification_id:
        verificationId,

      status:
        providerStatus,

      order:
        Array.isArray(order)
          ? order[0]
          : order,

      verification:
        verification || {

          request_id:
            requestId,

          number:
            number,

          service:
            serviceName,

          status:
            providerStatus,

          id:
            verificationId

        }

    });

  } catch (error) {

    console.error(
      "SureVerification order error:",
      error
    );


    /*
     * IMPORTANT:
     * Return the REAL error from the API.
     * Do not hide it behind "Unable to purchase number."
     */

    return res.status(500).json({

      success:
        false,

      error:
        error?.message ||
        "Unable to purchase number."

    });

  }

}

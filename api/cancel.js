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

  const response =
    await fetch(
      `${SUPABASE_URL}${path}`,
      {
        method:
          options.method || "GET",

        headers: {
          apikey:
            SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          Prefer:
            options.prefer ||
            "return=representation",

          ...(options.headers || {})
        },

        ...(options.body !== undefined
          ? {
              body:
                JSON.stringify(
                  options.body
                )
            }
          : {})
      }
    );


  const text =
    await response.text();


  let data = null;


  try {

    data =
      text
        ? JSON.parse(text)
        : null;

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


function getAccessToken(req) {

  const authorization =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";


  if (
    !authorization
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return null;
  }


  return authorization
    .slice(7)
    .trim();

}


export default async function handler(
  req,
  res
) {

  if (req.method !== "DELETE") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  }


  const accessToken =
    getAccessToken(req);


  if (!accessToken) {

    return res.status(401).json({
      success: false,
      error:
        "Authentication required."
    });

  }


  try {

    /*
      -------------------------------------------------------
      1. Verify logged-in user
      -------------------------------------------------------
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


    /*
      -------------------------------------------------------
      2. Get verification ID
      -------------------------------------------------------
    */

    const verificationId =
      req.query?.id ||
      req.query?.verificationId;


    if (!verificationId) {

      return res.status(400).json({
        success: false,
        error:
          "verificationId is required."
      });

    }


    /*
      -------------------------------------------------------
      3. Find the customer's order
      -------------------------------------------------------
      IMPORTANT:
      The order MUST belong to the logged-in user.
    */

    const orders =
      await supabaseRequest(
        `/rest/v1/orders?verification_id=eq.${encodeURIComponent(
          verificationId
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}&select=*&limit=1`,
        accessToken
      );


    const order =
      Array.isArray(orders)
        ? orders[0]
        : null;


    if (!order) {

      return res.status(404).json({
        success: false,
        error:
          "Active number not found."
      });

    }


    /*
      -------------------------------------------------------
      4. Make sure it has not already been cancelled
      -------------------------------------------------------
    */

    const currentStatus =
      String(
        order.status || ""
      ).toLowerCase();


    if (
      currentStatus === "cancelled" ||
      currentStatus === "canceled" ||
      currentStatus === "refunded"
    ) {

      return res.status(400).json({
        success: false,
        error:
          "This number has already been cancelled."
      });

    }


    /*
      -------------------------------------------------------
      5. Make sure cancellation is allowed after 2 minutes
      -------------------------------------------------------
    */

    if (order.created_at) {

      const createdAt =
        new Date(order.created_at)
          .getTime();


      if (
        Number.isFinite(createdAt)
      ) {

        const elapsed =
          Date.now() - createdAt;


        const minimumWait =
          2 * 60 * 1000;


        if (
          elapsed < minimumWait
        ) {

          const remainingSeconds =
            Math.ceil(
              (
                minimumWait -
                elapsed
              ) / 1000
            );


          return res.status(400).json({
            success: false,
            error:
              `Please wait ${remainingSeconds} seconds before cancelling this number.`,
            remainingSeconds
          });

        }

      }

    }


    /*
      -------------------------------------------------------
      6. Prevent two cancellation requests at once
      -------------------------------------------------------
    */

    const lockedOrder =
      await supabaseRequest(
        `/rest/v1/orders?id=eq.${encodeURIComponent(
          order.id
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}&status=eq.${encodeURIComponent(
          order.status
        )}`,
        accessToken,
        {
          method: "PATCH",

          body: {
            status:
              "cancelling"
          }
        }
      );


    if (
      !Array.isArray(lockedOrder) ||
      !lockedOrder.length
    ) {

      return res.status(409).json({
        success: false,
        error:
          "This number is already being cancelled. Please wait."
      });

    }


    /*
      -------------------------------------------------------
      7. Cancel number through SureVerification
      -------------------------------------------------------
    */

    let cancelResponse;


    try {

      cancelResponse =
        await sureVerificationRequest(
          `/verifications/cancel/${encodeURIComponent(
            verificationId
          )}`,
          {
            method: "DELETE"
          }
        );

    } catch (providerError) {

      /*
        Provider cancellation failed.
        Restore the order so the customer can try again.
      */

      try {

        await supabaseRequest(
          `/rest/v1/orders?id=eq.${encodeURIComponent(
            order.id
          )}&user_id=eq.${encodeURIComponent(
            user.id
          )}&status=eq.cancelling`,
          accessToken,
          {
            method: "PATCH",

            body: {
              status:
                order.status || "active"
            }
          }
        );

      } catch (restoreError) {

        console.error(
          "Unable to restore order status:",
          restoreError
        );

      }


      throw providerError;

    }


    /*
      -------------------------------------------------------
      8. Refund the exact amount charged
      -------------------------------------------------------
    */

    const refundAmount =
      Number(order.price);


    if (
      !Number.isFinite(refundAmount) ||
      refundAmount <= 0
    ) {

      /*
        We successfully cancelled the provider
        verification, but the saved order price
        is invalid. Do NOT silently create money.
      */

      await supabaseRequest(
        `/rest/v1/orders?id=eq.${encodeURIComponent(
          order.id
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}&status=eq.cancelling`,
        accessToken,
        {
          method: "PATCH",

          body: {
            status:
              "cancelled"
          }
        }
      );


      return res.status(500).json({
        success: false,
        error:
          "Number cancelled, but the refund could not be calculated. Please contact support."
      });

    }


    /*
      -------------------------------------------------------
      9. Get current wallet
      -------------------------------------------------------
    */

    const wallets =
      await supabaseRequest(
        `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
          user.id
        )}&select=*&limit=1`,
        accessToken
      );


    const wallet =
      Array.isArray(wallets)
        ? wallets[0]
        : null;


    if (!wallet) {

      /*
        Provider cancellation succeeded.
        Keep the order cancelled but report
        that manual support is needed for refund.
      */

      await supabaseRequest(
        `/rest/v1/orders?id=eq.${encodeURIComponent(
          order.id
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}&status=eq.cancelling`,
        accessToken,
        {
          method: "PATCH",

          body: {
            status:
              "cancelled"
          }
        }
      );


      return res.status(500).json({
        success: false,
        error:
          "Number cancelled, but your wallet could not be found. Please contact support for your refund."
      });

    }


    const currentBalance =
      Number(wallet.balance || 0);


    const newBalance =
      currentBalance +
      refundAmount;


    /*
      -------------------------------------------------------
      10. Credit refund to wallet
      -------------------------------------------------------
    */

    const walletUpdate =
      await supabaseRequest(
        `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
          user.id
        )}`,
        accessToken,
        {
          method: "PATCH",

          body: {
            balance:
              newBalance
          }
        }
      );


    if (
      !Array.isArray(walletUpdate) ||
      !walletUpdate.length
    ) {

      /*
        Provider cancellation succeeded.
        The order remains "cancelling" so we don't
        falsely tell the customer the refund happened.
      */

      return res.status(500).json({
        success: false,
        error:
          "Number cancelled, but the wallet refund failed. Please contact support."
      });

    }


    /*
      -------------------------------------------------------
      11. Record refund transaction
      -------------------------------------------------------
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
              refundAmount,

            type:
              "refund",

            description:
              `Refund for cancelled ${order.service_name || "number"} number`,

            reference:
              order.request_id ||
              String(order.id)

          }
        }
      );

    } catch (transactionError) {

      /*
        The wallet was already refunded.
        Do not refund it again.
        Just log the transaction-record problem.
      */

      console.error(
        "Refund transaction record error:",
        transactionError
      );

    }


    /*
      -------------------------------------------------------
      12. Mark order as cancelled
      -------------------------------------------------------
    */

    await supabaseRequest(
      `/rest/v1/orders?id=eq.${encodeURIComponent(
        order.id
      )}&user_id=eq.${encodeURIComponent(
        user.id
      )}&status=eq.cancelling`,
      accessToken,
      {
        method: "PATCH",

        body: {
          status:
            "cancelled"
        }
      }
    );


    /*
      -------------------------------------------------------
      13. Return success
      -------------------------------------------------------
    */

    return res.status(200).json({

      success:
        true,

      message:
        "Number cancelled successfully. Your wallet has been refunded.",

      refund:
        refundAmount,

      balance:
        newBalance,

      verificationId,

      orderId:
        order.id,

      data:
        cancelResponse

    });


  } catch (error) {

    console.error(
      "SureVerification cancel error:",
      error
    );


    return res.status(500).json({

      success:
        false,

      error:
        error?.message ||
        "Unable to cancel verification."

    });

  }

}

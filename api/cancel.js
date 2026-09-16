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
  Supabase server request
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
  Get customer access token
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
  Verify logged-in customer
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
  Safely add money back to the wallet.
  -------------------------------------------------------
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
    throw new Error(
      "Invalid refund amount."
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
      refundAmount;


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
        success:
          true,

        balance:
          Number(
            updated[0].balance
          )
      };

    }

  }


  throw new Error(
    "Wallet balance changed. Please try again."
  );

}


/*
  -------------------------------------------------------
  Record wallet transaction
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
  MAIN CANCEL HANDLER
  -------------------------------------------------------
*/

export default async function handler(
  req,
  res
) {

  if (
    req.method !== "DELETE"
  ) {

    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed"
    });

  }


  let user = null;

  let order = null;

  let cancellationStarted =
    false;


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


    /*
      ---------------------------------------------------
      2. Get verification ID
      ---------------------------------------------------
    */

    const verificationId =
      req.query?.id ||
      req.query?.verificationId;


    if (!verificationId) {

      return res.status(400).json({
        success:
          false,

        error:
          "verificationId is required"
      });

    }


    /*
      ---------------------------------------------------
      3. Find this order.

      IMPORTANT:
      The order MUST belong to the logged-in user.
      ---------------------------------------------------
    */

    const orders =
      await supabaseRequest(
        `orders?verification_id=eq.${encodeURIComponent(
          verificationId
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}&select=*&limit=1`
      );


    order =
      orders?.[0];


    if (!order) {

      return res.status(404).json({
        success:
          false,

        error:
          "Order not found."
      });

    }


    /*
      ---------------------------------------------------
      4. Prevent duplicate cancellation/refund
      ---------------------------------------------------
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
        success:
          false,

        error:
          "This number has already been cancelled."
      });

    }


    if (
      currentStatus === "cancelling"
    ) {

      return res.status(409).json({
        success:
          false,

        error:
          "Cancellation is already being processed."
      });

    }


    /*
      ---------------------------------------------------
      5. Make sure at least 2 minutes have passed.
      ---------------------------------------------------
    */

    const createdAt =
      order.created_at
        ? new Date(
            order.created_at
          )
        : null;


    if (
      createdAt &&
      !Number.isNaN(
        createdAt.getTime()
      )
    ) {

      const elapsed =
        Date.now() -
        createdAt.getTime();


      const minimumWait =
        2 * 60 * 1000;


      if (
        elapsed <
        minimumWait
      ) {

        const remaining =
          Math.ceil(
            (
              minimumWait -
              elapsed
            ) / 1000
          );


        return res.status(400).json({
          success:
            false,

          error:
            `You can cancel this number after 2 minutes.`,

          secondsRemaining:
            remaining
        });

      }

    }


    /*
      ---------------------------------------------------
      6. Lock the order.

      This prevents two cancellation requests
      from both receiving a refund.
      ---------------------------------------------------
    */

    const lockedRows =
      await supabaseRequest(
        `orders?id=eq.${encodeURIComponent(
          order.id
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}&status=neq.cancelled&status=neq.canceled&status=neq.refunded&status=neq.cancelling`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              status:
                "cancelling",

              updated_at:
                new Date().toISOString()
            })
        }
      );


    if (
      !Array.isArray(
        lockedRows
      ) ||
      lockedRows.length === 0
    ) {

      return res.status(409).json({
        success:
          false,

        error:
          "Cancellation is already being processed."
      });

    }


    cancellationStarted =
      true;


    /*
      ---------------------------------------------------
      7. Cancel the verification with SureVerification.
      ---------------------------------------------------
    */

    let providerResult;


    try {

      providerResult =
        await sureVerificationRequest(
          `/verifications/cancel/${encodeURIComponent(
            verificationId
          )}`,
          {
            method:
              "DELETE"
          }
        );

    } catch (
      providerError
    ) {

      /*
        Provider cancellation failed.

        Restore the order status.
        Do NOT refund because the provider
        did not confirm cancellation.
      */

      try {

        await supabaseRequest(
          `orders?id=eq.${encodeURIComponent(
            order.id
          )}&user_id=eq.${encodeURIComponent(
            user.id
          )}&status=eq.cancelling`,
          {
            method:
              "PATCH",

            body:
              JSON.stringify({
                status:
                  order.status ||
                  "active",

                updated_at:
                  new Date().toISOString()
              })
          }
        );

      } catch (
        restoreError
      ) {

        console.error(
          "Unable to restore order status:",
          restoreError
        );

      }


      cancellationStarted =
        false;


      return res.status(400).json({
        success:
          false,

        error:
          providerError?.message ||
          "Unable to cancel this number.",

        refunded:
          false
      });

    }


    /*
      ---------------------------------------------------
      8. Determine refund amount.

      The order.price contains the ADMIN SELLING PRICE
      that the customer actually paid.
      ---------------------------------------------------
    */

    const refundAmount =
      Number(
        order.price
      );


    if (
      !Number.isFinite(
        refundAmount
      ) ||
      refundAmount <= 0
    ) {

      /*
        Provider cancellation succeeded, but the
        stored order price is invalid.

        Mark the order cancelled so it cannot
        be cancelled repeatedly, but report the
        refund problem to the customer.
      */

      try {

        await supabaseRequest(
          `orders?id=eq.${encodeURIComponent(
            order.id
          )}&user_id=eq.${encodeURIComponent(
            user.id
          )}&status=eq.cancelling`,
          {
            method:
              "PATCH",

            body:
              JSON.stringify({
                status:
                  "cancelled",

                updated_at:
                  new Date().toISOString()
              })
          }
        );

      } catch (
        updateError
      ) {

        console.error(
          "Order cancellation update error:",
          updateError
        );

      }


      return res.status(500).json({
        success:
          false,

        error:
          "Number was cancelled, but the refund amount could not be determined. Please contact support.",

        refunded:
          false
      });

    }


    /*
      ---------------------------------------------------
      9. Refund the customer's wallet.
      ---------------------------------------------------
    */

    const refund =
      await refundWallet(
        user.id,
        refundAmount
      );


    /*
      ---------------------------------------------------
      10. Record refund transaction.
      ---------------------------------------------------
    */

    try {

      await createWalletTransaction({
        user_id:
          user.id,

        amount:
          refundAmount,

        type:
          "refund",

        description:
          `Refund for cancelled ${order.service_name || "number"} number`,

        reference:
          `refund-${verificationId}`
      });

    } catch (
      transactionError
    ) {

      /*
        Wallet has already been refunded.

        Do not refund again.
        Only log the transaction-record problem.
      */

      console.error(
        "Refund transaction record error:",
        transactionError
      );

    }


    /*
      ---------------------------------------------------
      11. Mark order as cancelled.
      ---------------------------------------------------
    */

    const cancelledRows =
      await supabaseRequest(
        `orders?id=eq.${encodeURIComponent(
          order.id
        )}&user_id=eq.${encodeURIComponent(
          user.id
        )}&status=eq.cancelling`,
        {
          method:
            "PATCH",

          body:
            JSON.stringify({
              status:
                "cancelled",

              updated_at:
                new Date().toISOString()
            })
        }
      );


    /*
      ---------------------------------------------------
      12. Return success.
      ---------------------------------------------------
    */

    return res.status(200).json({

      success:
        true,

      message:
        "Number cancelled successfully.",

      refunded:
        true,

      refund:
        refundAmount,

      balance:
        refund.balance,

      verificationId,

      provider:
        providerResult,

      order:
        cancelledRows?.[0] ||
        {
          ...order,

          status:
            "cancelled"
        }

    });


  } catch (error) {

    console.error(
      "SureVerification cancellation error:",
      error
    );


    /*
      If an unexpected error happens after
      cancellation started, restore the order
      only if it has not already been cancelled.
    */

    if (
      cancellationStarted &&
      order?.id &&
      user?.id
    ) {

      try {

        await supabaseRequest(
          `orders?id=eq.${encodeURIComponent(
            order.id
          )}&user_id=eq.${encodeURIComponent(
            user.id
          )}&status=eq.cancelling`,
          {
            method:
              "PATCH",

            body:
              JSON.stringify({
                status:
                  order.status ||
                  "active",

                updated_at:
                  new Date().toISOString()
              })
          }
        );

      } catch (
        restoreError
      ) {

        console.error(
          "Cancellation restore error:",
          restoreError
        );

      }

    }


    return res.status(500).json({
      success:
        false,

      error:
        error?.message ||
        "Unable to cancel verification.",

      refunded:
        false
    });

  }

}

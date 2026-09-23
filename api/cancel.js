import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =========================================================
   SUPABASE REQUEST
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
   AUTHENTICATED USER
   ========================================================= */

function getBearerToken(req) {

  const header =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header
    .slice(7)
    .trim();
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

  if (!response.ok) {
    throw new Error("Unauthorized.");
  }

  const user =
    await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}


/* =========================================================
   URL ENCODING
   ========================================================= */

function quote(value) {

  return encodeURIComponent(
    String(value)
  );

}


/* =========================================================
   FIND ORDER
   ========================================================= */

async function findOrder(
  userId,
  identifier
) {

  const value =
    String(identifier || "").trim();

  if (!value) {
    return null;
  }


  /*
    First try the real Supabase order UUID.
  */

  try {

    const rows =
      await supabaseRequest(
        `orders?id=eq.${quote(value)}` +
        `&user_id=eq.${quote(userId)}` +
        `&select=*` +
        `&limit=1`
      );

    if (rows?.[0]) {
      return rows[0];
    }

  } catch {
    /*
      The identifier may not be a UUID.
      Continue with the other identifiers.
    */
  }


  /*
    Try provider request/order ID.
  */

  const providerOrderRows =
    await supabaseRequest(
      `orders?provider_order_id=eq.${quote(value)}` +
      `&user_id=eq.${quote(userId)}` +
      `&select=*` +
      `&order=created_at.desc` +
      `&limit=1`
    );

  if (providerOrderRows?.[0]) {
    return providerOrderRows[0];
  }


  /*
    Try actual provider verification ID.
  */

  const verificationRows =
    await supabaseRequest(
      `orders?provider_verification_id=eq.${quote(value)}` +
      `&user_id=eq.${quote(userId)}` +
      `&select=*` +
      `&order=created_at.desc` +
      `&limit=1`
    );

  if (verificationRows?.[0]) {
    return verificationRows[0];
  }


  /*
    Finally allow the phone number.
  */

  const phoneRows =
    await supabaseRequest(
      `orders?phone_number=eq.${quote(value)}` +
      `&user_id=eq.${quote(userId)}` +
      `&select=*` +
      `&order=created_at.desc` +
      `&limit=1`
    );

  if (phoneRows?.[0]) {
    return phoneRows[0];
  }


  return null;
}


/* =========================================================
   REFUND CHECK
   ========================================================= */

async function hasRefund(
  orderId
) {

  const rows =
    await supabaseRequest(
      `wallet_transactions` +
      `?type=eq.refund` +
      `&reference_id=eq.${quote(orderId)}` +
      `&select=id,amount,created_at` +
      `&limit=1`
    );

  return Boolean(
    rows?.length
  );
}


/* =========================================================
   REFUND CUSTOMER
   ========================================================= */

async function refundOrder(
  order
) {

  if (!order?.id) {
    throw new Error(
      "Order ID is missing."
    );
  }


  /*
    NEVER refund the same order twice.
  */

  if (
    await hasRefund(order.id)
  ) {

    return {
      refunded: true,
      alreadyRefunded: true,
      amount: Number(
        order.customer_price || 0
      )
    };

  }


  const amount =
    Number(
      order.customer_price ??
      order.selling_price ??
      order.amount ??
      0
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    throw new Error(
      "This order does not have a valid refundable amount."
    );

  }


  /*
    Get wallet.
  */

  const walletRows =
    await supabaseRequest(
      `wallets?user_id=eq.${quote(order.user_id)}` +
      `&select=user_id,balance` +
      `&limit=1`
    );


  let wallet =
    walletRows?.[0];


  /*
    Create wallet if it somehow does not exist.
  */

  if (!wallet) {

    const created =
      await supabaseRequest(
        "wallets",
        {
          method: "POST",

          body: JSON.stringify({
            user_id:
              order.user_id,

            balance:
              amount
          })
        }
      );

    wallet =
      created?.[0] ||
      {
        user_id:
          order.user_id,

        balance:
          amount
      };

  } else {

    const before =
      Number(
        wallet.balance || 0
      );

    const after =
      before + amount;


    await supabaseRequest(
      `wallets?user_id=eq.${quote(order.user_id)}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          balance:
            after,

          updated_at:
            new Date().toISOString()
        })
      }
    );


    /*
      Record the refund.
    */

    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",

        body: JSON.stringify({
          user_id:
            order.user_id,

          type:
            "refund",

          amount:
            amount,

          balance_before:
            before,

          balance_after:
            after,

          reference_id:
            order.id,

          description:
            "Refund for cancelled or expired virtual number"
        })
      }
    );

  }


  return {
    refunded: true,
    alreadyRefunded: false,
    amount
  };

}


/* =========================================================
   UPDATE ORDER
   ========================================================= */

async function updateOrder(
  orderId,
  userId,
  values
) {

  return await supabaseRequest(
    `orders?id=eq.${quote(orderId)}` +
    `&user_id=eq.${quote(userId)}`,
    {
      method:
        "PATCH",

      body:
        JSON.stringify({
          ...values,

          updated_at:
            new Date().toISOString()
        })
    }
  );

}


/* =========================================================
   PROVIDER ERROR LOOKS LIKE EXPIRATION
   ========================================================= */

function looksExpired(
  error
) {

  const message =
    String(
      error?.message ||
      ""
    ).toLowerCase();

  return (
    message.includes("expired") ||
    message.includes("already expired") ||
    message.includes("not active") ||
    message.includes("inactive") ||
    message.includes("verification not found") ||
    message.includes("verification has ended") ||
    message.includes("number has expired")
  );

}


/* =========================================================
   MAIN CANCEL HANDLER
   ========================================================= */

export default async function handler(
  req,
  res
) {

  if (
    req.method !== "DELETE" &&
    req.method !== "POST"
  ) {

    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed"
    });

  }


  try {

    /*
      Authenticate customer.
    */

    const user =
      await getAuthenticatedUser(req);


    /*
      Accept all of these so the old frontend
      can still work while we transition it:

      ?orderId=
      ?order_id=
      ?phone=
      ?phone_number=
      ?id=
    */

    const identifier =
      req.query?.orderId ||
      req.query?.order_id ||
      req.query?.phone ||
      req.query?.phone_number ||
      req.query?.id ||
      req.body?.orderId ||
      req.body?.order_id ||
      req.body?.phone ||
      req.body?.phone_number ||
      req.body?.id;


    if (!identifier) {

      return res.status(400).json({
        success:
          false,

        error:
          "Order ID or phone number is required."
      });

    }


    /*
      Find the customer's actual order.
    */

    const order =
      await findOrder(
        user.id,
        identifier
      );


    if (!order) {

      return res.status(404).json({
        success:
          false,

        error:
          "Order not found."
      });

    }


    /*
      Make sure this order belongs to the
      authenticated customer.
    */

    if (
      String(order.user_id) !==
      String(user.id)
    ) {

      return res.status(403).json({
        success:
          false,

        error:
          "You are not allowed to cancel this order."
      });

    }


    /*
      Already cancelled/refunded.
    */

    if (
      String(order.status).toLowerCase() ===
        "cancelled" ||
      String(order.status).toLowerCase() ===
        "canceled"
    ) {

      const refund =
        await refundOrder(order);

      return res.status(200).json({
        success:
          true,

        message:
          refund.alreadyRefunded
            ? "This number was already cancelled and refunded."
            : "This number was already cancelled. Your wallet has been refunded.",

        order_id:
          order.id,

        status:
          "cancelled",

        refunded:
          true,

        refund_amount:
          refund.amount
      });

    }


    /*
      Check provider expiration timestamp
      BEFORE attempting cancellation.
    */

    const expiration =
      order.provider_expired_at
        ? new Date(
            order.provider_expired_at
          )
        : null;

    const now =
      new Date();


    if (
      expiration &&
      !Number.isNaN(
        expiration.getTime()
      ) &&
      expiration.getTime() <=
        now.getTime()
    ) {

      /*
        The provider number has already expired.
        Do NOT attempt a cancellation against
        an already expired verification.
      */

      const refund =
        await refundOrder(order);


      await updateOrder(
        order.id,
        user.id,
        {
          status:
            "expired",

          provider_expired_at:
            order.provider_expired_at
        }
      );


      return res.status(200).json({
        success:
          true,

        message:
          refund.alreadyRefunded
            ? "This number has already expired."
            : "This number has expired and the amount has been refunded to your wallet.",

        order_id:
          order.id,

        status:
          "expired",

        expired:
          true,

        refunded:
          true,

        refund_amount:
          refund.amount
      });

    }


    /*
      We need the REAL SureVerification
      verification.id here.

      NOT request_id.
      NOT provider_order_id.
      NOT the phone number.
    */

    const verificationId =
      order.provider_verification_id;


    if (!verificationId) {

      /*
        If the provider ID is missing, do not
        touch the wallet.

        This protects the customer's money.
      */

      return res.status(409).json({
        success:
          false,

        error:
          "This order is missing its SureVerification verification ID. Your wallet has NOT been charged again and no refund was processed.",

        order_id:
          order.id,

        provider_order_id:
          order.provider_order_id ||
          null
      });

    }


    /*
      SureVerification recommends waiting
      at least two minutes before cancellation.
    */

    if (order.created_at) {

      const created =
        new Date(
          order.created_at
        );

      if (
        !Number.isNaN(
          created.getTime()
        )
      ) {

        const age =
          Date.now() -
          created.getTime();

        const twoMinutes =
          2 * 60 * 1000;

        if (
          age <
          twoMinutes
        ) {

          const remaining =
            Math.ceil(
              (twoMinutes - age) /
              1000
            );

          return res.status(400).json({
            success:
              false,

            error:
              `Cancellation becomes available after 2 minutes. Please wait ${remaining} seconds.`
          });

        }

      }

    }


    /*
      CANCEL AT SUREVERIFICATION.
    */

    try {

      await sureVerificationRequest(
        `/verifications/cancel/${encodeURIComponent(
          String(
            verificationId
          )
        )}`,
        {
          method:
            "DELETE"
        }
      );

    } catch (providerError) {

      console.error(
        "SureVerification cancellation error:",
        providerError
      );


      /*
        If provider says it has already expired,
        synchronize our database and refund.
      */

      if (
        looksExpired(
          providerError
        )
      ) {

        const refund =
          await refundOrder(order);


        await updateOrder(
          order.id,
          user.id,
          {
            status:
              "expired"
          }
        );


        return res.status(200).json({
          success:
            true,

          message:
            refund.alreadyRefunded
              ? "The number has already expired."
              : "The number had already expired and your wallet has been refunded.",

          order_id:
            order.id,

          status:
            "expired",

          expired:
            true,

          refunded:
            true,

          refund_amount:
            refund.amount
        });

      }


      throw providerError;

    }


    /*
      Provider cancellation succeeded.
    */

    const refund =
      await refundOrder(order);


    await updateOrder(
      order.id,
      user.id,
      {
        status:
          "cancelled"
      }
    );


    return res.status(200).json({
      success:
        true,

      message:
        refund.alreadyRefunded
          ? "Number cancelled successfully."
          : "Number cancelled successfully. Your wallet has been refunded.",

      order_id:
        order.id,

      verification_id:
        verificationId,

      status:
        "cancelled",

      refunded:
        true,

      refund_amount:
        refund.amount
    });


  } catch (error) {

    console.error(
      "Cancel API error:",
      error
    );

    return res.status(500).json({
      success:
        false,

      error:
        error?.message ||
        "Unable to cancel number."
    });

  }

}

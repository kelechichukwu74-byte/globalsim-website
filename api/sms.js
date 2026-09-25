// api/sms.js

import {
  sureVerificationRequest
} from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_erjKhsDOoyhbHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


function quote(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}


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
    throw new Error("Unauthorized.");
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
    throw new Error("Unauthorized.");
  }

  const user =
    await response.json();

  if (!user?.id) {
    throw new Error("Unauthorized.");
  }

  return user;
}


async function supabaseRequest(
  path
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
        headers: {
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
      `Supabase returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.hint ||
      data?.details ||
      `Supabase request failed (HTTP ${response.status}).`
    );
  }

  return data;
}


async function getSms(
  verificationId
) {
  const data =
    await sureVerificationRequest(
      `/verifications/sms/${encodeURIComponent(
        String(
          verificationId
        )
      )}`
    );

  const smsList =
    Array.isArray(
      data?.sms
    )
      ? data.sms
      : [];

  const latest =
    smsList.length
      ? smsList[
          smsList.length - 1
        ]
      : null;

  const code =
    latest?.formatted ||
    latest?.raw ||
    null;

  return {
    sms:
      code
        ? String(code)
        : null,

    code:
      code
        ? String(code)
        : null,

    sms_received:
      Boolean(code),

    sms_list:
      smsList
  };
}


export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return res.status(405).json({
      success: false,
      error:
        "Method not allowed."
    });
  }


  try {
    const user =
      await getAuthenticatedUser(
        req
      );


    /*
     * The frontend may send:
     *
     * verificationId
     * verification_id
     * id
     *
     * OR the local order ID.
     */

    const verificationId =
      String(
        req.query?.verificationId ||
        req.query?.verification_id ||
        ""
      ).trim();

    const orderId =
      String(
        req.query?.orderId ||
        req.query?.order_id ||
        ""
      ).trim();


    /*
     * -----------------------------------------------------
     * DIRECT VERIFICATION ID
     * -----------------------------------------------------
     */

    if (
      verificationId
    ) {
      const result =
        await getSms(
          verificationId
        );

      return res.status(200).json({
        success: true,

        verification_id:
          verificationId,

        sms:
          result.sms,

        code:
          result.code,

        sms_received:
          result.sms_received,

        sms_list:
          result.sms_list
      });
    }


    /*
     * -----------------------------------------------------
     * ORDER ID
     * -----------------------------------------------------
     *
     * This makes SMS.js compatible with the
     * Active/order system.
     */

    if (
      orderId
    ) {
      const rows =
        await supabaseRequest(
          `orders?id=eq.${quote(
            orderId
          )}&user_id=eq.${quote(
            user.id
          )}&select=id,provider_verification_id,provider_order_id,provider_expired_at,status&limit=1`
        );

      if (
        !rows?.length
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Order not found."
        });
      }

      const order =
        rows[0];


      /*
       * Provider expiry check.
       */
      if (
        order.provider_expired_at
      ) {
        const expiry =
          new Date(
            String(
              order.provider_expired_at
            ).replace(
              " ",
              "T"
            ) + "Z"
          );

        if (
          !Number.isNaN(
            expiry.getTime()
          ) &&
          expiry.getTime() <=
            Date.now()
        ) {
          return res.status(410).json({
            success: false,
            verification_id:
              order.provider_verification_id ||
              null,
            sms: null,
            code: null,
            sms_received:
              false,
            error:
              "This number has expired."
          });
        }
      }


      const providerVerificationId =
        order.provider_verification_id;


      if (
        providerVerificationId
      ) {
        try {
          const result =
            await getSms(
              providerVerificationId
            );

          return res.status(200).json({
            success: true,

            order_id:
              order.id,

            verification_id:
              providerVerificationId,

            sms:
              result.sms,

            code:
              result.code,

            sms_received:
              result.sms_received,

            sms_list:
              result.sms_list
          });

        } catch (
          verificationError
        ) {
          /*
           * Continue to compatibility
           * fallback below.
           */
        }
      }


      /*
       * Compatibility fallback for older orders.
       *
       * New orders should use
       * provider_verification_id.
       */
      if (
        order.provider_order_id
      ) {
        try {
          const result =
            await getSms(
              order.provider_order_id
            );

          return res.status(200).json({
            success: true,

            order_id:
              order.id,

            verification_id:
              order.provider_order_id,

            sms:
              result.sms,

            code:
              result.code,

            sms_received:
              result.sms_received,

            sms_list:
              result.sms_list
          });

        } catch (
          requestError
        ) {
          return res.status(502).json({
            success: false,

            order_id:
              order.id,

            verification_id:
              order.provider_verification_id ||
              order.provider_order_id ||
              null,

            sms: null,

            code: null,

            sms_received:
              false,

            sms_list:
              [],

            error:
              requestError?.message ||
              "Unable to retrieve SMS."
          });
        }
      }


      return res.status(400).json({
        success: false,

        order_id:
          order.id,

        sms: null,

        code: null,

        sms_received:
          false,

        error:
          "Provider verification ID is missing."
      });
    }


    return res.status(400).json({
      success: false,
      error:
        "Verification ID or order ID is required."
    });

  } catch (error) {
    console.error(
      "SMS API error:",
      error
    );

    const message =
      error?.message ||
      "Unable to retrieve SMS.";

    if (
      message ===
      "Unauthorized."
    ) {
      return res.status(401).json({
        success: false,
        error:
          message
      });
    }

    return res.status(502).json({
      success: false,

      sms:
        null,

      code:
        null,

      sms_received:
        false,

      sms_list:
        [],

      error:
        message
    });
  }
}

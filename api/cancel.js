// api/cancel.js

export default async function handler(req, res) {
  if (req.method !== "DELETE" && req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SURE_API_KEY =
      process.env.SUREVERIFICATION_API_KEY;

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !SURE_API_KEY
    ) {
      return res.status(500).json({
        error: "Server configuration is missing."
      });
    }

    // Get logged-in user's access token
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized."
      });
    }

    const accessToken = authHeader.substring(7);

    // Verify the user with Supabase
    const userResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!userResponse.ok) {
      return res.status(401).json({
        error: "Unauthorized."
      });
    }

    const user = await userResponse.json();

    if (!user || !user.id) {
      return res.status(401).json({
        error: "Unauthorized."
      });
    }

    // Read cancellation ID
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const query = req.query || {};

    const providerOrderId =
      query.id ||
      query.verificationId ||
      query.verification_id ||
      body.id ||
      body.verificationId ||
      body.verification_id ||
      body.provider_order_id ||
      body.providerOrderId ||
      "";

    const cleanId = String(providerOrderId).trim();

    if (!cleanId) {
      return res.status(400).json({
        error: "Verification ID is required."
      });
    }

    // Find the user's order using the SureVerification request ID
    const orderUrl =
      `${SUPABASE_URL}/rest/v1/orders` +
      `?user_id=eq.${encodeURIComponent(user.id)}` +
      `&provider_order_id=eq.${encodeURIComponent(cleanId)}` +
      `&select=*`;

    const orderResponse = await fetch(orderUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();

      console.error(
        "Order lookup failed:",
        errorText
      );

      return res.status(500).json({
        error: "Unable to find order."
      });
    }

    const orders = await orderResponse.json();

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    const order = orders[0];

    // Do not cancel an already finished order
    const currentStatus =
      String(order.status || "").toLowerCase();

    if (
      [
        "cancelled",
        "canceled",
        "expired",
        "failed",
        "refunded"
      ].includes(currentStatus)
    ) {
      return res.status(400).json({
        error: "This number has already been cancelled or completed."
      });
    }

    // Cancel through SureVerification
    const cancelUrl =
      "https://sureverifications.com/api/v1/verifications/cancel/" +
      encodeURIComponent(cleanId);

    const providerResponse = await fetch(
      cancelUrl,
      {
        method: "DELETE",
        headers: {
          "x-api-key": SURE_API_KEY,
          Accept: "application/json"
        }
      }
    );

    const providerText =
      await providerResponse.text();

    let providerData = null;

    try {
      providerData =
        providerText ? JSON.parse(providerText) : null;
    } catch {
      providerData = {
        raw: providerText
      };
    }

    if (!providerResponse.ok) {
      console.error(
        "SureVerification cancellation failed:",
        providerData
      );

      return res.status(providerResponse.status).json({
        error:
          providerData?.message ||
          providerData?.error ||
          "Unable to cancel number.",
        provider: providerData
      });
    }

    // Refund the customer's selling price
    const refundAmount =
      Number(order.customer_price);

    const safeRefund =
      Number.isFinite(refundAmount) &&
      refundAmount > 0
        ? refundAmount
        : 0;

    // Get current wallet balance
    const profileUrl =
      `${SUPABASE_URL}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(user.id)}` +
      `&select=id,balance`;

    const profileResponse = await fetch(
      profileUrl,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!profileResponse.ok) {
      return res.status(500).json({
        error: "Unable to read wallet balance."
      });
    }

    const profiles =
      await profileResponse.json();

    if (!Array.isArray(profiles) || !profiles[0]) {
      return res.status(404).json({
        error: "User profile not found."
      });
    }

    const currentBalance =
      Number(profiles[0].balance || 0);

    const newBalance =
      currentBalance + safeRefund;

    // Update wallet
    const updateProfileUrl =
      `${SUPABASE_URL}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(user.id)}`;

    const updateProfileResponse =
      await fetch(updateProfileUrl, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          balance: newBalance
        })
      });

    if (!updateProfileResponse.ok) {
      const errorText =
        await updateProfileResponse.text();

      console.error(
        "Wallet refund failed:",
        errorText
      );

      return res.status(500).json({
        error:
          "Number was cancelled, but wallet refund failed."
      });
    }

    // Mark order as cancelled
    const updateOrderUrl =
      `${SUPABASE_URL}/rest/v1/orders` +
      `?id=eq.${encodeURIComponent(order.id)}`;

    const updateOrderResponse =
      await fetch(updateOrderUrl, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          status: "cancelled"
        })
      });

    if (!updateOrderResponse.ok) {
      const errorText =
        await updateOrderResponse.text();

      console.error(
        "Order status update failed:",
        errorText
      );
    }

    // Record refund transaction if wallet_transactions exists
    try {
      const transactionUrl =
        `${SUPABASE_URL}/rest/v1/wallet_transactions`;

      await fetch(transactionUrl, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type":
            "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          user_id: user.id,
          type: "refund",
          amount: safeRefund,
          description:
            `Refund for cancelled number ${order.phone_number || order.number || ""}`,
          reference:
            `CANCEL-${order.id}`
        })
      });
    } catch (transactionError) {
      console.error(
        "Refund transaction recording failed:",
        transactionError
      );
    }

    return res.status(200).json({
      success: true,
      message: "Number cancelled successfully.",
      refund: safeRefund,
      balance: newBalance,
      provider: providerData
    });

  } catch (error) {
    console.error(
      "Cancel API error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Internal server error."
    });
  }
}

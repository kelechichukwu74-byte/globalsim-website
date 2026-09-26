// api/order.js

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://jvfpbqzndxqzvsygqvpg.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SURE_BASE_URL =
  "https://sureverifications.com/api/v1";

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);

function json(res, status, data) {
  return res.status(status).json(data);
}

async function getUser(req) {
  const auth = req.headers.authorization || "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = auth.slice(7).trim();

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) return null;

  return response.json();
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...(options.body !== undefined
        ? { body: options.body }
        : {})
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.hint ||
      `Supabase request failed (${response.status})`
    );
  }

  return data;
}

async function sureVerificationRequest(
  path,
  options = {}
) {
  const apiKey =
    process.env.SUREVERIFICATION_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SUREVERIFICATION_API_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SURE_BASE_URL}${path}`,
    {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
        ...(options.headers || {})
      },
      ...(options.body !== undefined
        ? { body: options.body }
        : {})
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `SureVerification returned invalid JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `SureVerification returned HTTP ${response.status}.`
    );
  }

  return data;
}

async function getServicesFromServer(
  server,
  countryId
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${encodeURIComponent(
        countryId
      )}`
    );

  return Array.isArray(data?.services)
    ? data.services
    : [];
}

async function resolveServiceOnSelectedServer({
  server,
  countryId,
  serviceId,
  serviceName
}) {
  const services =
    await getServicesFromServer(
      server,
      countryId
    );

  const wantedId = String(
    serviceId || ""
  ).trim().toLowerCase();

  const wantedName = String(
    serviceName || ""
  ).trim().toLowerCase();

  const service = services.find((item) => {
    const id = String(
      item?.id || ""
    ).trim().toLowerCase();

    const name = String(
      item?.name || ""
    ).trim().toLowerCase();

    return (
      (wantedId && id === wantedId) ||
      (wantedName && name === wantedName)
    );
  });

  if (!service) {
    throw new Error(
      `Service "${serviceName || serviceId}" is not available on ${server}.`
    );
  }

  return service;
}

async function purchaseFromSelectedServer({
  server,
  countryId,
  serviceId,
  serviceName
}) {
  if (!ALLOWED_SERVERS.has(server)) {
    throw new Error(
      `Unsupported provider server: ${server}`
    );
  }

  if (server === "global-server-2") {
    try {
      return await sureVerificationRequest(
        "/global-server-2/purchase",
        {
          method: "POST"
        }
      );
    } catch (firstError) {
      const message = String(
        firstError?.message || ""
      ).toLowerCase();

      if (
        !message.includes("country") &&
        !message.includes("required")
      ) {
        throw firstError;
      }

      const service =
        await resolveServiceOnSelectedServer({
          server,
          countryId,
          serviceId,
          serviceName
        });

      return sureVerificationRequest(
        `/global-server-2/purchase?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          service.id
        )}`,
        {
          method: "POST"
        }
      );
    }
  }

  const service =
    await resolveServiceOnSelectedServer({
      server,
      countryId,
      serviceId,
      serviceName
    });

  return sureVerificationRequest(
    `/${server}/purchase?country_id=${encodeURIComponent(
      countryId
    )}&service=${encodeURIComponent(
      service.id
    )}`,
    {
      method: "POST"
    }
  );
}

async function getWallet(userId) {
  const wallets = await supabaseRequest(
    `/rest/v1/wallets?user_id=eq.${encodeURIComponent(
      userId
    )}&limit=1`
  );

  return Array.isArray(wallets) &&
    wallets.length
    ? wallets[0]
    : null;
}

async function debitWallet(
  userId,
  amount
) {
  const wallet = await getWallet(userId);

  if (!wallet) {
    throw new Error(
      "Wallet not found."
    );
  }

  const balance = Number(
    wallet.balance || 0
  );

  if (balance < amount) {
    throw new Error(
      "Insufficient wallet balance."
    );
  }

  const newBalance =
    balance - amount;

  const updated =
    await supabaseRequest(
      `/rest/v1/wallets?id=eq.${encodeURIComponent(
        wallet.id
      )}&balance=eq.${encodeURIComponent(
        balance
      )}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          balance: newBalance,
          updated_at:
            new Date().toISOString()
        })
      }
    );

  if (
    !Array.isArray(updated) ||
    !updated.length
  ) {
    throw new Error(
      "Wallet changed. Please try again."
    );
  }

  return {
    walletId: wallet.id,
    oldBalance: balance,
    newBalance
  };
}

async function refundWallet(
  userId,
  amount
) {
  const wallet = await getWallet(userId);

  if (!wallet) {
    throw new Error(
      "Wallet not found for refund."
    );
  }

  const balance =
    Number(wallet.balance || 0);

  await supabaseRequest(
    `/rest/v1/wallets?id=eq.${encodeURIComponent(
      wallet.id
    )}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        balance:
          balance + amount,
        updated_at:
          new Date().toISOString()
      })
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: "Method not allowed."
    });
  }

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, {
        success: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY is not configured."
      });
    }

    const user =
      await getUser(req);

    if (!user?.id) {
      return json(res, 401, {
        success: false,
        error: "Unauthorized."
      });
    }

    const body =
      req.body || {};

    const countryId = String(
      body.countryId ||
      body.country_id ||
      ""
    ).trim();

    const serviceId = String(
      body.serviceId ||
      body.service_id ||
      ""
    ).trim();

    const serviceName = String(
      body.serviceName ||
      body.service_name ||
      ""
    ).trim();

    const providerServer = String(
      body.providerServer ||
      body.provider_server ||
      body.server ||
      ""
    ).trim();

    if (!countryId) {
      return json(res, 400, {
        success: false,
        error: "Country ID is required."
      });
    }

    if (!serviceId && !serviceName) {
      return json(res, 400, {
        success: false,
        error: "Service is required."
      });
    }

    if (!ALLOWED_SERVERS.has(
      providerServer
    )) {
      return json(res, 400, {
        success: false,
        error:
          "A valid provider server is required."
      });
    }

    const prices =
      await supabaseRequest(
        `/rest/v1/product_prices?country_id=eq.${encodeURIComponent(
          countryId
        )}&provider_server=eq.${encodeURIComponent(
          providerServer
        )}&is_active=eq.true`
      );

    if (
      !Array.isArray(prices) ||
      !prices.length
    ) {
      return json(res, 404, {
        success: false,
        error:
          "This number is currently unavailable."
      });
    }

    const wantedServiceId =
      serviceId.toLowerCase();

    const wantedServiceName =
      serviceName.toLowerCase();

    const priceRow =
      prices.find((row) => {
        const providerId =
          String(
            row.provider_service_id ||
            row.service_id ||
            ""
          )
            .trim()
            .toLowerCase();

        const rowName =
          String(
            row.service_name ||
            ""
          )
            .trim()
            .toLowerCase();

        const rowId =
          String(
            row.id || ""
          )
            .trim()
            .toLowerCase();

        return (
          (wantedServiceId &&
            (
              providerId ===
                wantedServiceId ||
              rowId ===
                wantedServiceId
            )) ||
          (wantedServiceName &&
            rowName ===
              wantedServiceName)
        );
      });

    if (!priceRow) {
      return json(res, 404, {
        success: false,
        error:
          "This service is not available on the selected provider server."
      });
    }

    const customerPrice =
      Number(
        priceRow.customer_price ??
        priceRow.selling_price ??
        priceRow.price ??
        0
      );

    const providerCost =
      Number(
        priceRow.provider_cost ??
        priceRow.cost ??
        0
      );

    if (
      !Number.isFinite(
        customerPrice
      ) ||
      customerPrice <= 0
    ) {
      return json(res, 400, {
        success: false,
        error:
          "Invalid selling price."
      });
    }

    let debit;

    try {
      debit =
        await debitWallet(
          user.id,
          customerPrice
        );
    } catch (error) {
      return json(res, 400, {
        success: false,
        error:
          error?.message ||
          "Insufficient funds."
      });
    }

    let providerData;

    try {
      providerData =
        await purchaseFromSelectedServer({
          server:
            providerServer,
          countryId,
          serviceId:
            priceRow.provider_service_id ||
            priceRow.service_id ||
            serviceId,
          serviceName:
            priceRow.service_name ||
            serviceName
        });
    } catch (error) {
      try {
        await refundWallet(
          user.id,
          customerPrice
        );
      } catch {}

      return json(res, 400, {
        success: false,
        error:
          error?.message ||
          "Unable to purchase number."
      });
    }

    const verification =
      providerData?.verification ||
      providerData?.data?.verification ||
      null;

    if (!verification) {
      await refundWallet(
        user.id,
        customerPrice
      );

      return json(res, 502, {
        success: false,
        error:
          "Provider did not return verification data."
      });
    }

    /*
     * IMPORTANT:
     * request_id and verification.id are DIFFERENT.
     *
     * request_id -> provider_order_id
     * verification.id -> provider_verification_id
     *
     * The SMS endpoint requires verification.id.
     */

    const providerRequestId =
      verification.request_id != null
        ? String(
            verification.request_id
          )
        : null;

    const providerVerificationId =
      verification.id != null
        ? String(
            verification.id
          )
        : null;

    const phoneNumber =
      verification.number != null
        ? String(
            verification.number
          )
        : null;

    const providerExpiredAt =
      verification.expired_at ||
      null;

    if (
      !providerVerificationId ||
      !phoneNumber
    ) {
      await refundWallet(
        user.id,
        customerPrice
      );

      return json(res, 502, {
        success: false,
        error:
          "Provider returned an incomplete verification response.",
        provider_response: {
          request_id:
            providerRequestId,
          verification_id:
            providerVerificationId,
          number:
            phoneNumber,
          expired_at:
            providerExpiredAt
        }
      });
    }

    const profit =
      customerPrice -
      providerCost;

    const orderRows =
      await supabaseRequest(
        "/rest/v1/orders",
        {
          method: "POST",
          headers: {
            Prefer:
              "return=representation"
          },
          body: JSON.stringify({
            user_id:
              user.id,

            provider_order_id:
              providerRequestId,

            provider_verification_id:
              providerVerificationId,

            service_country_price_id:
              String(
                priceRow.id
              ),

            service_name:
              priceRow.service_name ||
              serviceName,

            country_name:
              priceRow.country_name ||
              body.countryName ||
              body.country_name ||
              null,

            provider_cost:
              providerCost,

            customer_price:
              customerPrice,

            profit,

            status:
              "active",

            phone_number:
              phoneNumber,

            provider_name:
              priceRow.provider_name ||
              "SureVerification",

            provider_server:
              providerServer,

            provider_base_url:
              SURE_BASE_URL,

            provider_expired_at:
              providerExpiredAt,

            updated_at:
              new Date().toISOString()
          })
        }
      );

    const order =
      Array.isArray(orderRows) &&
      orderRows.length
        ? orderRows[0]
        : null;

    if (!order) {
      await refundWallet(
        user.id,
        customerPrice
      );

      return json(res, 500, {
        success: false,
        error:
          "Number was purchased, but the order could not be saved."
      });
    }

    try {
      await supabaseRequest(
        "/rest/v1/wallet_transactions",
        {
          method: "POST",
          body: JSON.stringify({
            user_id:
              user.id,
            wallet_id:
              debit.walletId,
            type:
              "purchase",
            amount:
              customerPrice,
            balance_before:
              debit.oldBalance,
            balance_after:
              debit.newBalance,
            reference_id:
              order.id,
            description:
              `Purchased ${priceRow.service_name || serviceName} number`
          })
        }
      );
    } catch {}

    return json(res, 200, {
      success: true,
      order,
      server:
        providerServer,
      provider_server:
        providerServer,
      verification: {
        request_id:
          providerRequestId,
        id:
          providerVerificationId,
        number:
          phoneNumber,
        service:
          verification.service ||
          priceRow.service_name ||
          serviceName,
        status:
          verification.status ||
          "active",
        expired_at:
          providerExpiredAt
      }
    });
  } catch (error) {
    return json(res, 500, {
      success: false,
      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}

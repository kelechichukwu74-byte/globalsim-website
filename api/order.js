import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_erjKhsDOoyhbjHDExvQ7RQ_gpGcK0C-";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const BASE_URL =
  "https://sureverifications.com/api/v1";

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);

function q(value) {
  return encodeURIComponent(
    String(value ?? "")
  );
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/* =========================================================
   SUPABASE REST
   ========================================================= */

async function supabaseRequest(
  path,
  options = {}
) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
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
        ? { body: options.body }
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

  if (
    !header
      .toLowerCase()
      .startsWith("bearer ")
  ) {
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
    throw new Error(
      "Unauthorized."
    );
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
      "Unable to verify user session."
    );
  }

  if (
    !response.ok ||
    !data?.id
  ) {
    throw new Error(
      "Unauthorized."
    );
  }

  return data;
}

/* =========================================================
   PROVIDER SERVICES
   ========================================================= */

async function getProviderServices(
  server,
  countryId
) {
  const data =
    await sureVerificationRequest(
      `/${server}/services?country_id=${q(
        countryId
      )}`
    );

  const services =
    Array.isArray(data?.services)
      ? data.services
      : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
      ? data
      : [];

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  return services;
}

async function resolveProviderService(
  server,
  countryId,
  requestedId,
  requestedName
) {
  const services =
    await getProviderServices(
      server,
      countryId
    );

  const wantedId =
    normalize(requestedId);

  const wantedName =
    normalize(requestedName);

  let match = null;

  if (wantedId) {
    match =
      services.find(
        service =>
          normalize(
            service?.id
          ) === wantedId
      );
  }

  if (!match && wantedName) {
    match =
      services.find(
        service =>
          normalize(
            service?.name
          ) === wantedName
      );
  }

  if (!match && wantedName) {
    match =
      services.find(
        service => {
          const name =
            normalize(
              service?.name
            );

          return (
            name.includes(
              wantedName
            ) ||
            wantedName.includes(
              name
            )
          );
        }
      );
  }

  if (!match) {
    throw new Error(
      `Service "${requestedName || requestedId}" is not available on ${server}.`
    );
  }

  return {
    id:
      match.id,

    name:
      match.name,

    raw:
      match
  };
}

/* =========================================================
   GLOBAL SERVER 2 PRICE TIER
   ========================================================= */

async function getGlobalServer2Tier(
  providerService
) {
  const data =
    await sureVerificationRequest(
      "/global-server-2/price"
    );

  const prices =
    Array.isArray(data?.prices)
      ? data.prices
      : [];

  if (!prices.length) {
    throw new Error(
      "Global Server 2 returned no price tiers."
    );
  }

  const wantedId =
    normalize(
      providerService.id
    );

  const wantedName =
    normalize(
      providerService.name
    );

  let match =
    prices.find(row => {
      const id =
        normalize(
          row?.service?.id
        );

      return (
        wantedId &&
        id === wantedId
      );
    });

  if (!match && wantedName) {
    match =
      prices.find(row => {
        const name =
          normalize(
            row?.service?.name
          );

        return (
          name === wantedName
        );
      });
  }

  if (!match && wantedName) {
    match =
      prices.find(row => {
        const name =
          normalize(
            row?.service?.name
          );

        return (
          name.includes(
            wantedName
          ) ||
          wantedName.includes(
            name
          )
        );
      });
  }

  if (!match) {
    throw new Error(
      `Global Server 2 has no price tier for "${providerService.name}".`
    );
  }

  const tierId =
    match?.id ??
    match?.price_id ??
    match?.priceId;

  if (
    tierId === undefined ||
    tierId === null ||
    String(tierId).trim() === ""
  ) {
    throw new Error(
      "Global Server 2 returned no valid price tier ID."
    );
  }

  return {
    id:
      String(tierId),

    price:
      Number(
        match?.price || 0
      )
  };
}

/* =========================================================
   SELLING PRICE
   ========================================================= */

async function getSellingPrice({
  countryId,
  providerServer,
  providerService
}) {
  const rows =
    await supabaseRequest(
      "product_prices" +
      `?country_id=eq.${q(
        countryId
      )}` +
      `&provider_server=eq.${q(
        providerServer
      )}` +
      "&is_active=eq.true" +
      "&select=*" +
      "&limit=500"
    );

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(
      `No selling price has been configured for ${providerService.name} on ${providerServer}.`
    );
  }

  const wantedId =
    normalize(
      providerService.id
    );

  const wantedName =
    normalize(
      providerService.name
    );

  let row =
    rows.find(item => {
      const providerId =
        normalize(
          item?.provider_service_id
        );

      const serviceId =
        normalize(
          item?.service_id
        );

      return (
        providerId === wantedId ||
        serviceId === wantedId
      );
    });

  if (!row) {
    row =
      rows.find(
        item =>
          normalize(
            item?.service_name
          ) === wantedName
      );
  }

  if (!row) {
    row =
      rows.find(item => {
        const name =
          normalize(
            item?.service_name
          );

        return (
          name.includes(
            wantedName
          ) ||
          wantedName.includes(
            name
          )
        );
      });
  }

  if (!row) {
    throw new Error(
      `No selling price has been configured for "${providerService.name}" on ${providerServer}.`
    );
  }

  const sellingPrice =
    Number(
      row?.selling_price
    );

  if (
    !Number.isFinite(
      sellingPrice
    ) ||
    sellingPrice <= 0
  ) {
    throw new Error(
      `Invalid selling price for "${providerService.name}" on ${providerServer}.`
    );
  }

  return {
    id:
      row.id,

    sellingPrice,

    providerCost:
      Number(
        row?.provider_cost || 0
      ),

    serviceName:
      row?.service_name ||
      providerService.name,

    countryName:
      row?.country_name || ""
  };
}

/* =========================================================
   WALLET
   ========================================================= */

async function getWallet(
  userId
) {
  const rows =
    await supabaseRequest(
      `wallets?user_id=eq.${q(
        userId
      )}&select=user_id,balance&limit=1`
    );

  if (
    Array.isArray(rows) &&
    rows[0]
  ) {
    return rows[0];
  }

  const created =
    await supabaseRequest(
      "wallets",
      {
        method: "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            balance:
              0
          })
      }
    );

  if (
    !Array.isArray(created) ||
    !created[0]
  ) {
    throw new Error(
      "Unable to create wallet."
    );
  }

  return created[0];
}

async function debitWallet(
  userId,
  amount,
  referenceId
) {
  const wallet =
    await getWallet(
      userId
    );

  const balance =
    Number(
      wallet.balance || 0
    );

  if (
    !Number.isFinite(balance) ||
    balance < amount
  ) {
    return {
      success:
        false,

      balance
    };
  }

  const newBalance =
    balance - amount;

  const updated =
    await supabaseRequest(
      `wallets?user_id=eq.${q(
        userId
      )}&balance=eq.${q(
        balance
      )}`,
      {
        method: "PATCH",

        body:
          JSON.stringify({
            balance:
              newBalance,

            updated_at:
              new Date()
                .toISOString()
          })
      }
    );

  if (
    !Array.isArray(updated) ||
    !updated.length
  ) {
    throw new Error(
      "Unable to debit wallet. Please try again."
    );
  }

  try {
    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            type:
              "purchase",

            amount:
              -amount,

            reference_id:
              referenceId ||
              null,

            description:
              "Virtual number purchase"
          })
      }
    );
  } catch (error) {
    await supabaseRequest(
      `wallets?user_id=eq.${q(
        userId
      )}&balance=eq.${q(
        newBalance
      )}`,
      {
        method: "PATCH",

        body:
          JSON.stringify({
            balance:
              balance,

            updated_at:
              new Date()
                .toISOString()
          })
      }
    );

    throw error;
  }

  return {
    success:
      true,

    balance:
      newBalance
  };
}

async function refundWallet(
  userId,
  amount,
  referenceId
) {
  const wallet =
    await getWallet(
      userId
    );

  const balance =
    Number(
      wallet.balance || 0
    );

  const newBalance =
    balance + amount;

  const updated =
    await supabaseRequest(
      `wallets?user_id=eq.${q(
        userId
      )}&balance=eq.${q(
        balance
      )}`,
      {
        method: "PATCH",

        body:
          JSON.stringify({
            balance:
              newBalance,

            updated_at:
              new Date()
                .toISOString()
          })
      }
    );

  if (
    !Array.isArray(updated) ||
    !updated.length
  ) {
    throw new Error(
      "Unable to refund wallet."
    );
  }

  try {
    await supabaseRequest(
      "wallet_transactions",
      {
        method: "POST",

        body:
          JSON.stringify({
            user_id:
              userId,

            type:
              "refund",

            amount:
              amount,

            reference_id:
              referenceId ||
              null,

            description:
              "Virtual number purchase refund"
          })
      }
    );
  } catch (error) {
    console.error(
      "Refund transaction history error:",
      error
    );
  }

  return newBalance;
}

/* =========================================================
   PROVIDER RESPONSE
   ========================================================= */

function extractVerification(
  data
) {
  const verification =
    data?.verification ||
    data?.data?.verification ||
    data?.result?.verification ||
    data?.result ||
    data?.data ||
    data;

  return {
    verificationId:
      verification?.request_id ||
      verification?.requestId ||
      verification?.verification_id ||
      verification?.verificationId ||
      verification?.id ||
      data?.request_id ||
      data?.verification_id ||
      null,

    phoneNumber:
      verification?.number ||
      verification?.phone_number ||
      verification?.phoneNumber ||
      verification?.phone ||
      data?.number ||
      data?.phone_number ||
      null,

    status:
      verification?.status ||
      data?.status ||
      "active",

    expiredAt:
      verification?.expired_at ||
      data?.expired_at ||
      null,

    providerOrderId:
      verification?.order_id ||
      verification?.orderId ||
      data?.order_id ||
      data?.orderId ||
      null
  };
}

/* =========================================================
   PROVIDER PURCHASE
   ========================================================= */

async function purchaseNumber({
  server,
  countryId,
  providerService
}) {
  const cleanCountry =
    String(
      countryId
    ).trim();

  const cleanService =
    String(
      providerService.id
    ).trim();

  if (!cleanCountry) {
    throw new Error(
      "The country id field is required."
    );
  }

  if (!cleanService) {
    throw new Error(
      "The service field is required."
    );
  }

  const path =
    `/${server}/purchase` +
    `?country_id=${q(
      cleanCountry
    )}` +
    `&service=${q(
      cleanService
    )}`;

  let body = {
    country_id:
      cleanCountry,

    countryId:
      cleanCountry,

    service:
      cleanService,

    service_id:
      cleanService,

    serviceId:
      cleanService
  };

  /*
   * Global Server 2 requires the price-tier ID.
   */
  if (
    server ===
    "global-server-2"
  ) {
    const tier =
      await getGlobalServer2Tier(
        providerService
      );

    body = {
      ...body,

      id:
        String(tier.id)
    };
  }

  console.log(
    "PROVIDER PURCHASE:",
    {
      server,
      countryId:
        cleanCountry,
      service:
        cleanService,
      body
    }
  );

  return await sureVerificationRequest(
    path,
    {
      method:
        "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(body)
    }
  );
}

/* =========================================================
   SAVE ORDER
   ========================================================= */

async function saveOrder({
  userId,
  providerResponse,
  verification,
  pricing,
  providerService,
  countryId,
  countryName,
  serviceCountryPriceId,
  server,
  sellingPrice
}) {
  const providerCost =
    Number.isFinite(
      Number(
        providerResponse?.price
      )
    )
      ? Number(
          providerResponse.price
        )
      : Number(
          pricing.providerCost ||
          0
        );

  const orderData = {
    user_id:
      userId,

    provider_order_id:
      verification.providerOrderId ||
      verification.verificationId ||
      null,

    service_country_price_id:
      serviceCountryPriceId ||
      pricing.id ||
      null,

    service_name:
      pricing.serviceName ||
      providerService.name ||
      null,

    country_name:
      pricing.countryName ||
      countryName ||
      countryId ||
      null,

    provider_cost:
      providerCost,

    customer_price:
      sellingPrice,

    profit:
      sellingPrice -
      providerCost,

    status:
      verification.status ||
      "active",

    phone_number:
      verification.phoneNumber ||
      null,

    provider_name:
      "SureVerification",

    provider_server:
      server,

    provider_base_url:
      BASE_URL,

    provider_expired_at:
      verification.expiredAt ||
      null
  };

  const rows =
    await supabaseRequest(
      "orders",
      {
        method:
          "POST",

        body:
          JSON.stringify(
            orderData
          )
      }
    );

  if (
    !Array.isArray(rows) ||
    !rows[0]
  ) {
    throw new Error(
      "Unable to save order."
    );
  }

  return rows[0];
}

/* =========================================================
   MAIN API
   ========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !==
    "POST"
  ) {
    return res.status(405).json({
      success:
        false,

      error:
        "Method not allowed."
    });
  }

  let userId =
    null;

  let walletDebited =
    false;

  let debitAmount =
    0;

  let verificationId =
    null;

  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    userId =
      user.id;

    const body =
      typeof req.body ===
      "string"
        ? JSON.parse(
            req.body
          )
        : req.body || {};

    const countryId =
      String(
        body.countryId ??
        body.country_id ??
        body.country?.id ??
        ""
      ).trim();

    const countryName =
      String(
        body.countryName ??
        body.country_name ??
        body.country?.name ??
        ""
      ).trim();

    const requestedServiceId =
      String(
        body.serviceId ??
        body.service_id ??
        body.serviceCountryPriceId ??
        ""
      ).trim();

    const requestedServiceName =
      String(
        body.serviceName ??
        body.service_name ??
        ""
      ).trim();

    const serviceCountryPriceId =
      String(
        body.serviceCountryPriceId ??
        body.service_country_price_id ??
        ""
      ).trim();

    const providerServer =
      String(
        body.providerServer ??
        body.provider_server ??
        body.server ??
        ""
      ).trim();

    if (!countryId) {
      return res.status(400).json({
        success:
          false,

        error:
          "The country id field is required."
      });
    }

    if (
      !requestedServiceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "The service field is required."
      });
    }

    if (!providerServer) {
      return res.status(400).json({
        success:
          false,

        error:
          "Please select a seller/server."
      });
    }

    if (
      !ALLOWED_SERVERS.has(
        providerServer
      )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          `Invalid provider server "${providerServer}".`
      });
    }

    console.log(
      "ORDER REQUEST:",
      {
        countryId,
        countryName,
        requestedServiceId,
        requestedServiceName,
        providerServer
      }
    );

    /*
     * IMPORTANT:
     * Resolve the service AGAIN from the selected
     * provider server. This prevents USA1 service IDs
     * being sent to Global1/Global2 and vice versa.
     */
    const providerService =
      await resolveProviderService(
        providerServer,
        countryId,
        requestedServiceId,
        requestedServiceName
      );

    /*
     * Get the selling price belonging to:
     *
     * country + selected server + selected provider service
     */
    const pricing =
      await getSellingPrice({
        countryId,

        providerServer,

        providerService
      });

    const sellingPrice =
      Number(
        pricing.sellingPrice
      );

    debitAmount =
      sellingPrice;

    const wallet =
      await getWallet(
        userId
      );

    const balance =
      Number(
        wallet.balance || 0
      );

    if (
      !Number.isFinite(balance) ||
      balance < sellingPrice
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Insufficient wallet balance.",

        balance,

        required:
          sellingPrice
      });
    }

    /*
     * PURCHASE FROM THE SELECTED SERVER.
     */
    let providerResponse;

    try {
      providerResponse =
        await purchaseNumber({
          server:
            providerServer,

          countryId,

          providerService
        });
    } catch (providerError) {
      console.error(
        "PROVIDER PURCHASE ERROR:",
        providerError
      );

      return res.status(502).json({
        success:
          false,

        error:
          providerError?.message ||
          "Unable to purchase number from the selected server.",

        server:
          providerServer
      });
    }

    console.log(
      "PROVIDER RESPONSE:",
      JSON.stringify(
        providerResponse
      )
    );

    const verification =
      extractVerification(
        providerResponse
      );

    verificationId =
      verification.verificationId;

    if (
      !verification.verificationId
    ) {
      return res.status(502).json({
        success:
          false,

        error:
          "The provider did not return a verification ID.",

        server:
          providerServer
      });
    }

    if (
      !verification.phoneNumber
    ) {
      return res.status(502).json({
        success:
          false,

        error:
          "The provider did not return a phone number.",

        server:
          providerServer
      });
    }

    /*
     * Provider succeeded.
     * Now debit the customer's wallet.
     */
    const debit =
      await debitWallet(
        userId,

        sellingPrice,

        verification.verificationId
      );

    if (!debit.success) {
      return res.status(400).json({
        success:
          false,

        error:
          "Insufficient wallet balance.",

        balance:
          debit.balance,

        required:
          sellingPrice
      });
    }

    walletDebited =
      true;

    let order;

    try {
      order =
        await saveOrder({
          userId,

          providerResponse,

          verification,

          pricing,

          providerService,

          countryId,

          countryName,

          serviceCountryPriceId,

          server:
            providerServer,

          sellingPrice
        });
    } catch (orderError) {
      /*
       * Never leave the customer charged when
       * the local order cannot be saved.
       */
      try {
        await refundWallet(
          userId,

          sellingPrice,

          verification.verificationId
        );

        walletDebited =
          false;
      } catch (refundError) {
        console.error(
          "REFUND ERROR:",
          refundError
        );
      }

      throw orderError;
    }

    walletDebited =
      false;

    return res.status(200).json({
      success:
        true,

      message:
        "Number purchased successfully.",

      order,

      number:
        verification.phoneNumber,

      phoneNumber:
        verification.phoneNumber,

      verificationId:
        verification.verificationId,

      requestId:
        verification.verificationId,

      status:
        verification.status ||
        "active",

      expiredAt:
        verification.expiredAt ||
        null,

      countryId,

      countryName:
        countryName ||
        pricing.countryName ||
        "",

      serviceId:
        providerService.id,

      serviceName:
        providerService.name,

      server:
        providerServer,

      seller:
        providerServer,

      price:
        sellingPrice,

      balance:
        debit.balance
    });

  } catch (error) {
    console.error(
      "ORDER API ERROR:",
      error
    );

    if (
      walletDebited &&
      userId &&
      debitAmount > 0
    ) {
      try {
        await refundWallet(
          userId,

          debitAmount,

          verificationId
        );
      } catch (refundError) {
        console.error(
          "SAFETY REFUND ERROR:",
          refundError
        );
      }
    }

    const message =
      error?.message ||
      "Unable to purchase number.";

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

    if (
      message
        .toLowerCase()
        .includes(
          "insufficient wallet"
        )
    ) {
      return res.status(400).json({
        success:
          false,

        error:
          "Insufficient wallet balance."
      });
    }

    return res.status(500).json({
      success:
        false,

      error:
        message
    });
  }
}

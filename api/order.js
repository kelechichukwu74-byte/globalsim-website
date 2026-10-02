import { createClient } from "@supabase/supabase-js";
import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_SERVERS = [
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
];

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function bearer(req) {
  const auth = req.headers?.authorization || "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return auth.slice(7).trim() || null;
}

async function getUser(req) {
  const token = bearer(req);

  if (!token) return null;

  const client = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  const {
    data: { user },
    error
  } = await client.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return user;
}

/* -------------------------------------------------------
   PROVIDER SERVICES
------------------------------------------------------- */

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

  if (!services.length) {
    throw new Error(
      `No services were returned by ${server} for country ${countryId}.`
    );
  }

  const wantedId =
    normalize(requestedId);

  const wantedName =
    normalize(requestedName);

  let match = null;

  if (wantedId) {
    match = services.find(
      service =>
        normalize(
          service?.id ??
          service?.service_id ??
          service?.serviceId
        ) === wantedId
    );
  }

  if (!match && wantedName) {
    match = services.find(
      service =>
        normalize(
          service?.name ??
          service?.service_name ??
          service?.serviceName
        ) === wantedName
    );
  }

  if (!match && wantedName) {
    match = services.find(service => {
      const name = normalize(
        service?.name ??
        service?.service_name ??
        service?.serviceName
      );

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  if (!match) {
    throw new Error(
      `Service "${requestedName || requestedId}" is not available on ${server}.`
    );
  }

  return {
    id:
      match.id ??
      match.service_id ??
      match.serviceId,

    name:
      match.name ??
      match.service_name ??
      match.serviceName,

    raw: match
  };
}

/* -------------------------------------------------------
   GLOBAL SERVER 2 PRICE TIER
------------------------------------------------------- */

async function getGlobal2Tier(
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
      "Global Server 2 did not return any price tiers."
    );
  }

  const wantedId =
    normalize(providerService.id);

  const wantedName =
    normalize(providerService.name);

  let match = prices.find(row => {
    const serviceId =
      normalize(
        row?.service?.id ??
        row?.service_id ??
        row?.serviceId
      );

    return (
      wantedId &&
      serviceId === wantedId
    );
  });

  if (!match && wantedName) {
    match = prices.find(row => {
      const name =
        normalize(
          row?.service?.name ??
          row?.service_name ??
          row?.serviceName
        );

      return name === wantedName;
    });
  }

  if (!match && wantedName) {
    match = prices.find(row => {
      const name =
        normalize(
          row?.service?.name ??
          row?.service_name ??
          row?.serviceName
        );

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  if (!match) {
    throw new Error(
      `No Global Server 2 price tier was found for "${providerService.name}".`
    );
  }

  const tierId =
    match.id ??
    match.price_id ??
    match.priceId;

  if (
    tierId === undefined ||
    tierId === null ||
    String(tierId).trim() === ""
  ) {
    throw new Error(
      "Global Server 2 did not return a valid price tier ID."
    );
  }

  return {
    id: tierId,
    price: Number(match.price || 0)
  };
}

/* -------------------------------------------------------
   SELLING PRICE
------------------------------------------------------- */

async function getSellingPrice({
  countryId,
  providerService,
  server
}) {
  const { data, error } =
    await supabase
      .from("product_prices")
      .select("*")
      .eq(
        "country_id",
        String(countryId)
      )
      .eq(
        "provider_server",
        server
      )
      .eq(
        "is_active",
        true
      );

  if (error) {
    throw new Error(
      `Unable to load selling price: ${error.message}`
    );
  }

  if (!data?.length) {
    throw new Error(
      `No selling price has been configured for ${providerService.name} on ${server}.`
    );
  }

  const wantedId =
    normalize(providerService.id);

  const wantedName =
    normalize(providerService.name);

  let row = data.find(item => {
    const providerId =
      normalize(
        item.provider_service_id
      );

    const serviceId =
      normalize(
        item.service_id
      );

    return (
      (wantedId &&
        providerId === wantedId) ||
      (wantedId &&
        serviceId === wantedId)
    );
  });

  if (!row) {
    row = data.find(
      item =>
        normalize(
          item.service_name
        ) === wantedName
    );
  }

  if (!row) {
    row = data.find(item => {
      const name =
        normalize(
          item.service_name
        );

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  if (!row) {
    throw new Error(
      `No selling price has been configured for "${providerService.name}" on ${server}.`
    );
  }

  const sellingPrice =
    Number(row.selling_price);

  if (
    !Number.isFinite(sellingPrice) ||
    sellingPrice <= 0
  ) {
    throw new Error(
      `Invalid selling price for "${providerService.name}" on ${server}.`
    );
  }

  return {
    id: row.id,
    sellingPrice,
    providerCost:
      Number(row.provider_cost) || 0,
    serviceName:
      row.service_name ||
      providerService.name,
    countryName:
      row.country_name || ""
  };
}

/* -------------------------------------------------------
   WALLET
------------------------------------------------------- */

async function getWallet(userId) {
  let { data, error } =
    await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load wallet: ${error.message}`
    );
  }

  if (data) {
    return data;
  }

  const result =
    await supabase
      .from("wallets")
      .insert({
        user_id: userId,
        balance: 0
      })
      .select("*")
      .single();

  if (result.error) {
    throw new Error(
      `Unable to create wallet: ${result.error.message}`
    );
  }

  return result.data;
}

async function debitWallet(
  userId,
  amount,
  referenceId
) {
  const wallet =
    await getWallet(userId);

  const balance =
    Number(wallet.balance || 0);

  if (
    !Number.isFinite(balance) ||
    balance < amount
  ) {
    return {
      success: false,
      balance
    };
  }

  const newBalance =
    balance - amount;

  const { error } =
    await supabase
      .from("wallets")
      .update({
        balance: newBalance,
        updated_at:
          new Date().toISOString()
      })
      .eq(
        "user_id",
        userId
      );

  if (error) {
    throw new Error(
      `Unable to debit wallet: ${error.message}`
    );
  }

  const transaction =
    await supabase
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        type: "purchase",
        amount: -amount,
        reference_id:
          referenceId || null,
        description:
          "Virtual number purchase"
      });

  if (transaction.error) {
    await supabase
      .from("wallets")
      .update({
        balance,
        updated_at:
          new Date().toISOString()
      })
      .eq(
        "user_id",
        userId
      );

    throw new Error(
      `Unable to record wallet transaction: ${transaction.error.message}`
    );
  }

  return {
    success: true,
    balance: newBalance
  };
}

async function refundWallet(
  userId,
  amount,
  referenceId
) {
  const wallet =
    await getWallet(userId);

  const balance =
    Number(wallet.balance || 0);

  const newBalance =
    balance + amount;

  const { error } =
    await supabase
      .from("wallets")
      .update({
        balance: newBalance,
        updated_at:
          new Date().toISOString()
      })
      .eq(
        "user_id",
        userId
      );

  if (error) {
    throw new Error(
      `Unable to refund wallet: ${error.message}`
    );
  }

  await supabase
    .from("wallet_transactions")
    .insert({
      user_id: userId,
      type: "refund",
      amount,
      reference_id:
        referenceId || null,
      description:
        "Virtual number purchase refund"
    });

  return newBalance;
}

/* -------------------------------------------------------
   PROVIDER RESPONSE
------------------------------------------------------- */

function extractVerification(data) {
  const verification =
    data?.verification ||
    data?.data?.verification ||
    data?.result?.verification ||
    data?.result ||
    data;

  return {
    verificationId:
      verification?.request_id ||
      verification?.verification_id ||
      verification?.id ||
      data?.request_id ||
      data?.verification_id ||
      null,

    phoneNumber:
      verification?.number ||
      verification?.phone_number ||
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
      null
  };
}

/* -------------------------------------------------------
   PROVIDER PURCHASE
------------------------------------------------------- */

async function purchaseFromProvider({
  server,
  countryId,
  providerService
}) {
  const country =
    String(countryId).trim();

  const service =
    String(providerService.id).trim();

  if (!country) {
    throw new Error(
      "The country id field is required."
    );
  }

  if (!service) {
    throw new Error(
      "The service field is required."
    );
  }

  const path =
    `/${server}/purchase?country_id=${q(
      country
    )}&service=${q(service)}`;

  let body = {
    country_id: country,
    countryId: country,
    service: service,
    service_id: service,
    serviceId: service
  };

  /* Global Server 2 requires its price-tier ID. */
  if (
    server ===
    "global-server-2"
  ) {
    const tier =
      await getGlobal2Tier(
        providerService
      );

    body = {
      ...body,
      id: String(tier.id)
    };
  }

  console.log(
    "SureVerification purchase request:",
    {
      server,
      countryId: country,
      service,
      body
    }
  );

  const response =
    await sureVerificationRequest(
      path,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(body)
      }
    );

  console.log(
    "SureVerification purchase response:",
    JSON.stringify(response)
  );

  return response;
}

/* -------------------------------------------------------
   CREATE ORDER
------------------------------------------------------- */

async function createOrder({
  userId,
  providerResponse,
  verification,
  pricing,
  providerService,
  countryName,
  countryId,
  sellingPrice,
  server
}) {
  const providerCost =
    Number(
      providerResponse?.price ??
      providerResponse?.verification?.price ??
      providerResponse?.data?.price ??
      pricing.providerCost ??
      0
    ) || 0;

  const profit =
    sellingPrice - providerCost;

  const row = {
    user_id: userId,

    provider_order_id:
      providerResponse?.order_id ||
      providerResponse?.provider_order_id ||
      verification.verificationId,

    service_country_price_id:
      pricing.id,

    service_name:
      pricing.serviceName ||
      providerService.name,

    country_name:
      pricing.countryName ||
      countryName ||
      countryId,

    provider_cost:
      providerCost,

    customer_price:
      sellingPrice,

    profit,

    status:
      verification.status ||
      "active",

    phone_number:
      verification.phoneNumber,

    provider_name:
      "SureVerification",

    provider_server:
      server,

    provider_base_url:
      "https://sureverifications.com/api/v1",

    provider_expired_at:
      verification.expiredAt || null
  };

  const { data, error } =
    await supabase
      .from("orders")
      .insert(row)
      .select("*")
      .single();

  if (error) {
    throw new Error(
      `Unable to save order: ${error.message}`
    );
  }

  return data;
}

/* -------------------------------------------------------
   MAIN API
------------------------------------------------------- */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let userId = null;
  let walletDebited = false;
  let debitAmount = 0;
  let refundReference = null;

  try {
    const user =
      await getUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    userId = user.id;

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    /* -----------------------------------------
       COUNTRY
    ----------------------------------------- */

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

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error:
          "The country id field is required."
      });
    }

    /* -----------------------------------------
       SERVICE
    ----------------------------------------- */

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

    if (
      !requestedServiceId &&
      !requestedServiceName
    ) {
      return res.status(400).json({
        success: false,
        error:
          "The service field is required."
      });
    }

    /* -----------------------------------------
       SERVER
    ----------------------------------------- */

    const server =
      String(
        body.providerServer ??
        body.provider_server ??
        body.server ??
        ""
      ).trim();

    if (!server) {
      return res.status(400).json({
        success: false,
        error:
          "Please select a seller/server."
      });
    }

    if (
      !ALLOWED_SERVERS.includes(server)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid seller/server selected."
      });
    }

    console.log(
      "ORDER REQUEST:",
      {
        userId,
        countryId,
        countryName,
        requestedServiceId,
        requestedServiceName,
        server
      }
    );

    /* -----------------------------------------
       RESOLVE SERVICE FOR EXACT SERVER
    ----------------------------------------- */

    const providerService =
      await resolveProviderService(
        server,
        countryId,
        requestedServiceId,
        requestedServiceName
      );

    /* -----------------------------------------
       LOAD PRICE FOR EXACT SERVER
    ----------------------------------------- */

    const pricing =
      await getSellingPrice({
        countryId,
        providerService,
        server
      });

    const sellingPrice =
      Number(pricing.sellingPrice);

    debitAmount =
      sellingPrice;

    /* -----------------------------------------
       CHECK WALLET
    ----------------------------------------- */

    const wallet =
      await getWallet(userId);

    const balance =
      Number(wallet.balance || 0);

    if (
      !Number.isFinite(balance) ||
      balance < sellingPrice
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance,
        required:
          sellingPrice
      });
    }

    /* -----------------------------------------
       PURCHASE FROM SELECTED SERVER ONLY
    ----------------------------------------- */

    let providerResponse;

    try {
      providerResponse =
        await purchaseFromProvider({
          server,
          countryId,
          providerService
        });
    } catch (error) {
      console.error(
        "Provider purchase failed:",
        {
          server,
          countryId,
          service:
            providerService.id,
          error:
            error?.message
        }
      );

      return res.status(502).json({
        success: false,
        error:
          error?.message ||
          "Unable to purchase number from the selected server.",
        server
      });
    }

    /* -----------------------------------------
       EXTRACT NUMBER
    ----------------------------------------- */

    const verification =
      extractVerification(
        providerResponse
      );

    if (
      !verification.verificationId
    ) {
      return res.status(502).json({
        success: false,
        error:
          "The selected server did not return a verification ID.",
        server
      });
    }

    if (
      !verification.phoneNumber
    ) {
      return res.status(502).json({
        success: false,
        error:
          "The selected server did not return a phone number.",
        server
      });
    }

    refundReference =
      verification.verificationId;

    /* -----------------------------------------
       DEBIT WALLET
    ----------------------------------------- */

    const debit =
      await debitWallet(
        userId,
        sellingPrice,
        verification.verificationId
      );

    if (!debit.success) {
      return res.status(400).json({
        success: false,
        error:
          "Insufficient wallet balance.",
        balance:
          debit.balance,
        required:
          sellingPrice
      });
    }

    walletDebited = true;

    /* -----------------------------------------
       SAVE ORDER
    ----------------------------------------- */

    let order;

    try {
      order =
        await createOrder({
          userId,
          providerResponse,
          verification,
          pricing,
          providerService,
          countryName,
          countryId,
          sellingPrice,
          server
        });
    } catch (error) {
      await refundWallet(
        userId,
        sellingPrice,
        verification.verificationId
      );

      walletDebited = false;

      throw error;
    }

    /* -----------------------------------------
       SUCCESS
    ----------------------------------------- */

    return res.status(200).json({
      success: true,

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

      server,

      seller:
        server,

      price:
        sellingPrice,

      balance:
        debit.balance
    });

  } catch (error) {
    console.error(
      "Virtual number purchase error:",
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
          refundReference
        );
      } catch (refundError) {
        console.error(
          "Automatic refund failed:",
          refundError
        );
      }
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to purchase number."
    });
  }
}

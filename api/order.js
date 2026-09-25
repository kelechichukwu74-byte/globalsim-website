import { createClient } from "@supabase/supabase-js";
import { sureVerificationRequest } from "./_lib.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

function quote(value) {
  return encodeURIComponent(String(value ?? ""));
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractUserToken(req) {
  const auth = req.headers?.authorization || "";

  if (!auth.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return auth.slice(7).trim() || null;
}

async function getUser(req) {
  const token = extractUserToken(req);

  if (!token) return null;

  const client = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  const {
    data: { user },
    error
  } = await client.auth.getUser(token);

  if (error || !user) return null;

  return user;
}

async function getProviderServices(server, countryId) {
  const data = await sureVerificationRequest(
    `/${server}/services?country_id=${quote(countryId)}`
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

async function resolveProviderServiceId(
  server,
  countryId,
  requestedServiceId,
  requestedServiceName
) {
  const services = await getProviderServices(
    server,
    countryId
  );

  const wantedId = normalize(requestedServiceId);
  const wantedName = normalize(requestedServiceName);

  let match = null;

  if (wantedId) {
    match = services.find(
      service => normalize(service?.id) === wantedId
    );
  }

  if (!match && wantedName) {
    match = services.find(
      service => normalize(service?.name) === wantedName
    );
  }

  if (!match && wantedName) {
    match = services.find(service => {
      const name = normalize(service?.name);

      return (
        name.includes(wantedName) ||
        wantedName.includes(name)
      );
    });
  }

  if (!match) {
    throw new Error(
      `Service "${requestedServiceName || requestedServiceId}" is not available on ${server}.`
    );
  }

  return {
    id: match.id,
    name: match.name,
    service: match
  };
}

async function getSellingPrice({
  countryId,
  serviceId,
  serviceName,
  server
}) {
  const { data: rows, error } = await supabase
    .from("product_prices")
    .select("*")
    .eq("country_id", String(countryId))
    .eq("provider_server", server)
    .eq("is_active", true);

  if (error) {
    throw new Error(
      `Unable to load selling price: ${error.message}`
    );
  }

  if (!rows?.length) {
    throw new Error(
      `No selling price has been configured for this service on ${server}.`
    );
  }

  const requestedId = normalize(serviceId);
  const requestedName = normalize(serviceName);

  let row = rows.find(item => {
    const providerId = normalize(item.provider_service_id);
    const serviceIdValue = normalize(item.service_id);

    return (
      (requestedId && providerId === requestedId) ||
      (requestedId && serviceIdValue === requestedId)
    );
  });

  if (!row && requestedName) {
    row = rows.find(
      item =>
        normalize(item.service_name) === requestedName
    );
  }

  if (!row && requestedName) {
    row = rows.find(item => {
      const name = normalize(item.service_name);

      return (
        name.includes(requestedName) ||
        requestedName.includes(name)
      );
    });
  }

  if (!row) {
    throw new Error(
      `No selling price has been configured for "${serviceName || serviceId}" on ${server}.`
    );
  }

  const sellingPrice = Number(row.selling_price);

  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    throw new Error(
      `The selling price for "${serviceName || serviceId}" on ${server} is invalid.`
    );
  }

  return {
    id: row.id,
    sellingPrice,
    serviceName: row.service_name || serviceName || "",
    countryName: row.country_name || ""
  };
}

async function getWallet(userId) {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load wallet: ${error.message}`
    );
  }

  if (data) return data;

  const { data: created, error: createError } =
    await supabase
      .from("wallets")
      .insert({
        user_id: userId,
        balance: 0
      })
      .select("*")
      .single();

  if (createError) {
    throw new Error(
      `Unable to create wallet: ${createError.message}`
    );
  }

  return created;
}

async function debitWallet(userId, amount, referenceId) {
  const wallet = await getWallet(userId);
  const balance = Number(wallet.balance || 0);

  if (!Number.isFinite(balance) || balance < amount) {
    return {
      success: false,
      balance
    };
  }

  const newBalance = balance - amount;

  const { error: walletError } = await supabase
    .from("wallets")
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq("id", wallet.id);

  if (walletError) {
    throw new Error(
      `Unable to debit wallet: ${walletError.message}`
    );
  }

  const { error: transactionError } =
    await supabase
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        type: "purchase",
        amount: -amount,
        reference_id: referenceId || null,
        description: "Virtual number purchase"
      });

  if (transactionError) {
    await supabase
      .from("wallets")
      .update({
        balance,
        updated_at: new Date().toISOString()
      })
      .eq("id", wallet.id);

    throw new Error(
      `Unable to record wallet transaction: ${transactionError.message}`
    );
  }

  return {
    success: true,
    balance: newBalance
  };
}

async function refundWallet(userId, amount, referenceId) {
  const wallet = await getWallet(userId);
  const balance = Number(wallet.balance || 0);
  const newBalance = balance + amount;

  const { error: walletError } = await supabase
    .from("wallets")
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq("id", wallet.id);

  if (walletError) {
    throw new Error(
      `Unable to refund wallet: ${walletError.message}`
    );
  }

  const { error: transactionError } =
    await supabase
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        type: "refund",
        amount,
        reference_id: referenceId || null,
        description: "Virtual number purchase refund"
      });

  if (transactionError) {
    console.error(
      "Refund transaction record failed:",
      transactionError
    );
  }

  return newBalance;
}

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

async function createOrder({
  userId,
  providerOrderId,
  serviceCountryPriceId,
  serviceName,
  countryName,
  providerPrice,
  sellingPrice,
  phoneNumber,
  status,
  providerServer
}) {
  const safeProviderCost =
    Number.isFinite(Number(providerPrice))
      ? Number(providerPrice)
      : 0;

  const safeSellingPrice =
    Number.isFinite(Number(sellingPrice))
      ? Number(sellingPrice)
      : 0;

  const safeProfit =
    safeSellingPrice - safeProviderCost;

  const insertData = {
    user_id: userId,

    provider_order_id:
      providerOrderId || null,

    service_country_price_id:
      serviceCountryPriceId || null,

    service_name:
      serviceName || null,

    country_name:
      countryName || null,

    provider_cost:
      safeProviderCost,

    customer_price:
      safeSellingPrice,

    profit:
      safeProfit,

    status:
      status || "active",

    phone_number:
      phoneNumber || null,

    provider_name:
      "SureVerification",

    provider_server:
      providerServer || null,

    provider_base_url:
      "https://sureverifications.com/api/v1"
  };

  const { data, error } = await supabase
    .from("orders")
    .insert(insertData)
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Unable to save order: ${error.message}`
    );
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  let walletDebited = false;
  let debitAmount = 0;
  let userId = null;
  let createdProviderVerificationId = null;

  try {
    const user = await getUser(req);

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

    const {
      countryId,
      countryName,
      serviceId,
      serviceName,
      serviceCountryPriceId,
      providerServer,
      server
    } = body;

    /*
     * CUSTOMER SELECTED SERVER ONLY.
     * NO AUTOMATIC SERVER FALLBACK.
     */
    const selectedServer =
      providerServer ||
      server ||
      null;

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "The country id field is required."
      });
    }

    if (!serviceId && !serviceName) {
      return res.status(400).json({
        success: false,
        error: "The service field is required."
      });
    }

    if (!selectedServer) {
      return res.status(400).json({
        success: false,
        error: "Please select a seller/server."
      });
    }

    if (!ALLOWED_SERVERS.includes(selectedServer)) {
      return res.status(400).json({
        success: false,
        error: "Invalid seller/server selected."
      });
    }

    /*
     * This is the ONLY server used for this order.
     */
    const serverToUse = selectedServer;

    /*
     * Get the service ID belonging to THIS selected server.
     */
    const providerService =
      await resolveProviderServiceId(
        serverToUse,
        countryId,
        serviceId,
        serviceName
      );

    /*
     * Get the manually configured selling price
     * for THIS country + service + selected server.
     */
    const pricing =
      await getSellingPrice({
        countryId,
        serviceId: providerService.id,
        serviceName: providerService.name,
        server: serverToUse
      });

    const sellingPrice =
      Number(pricing.sellingPrice);

    debitAmount = sellingPrice;

    const wallet = await getWallet(userId);

    const currentBalance =
      Number(wallet.balance || 0);

    if (
      !Number.isFinite(currentBalance) ||
      currentBalance < sellingPrice
    ) {
      return res.status(400).json({
        success: false,
        error: "Insufficient wallet balance.",
        balance: currentBalance,
        required: sellingPrice
      });
    }

    /*
     * PURCHASE FROM ONLY THE SERVER THE CUSTOMER CHOSE.
     */
    let providerResponse;

    try {
      providerResponse =
        await sureVerificationRequest(
          `/${serverToUse}/purchase?country_id=${quote(
            countryId
          )}&service=${quote(
            providerService.id
          )}`,
          {
            method: "POST"
          }
        );
    } catch (providerError) {
      return res.status(502).json({
        success: false,
        error:
          providerError?.message ||
          "Unable to purchase number from the selected server.",
        server: serverToUse
      });
    }

    const verification =
      extractVerification(providerResponse);

    if (!verification.verificationId) {
      return res.status(502).json({
        success: false,
        error:
          "The selected server did not return a verification ID.",
        server: serverToUse
      });
    }

    if (!verification.phoneNumber) {
      return res.status(502).json({
        success: false,
        error:
          "The selected server did not return a phone number.",
        server: serverToUse
      });
    }

    createdProviderVerificationId =
      verification.verificationId;

    /*
     * Debit only after the provider successfully
     * returns a usable number.
     */
    const debit =
      await debitWallet(
        userId,
        sellingPrice,
        verification.verificationId
      );

    if (!debit.success) {
      return res.status(400).json({
        success: false,
        error: "Insufficient wallet balance.",
        balance: debit.balance,
        required: sellingPrice
      });
    }

    walletDebited = true;

    const rawProviderPrice =
      providerResponse?.price ??
      providerResponse?.verification?.price ??
      providerResponse?.data?.price;

    const providerPrice =
      Number.isFinite(Number(rawProviderPrice))
        ? Number(rawProviderPrice)
        : 0;

    let order;

    try {
      order = await createOrder({
        userId,

        providerOrderId:
          providerResponse?.order_id ||
          providerResponse?.provider_order_id ||
          verification.verificationId,

        serviceCountryPriceId:
          serviceCountryPriceId ||
          pricing.id,

        serviceName:
          pricing.serviceName ||
          providerService.name ||
          serviceName,

        countryName:
          pricing.countryName ||
          countryName ||
          "",

        providerPrice,

        sellingPrice,

        phoneNumber:
          verification.phoneNumber,

        status:
          verification.status ||
          "active",

        providerServer:
          serverToUse
      });
    } catch (orderError) {
      await refundWallet(
        userId,
        sellingPrice,
        verification.verificationId
      );

      walletDebited = false;

      throw orderError;
    }

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
        verification.status || "active",

      expiredAt:
        verification.expiredAt || null,

      countryId,

      countryName:
        countryName ||
        pricing.countryName ||
        "",

      serviceId:
        providerService.id,

      serviceName:
        providerService.name ||
        serviceName,

      server:
        serverToUse,

      seller:
        serverToUse,

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
          createdProviderVerificationId
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

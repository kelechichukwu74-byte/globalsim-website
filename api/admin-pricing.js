const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_AUTH_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

function getBearerToken(req) {
  const authorization =
    req.headers?.authorization ||
    req.headers?.Authorization ||
    "";

  if (!authorization) return "";

  const match =
    String(authorization).match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
}

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function supabaseRest(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",

      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type": "application/json",
        Accept: "application/json",

        Prefer:
          options.prefer ||
          "return=representation"
      },

      ...(options.body !== undefined
        ? {
            body: options.body
          }
        : {})
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.hint ||
      `Supabase returned HTTP ${response.status}.`
    );
  }

  return data;
}


/* =========================================================
   VERIFY SIGNED-IN USER
   ========================================================= */

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    throw new Error(
      "No authentication token was provided."
    );
  }

  if (!SUPABASE_AUTH_KEY) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",

      headers: {
        apikey: SUPABASE_AUTH_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const text = await response.text();

  let user = null;

  try {
    user = text ? JSON.parse(text) : null;
  } catch {
    user = null;
  }

  if (!response.ok || !user?.id) {
    console.error(
      "Supabase authentication failed:",
      response.status,
      user
    );

    throw new Error(
      "Your admin session has expired. Please sign out and sign in again."
    );
  }

  return user;
}


/* =========================================================
   VERIFY ADMIN ROLE
   ========================================================= */

async function requireAdmin(req) {
  const user =
    await getAuthenticatedUser(req);

  const profiles =
    await supabaseRest(
      `profiles?id=eq.${encode(user.id)}&select=id,role&limit=1`
    );

  if (!profiles?.length) {
    throw new Error(
      "Admin profile was not found."
    );
  }

  if (profiles[0].role !== "admin") {
    throw new Error(
      "Administrator access required."
    );
  }

  return user;
}


/* =========================================================
   ALLOWED SERVERS
   ========================================================= */

const ALLOWED_SERVERS = new Set([
  "usa-server-1",
  "usa-server-2",
  "global-server-1",
  "global-server-2"
]);


/* =========================================================
   MAIN HANDLER
   ========================================================= */

export default async function handler(req, res) {
  try {

    /*
     * Only an authenticated administrator
     * can use this API.
     */
    await requireAdmin(req);


    /* =====================================================
       GET
       Load all saved selling prices.
       ===================================================== */

    if (req.method === "GET") {

      const prices =
        await supabaseRest(
          "product_prices" +
          "?select=" +
          "id," +
          "country_id," +
          "country_name," +
          "service_id," +
          "service_name," +
          "selling_price," +
          "is_active," +
          "provider_server," +
          "provider_service_id" +
          "&order=country_name.asc,provider_server.asc,service_name.asc"
        );

      return res.status(200).json({
        success: true,
        prices: prices || []
      });
    }


    /* =====================================================
       POST
       Save or replace a selling price.
       ===================================================== */

    if (req.method === "POST") {

      const body = req.body || {};

      const countryId =
        String(
          body.countryId || ""
        ).trim();

      const countryName =
        String(
          body.countryName || ""
        ).trim();

      const providerServer =
        String(
          body.providerServer ||
          body.server ||
          ""
        ).trim();

      const serviceId =
        String(
          body.serviceId ||
          body.providerServiceId ||
          ""
        ).trim();

      const serviceName =
        String(
          body.serviceName || ""
        ).trim();

      const sellingPrice =
        Number(
          body.sellingPrice
        );


      /* -----------------------------
         Validate country
         ----------------------------- */

      if (!countryId) {
        return res.status(400).json({
          success: false,
          error:
            "Please select a country."
        });
      }


      /* -----------------------------
         Validate server
         ----------------------------- */

      if (!providerServer) {
        return res.status(400).json({
          success: false,
          error:
            "Please select a provider server."
        });
      }


      if (
        !ALLOWED_SERVERS.has(
          providerServer
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid provider server."
        });
      }


      /* -----------------------------
         Validate service
         ----------------------------- */

      if (!serviceId || !serviceName) {
        return res.status(400).json({
          success: false,
          error:
            "Please select a service."
        });
      }


      /* -----------------------------
         Validate price
         ----------------------------- */

      if (
        !Number.isFinite(
          sellingPrice
        ) ||
        sellingPrice <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Please enter a valid selling price."
        });
      }


      /*
       * Look for an existing price
       * for this exact:
       *
       * Country
       * +
       * Provider Server
       * +
       * Service
       *
       * If found, update it.
       */

      let existing =
        await supabaseRest(
          "product_prices" +
          `?country_id=eq.${encode(countryId)}` +
          `&provider_server=eq.${encode(providerServer)}` +
          `&service_id=eq.${encode(serviceId)}` +
          "&select=id" +
          "&limit=1"
        );


      /*
       * Also support older records
       * that stored the service ID
       * in provider_service_id.
       */

      if (!existing?.length) {

        existing =
          await supabaseRest(
            "product_prices" +
            `?country_id=eq.${encode(countryId)}` +
            `&provider_server=eq.${encode(providerServer)}` +
            `&provider_service_id=eq.${encode(serviceId)}` +
            "&select=id" +
            "&limit=1"
          );
      }


      const priceRow = {

        country_id:
          countryId,

        country_name:
          countryName ||
          countryId,

        service_id:
          serviceId,

        service_name:
          serviceName,

        selling_price:
          sellingPrice,

        is_active:
          true,

        provider_server:
          providerServer,

        provider_service_id:
          serviceId,

        /*
         * Provider price is NOT used.
         * Your selling price is manual.
         */
        provider_cost:
          0
      };


      let saved;


      /* -----------------------------
         UPDATE EXISTING PRICE
         ----------------------------- */

      if (existing?.[0]?.id) {

        saved =
          await supabaseRest(
            `product_prices?id=eq.${encode(
              existing[0].id
            )}`,
            {
              method: "PATCH",

              body:
                JSON.stringify(
                  priceRow
                )
            }
          );

        return res.status(200).json({
          success: true,
          action: "updated",
          message:
            "Selling price updated successfully.",
          price:
            saved?.[0] || null
        });
      }


      /* -----------------------------
         CREATE NEW PRICE
         ----------------------------- */

      saved =
        await supabaseRest(
          "product_prices",
          {
            method: "POST",

            body:
              JSON.stringify(
                priceRow
              )
          }
        );


      return res.status(200).json({
        success: true,
        action: "created",
        message:
          "Selling price saved successfully.",
        price:
          saved?.[0] || null
      });
    }


    /* =====================================================
       DELETE
       Delete a saved selling price.
       ===================================================== */

    if (req.method === "DELETE") {

      const id =
        String(
          req.query?.id || ""
        ).trim();

      if (!id) {
        return res.status(400).json({
          success: false,
          error:
            "Price ID is required."
        });
      }


      /*
       * Confirm that the price exists.
       */

      const existing =
        await supabaseRest(
          `product_prices?id=eq.${encode(id)}` +
          "&select=id" +
          "&limit=1"
        );


      if (!existing?.[0]?.id) {
        return res.status(404).json({
          success: false,
          error:
            "Selling price not found."
        });
      }


      /*
       * Delete it.
       */

      await supabaseRest(
        `product_prices?id=eq.${encode(id)}`,
        {
          method: "DELETE",
          prefer:
            "return=minimal"
        }
      );


      return res.status(200).json({
        success: true,
        message:
          "Selling price deleted successfully."
      });
    }


    /* =====================================================
       METHOD NOT ALLOWED
       ===================================================== */

    return res.status(405).json({
      success: false,
      error:
        "Method not allowed."
    });

  } catch (error) {

    console.error(
      "Admin pricing API error:",
      error
    );

    const message =
      error?.message ||
      "Unable to process pricing request.";

    let status = 500;

    if (
      message.includes(
        "authentication"
      ) ||
      message.includes(
        "session"
      ) ||
      message.includes(
        "No authentication"
      )
    ) {
      status = 401;
    }

    if (
      message.includes(
        "Administrator access required"
      )
    ) {
      status = 403;
    }

    return res.status(status).json({
      success: false,
      error: message
    });
  }
}

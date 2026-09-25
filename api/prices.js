const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function q(value) {
  return encodeURIComponent(String(value ?? ""));
}

async function supabaseRequest(path) {

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: "application/json"
      }
    }
  );

  const data =
    await response.json().catch(() => []);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `Supabase returned HTTP ${response.status}.`
    );
  }

  return data;
}

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  try {

    const countryId =
      String(req.query?.countryId || "").trim();

    const serviceName =
      String(req.query?.serviceName || "").trim();

    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "countryId is required."
      });
    }

    let path =
      `product_prices?country_id=eq.${q(countryId)}` +
      `&is_active=eq.true` +
      `&select=id,country_id,country_name,service_id,service_name,selling_price,provider_server,provider_service_id` +
      `&order=service_name.asc,provider_server.asc`;

    if (serviceName) {
      path +=
        `&service_name=ilike.${q(serviceName)}`;
    }

    const rows =
      await supabaseRequest(path);

    return res.status(200).json({
      success: true,
      prices: rows || []
    });

  } catch (error) {

    console.error(
      "Public pricing error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Unable to load selling prices."
    });
  }
}

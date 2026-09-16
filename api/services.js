import {
  sureVerificationRequest,
  getServerForCountry
} from "./_lib.js";


const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";


const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


async function supabaseRequest(path) {

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


  let data = [];


  try {

    data =
      text
        ? JSON.parse(text)
        : [];

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


export default async function handler(
  req,
  res
) {

  if (req.method !== "GET") {

    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });

  }


  try {

    const countryId =
      req.query?.countryId;


    const requestedServer =
      req.query?.server;


    if (!countryId) {

      return res.status(400).json({
        success: false,
        error:
          "countryId is required"
      });

    }


    const server =
      requestedServer ||
      getServerForCountry(
        countryId
      );


    /*
      -------------------------------------------------------
      1. Get available services from SureVerification
      -------------------------------------------------------
    */

    const data =
      await sureVerificationRequest(
        `/${server}/services?country_id=${encodeURIComponent(
          countryId
        )}`
      );


    const rawServices =
      Array.isArray(data?.services)
        ? data.services
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];


    /*
      -------------------------------------------------------
      2. Get administrator selling prices
      -------------------------------------------------------
    */

    let sellingPrices = [];


    try {

      sellingPrices =
        await supabaseRequest(
          `product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&select=country_id,country_name,service_id,service_name,selling_price`
        );

    } catch (pricingError) {

      console.error(
        "Admin pricing lookup error:",
        pricingError
      );

      /*
        Do not expose provider prices as customer
        selling prices when admin pricing cannot be loaded.
      */

      sellingPrices = [];

    }


    /*
      -------------------------------------------------------
      3. Create a quick service-price lookup
      -------------------------------------------------------
    */

    const priceMap =
      new Map();


    for (
      const row of sellingPrices
    ) {

      if (!row?.service_id) {
        continue;
      }


      priceMap.set(
        String(row.service_id),
        {
          sellingPrice:
            Number(
              row.selling_price
            ),

          serviceName:
            row.service_name ||
            ""
        }
      );

    }


    /*
      -------------------------------------------------------
      4. Return services with admin prices
      -------------------------------------------------------
    */

    const services =
      rawServices.map(
        service => {

          const serviceId =
            service.id ??
            service.serviceId ??
            service.service_id ??
            service.serviceCountryPriceId ??
            service.service_country_price_id;


          const serviceName =
            service.name ??
            service.serviceName ??
            service.service_name ??
            service.title ??
            String(
              serviceId || ""
            );


          const configured =
            priceMap.get(
              String(serviceId)
            );


          const sellingPrice =
            configured &&
            Number.isFinite(
              configured.sellingPrice
            ) &&
            configured.sellingPrice > 0
              ? configured.sellingPrice
              : null;


          return {

            ...service,

            id:
              serviceId,

            name:
              serviceName,

            serviceName:
              serviceName,

            selling_price:
              sellingPrice,

            sellingPrice:
              sellingPrice,

            /*
              Keep provider availability data,
              but NEVER use provider price as
              the customer selling price.
            */

            provider_price:
              undefined

          };

        }
      );


    return res.status(200).json({

      success:
        true,

      server,

      countryId,

      services

    });


  } catch (error) {

    console.error(
      "SureVerification services error:",
      error
    );


    return res.status(500).json({

      success:
        false,

      error:
        error?.message ||
        "Unable to load services."

    });

  }

}

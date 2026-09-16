import {
  sureVerificationRequest,
  getServerForCountry
} from "./_lib.js";


const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://rfitbmkizfmwfqqskwhy.supabase.co";


const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
  -------------------------------------------------------
  Supabase server request
  -------------------------------------------------------
*/

async function supabaseRequest(
  path,
  options = {}
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


/*
  -------------------------------------------------------
  MAIN PRICE HANDLER
  -------------------------------------------------------
*/

export default async function handler(
  req,
  res
) {

  if (
    req.method !== "GET"
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
      ---------------------------------------------------
      1. Read country and service
      ---------------------------------------------------
    */

    const countryId =
      req.query?.countryId;


    const service =
      req.query?.service;


    const requestedServer =
      req.query?.server;


    if (!countryId) {

      return res.status(400).json({
        success:
          false,

        error:
          "countryId is required"
      });

    }


    if (!service) {

      return res.status(400).json({
        success:
          false,

        error:
          "service is required"
      });

    }


    /*
      ---------------------------------------------------
      2. Determine SureVerification server
      ---------------------------------------------------
    */

    const server =
      requestedServer ||
      getServerForCountry(
        countryId
      );


    /*
      ---------------------------------------------------
      3. Get provider price.
      
      This is the SureVerification cost.
      It is NOT the customer's selling price.
      ---------------------------------------------------
    */

    const providerData =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          service
        )}`
      );


    const providerPrice =
      Number(
        providerData?.price ??
        providerData?.data?.price ??
        providerData?.amount ??
        providerData?.data?.amount
      );


    if (
      !Number.isFinite(
        providerPrice
      ) ||
      providerPrice <= 0
    ) {

      return res.status(400).json({
        success:
          false,

        error:
          "Unable to determine the provider price.",

        server,

        countryId,

        service
      });

    }


    /*
      ---------------------------------------------------
      4. Look for ADMIN SELLING PRICE
      ---------------------------------------------------
    */

    let sellingPrice =
      null;


    let pricing =
      null;


    try {

      const pricingRows =
        await supabaseRequest(
          `product_prices?country_id=eq.${encodeURIComponent(
            countryId
          )}&service_id=eq.${encodeURIComponent(
            service
          )}&select=id,country_id,country_name,service_id,service_name,selling_price&limit=1`
        );


      pricing =
        pricingRows?.[0] ||
        null;


      if (pricing) {

        const configuredPrice =
          Number(
            pricing.selling_price
          );


        if (
          Number.isFinite(
            configuredPrice
          ) &&
          configuredPrice > 0
        ) {

          sellingPrice =
            configuredPrice;

        }

      }

    } catch (
      pricingError
    ) {

      console.error(
        "Admin selling price lookup error:",
        pricingError
      );

    }


    /*
      ---------------------------------------------------
      5. Do NOT expose provider price as customer price.
      ---------------------------------------------------
    */

    if (
      sellingPrice === null
    ) {

      return res.status(200).json({

        success:
          true,

        configured:
          false,

        server,

        countryId,

        service,

        selling_price:
          null,

        sellingPrice:
          null,

        /*
          Provider price is returned separately
          for internal/admin information.
        */

        provider_price:
          providerPrice,

        message:
          "Selling price has not been configured for this country and service."

      });

    }


    /*
      ---------------------------------------------------
      6. Return configured admin selling price.
      ---------------------------------------------------
    */

    return res.status(200).json({

      success:
        true,

      configured:
        true,

      server,

      countryId,

      service,

      /*
        This is the price the CUSTOMER pays.
      */

      selling_price:
        sellingPrice,

      sellingPrice:
        sellingPrice,

      /*
        Provider cost kept separate.
      */

      provider_price:
        providerPrice,

      providerPrice:
        providerPrice,

      pricing:
        pricing

    });


  } catch (error) {

    console.error(
      "SureVerification price error:",
      error
    );


    return res.status(500).json({

      success:
        false,

      error:
        error?.message ||
        "Unable to load price."

    });

  }

}

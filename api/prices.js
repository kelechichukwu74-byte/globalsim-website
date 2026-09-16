import {
  sureVerificationRequest,
  getServerForCountry
} from "./_lib.js";


export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }


  try {

    const countryId =
      req.query?.countryId;

    const service =
      req.query?.service;

    const requestedServer =
      req.query?.server;


    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "countryId is required"
      });
    }


    if (!service) {
      return res.status(400).json({
        success: false,
        error: "service is required"
      });
    }


    /*
      Use the server supplied by the frontend.

      This is important because countryId may be a numeric
      provider ID, so we cannot reliably determine USA
      merely from countryId.
    */
    const server =
      requestedServer ||
      getServerForCountry(countryId);


    const data =
      await sureVerificationRequest(
        `/${server}/price?country_id=${encodeURIComponent(
          countryId
        )}&service=${encodeURIComponent(
          service
        )}`
      );


    const price =
      Number(
        data?.price ??
        data?.data?.price ??
        data?.amount ??
        data?.data?.amount
      );


    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {

      return res.status(400).json({

        success: false,

        error:
          "Unable to determine the number price.",

        server,

        data

      });

    }


    return res.status(200).json({

      success: true,

      server,

      countryId,

      service,

      price,

      data

    });


  } catch (error) {

    console.error(
      "SureVerification price error:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error?.message ||
        "Unable to load price."

    });

  }

}

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

    const requestedServer =
      req.query?.server;


    if (!countryId) {
      return res.status(400).json({
        success: false,
        error: "countryId is required"
      });
    }


    /*
      The frontend already knows which SureVerification
      server belongs to the selected country.

      Use that server when supplied.
    */
    const server =
      requestedServer ||
      getServerForCountry(countryId);


    /*
      Load services from SureVerification.
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
      Load the provider price for every service.

      This is important because the frontend displays
      the price from the service object.
    */
    const services =
      await Promise.all(
        rawServices.map(
          async service => {

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
              String(serviceId || "");


            let providerPrice = null;


            /*
              If SureVerification already returned a price,
              use it first.
            */
            const existingPrice =
              service.price ??
              service.amount ??
              service.provider_price ??
              service.providerPrice;


            if (
              existingPrice !== undefined &&
              existingPrice !== null &&
              existingPrice !== ""
            ) {

              const numericPrice =
                Number(existingPrice);

              if (
                Number.isFinite(numericPrice) &&
                numericPrice > 0
              ) {
                providerPrice =
                  numericPrice;
              }

            }


            /*
              If the service response did not contain a price,
              request the price endpoint.
            */
            if (
              providerPrice === null &&
              serviceId
            ) {

              try {

                const priceData =
                  await sureVerificationRequest(
                    `/${server}/price?country_id=${encodeURIComponent(
                      countryId
                    )}&service=${encodeURIComponent(
                      serviceId
                    )}`
                  );


                const returnedPrice =
                  Number(
                    priceData?.price ??
                    priceData?.data?.price ??
                    priceData?.amount ??
                    priceData?.data?.amount
                  );


                if (
                  Number.isFinite(returnedPrice) &&
                  returnedPrice > 0
                ) {

                  providerPrice =
                    returnedPrice;

                }

              } catch (priceError) {

                console.error(
                  `Unable to load price for ${serviceName}:`,
                  priceError
                );

              }

            }


            return {

              ...service,

              id:
                serviceId,

              name:
                serviceName,

              provider_price:
                providerPrice,

              price:
                providerPrice

            };

          }
        )
      );


    return res.status(200).json({

      success: true,

      server,

      services

    });


  } catch (error) {

    console.error(
      "SureVerification services error:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error?.message ||
        "Unable to load services."

    });

  }

}

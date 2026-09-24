  } catch (error) {

    console.error(
      "ORDER ENDPOINT ERROR:",
      error
    );

    console.error(
      "ORDER ERROR MESSAGE:",
      error?.message
    );

    const message =
      error?.message ||
      "Unable to purchase number.";

    if (
      String(message)
        .toLowerCase()
        .includes("unauthorized")
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized.",
        message: "Unauthorized.",
        debug: message
      });
    }

    if (
      String(message)
        .toLowerCase()
        .includes("insufficient")
    ) {
      return res.status(400).json({
        success: false,
        error: "Insufficient wallet balance.",
        message: "Insufficient wallet balance."
      });
    }

    return res.status(500).json({
      success: false,

      error: message,

      message: message,

      debug: message
    });
  }

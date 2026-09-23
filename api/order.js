if (
  !Number.isFinite(
    customerPrice
  ) ||
  customerPrice <= 0
) {
  return res.status(400).json({
    success:
      false,

    error:
      "A valid selling price is required."
  });
}

walletAmount =
  Number(
    customerPrice
  );

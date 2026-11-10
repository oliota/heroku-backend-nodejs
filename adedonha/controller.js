export const controller = (action, getService) => async (req, res, next) => {
  try {
    const data = await getService().execute(
      action,
      req.user,
      req.method === "GET" ? req.query : (req.body ?? {}),
      {
        code: req.params.code,
        id: req.params.id ?? req.params.category,
        key: req.get("Idempotency-Key"),
      },
    );
    res.status(action === "rooms:create" ? 201 : 200).json({ data });
  } catch (error) {
    next(error);
  }
};

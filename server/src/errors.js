// Small helpers for HTTP-aware errors. `expose` marks messages that are safe
// to return to the client.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

module.exports = {
  httpError,
  badRequest: (message) => httpError(400, message),
  notFound: (message) => httpError(404, message),
  badGateway: (message) => httpError(502, message),
};

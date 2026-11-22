// A small error type: "status" is the HTTP status code the browser will receive.
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { AppError };

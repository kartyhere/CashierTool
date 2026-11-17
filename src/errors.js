'use strict';
// Errors whose message is written for the person at the counter and is safe to show as it is.
// Anything else that is thrown is treated as a bug: it is logged, and the page only sees a generic message.
class UserError extends Error {
  constructor(message, code = 'INVALID', extra = {}) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    Object.assign(this, extra);
  }
}

module.exports = { UserError };

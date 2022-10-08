class ClientError extends Error {
  constructor(response) {
    super('Client Error');
    this.response = response;
    this.code = 'ECLIENT';
  }
};

function createClientError(statusCode, message) {
  return new ClientError({
    statusCode,
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify(message),
  })
}

module.exports = {
  ClientError: ClientError,
  createClientError: createClientError
};

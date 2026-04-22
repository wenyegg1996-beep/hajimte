export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toErrorPayload(error) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  return {
    status: 500,
    body: {
      error: error.message || 'Unexpected error',
      code: 'INTERNAL_ERROR',
    },
  };
}

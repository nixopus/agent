export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 'AUTH_REQUIRED', 401);
  }
}

export class CreditsExhaustedError extends AppError {
  constructor(message = 'Insufficient credits', details?: Record<string, unknown>) {
    super(message, 'CREDITS_EXHAUSTED', 402, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, { resource, ...(id && { id }) });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
  }
}

export class RateLimitError extends AppError {
  readonly retryAfter?: number;

  constructor(message = 'Too many requests', retryAfter?: number) {
    super(message, 'RATE_LIMITED', 429, retryAfter !== undefined ? { retryAfter } : undefined);
    this.retryAfter = retryAfter;
  }
}

export class ConcurrencyLimitError extends AppError {
  constructor(message = 'Too many concurrent operations') {
    super(message, 'CONCURRENCY_LIMITED', 429);
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 500);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, statusCode = 502) {
    super(message, 'EXTERNAL_SERVICE_ERROR', statusCode, { service });
  }
}

export function toErrorResponse(error: unknown): {
  body: { error: string; message: string; details?: Record<string, unknown> };
  status: number;
} {
  if (isAppError(error)) {
    return {
      status: error.statusCode,
      body: {
        error: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: { error: 'INTERNAL_ERROR', message: error.message },
    };
  }

  return {
    status: 500,
    body: { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  };
}

const JSON_CT = { 'Content-Type': 'application/json' } as const;

export function errorResponse(error: unknown): Response {
  const { body, status } = toErrorResponse(error);
  return new Response(JSON.stringify(body), { status, headers: JSON_CT });
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

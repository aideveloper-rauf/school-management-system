import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiErrorBody } from '@sms/shared';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    let status = 500;
    let body: ApiErrorBody;

    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, details: err.details, requestId: req.id } };
    } else if (err instanceof ZodError) {
      status = 422;
      body = {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'errors.validation',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId: req.id,
        },
      };
    } else if ((err as FastifyError).statusCode === 429) {
      status = 429;
      body = { error: { code: 'RATE_LIMITED', message: 'errors.rateLimited', requestId: req.id } };
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      status = (err as FastifyError).statusCode!;
      body = { error: { code: 'BAD_REQUEST', message: 'errors.badRequest', requestId: req.id } };
    } else {
      // Log the error object (stack) but never request bodies — they may contain personal data.
      req.log.error({ err }, 'unhandled error');
      body = { error: { code: 'INTERNAL', message: 'errors.internal', requestId: req.id } };
    }
    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'errors.notFound', requestId: req.id } } satisfies ApiErrorBody);
  });
}

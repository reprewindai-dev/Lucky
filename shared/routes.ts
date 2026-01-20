import { z } from 'zod';
import { insertTrackSchema, tracks } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  tracks: {
    create: {
      method: 'POST' as const,
      path: '/api/tracks',
      input: insertTrackSchema,
      responses: {
        201: z.custom<typeof tracks.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/tracks',
      responses: {
        200: z.array(z.custom<typeof tracks.$inferSelect>()),
      },
    },
    updateVideoStatus: {
      method: 'PATCH' as const,
      path: '/api/tracks/:id/video',
      input: z.object({
        status: z.enum(['processing', 'complete', 'failed']),
        url: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof tracks.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type InsertTrack = z.infer<typeof api.tracks.create.input>;
export type Track = z.infer<typeof api.tracks.create.responses[201]>;

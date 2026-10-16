import { z } from "../openapi";

export const projectIdParam = z.object({ projectId: z.string() });

export const pageParam = z.object({ id: z.string() });

export const createPageBody = z.object({
  projectId: z.string(),
  parentId: z.string().nullable().optional(),
  title: z.string().max(500).optional(),
});

export const updatePageBody = z.object({
  title: z.string().max(500).optional(),
  parentId: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

export const pageImageUploadBody = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
});

export const finalizePageImageUploadBody = z.object({
  key: z
    .string()
    .openapi({ description: "The key returned when the URL was issued." }),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
});

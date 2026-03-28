import { z } from 'zod';

export const loginSchema = z.object({
    username: z.string().min(3).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    password: z.string().min(6).max(100),
});

export const settingsSchema = z.object({
    username: z.string().min(3).max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    password: z.string().min(6).max(100).optional(),
});

export const folderSchema = z.object({
    name: z.string().min(1).max(255).refine(val => !/[<>\"'`]/.test(val), {
        message: "Folder name contains illegal characters",
    }),
    parent_id: z.number().int().positive().nullable().optional(),
});

export const bookmarkSchema = z.object({
    title: z.string().min(1).max(500),
    url: z.string().url().max(2048),
    folder_id: z.number().int().positive().nullable().optional(),
});

export const idSchema = z.coerce.number().int().positive();

export const reorderSchema = z.object({
    orderedIds: z.array(z.number().int().positive()).min(1),
});

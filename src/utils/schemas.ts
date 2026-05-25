import { z } from 'zod';

const httpUrlSchema = z.string().url().max(2048).refine((value) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}, {
    message: 'Only HTTP and HTTPS URLs are supported',
});

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
    url: httpUrlSchema,
    description: z.string().max(1000).nullable().optional(),
    folder_id: z.number().int().positive().nullable().optional(),
});

export const idSchema = z.coerce.number().int().positive();

export const reorderSchema = z.object({
    orderedIds: z.array(z.number().int().positive()).min(1),
});

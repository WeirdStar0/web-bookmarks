import type { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

export type ApiApp = Hono<{ Bindings: Bindings; Variables: Variables }>;

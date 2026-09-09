import { Hono } from 'hono';
import { registerAuthRoutes } from './auth';
import { registerBookmarkRoutes } from './bookmarks';
import { registerDataRoutes } from './data';
import { registerFolderRoutes } from './folders';
import { registerImportExportRoutes } from './importExport';
import { registerTrashRoutes } from './trash';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

registerAuthRoutes(app);
registerDataRoutes(app);
registerImportExportRoutes(app);
registerFolderRoutes(app);
registerBookmarkRoutes(app);
registerTrashRoutes(app);

export default app;

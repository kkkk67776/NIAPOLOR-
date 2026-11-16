import type { Request, Response } from 'express';
import { app, ensureServerInitialized } from '../server';

export default async function handler(req: Request, res: Response) {
  await ensureServerInitialized();
  return app(req, res);
}

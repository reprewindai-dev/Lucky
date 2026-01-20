import type { VercelRequest, VercelResponse } from "@vercel/node";
import serverless from "serverless-http";
import { createApp } from "../server/app";

let cached: any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cached) {
    const { app } = await createApp();
    cached = serverless(app);
  }
  return cached(req, res);
}

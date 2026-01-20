import express, { type Request, type Response, type NextFunction } from "express";
import { createServer, type Server as HttpServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export async function createApp() {
  const app = express();
  const httpServer: HttpServer = createServer(app);

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  // lightweight API logging (kept from the original)
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined;

    const originalResJson = res.json.bind(res);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).json = function (bodyJson: any, ...args: any[]) {
      capturedJsonResponse = bodyJson;
      return originalResJson(bodyJson, ...args);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      const duration = Date.now() - start;
      const line = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        console.log(`${line} :: ${JSON.stringify(capturedJsonResponse)}`);
      } else {
        console.log(line);
      }
    });

    next();
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  // In production we'll serve the built client (dist/public) for non-API routes.
  // On Vercel this works fine and keeps the ZIP self-contained.
  serveStatic(app);

  return { app, httpServer };
}

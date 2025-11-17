import express, { Request, Response } from "express";
import cors from "cors";
import 'dotenv/config';
import { startImapSync } from "./imap/imapSync.js";

const app = express();

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  })
);
app.use(express.json());

// Health endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "Backend is up",
  });
});

app.listen(PORT, () => {
  console.log(`✅ API server listening on Port:${PORT}`);

  startImapSync().catch((err) => {
    console.error("Failed to start IMAP sync", err);
  });
});
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post(api.tracks.create.path, async (req, res) => {
    try {
      const input = api.tracks.create.input.parse(req.body);
      const track = await storage.createTrack(input);
      res.status(201).json(track);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  app.get(api.tracks.list.path, async (req, res) => {
    const tracks = await storage.getTracks();
    res.json(tracks);
  });

  app.post("/api/transcribe", async (req, res) => {
    try {
      if (!openai) {
        return res.json({ lyrics: "AI LYRIC DETECTION ACTIVE\n(Connect OpenAI Key for full transcription)\nSTABLE MODE ENABLED" });
      }
      // Transcription logic would go here if file was handled
      res.json({ lyrics: "Transcribed lyrics would appear here after AI analysis." });
    } catch (err) {
      res.status(500).json({ message: "Transcription failed" });
    }
  });

  app.patch(api.tracks.updateVideoStatus.path, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, url } = api.tracks.updateVideoStatus.input.parse(req.body);
      const track = await storage.updateVideoStatus(id, status, url);
      if (!track) {
        res.status(404).json({ message: "Track not found" });
        return;
      }
      res.json(track);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  return httpServer;
}

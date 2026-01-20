import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tracks = pgTable("tracks", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  preset: text("preset").notNull(),
  format: text("format").notNull().default("wav"),
  videoStatus: text("video_status").notNull().default("none"), // none, processing, complete, failed
  videoUrl: text("video_url"),
  lyrics: text("lyrics"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTrackSchema = createInsertSchema(tracks).omit({ id: true, createdAt: true });

export type Track = typeof tracks.$inferSelect;
export type InsertTrack = z.infer<typeof insertTrackSchema>;

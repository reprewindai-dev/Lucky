import { db } from "./db";
import { tracks, type InsertTrack, type Track } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  createTrack(track: InsertTrack): Promise<Track>;
  getTracks(): Promise<Track[]>;
  updateVideoStatus(id: number, status: string, url?: string): Promise<Track | undefined>;
}

export class DatabaseStorage implements IStorage {
  async createTrack(insertTrack: InsertTrack): Promise<Track> {
    const [track] = await db!.insert(tracks).values(insertTrack).returning();
    return track;
  }

  async getTracks(): Promise<Track[]> {
    return await db!.select().from(tracks).orderBy(desc(tracks.createdAt));
  }

  async updateVideoStatus(id: number, status: string, url?: string): Promise<Track | undefined> {
    const [track] = await db!
      .update(tracks)
      .set({ videoStatus: status, videoUrl: url || null })
      .where(eq(tracks.id, id))
      .returning();
    return track;
  }
}

class MemoryStorage implements IStorage {
  private data: Track[] = [];
  private nextId = 1;

  async createTrack(insertTrack: InsertTrack): Promise<Track> {
    const now = new Date();
    const track: Track = {
      id: this.nextId++,
      title: insertTrack.title,
      artist: insertTrack.artist ?? null,
      createdAt: now,
      videoStatus: insertTrack.videoStatus ?? "pending",
      videoUrl: insertTrack.videoUrl ?? null,
    };
    this.data.unshift(track);
    return track;
  }

  async getTracks(): Promise<Track[]> {
    return this.data;
  }

  async updateVideoStatus(id: number, status: string, url?: string): Promise<Track | undefined> {
    const t = this.data.find((x) => x.id === id);
    if (!t) return undefined;
    t.videoStatus = status;
    t.videoUrl = url ?? null;
    return t;
  }
}

// If DATABASE_URL is missing, fall back to in-memory storage so the UI still works.
export const storage: IStorage = process.env.DATABASE_URL
  ? new DatabaseStorage()
  : new MemoryStorage();

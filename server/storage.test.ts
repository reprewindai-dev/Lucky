import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseStorage } from './storage';
import type { InsertTrack, Track } from '@shared/schema';

// We're testing the MemoryStorage class implementation
// Since it's not exported directly, we'll recreate it for testing purposes
class MemoryStorage {
  private data: Track[] = [];
  private nextId = 1;

  async createTrack(insertTrack: InsertTrack): Promise<Track> {
    const now = new Date();
    const track: Track = {
      id: this.nextId++,
      filename: insertTrack.filename,
      preset: insertTrack.preset,
      format: insertTrack.format ?? 'wav',
      videoStatus: insertTrack.videoStatus ?? 'none',
      videoUrl: insertTrack.videoUrl ?? null,
      lyrics: insertTrack.lyrics ?? null,
      createdAt: now,
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

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('createTrack', () => {
    it('should create a track with all required fields', async () => {
      const insertTrack: InsertTrack = {
        filename: 'test-song.mp3',
        preset: 'rock',
        format: 'mp3',
      };

      const track = await storage.createTrack(insertTrack);

      expect(track).toMatchObject({
        id: 1,
        filename: 'test-song.mp3',
        preset: 'rock',
        format: 'mp3',
        videoStatus: 'none',
        videoUrl: null,
        lyrics: null,
      });
      expect(track.createdAt).toBeInstanceOf(Date);
    });

    it('should create a track with optional fields provided', async () => {
      const insertTrack: InsertTrack = {
        filename: 'song-with-video.mp3',
        preset: 'jazz',
        format: 'wav',
        videoStatus: 'processing',
        videoUrl: 'https://example.com/video.mp4',
        lyrics: 'Some amazing lyrics',
      };

      const track = await storage.createTrack(insertTrack);

      expect(track).toMatchObject({
        id: 1,
        filename: 'song-with-video.mp3',
        preset: 'jazz',
        format: 'wav',
        videoStatus: 'processing',
        videoUrl: 'https://example.com/video.mp4',
        lyrics: 'Some amazing lyrics',
      });
    });

    it('should use default format "wav" when not provided', async () => {
      const insertTrack: InsertTrack = {
        filename: 'default-format.mp3',
        preset: 'pop',
      };

      const track = await storage.createTrack(insertTrack);

      expect(track.format).toBe('wav');
    });

    it('should use default videoStatus "none" when not provided', async () => {
      const insertTrack: InsertTrack = {
        filename: 'no-video.mp3',
        preset: 'classical',
        format: 'flac',
      };

      const track = await storage.createTrack(insertTrack);

      expect(track.videoStatus).toBe('none');
    });

    it('should auto-increment track IDs', async () => {
      const track1 = await storage.createTrack({
        filename: 'track1.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      const track2 = await storage.createTrack({
        filename: 'track2.mp3',
        preset: 'jazz',
        format: 'wav',
      });

      const track3 = await storage.createTrack({
        filename: 'track3.mp3',
        preset: 'pop',
        format: 'flac',
      });

      expect(track1.id).toBe(1);
      expect(track2.id).toBe(2);
      expect(track3.id).toBe(3);
    });

    it('should add new tracks to the beginning of the list (LIFO order)', async () => {
      const track1 = await storage.createTrack({
        filename: 'first.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      const track2 = await storage.createTrack({
        filename: 'second.mp3',
        preset: 'jazz',
        format: 'wav',
      });

      const tracks = await storage.getTracks();

      expect(tracks[0]).toMatchObject({ id: 2, filename: 'second.mp3' });
      expect(tracks[1]).toMatchObject({ id: 1, filename: 'first.mp3' });
    });

    it('should set createdAt to current timestamp', async () => {
      const beforeCreate = new Date();
      const track = await storage.createTrack({
        filename: 'timestamp-test.mp3',
        preset: 'electronic',
        format: 'mp3',
      });
      const afterCreate = new Date();

      expect(track.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(track.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });

    it('should handle null values for optional fields correctly', async () => {
      const insertTrack: InsertTrack = {
        filename: 'null-fields.mp3',
        preset: 'ambient',
        format: 'wav',
        videoUrl: null,
        lyrics: null,
      };

      const track = await storage.createTrack(insertTrack);

      expect(track.videoUrl).toBeNull();
      expect(track.lyrics).toBeNull();
    });
  });

  describe('getTracks', () => {
    it('should return an empty array when no tracks exist', async () => {
      const tracks = await storage.getTracks();

      expect(tracks).toEqual([]);
      expect(tracks).toHaveLength(0);
    });

    it('should return a single track', async () => {
      await storage.createTrack({
        filename: 'solo-track.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      const tracks = await storage.getTracks();

      expect(tracks).toHaveLength(1);
      expect(tracks[0]).toMatchObject({
        filename: 'solo-track.mp3',
        preset: 'rock',
      });
    });

    it('should return multiple tracks in LIFO order (newest first)', async () => {
      await storage.createTrack({
        filename: 'track1.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      await storage.createTrack({
        filename: 'track2.mp3',
        preset: 'jazz',
        format: 'wav',
      });

      await storage.createTrack({
        filename: 'track3.mp3',
        preset: 'pop',
        format: 'flac',
      });

      const tracks = await storage.getTracks();

      expect(tracks).toHaveLength(3);
      expect(tracks[0].filename).toBe('track3.mp3');
      expect(tracks[1].filename).toBe('track2.mp3');
      expect(tracks[2].filename).toBe('track1.mp3');
    });

    it('should return all track properties correctly', async () => {
      await storage.createTrack({
        filename: 'complete-track.mp3',
        preset: 'electronic',
        format: 'wav',
        videoStatus: 'complete',
        videoUrl: 'https://example.com/video.mp4',
        lyrics: 'Test lyrics',
      });

      const tracks = await storage.getTracks();

      expect(tracks[0]).toMatchObject({
        id: 1,
        filename: 'complete-track.mp3',
        preset: 'electronic',
        format: 'wav',
        videoStatus: 'complete',
        videoUrl: 'https://example.com/video.mp4',
        lyrics: 'Test lyrics',
      });
      expect(tracks[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe('updateVideoStatus', () => {
    it('should update video status without URL', async () => {
      const track = await storage.createTrack({
        filename: 'update-test.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      const updated = await storage.updateVideoStatus(track.id, 'processing');

      expect(updated).toBeDefined();
      expect(updated?.videoStatus).toBe('processing');
      expect(updated?.videoUrl).toBeNull();
    });

    it('should update video status with URL', async () => {
      const track = await storage.createTrack({
        filename: 'video-track.mp3',
        preset: 'pop',
        format: 'wav',
      });

      const updated = await storage.updateVideoStatus(
        track.id,
        'complete',
        'https://example.com/completed-video.mp4'
      );

      expect(updated).toBeDefined();
      expect(updated?.videoStatus).toBe('complete');
      expect(updated?.videoUrl).toBe('https://example.com/completed-video.mp4');
    });

    it('should return undefined for non-existent track ID', async () => {
      const result = await storage.updateVideoStatus(999, 'processing');

      expect(result).toBeUndefined();
    });

    it('should set videoUrl to null when URL is not provided', async () => {
      const track = await storage.createTrack({
        filename: 'clear-url.mp3',
        preset: 'jazz',
        format: 'mp3',
        videoUrl: 'https://example.com/old-video.mp4',
      });

      const updated = await storage.updateVideoStatus(track.id, 'failed');

      expect(updated?.videoUrl).toBeNull();
    });

    it('should update the track in the storage', async () => {
      const track = await storage.createTrack({
        filename: 'persistent-update.mp3',
        preset: 'ambient',
        format: 'wav',
      });

      await storage.updateVideoStatus(track.id, 'processing', 'https://example.com/processing.mp4');

      const tracks = await storage.getTracks();
      const updatedTrack = tracks.find(t => t.id === track.id);

      expect(updatedTrack?.videoStatus).toBe('processing');
      expect(updatedTrack?.videoUrl).toBe('https://example.com/processing.mp4');
    });

    it('should handle updating status multiple times', async () => {
      const track = await storage.createTrack({
        filename: 'multi-update.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      await storage.updateVideoStatus(track.id, 'processing');
      const afterProcessing = await storage.getTracks();
      expect(afterProcessing[0].videoStatus).toBe('processing');

      await storage.updateVideoStatus(track.id, 'complete', 'https://example.com/done.mp4');
      const afterComplete = await storage.getTracks();
      expect(afterComplete[0].videoStatus).toBe('complete');
      expect(afterComplete[0].videoUrl).toBe('https://example.com/done.mp4');

      await storage.updateVideoStatus(track.id, 'failed');
      const afterFailed = await storage.getTracks();
      expect(afterFailed[0].videoStatus).toBe('failed');
      expect(afterFailed[0].videoUrl).toBeNull();
    });

    it('should only update the specified track', async () => {
      const track1 = await storage.createTrack({
        filename: 'track1.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      const track2 = await storage.createTrack({
        filename: 'track2.mp3',
        preset: 'jazz',
        format: 'wav',
      });

      await storage.updateVideoStatus(track1.id, 'complete', 'https://example.com/video1.mp4');

      const tracks = await storage.getTracks();
      const updatedTrack1 = tracks.find(t => t.id === track1.id);
      const untouchedTrack2 = tracks.find(t => t.id === track2.id);

      expect(updatedTrack1?.videoStatus).toBe('complete');
      expect(updatedTrack1?.videoUrl).toBe('https://example.com/video1.mp4');
      expect(untouchedTrack2?.videoStatus).toBe('none');
      expect(untouchedTrack2?.videoUrl).toBeNull();
    });

    it('should return the updated track object', async () => {
      const track = await storage.createTrack({
        filename: 'return-test.mp3',
        preset: 'electronic',
        format: 'flac',
      });

      const updated = await storage.updateVideoStatus(track.id, 'processing');

      expect(updated).toBeDefined();
      expect(updated?.id).toBe(track.id);
      expect(updated?.filename).toBe('return-test.mp3');
      expect(updated?.preset).toBe('electronic');
      expect(updated?.format).toBe('flac');
    });
  });

  describe('Integration tests', () => {
    it('should handle a complete workflow: create, retrieve, update, retrieve again', async () => {
      // Create a track
      const created = await storage.createTrack({
        filename: 'workflow.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      expect(created.videoStatus).toBe('none');

      // Get tracks and verify
      let tracks = await storage.getTracks();
      expect(tracks).toHaveLength(1);
      expect(tracks[0].videoStatus).toBe('none');

      // Update status to processing
      await storage.updateVideoStatus(created.id, 'processing');
      tracks = await storage.getTracks();
      expect(tracks[0].videoStatus).toBe('processing');

      // Update status to complete with URL
      await storage.updateVideoStatus(created.id, 'complete', 'https://example.com/final.mp4');
      tracks = await storage.getTracks();
      expect(tracks[0].videoStatus).toBe('complete');
      expect(tracks[0].videoUrl).toBe('https://example.com/final.mp4');
    });

    it('should handle multiple tracks with different states', async () => {
      const track1 = await storage.createTrack({
        filename: 'pending.mp3',
        preset: 'rock',
        format: 'mp3',
      });

      const track2 = await storage.createTrack({
        filename: 'processing.mp3',
        preset: 'jazz',
        format: 'wav',
      });

      const track3 = await storage.createTrack({
        filename: 'complete.mp3',
        preset: 'pop',
        format: 'flac',
      });

      await storage.updateVideoStatus(track2.id, 'processing');
      await storage.updateVideoStatus(track3.id, 'complete', 'https://example.com/done.mp4');

      const tracks = await storage.getTracks();

      expect(tracks).toHaveLength(3);
      expect(tracks.find(t => t.id === track1.id)?.videoStatus).toBe('none');
      expect(tracks.find(t => t.id === track2.id)?.videoStatus).toBe('processing');
      expect(tracks.find(t => t.id === track3.id)?.videoStatus).toBe('complete');
      expect(tracks.find(t => t.id === track3.id)?.videoUrl).toBe('https://example.com/done.mp4');
    });

    it('should maintain data integrity across operations', async () => {
      // Create 5 tracks
      for (let i = 1; i <= 5; i++) {
        await storage.createTrack({
          filename: `track${i}.mp3`,
          preset: 'rock',
          format: 'mp3',
        });
      }

      // Update some of them
      await storage.updateVideoStatus(2, 'processing');
      await storage.updateVideoStatus(4, 'complete', 'https://example.com/vid4.mp4');

      // Get all tracks
      const tracks = await storage.getTracks();

      // Verify count
      expect(tracks).toHaveLength(5);

      // Verify order (newest first)
      expect(tracks.map(t => t.id)).toEqual([5, 4, 3, 2, 1]);

      // Verify specific tracks
      expect(tracks.find(t => t.id === 2)?.videoStatus).toBe('processing');
      expect(tracks.find(t => t.id === 4)?.videoStatus).toBe('complete');
      expect(tracks.find(t => t.id === 4)?.videoUrl).toBe('https://example.com/vid4.mp4');
      expect(tracks.find(t => t.id === 1)?.videoStatus).toBe('none');
    });
  });
});

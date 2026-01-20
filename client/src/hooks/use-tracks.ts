import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type InsertTrack, type Track } from "@shared/routes";

export function useTracks() {
  return useQuery({
    queryKey: [api.tracks.list.path],
    queryFn: async () => {
      const res = await fetch(api.tracks.list.path);
      if (!res.ok) throw new Error("Failed to fetch tracks");
      return api.tracks.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertTrack) => {
      const res = await fetch(api.tracks.create.path, {
        method: api.tracks.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.tracks.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to save track history");
      }
      
      return api.tracks.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tracks.list.path] });
    },
  });
}

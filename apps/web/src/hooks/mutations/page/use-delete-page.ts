import { useMutation, useQueryClient } from "@tanstack/react-query";
import deletePage from "@/fetchers/page/delete-page";

export function useDeletePage(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deletePage(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
    },
  });
}

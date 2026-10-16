import { useMutation, useQueryClient } from "@tanstack/react-query";
import createPage from "@/fetchers/page/create-page";

export function useCreatePage(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { parentId?: string | null; title?: string }) =>
      createPage(projectId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
    },
  });
}

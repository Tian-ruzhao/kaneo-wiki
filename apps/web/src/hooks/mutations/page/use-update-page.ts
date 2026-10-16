import { useMutation, useQueryClient } from "@tanstack/react-query";
import updatePage from "@/fetchers/page/update-page";

export function useUpdatePage(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { title?: string; parentId?: string | null; position?: number };
    }) => updatePage(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
    },
  });
}

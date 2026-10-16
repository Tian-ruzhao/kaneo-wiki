import { useQuery } from "@tanstack/react-query";
import getPages from "@/fetchers/page/get-pages";

export type DocsPageList = Awaited<ReturnType<typeof getPages>>;
export type DocsPage = DocsPageList["pages"][number];

export function useGetPages(projectId: string) {
  return useQuery({
    queryKey: ["pages", projectId],
    queryFn: () => getPages(projectId),
    enabled: !!projectId,
  });
}

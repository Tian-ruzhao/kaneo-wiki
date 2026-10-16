import { useQuery } from "@tanstack/react-query";
import getPages from "@/fetchers/page/get-pages";

export type DocsPageList = Awaited<ReturnType<typeof getPages>>;
// `updatedBy` is landing from the API lane in parallel; optional until then.
export type DocsPage = DocsPageList["pages"][number] & {
  updatedBy?: { id: string; name: string } | null;
};

export function useGetPages(projectId: string) {
  return useQuery({
    queryKey: ["pages", projectId],
    queryFn: () => getPages(projectId),
    enabled: !!projectId,
  });
}

import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import { DocsView } from "@/components/docs/docs-view";
import PageTitle from "@/components/page-title";
import useGetProject from "@/hooks/queries/project/use-get-project";

type DocsSearchParams = {
  pageId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/docs",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): DocsSearchParams => ({
    pageId: typeof search.pageId === "string" ? search.pageId : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { pageId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: project } = useGetProject({ id: projectId, workspaceId });

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="docs"
    >
      <PageTitle
        title={
          project?.name
            ? `${project.name} · ${t("docs:tab.label")}`
            : t("docs:tab.label")
        }
        hideAppName
      />
      <DocsView
        projectId={projectId}
        workspaceId={workspaceId}
        selectedId={pageId ?? null}
        onSelect={(id) =>
          navigate({
            to: ".",
            search: id ? { pageId: id } : {},
            replace: true,
          })
        }
      />
    </ProjectLayout>
  );
}

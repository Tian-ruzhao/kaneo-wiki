import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useUserPreferencesStore } from "@/store/user-preferences";
import {
  PROJECT_ROUTE_PATHS,
  type ProjectRoute,
  type ProjectView,
  routeForView,
} from "./project-views";

export function useGoToProjectView({
  workspaceId,
  projectId,
  currentRoute,
}: {
  workspaceId: string;
  projectId: string;
  currentRoute: ProjectRoute;
}) {
  const navigate = useNavigate();
  const setViewMode = useUserPreferencesStore((state) => state.setViewMode);
  const setTaskLayout = useUserPreferencesStore((state) => state.setTaskLayout);

  return useCallback(
    (view: ProjectView) => {
      if (view === "board" || view === "list") setViewMode(view);
      // Docs is not a task layout; it must not overwrite the remembered
      // board/list/calendar/gantt layout used by the Tasks scope.
      if (view !== "backlog" && view !== "docs") setTaskLayout(view);
      const route = routeForView(view);
      if (route === currentRoute) return;
      navigate({
        to: PROJECT_ROUTE_PATHS[route],
        params: { workspaceId, projectId },
      });
    },
    [
      currentRoute,
      navigate,
      projectId,
      setTaskLayout,
      setViewMode,
      workspaceId,
    ],
  );
}

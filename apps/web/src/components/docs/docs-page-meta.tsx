import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDateTime } from "@/lib/format";

export type DocsPageUpdater = {
  id: string;
  name: string;
};

type DocsPageMetaProps = {
  updatedBy?: DocsPageUpdater | null;
  updatedAt?: string | Date | null;
};

function editorInitial(name: string) {
  const initial = name.trim().charAt(0);
  return initial ? initial.toUpperCase() : "?";
}

/**
 * Muted "who last edited and when" line shown directly under the page title.
 * Renders nothing until the API provides at least one of the two fields.
 */
export function DocsPageMeta({ updatedBy, updatedAt }: DocsPageMetaProps) {
  const { t } = useTranslation();

  if (!updatedBy && !updatedAt) return null;

  const date = updatedAt ? formatDateTime(updatedAt) : "";

  if (!updatedBy) {
    return (
      <p className="mt-1.5 text-muted-foreground text-sm">
        {t("docs:meta.editedNoName", { date })}
      </p>
    );
  }

  if (!updatedAt) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-sm">
        <Avatar className="size-5">
          <AvatarFallback className="text-[10px]">
            {editorInitial(updatedBy.name)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate">{updatedBy.name}</span>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-sm">
      <Avatar className="size-5">
        <AvatarFallback className="text-[10px]">
          {editorInitial(updatedBy.name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">
        {t("docs:meta.edited", { name: updatedBy.name, date })}
      </span>
    </div>
  );
}

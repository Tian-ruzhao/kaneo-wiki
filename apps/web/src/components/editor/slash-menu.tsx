import { ShortcutKeys } from "@/components/shortcuts/shortcut-keys";
import { cn } from "@/lib/cn";
import type { SlashCommand } from "./slash-commands";

export type SlashMenuState = {
  from: number;
  to: number;
  query: string;
  top: number;
  left: number;
  selectedIndex: number;
};

export type SlashMenuGroup = {
  title: string;
  items: SlashCommand[];
};

/**
 * Shared "/" block-insert menu. The comment editor, task description editor,
 * and docs editor all render this same listbox; only the command list and
 * positioning differ per surface.
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter(
    (command) =>
      command.label.toLowerCase().includes(normalized) ||
      command.search.includes(normalized),
  );
}

/**
 * Match the "/" trigger in the text before the cursor in the current
 * textblock. Matches "/" at the start of an empty line or after whitespace,
 * mirroring the comment editor's trigger rule. Returns the typed query plus
 * the full matched text (needed to compute the range to delete on insert).
 */
export function matchSlashTrigger(
  textBefore: string,
): { query: string; matchText: string } | null {
  const match = textBefore.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!match) return null;
  return { query: match[1] ?? "", matchText: match[0] };
}

type SlashMenuProps = {
  groups: SlashMenuGroup[];
  flatCommands: SlashCommand[];
  selectedIndex: number;
  top: number;
  left: number;
  position?: "absolute" | "fixed";
  emptyLabel: string;
  onHover?: (index: number) => void;
  onSelect?: (command: SlashCommand) => void;
};

export function SlashMenu({
  groups,
  flatCommands,
  selectedIndex,
  top,
  left,
  position = "absolute",
  emptyLabel,
  onHover,
  onSelect,
}: SlashMenuProps) {
  if (flatCommands.length === 0) {
    return (
      <div
        className="kaneo-tiptap-slash-menu"
        style={{ top, left, position }}
        role="listbox"
        aria-label={emptyLabel}
      >
        <div className="kaneo-tiptap-slash-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div
      className="kaneo-tiptap-slash-menu"
      style={{ top, left, position }}
      role="listbox"
    >
      {groups.map((group) => {
        if (group.items.length === 0) return null;
        return (
          <div key={group.title} className="kaneo-tiptap-slash-group">
            <div className="kaneo-tiptap-slash-group-title">{group.title}</div>
            {group.items.map((command) => {
              const index = flatCommands.findIndex(
                (candidate) => candidate.id === command.id,
              );
              const selected = selectedIndex === index;
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "kaneo-tiptap-slash-item",
                    selected && "is-selected",
                  )}
                  onMouseEnter={() => onHover?.(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect?.(command);
                  }}
                >
                  <span className="kaneo-tiptap-slash-label">
                    {command.label}
                  </span>
                  {command.shortcutId && (
                    <span className="kaneo-tiptap-slash-shortcut">
                      <ShortcutKeys id={command.shortcutId} tone="muted" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

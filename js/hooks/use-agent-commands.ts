import { useEffect, useRef } from "react";
import { cellElement } from "@/lib/cell-regions";
import type { AgentCommand } from "@/types";

export function useAgentCommands(commands: AgentCommand[]) {
  const handled = useRef(new Set<string>());

  useEffect(() => {
    for (const command of commands) {
      if (handled.current.has(command.id)) continue;
      handled.current.add(command.id);
      if (command.kind !== "focus-cell") continue;
      cellElement(command.cellId)?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    }
  }, [commands]);
}

import * as stylex from "@stylexjs/stylex";
import { MessageSquare } from "lucide-react";

import { useLens } from "@/context/lens-context";
import { ui } from "@/styles/primitives";
import { formatExactTime, formatWhen } from "@/ui/relative-time";
import { useNow } from "@/ui/use-now";

import { openChatStyles } from "./open-chats.styles";

/** The chat requests an agent opened and has not resolved, quoting the analyst. */
export function OpenChats() {
  const { state } = useLens();
  const now = useNow();
  if (state.chats.length === 0) return null;
  return (
    <ol {...stylex.props(openChatStyles.list)} aria-label="Open chat requests">
      {state.chats.map((chat) => (
        <li
          key={chat.id}
          {...stylex.props(openChatStyles.item)}
          data-marimo-lens-open-chat={chat.id}
        >
          <span {...stylex.props(ui.label, ui.borderless, openChatStyles.chip)} aria-hidden="true">
            <MessageSquare size={12} />
          </span>
          <span {...stylex.props(openChatStyles.details)}>
            <span
              {...stylex.props(openChatStyles.note)}
              title={`${chat.note}\n\nThe agent's copy of the chat message.`}
            >
              {chat.note}
            </span>
            <small {...stylex.props(openChatStyles.metadata)}>
              Asked in chat ·{" "}
              <time dateTime={chat.openedAt} title={`Opened ${formatExactTime(chat.openedAt)}`}>
                opened {formatWhen(chat.openedAt, now)}
              </time>
            </small>
          </span>
        </li>
      ))}
    </ol>
  );
}

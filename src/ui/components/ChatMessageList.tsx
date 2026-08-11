import { toolIcon, type ChatMessage } from "../useDiffChat";
import { Markdown } from "./Markdown";

/**
 * Renders the chat transcript: user/assistant text bubbles, muted `tool`
 * activity lines, and muted `progress` narration. Shared by ChatPanel and
 * CommentThread so the per-message rendering lives in one place. Callers own the
 * surrounding scroll container and trailing scroll anchor.
 *
 * Assistant replies render as Markdown, since that is what the agent writes.
 * User messages stay plain text so the bubble shows exactly what was typed.
 */
export function ChatMessageList({
  messages,
  streaming,
}: {
  messages: ChatMessage[];
  streaming: boolean;
}) {
  return (
    <>
      {messages.map((m, i) => {
        if (m.role === "tool") {
          return (
            <div key={i} className="chat-activity" title={m.target}>
              <span className="chat-activity-icon">{toolIcon(m.name)}</span>
              <span className="chat-activity-name">{m.name}</span>
              {m.target && <span className="chat-activity-target">{m.target}</span>}
            </div>
          );
        }
        if (m.role === "progress") {
          return (
            <div key={i} className="chat-progress">
              <span className="chat-progress-icon">›</span>
              {m.text}
            </div>
          );
        }
        if (m.text === "" && streaming) {
          return (
            <div key={i} className={`chat-msg chat-msg-${m.role}`}>
              <span className="chat-thinking">thinking…</span>
            </div>
          );
        }
        return (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            {m.role === "assistant" ? (
              <Markdown source={m.text} className="chat-markdown" />
            ) : (
              m.text
            )}
          </div>
        );
      })}
    </>
  );
}

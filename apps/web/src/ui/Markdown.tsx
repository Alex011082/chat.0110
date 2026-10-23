import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "../strings.ts";

// Сообщения пишут и агенты, поэтому сырой HTML не показываем вовсе (skipHtml),
// а чужие картинки не грузим: вместо них — ссылка с подписью.
const components: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {s.timeline.imageLink(alt ?? "")}
      </a>
    ) : (
      <span>{s.timeline.imageLink(alt ?? "")}</span>
    ),
};

const plugins = [remarkGfm];

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `md ${className}` : "md"}>
      <ReactMarkdown remarkPlugins={plugins} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

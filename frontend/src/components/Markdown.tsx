import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The single markdown renderer for AI answers.
 *
 * Headings and inline code are sized in `em`, not fixed `px`, so the same map
 * works inside the Console's compact 14px rail and the roomier 15px /ask column
 * without a size prop.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ node, ...props }) => (
          <h1 className="text-[1.2em] font-bold my-2 text-foreground" {...props} />
        ),
        h2: ({ node, ...props }) => (
          <h2 className="text-[1.1em] font-bold my-1.5 text-foreground" {...props} />
        ),
        h3: ({ node, ...props }) => (
          <h3 className="text-[1em] font-bold my-1 text-foreground" {...props} />
        ),
        p: ({ node, ...props }) => <p className="my-1.5 leading-relaxed" {...props} />,
        ul: ({ node, ...props }) => <ul className="list-disc pl-4 my-1.5 space-y-0.5" {...props} />,
        ol: ({ node, ...props }) => (
          <ol className="list-decimal pl-4 my-1.5 space-y-0.5" {...props} />
        ),
        li: ({ node, ...props }) => <li className="my-0.5" {...props} />,
        table: ({ node, ...props }) => (
          <div className="my-2 block max-w-full overflow-x-auto rounded border border-border">
            <table
              className="w-full text-[0.85em] border-collapse divide-y divide-border"
              {...props}
            />
          </div>
        ),
        thead: ({ node, ...props }) => <thead className="bg-muted/60" {...props} />,
        tbody: ({ node, ...props }) => <tbody className="divide-y divide-border" {...props} />,
        tr: ({ node, ...props }) => <tr className="hover:bg-muted/20" {...props} />,
        th: ({ node, ...props }) => (
          <th
            className="px-2 py-1.5 text-left font-semibold border-r border-border last:border-r-0"
            {...props}
          />
        ),
        td: ({ node, ...props }) => (
          <td className="px-2 py-1.5 align-top border-r border-border last:border-r-0" {...props} />
        ),
        code: ({ node, className, children: code, ...props }) => {
          const match = /language-(\w+)/.exec(className || "");
          return !match ? (
            <code className="rounded bg-muted px-1 py-0.5 text-[0.88em] font-mono" {...props}>
              {code}
            </code>
          ) : (
            <pre className="rounded bg-muted p-2 overflow-x-auto text-[0.88em] font-mono my-2">
              <code className={className} {...props}>
                {code}
              </code>
            </pre>
          );
        },
        strong: ({ node, ...props }) => <strong className="font-bold text-foreground" {...props} />,
        a: ({ node, ...props }) => (
          <a
            className="text-primary underline underline-offset-2 hover:no-underline"
            target="_blank"
            rel="noreferrer"
            {...props}
          />
        ),
        blockquote: ({ node, ...props }) => (
          <blockquote
            className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
            {...props}
          />
        ),
      }}
    >
      {children || ""}
    </ReactMarkdown>
  );
}

import { cn } from "@/lib/utils";

/**
 * Frosted-glass card primitive.
 *
 * Copied in as given, with the shadcn slot/data-attribute conventions intact so it
 * behaves like the rest of components/ui. It needs no dependency beyond `cn` — the
 * Button/Label/Input in the reference demo are for the demo, not for this file, and
 * all three already exist here.
 *
 * READ THIS BEFORE USING IT ON A LIGHT BACKGROUND
 * The defaults below assume a dark photographic backdrop: `text-white` over a 30%
 * wash. Dropped onto a light surface the text turns invisible. Satyam's sign-in page
 * is light, so /login overrides the colour classes via `className` — tailwind-merge
 * resolves the conflict in favour of the caller, which is exactly what that override
 * is for. Keep the defaults for a dark hero; override them anywhere else.
 */
function GlassCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-card"
      className={cn(
        "bg-primary-foreground/30 border-primary-foreground/30 flex flex-col gap-6 rounded-2xl border py-6 text-white backdrop-blur-md",
        className,
      )}
      {...props}
    />
  );
}

function GlassCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-5 has-data-[slot=glass-card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  );
}

function GlassCardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  );
}

function GlassCardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="glass-card-description" className={cn("text-sm", className)} {...props} />;
}

function GlassCardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function GlassCardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="glass-card-content" className={cn("px-5", className)} {...props} />;
}

function GlassCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="glass-card-footer"
      className={cn("flex items-center px-5 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardAction,
  GlassCardContent,
  GlassCardFooter,
};

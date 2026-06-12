import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[5px] text-sm font-bold cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border-2 border-foreground active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground nb-shadow hover:nb-shadow-sm",
        destructive: "bg-destructive text-destructive-foreground nb-shadow hover:nb-shadow-sm",
        outline:
          "bg-secondary-background text-foreground nb-shadow hover:nb-shadow-sm",
        secondary: "bg-secondary-background text-foreground nb-shadow hover:nb-shadow-sm",
        ghost: "border-transparent shadow-none hover:bg-accent/20 hover:translate-x-0 hover:translate-y-0",
        link: "border-transparent shadow-none text-foreground underline-offset-4 hover:underline hover:translate-x-0 hover:translate-y-0",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-[5px] px-3 text-xs",
        lg: "h-11 rounded-[5px] px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cn } from "../lib/utils";

interface BadgeProps extends ViewProps {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

const badgeVariants = (variant: BadgeProps["variant"] = "default") => {
  switch (variant) {
    case "default":
      return "border-transparent bg-primary text-primary-foreground hover:bg-primary/80";
    case "secondary":
      return "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80";
    case "destructive":
      return "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80";
    case "outline":
      return "text-foreground";
    default:
      return "border-transparent bg-primary text-primary-foreground";
  }
};

const Badge = React.forwardRef<View, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <View
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          badgeVariants(variant),
          className
        )}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };

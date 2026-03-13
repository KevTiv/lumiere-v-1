import * as React from "react";
import { View, type ViewProps, Text } from "react-native";
import { cn } from "../lib/utils";

interface AlertProps extends ViewProps {
  variant?: "default" | "destructive";
}

const Alert = React.forwardRef<View, AlertProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <View
        ref={ref}
        role="alert"
        className={cn(
          "relative w-full rounded-lg border p-4",
          variant === "default" &&
            "border-border bg-background text-foreground",
          variant === "destructive" &&
            "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
          className
        )}
        {...props}
      />
    );
  }
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<Text, React.ComponentPropsWithoutRef<typeof Text>>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}
    />
  )
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<Text, React.ComponentPropsWithoutRef<typeof Text>>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      className={cn("text-sm [&_p]:leading-relaxed", className)}
      {...props}
    />
  )
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };

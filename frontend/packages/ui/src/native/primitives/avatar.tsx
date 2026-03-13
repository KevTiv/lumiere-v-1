import * as AvatarPrimitive from "@rn-primitives/avatar";
import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cn } from "../lib/utils";

interface AvatarProps extends ViewProps {
  alt: string;
}

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(({ className, style, alt, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    alt={alt}
    style={[style]}
    {...props}
  >
    <View className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}>
      {props.children}
    </View>
  </AvatarPrimitive.Root>
));
Avatar.displayName = "Avatar";

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    {...props}
  />
));
AvatarImage.displayName = "AvatarImage";

interface AvatarFallbackProps extends ViewProps {
  delayMs?: number;
}

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  AvatarFallbackProps
>(({ className, style, children, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    style={[style]}
    {...props}
  >
    <View className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}>
      {children}
    </View>
  </AvatarPrimitive.Fallback>
));
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };

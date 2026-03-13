import * as React from "react";
import { 
  Pressable, 
  type PressableProps, 
  Text, 
  type TextProps,
  ViewStyle,
  TextStyle
} from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "flex items-center justify-center rounded-md",
  {
    variants: {
      variant: {
        default: "bg-primary",
        destructive: "bg-destructive",
        outline: "border border-input bg-background",
        secondary: "bg-secondary",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const buttonTextVariants = cva("font-medium", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      destructive: "text-destructive-foreground",
      outline: "text-foreground",
      secondary: "text-secondary-foreground",
      ghost: "text-foreground",
      link: "text-primary underline",
    },
    size: {
      default: "text-sm",
      sm: "text-sm",
      lg: "text-base",
      icon: "text-sm",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: ViewStyle | ViewStyle[];
  textClassName?: string;
  textStyle?: TextStyle | TextStyle[];
}

const Button = React.forwardRef<
  React.ElementRef<typeof Pressable>,
  ButtonProps
>(({ 
  style,
  variant = "default", 
  size = "default", 
  textClassName, 
  textStyle,
  children, 
  ...props 
}, ref) => {
  return (
    <Pressable
      style={style}
      className={cn(buttonVariants({ variant, size }))}
      ref={ref}
      {...props}
    >
      {typeof children === "string" ? (
        <Text 
          style={textStyle}
          className={cn(buttonTextVariants({ variant, size, className: textClassName }))}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
});
Button.displayName = "Button";

export { Button, buttonVariants, buttonTextVariants };
export type { ButtonVariant, ButtonSize };

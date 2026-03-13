import * as React from "react";
import { View, type ViewProps, Pressable } from "react-native";
import { cn } from "../lib/utils";

interface AccordionProps extends ViewProps {
  type?: "single" | "multiple";
  collapsible?: boolean;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

const Accordion = React.forwardRef<View, AccordionProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <View ref={ref} className={cn("w-full", className)} {...props}>
        {children}
      </View>
    );
  }
);
Accordion.displayName = "Accordion";

interface AccordionItemProps extends ViewProps {
  value: string;
}

const AccordionItem = React.forwardRef<View, AccordionItemProps>(
  ({ className, value, ...props }, ref) => {
    return (
      <View
        ref={ref}
        className={cn("border-b border-border", className)}
        {...props}
      />
    );
  }
);
AccordionItem.displayName = "AccordionItem";

interface AccordionTriggerProps extends ViewProps {
  onPress?: () => void;
}

const AccordionTrigger = React.forwardRef<View, AccordionTriggerProps>(
  ({ className, children, onPress, ...props }, ref) => {
    return (
      <Pressable
        ref={ref}
        onPress={onPress}
        className={cn(
          "flex flex-row items-center justify-between py-4 font-medium transition-all hover:underline",
          className
        )}
        {...props}
      >
        {children}
      </Pressable>
    );
  }
);
AccordionTrigger.displayName = "AccordionTrigger";

const AccordionContent = React.forwardRef<View, ViewProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <View
        ref={ref}
        className={cn(
          "overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
          className
        )}
        {...props}
      >
        <View className="pb-4 pt-0">{children}</View>
      </View>
    );
  }
);
AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };

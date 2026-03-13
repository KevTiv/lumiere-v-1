import * as ProgressPrimitive from "@rn-primitives/progress";
import * as React from "react";
import { View } from "react-native";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    {...props}
  >
    <View className="relative h-4 w-full overflow-hidden rounded-full bg-secondary">
      <ProgressPrimitive.Indicator className="h-full w-full flex-1 bg-primary transition-all" />
    </View>
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };

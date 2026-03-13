import * as SliderPrimitive from "@rn-primitives/slider";
import * as React from "react";
import { View } from "react-native";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    {...props}
  >
    <View className="relative flex w-full touch-none select-none items-center">
      <View className="relative h-4 w-full grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Track className="h-full">
          <View className="h-full bg-primary" />
        </SliderPrimitive.Track>
      </View>
      <SliderPrimitive.Thumb
        className="block h-6 w-6 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      />
    </View>
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

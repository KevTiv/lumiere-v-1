import * as LabelPrimitive from "@rn-primitives/label";
import * as React from "react";

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Text>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Text>
>(({ ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    {...props}
  >
    <LabelPrimitive.Text className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" />
  </LabelPrimitive.Root>
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };

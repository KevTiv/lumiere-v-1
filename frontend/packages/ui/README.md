# @lumiere/ui

A shared UI package for Lumiere that includes both web (shadcn/ui) and native (react-native-reusables) components.

## Structure

```
src/
├── components/      # Web components (shadcn/ui)
├── lib/            # Shared utilities
├── hooks/          # Shared hooks
├── native/         # React Native components
│   ├── primitives/ # Base primitives using @rn-primitives
│   └── lib/        # Native-specific utilities
└── styles/         # Global styles
```

## Usage

### Web Components

```tsx
import { Button } from "@lumiere/ui";

export function MyComponent() {
  return <Button variant="outline">Click me</Button>;
}
```

### Native Components

```tsx
import { Button } from "@lumiere/ui/native";

export function MyNativeComponent() {
  return <Button variant="outline">Click me</Button>;
}
```

## Adding Components

### Web (shadcn)

```bash
cd packages/ui
pnpm dlx shadcn@latest add <component-name>
```

### Native (react-native-reusables)

Install the primitive:
```bash
pnpm add @rn-primitives/<component-name>
```

Then create a themed wrapper in `src/native/primitives/`.

## Prerequisites

- React Native projects using this package should have `nativewind` configured
- Web projects should have Tailwind CSS configured

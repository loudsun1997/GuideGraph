# @guidegraph/react-builder

Optional React workflow builder UI for GuideGraph.

Use this package when you want a ready-made editor for GuideGraph workflow definition drafts. It builds on `@guidegraph/builder` and React Flow.

## Basic Usage

```tsx
import { WorkflowBuilder } from "@guidegraph/react-builder";

<WorkflowBuilder
  initialDefinition={builderDraft}
  onChange={setBuilderDraft}
  onPublish={(definition, builderDefinition) => {
    saveRuntimeDefinition(definition);
    saveBuilderDraft(builderDefinition);
  }}
/>;
```

`onPublish()` receives:

- `definition`: plain runtime `WorkflowDefinition`, with builder metadata stripped
- `builderDefinition`: editable builder draft, including canvas metadata

## Current UI Features

- canvas, form, and preview tabs
- React Flow canvas
- draggable step cards
- dependency requirement edges
- transition/action edges
- action label nodes
- requirement gate nodes
- step inspector
- edge inspector
- action event, label, and icon editing
- validation panel
- warning panel
- preview simulation through `@guidegraph/core`
- generated runtime JSON preview
- read-only behavior for non-draft statuses

## Workbench

Run the builder component workbench:

```sh
pnpm stories:builder
```

This repo uses Ladle for the builder workbench because it is lightweight and Vite-native. Storybook remains a strong general-purpose choice, but Ladle is enough for this package's local component review needs.

## Example App

Run the dedicated builder app:

```sh
pnpm dev:builder
```

## Design Notes

This package is optional. It should not be imported by `@guidegraph/core`, `@guidegraph/server`, `@guidegraph/http`, or base `@guidegraph/react`.

Host apps still own:

- workflow definition persistence
- publish approval flows
- role-based builder permissions
- domain-specific form schemas
- production audit policy for definition changes

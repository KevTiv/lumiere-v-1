# Form Configuration Developer Guide

## Introduction

The Unified Form Configuration System allows you to create configurable forms that can be customized per organization with role-based visibility and user custom fields.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Configurable │  │ FormRegistry │  │ useFormConfiguration │  │
│  │ Form         │  │              │  │ Hook                 │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                  │                    │               │
└─────────┼──────────────────┼────────────────────┼───────────────┘
          │                  │                    │
          ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SpacetimeDB                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ FormConfig   │  │FormConfig    │  │FormRoleConfig        │  │
│  │              │  │Field         │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                  │                    │               │
│         └──────────────────┴────────────────────┘               │
│                          │                                       │
│                    ┌─────────┐                                   │
│                    │ User    │                                   │
│                    │ Custom  │                                   │
│                    │ Field   │                                   │
│                    └─────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Adding a New Form

### 1. Backend: Add Seed Configuration

Add initialization logic in `spacetimedb/src/forms/mod.rs`:

```rust
fn init_my_module_form_config(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    let module_id = "my_module".to_string();
    let form_id = "new-entry".to_string();

    // Check if already exists
    // ... (see existing code pattern)

    // Create configuration
    let config = FormConfig {
        id: 0,
        organization_id,
        module_id: module_id.clone(),
        form_id: form_id.clone(),
        name: "My Form".to_string(),
        description: "Description here".to_string(),
        is_active: true,
        is_system_default: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
    };

    let inserted = ctx.db.form_config().insert(config);

    // Add fields
    let fields = vec![
        ("field_id", "Field Label", FieldType::Text, true, 1),
        // ... more fields
    ];

    for (field_id, label, field_type, is_system, order) in fields {
        let field = FormConfigField {
            id: 0,
            configuration_id: inserted.id,
            field_id: field_id.to_string(),
            name: field_id.to_string(),
            label: label.to_string(),
            field_type,
            description: String::new(),
            placeholder: String::new(),
            default_value: String::new(),
            options_json: String::new(),
            validation_json: serde_json::to_string(&FieldValidation::default()).unwrap_or_default(),
            ai_suggestions_json: String::new(),
            order,
            is_system,
            is_enabled: true,
            category: String::new(),
            show_in_list: false,
            width: FieldWidth::Full,
            section_id: String::new(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        };
        ctx.db.form_config_field().insert(field);
    }

    Ok(())
}
```

### 2. Frontend: Add Registry Entry

Create `frontend/packages/ui/src/forms/config/modules/my-module.config.ts`:

```typescript
import type { FormRegistryEntry } from "../types"

export const myModuleForms: FormRegistryEntry[] = [
  {
    moduleId: "my_module",
    formId: "new-entry",
    name: "My Form",
    description: "Description of the form",
    icon: "FileText",
    category: "My Module",
    defaultConfig: () => ({
      moduleId: "my_module",
      formId: "new-entry",
      name: "My Form",
      description: "Description",
      isSystemDefault: true,
      fields: [
        {
          fieldId: "field_id",
          name: "field_id",
          label: "Field Label",
          fieldType: "Text",
          validation: { required: true },
          order: 1,
          isSystem: true,
          isEnabled: true,
          showInList: false,
          width: "Full",
        },
      ],
      roleConfigs: {
        "role-admin": {
          roleId: "role-admin",
          enabledFields: ["field_id"],
          requiredFields: ["field_id"],
          defaultPrompts: [],
        },
      },
    }),
  },
]
```

### 3. Register in Main Registry

Update `frontend/packages/ui/src/forms/config/registry.ts`:

```typescript
import { myModuleForms } from "./modules/my-module.config"

// In initializeRegistry()
for (const form of myModuleForms) {
  this.registerForm(form)
}
this.registerModule({
  id: "my_module",
  name: "My Module",
  description: "Module description",
  icon: "FileText",
  color: "blue",
  forms: myModuleForms,
})
```

### 4. Use in Component

```typescript
import { useFormConfiguration, ConfigurableForm } from "@lumiere/ui/forms"

function MyFormPage() {
  const { config, isLoading } = useFormConfiguration({
    moduleId: "my_module",
    formId: "new-entry",
    organizationId: orgId,
    roleId: currentRole,
  })

  const handleSubmit = async (data) => {
    // Handle form submission
  }

  return (
    <ConfigurableForm
      config={config}
      isLoading={isLoading}
      onSubmit={handleSubmit}
    />
  )
}
```

## Role-Based Access

### Defining Role Configurations

In the registry entry:

```typescript
roleConfigs: {
  "role-admin": {
    roleId: "role-admin",
    enabledFields: ["field1", "field2", "field3"],
    requiredFields: ["field1"],
    defaultPrompts: ["AI prompt 1", "AI prompt 2"],
  },
  "role-manager": {
    roleId: "role-manager",
    enabledFields: ["field1", "field2"],
    requiredFields: ["field1"],
    defaultPrompts: [],
  },
}
```

### Field Visibility Rules

- If no role config exists, only enabled system fields are shown
- If role config exists, only fields in `enabledFields` are visible
- Fields in `requiredFields` are marked as required (additive to field validation)

## Custom Fields

### User Custom Fields

Users can add their own fields prefixed with `custom:`:

```typescript
const customField = {
  fieldId: "custom:my_custom_field",
  name: "custom:my_custom_field",
  label: "My Custom Field",
  fieldType: "Text",
  // ...
}
```

### Handling Custom Fields in Submission

Custom fields are automatically separated in the ConfigurableForm:

```typescript
const handleSubmit = (data) => {
  // Standard fields
  const { field1, field2 } = data
  
  // Custom fields in metadata
  const { metadata } = data
  // metadata = { "custom:my_custom_field": "value" }
}
```

## Field Types

| Type | Description | Options Support |
|------|-------------|-----------------|
| Text | Single line text | No |
| Email | Email input | No |
| Textarea | Multi-line text | No |
| Number | Numeric input | No |
| Select | Dropdown select | Yes |
| MultiSelect | Multi-select dropdown | Yes |
| Radio | Radio buttons | Yes |
| Checkbox | Single checkbox | No |
| Switch | Toggle switch | No |
| Date | Date picker | No |
| DateTime | Date and time picker | No |
| Time | Time picker | No |
| File | File upload | No |
| Rating | Star rating | No |
| Slider | Range slider | No |
| Tags | Tag input | No |
| UserSelect | User picker | No |
| Hidden | Hidden field | No |

## Validation

### Field Validation

```typescript
{
  fieldId: "email",
  fieldType: "Email",
  validation: {
    required: true,
    minLength: 5,
    maxLength: 100,
    pattern: "^[^@]+@[^@]+$",
    message: "Please enter a valid email",
  },
}
```

### Custom Validation

For complex validation, implement in your onSubmit handler:

```typescript
const handleSubmit = async (data) => {
  // Custom validation
  if (data.amount && data.amount < 0) {
    throw new Error("Amount cannot be negative")
  }
  
  // Proceed with submission
}
```

## Best Practices

### 1. Use System Fields for Core Data

Core fields that are essential to the form should be marked as `isSystem: true` to prevent accidental deletion.

### 2. Group Fields with Sections

Use `sectionId` to group related fields visually:

```typescript
{
  fieldId: "billing_address",
  sectionId: "billing",
  // ...
},
{
  fieldId: "billing_city",
  sectionId: "billing",
  // ...
}
```

### 3. Configure Appropriate Widths

Balance form layout with field widths:

```typescript
// Side-by-side fields
{ fieldId: "first_name", width: "Half" }
{ fieldId: "last_name", width: "Half" }

// Full width for important content
{ fieldId: "description", width: "Full" }
```

### 4. Provide Clear Labels and Placeholders

Help users understand what to enter:

```typescript
{
  label: "Email Address",
  placeholder: "you@company.com",
  description: "We'll send a confirmation to this address",
}
```

### 5. Use AI Suggestions Wisely

Provide helpful AI suggestions for complex fields:

```typescript
{
  fieldId: "issue_description",
  fieldType: "Textarea",
  aiSuggestions: [
    "Describe the problem in detail",
    "Include any error messages",
    "Mention when the issue started",
  ],
}
```

## Troubleshooting

### Form Not Loading

1. Check moduleId and formId match exactly
2. Verify organizationId is correct
3. Ensure the form was initialized (call `initialize_default_form_configs`)

### Fields Not Showing

1. Check role config has the field in `enabledFields`
2. Verify field has `isEnabled: true`
3. Check `useDefaultIfMissing` if using fallback

### Custom Fields Not Saving

1. Ensure fieldId starts with `custom:`
2. Verify the user has permission to add custom fields
3. Check the field validation is valid

## Performance Tips

1. **Memoize Form Configs**: The `useFormConfiguration` hook memoizes parsed fields
2. **Use React.memo**: Wrap child components to prevent unnecessary re-renders
3. **Lazy Load Modules**: Only load form configs when needed
4. **Optimize Field Rendering**: The FormFieldsGrid component is memoized by default

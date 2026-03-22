# Form Configuration API Documentation

## Overview

The Unified Form Configuration System provides configurable forms across all modules with role-based field visibility, custom field support, and database persistence via SpacetimeDB.

## Backend API (SpacetimeDB Reducers)

### Table Definitions

#### FormConfig
Stores form configuration metadata.

| Field | Type | Description |
|-------|------|-------------|
| id | u64 | Primary key (auto-increment) |
| organization_id | u64 | Organization owning this config |
| module_id | String | Module identifier (e.g., "journal", "crm") |
| form_id | String | Form identifier within module |
| name | String | Display name |
| description | String | Form description |
| is_active | bool | Whether form is active |
| is_system_default | bool | System-provided default |
| created_at | Timestamp | Creation timestamp |
| updated_at | Timestamp | Last update timestamp |
| created_by | Identity | Creator identity |
| updated_by | Identity | Last updater identity |

#### FormConfigField
Individual fields within a form configuration.

| Field | Type | Description |
|-------|------|-------------|
| id | u64 | Primary key |
| configuration_id | u64 | FK to FormConfig |
| field_id | String | Unique field identifier |
| name | String | Field name |
| label | String | Display label |
| field_type | FieldType | Type enum |
| description | String | Field description |
| placeholder | String | Placeholder text |
| default_value | String | Default value |
| options_json | String | Serialized FieldOption[] |
| validation_json | String | Serialized FieldValidation |
| ai_suggestions_json | String | Serialized AI suggestions |
| order | u32 | Display order |
| is_system | bool | System field (non-deletable) |
| is_enabled | bool | Field enabled |
| category | String | Field category |
| show_in_list | bool | Show in list views |
| width | FieldWidth | Layout width |
| section_id | String | Section grouping |

#### FormRoleConfig
Role-based field visibility and requirements.

| Field | Type | Description |
|-------|------|-------------|
| id | u64 | Primary key |
| configuration_id | u64 | FK to FormConfig |
| role_id | String | Role identifier |
| enabled_fields_json | String | Serialized Vec<String> |
| required_fields_json | String | Serialized Vec<String> |
| default_prompts_json | String | Serialized Vec<String> |
| is_active | bool | Config active |
| created_at | Timestamp | Creation timestamp |
| updated_at | Timestamp | Last update timestamp |

#### UserCustomField
User-specific custom fields.

| Field | Type | Description |
|-------|------|-------------|
| id | u64 | Primary key |
| organization_id | u64 | Organization |
| user_id | Identity | User who created |
| configuration_id | u64 | FK to FormConfig |
| field_id | String | Must start with "custom:" |
| field_data_json | String | Serialized field definition |
| created_at | Timestamp | Creation timestamp |
| updated_at | Timestamp | Last update timestamp |

### Field Types

```rust
pub enum FieldType {
    Text,
    Email,
    Password,
    Tel,
    Url,
    Textarea,
    Number,
    Select,
    MultiSelect,
    Checkbox,
    Switch,
    Radio,
    Date,
    Time,
    DateTime,
    File,
    Hidden,
    Rating,
    Slider,
    Tags,
    UserSelect,
    Custom,
}
```

### Field Width

```rust
pub enum FieldWidth {
    Full,      // 100%
    Half,      // 50%
    Third,     // 33%
    TwoThirds, // 67%
    Quarter,   // 25%
}
```

### Reducers

#### create_form_configuration
Creates a new form configuration.

```rust
#[reducer]
pub fn create_form_configuration(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateFormConfigParams,
) -> Result<(), String>
```

**Parameters:**
- `organization_id`: Target organization
- `params`: CreateFormConfigParams with module_id, form_id, name, description, is_system_default

**Errors:**
- Permission denied
- Configuration already exists

#### add_form_field
Adds a field to a form configuration.

```rust
#[reducer]
pub fn add_form_field(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    params: CreateFormFieldParams,
) -> Result<(), String>
```

#### update_form_field
Updates an existing form field.

```rust
#[reducer]
pub fn update_form_field(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    field_id: String,
    params: UpdateFormFieldParams,
) -> Result<(), String>
```

#### delete_form_field
Deletes a form field (non-system only).

```rust
#[reducer]
pub fn delete_form_field(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    field_id: String,
) -> Result<(), String>
```

#### set_form_role_config
Creates or updates role-based field configuration.

```rust
#[reducer]
pub fn set_form_role_config(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    params: CreateRoleConfigParams,
) -> Result<(), String>
```

#### add_user_custom_field
Adds a custom field for a user.

```rust
#[reducer]
pub fn add_user_custom_field(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUserCustomFieldParams,
) -> Result<(), String>
```

**Note:** Custom field IDs must start with "custom:" prefix.

#### delete_user_custom_field
Deletes a user's custom field.

```rust
#[reducer]
pub fn delete_user_custom_field(
    ctx: &ReducerContext,
    organization_id: u64,
    custom_field_id: u64,
) -> Result<(), String>
```

#### initialize_default_form_configs
Seeds default form configurations for an organization.

```rust
#[reducer]
pub fn initialize_default_form_configs(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String>
```

## Frontend API

### Hooks

#### useFormConfiguration
Main hook for consuming form configurations.

```typescript
import { useFormConfiguration } from "@lumiere/ui/forms"

const { config, isLoading, error, refetch } = useFormConfiguration({
  moduleId: "journal",
  formId: "daily-entry",
  organizationId: 1,
  roleId: "role-admin",
  userId: "user-123",
  useDefaultIfMissing: true,
})
```

**Options:**
- `moduleId`: Module identifier
- `formId`: Form identifier
- `organizationId`: Organization ID
- `roleId`: Current user's role (optional)
- `userId`: Current user's ID (optional)
- `useDefaultIfMissing`: Fall back to default config

**Returns:**
- `config`: MergedFormConfiguration with fields
- `isLoading`: Loading state
- `error`: Error message if any
- `refetch`: Function to refresh data

#### useOrganizationFormConfigs
Get all configurations for an organization.

```typescript
const { configs, isLoading } = useOrganizationFormConfigs(organizationId)
```

#### useFieldVisibility
Check field visibility for a role.

```typescript
const isVisible = useFieldVisibility("field_id", roleConfig)
```

#### useFieldRequired
Check if field is required for a role.

```typescript
const isRequired = useFieldRequired("field_id", validation, roleConfig)
```

### Components

#### ConfigurableForm
Renders a form based on configuration.

```typescript
import { ConfigurableForm } from "@lumiere/ui/forms"

<ConfigurableForm
  config={mergedConfig}
  isLoading={false}
  onSubmit={handleSubmit}
  onCancel={handleCancel}
  defaultValues={{ mood: "good" }}
  submitLabel="Save"
  cancelLabel="Cancel"
  disabled={false}
  className="my-form"
  layout="vertical" // "vertical" | "horizontal" | "sections"
  showDescription={true}
/>
```

### Registry

#### formRegistry
Central registry for all forms.

```typescript
import { formRegistry } from "@lumiere/ui/forms"

// Get a form
const entry = formRegistry.get("journal", "daily-entry")

// Get all forms for a module
const forms = formRegistry.getByModule("crm")

// Get all forms
const allForms = formRegistry.getAll()

// Get module metadata
const module = formRegistry.getModule("sales")

// Search forms
const results = formRegistry.search("invoice")

// Get default config
const defaultConfig = formRegistry.getDefaultConfig("journal", "daily-entry")
```

## Usage Examples

### Basic Form Usage

```typescript
import { useFormConfiguration, ConfigurableForm } from "@lumiere/ui/forms"

function MyForm() {
  const { config, isLoading } = useFormConfiguration({
    moduleId: "journal",
    formId: "daily-entry",
    organizationId: 1,
    roleId: "role-manager",
  })

  const handleSubmit = async (data) => {
    console.log("Form data:", data)
    // Send to backend
  }

  return (
    <ConfigurableForm
      config={config}
      isLoading={isLoading}
      onSubmit={handleSubmit}
      submitLabel="Save Entry"
    />
  )
}
```

### With Sections Layout

```typescript
<ConfigurableForm
  config={config}
  onSubmit={handleSubmit}
  layout="sections"
  showDescription={true}
/>
```

### Custom Field Handling

Custom fields are automatically separated and passed in a `metadata` object:

```typescript
const handleSubmit = (data) => {
  const { metadata, ...standardFields } = data
  // standardFields = { mood: "good", accomplishments: "..." }
  // metadata = { custom_myfield: "value" }
}
```

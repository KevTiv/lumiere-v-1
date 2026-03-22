//! Unified Form Configuration System
//!
//! This module provides configurable forms across all modules with:
//! - Role-based field visibility
//! - User custom fields support
//! - Database persistence via SpacetimeDB
//!
//! ## Usage
//!
//! ```typescript
//! import { useFormConfiguration } from "@/forms/hooks/use-form-config"
//!
//! const { config, isLoading } = useFormConfiguration({
//!   moduleId: "journal",
//!   formId: "daily-entry",
//!   organizationId: 1,
//!   roleId: "role-manager",
//! })
//! ```

// Config exports
export * from "./config/types"
export * from "./config/registry"

// Hooks exports
export * from "./hooks/use-form-config"

// Component exports
export * from "./components/configurable-form"
export * from "./components/form-field-renderer"

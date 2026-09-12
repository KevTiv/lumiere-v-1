//! Canonical, renderer-neutral wire models for composed module presentations.

pub mod models;
pub mod preview;
pub use preview::*;
pub mod validation;

#[cfg(test)]
mod validation_tests;

pub use models::*;
pub use validation::*;

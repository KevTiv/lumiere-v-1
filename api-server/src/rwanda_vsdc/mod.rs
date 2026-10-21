//! Unwired, crate-private RRA VSDC protocol foundation.
//!
//! Source: RRA VSDC specification v1.0.5, revised 2023-05-16,
//! <https://www.rra.gov.rw/fileadmin/user_upload/VSDC_SPECIFICATION_DOCUMENT_v1.0.5_okay.pdf>.
//! Initialization: PDF pages 16–17; normal sales: 40–44; codes: 75–76.
//! This historical document does not establish current installation approval or certification.
//!
//! There are deliberately no routes, workers, environment reads or default endpoint here.
//! Sales require an explicit reviewed dialect because the table and example disagree on
//! item tax and receipt customer-TIN names. Only normal approved sales are represented;
//! refunds, cancellations, training/proforma/copies, insurance and discounts are unsupported.
//! Monetary values are integer hundredths, never floating point. No rounding or tax
//! classification is inferred. Callers must supply reviewed tax codes/rates, exact values
//! and an explicit inclusive/exclusive convention. Only supply-equals-taxable arithmetic
//! is supported; fractional-cent taxes are rejected under both reviewed conventions.
//! A successful sales response identifies the SDC/MRC, but does not echo TIN, branch or
//! invoice number. It therefore cannot establish invoice-level correlation or safe replay.
//! Every dispatched request needs a durable, scoped intent/unknown-outcome state machine
//! before this module can be connected to an application flow. This module supplies none.
//! Device-to-organization/company binding, approved item/unit/tax code catalogs, purchase
//! code provenance and canonical invoice mapping remain integration responsibilities.
#![allow(dead_code)] // Intentional until a separately reviewed integration is implemented.

mod client;
mod protocol;
mod values;
mod wire;

pub(crate) use client::{ClientConfig, UncertainReason, VsdcClient, VsdcError};
pub(crate) use protocol::*;
pub(crate) use values::{Counter, Decimal, ValidationError};

#[cfg(test)]
mod tests;

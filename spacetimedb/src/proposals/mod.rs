/// Proposals Module — Sales proposals, tenders, and RFP responses
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **Proposal** | Core proposal record (status, value, client, etc.) |
/// | **ProposalSection** | Individual sections of the proposal draft |
/// | **ProposalVersion** | Saved version snapshots with serialised sections |
/// | **ProposalSourceDoc** | Source documents uploaded/pasted for AI analysis |
pub mod proposals;

pub use proposals::*;

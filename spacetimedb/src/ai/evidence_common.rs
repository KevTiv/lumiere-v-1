//! Shared validation and scope rules for the AIH-13/14/17/18 evidence,
//! provenance and knowledge records.
//!
//! Everything here is pure so the rules can be unit tested without a
//! database and so each reducer module states a rule once rather than
//! re-implementing it. Nothing in this file touches a table.

/// Version of the reverse-dependency policy (AIH-18) stamped onto every
/// dependency edge and source-change record. A change to how a source
/// change maps onto dependent work bumps this, so a historical decision can
/// be interpreted under the policy that was in force when it was made.
pub const EVIDENCE_POLICY_VERSION: u32 = 1;

pub const MAX_TAGS: usize = 32;
pub const MAX_TAG_LEN: usize = 128;
pub const MAX_ID_LIST: usize = 256;
pub const MAX_LIST_ITEMS: usize = 32;
pub const MAX_LIST_ITEM_LEN: usize = 1_000;

/// What a contributor (or a source version) can say about how the underlying
/// material was checked. Ordered weakest to strongest; a record may never
/// claim a stronger state than the evidence it rests on.
pub const INSPECTION_STATES: [&str; 3] = ["unverified_recollection", "user_reported", "inspected"];

pub fn inspection_rank(state: &str) -> Option<u8> {
    INSPECTION_STATES
        .iter()
        .position(|candidate| *candidate == state)
        .map(|idx| idx as u8)
}

/// `Ok` when `value` is one of `allowed`.
pub fn require_one_of(name: &str, value: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("{name} must be one of: {}", allowed.join(", ")))
    }
}

pub fn require_len(name: &str, value: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max {
        Err(format!("{name} must be 1..{max} bytes"))
    } else {
        Ok(())
    }
}

pub fn require_opt_len(name: &str, value: &Option<String>, max: usize) -> Result<(), String> {
    match value {
        Some(inner) => require_len(name, inner, max),
        None => Ok(()),
    }
}

/// Free-text lists (alternatives, adaptations, assumptions). Bounded so a
/// record stays an observable justification rather than a transcript.
pub fn validate_text_list(name: &str, items: &[String]) -> Result<(), String> {
    if items.len() > MAX_LIST_ITEMS {
        return Err(format!("{name} allows at most {MAX_LIST_ITEMS} items"));
    }
    for item in items {
        require_len(name, item, MAX_LIST_ITEM_LEN)?;
    }
    Ok(())
}

/// `key:value` scope tags, the same shape `ai_evidence_passage` uses.
pub fn validate_tags(name: &str, tags: &[String]) -> Result<(), String> {
    if tags.len() > MAX_TAGS {
        return Err(format!("{name} allows at most {MAX_TAGS} tags"));
    }
    for tag in tags {
        let well_formed = tag
            .split_once(':')
            .is_some_and(|(key, value)| !key.trim().is_empty() && !value.trim().is_empty());
        if !well_formed || tag.len() > MAX_TAG_LEN {
            return Err(format!(
                "{name} tag '{tag}' must be 'key:value' and at most {MAX_TAG_LEN} bytes"
            ));
        }
    }
    Ok(())
}

/// Id lists that reference other rows: bounded and free of duplicates so a
/// dependency edge is never recorded twice for one reference.
pub fn validate_id_list(name: &str, ids: &[u64]) -> Result<(), String> {
    if ids.len() > MAX_ID_LIST {
        return Err(format!("{name} allows at most {MAX_ID_LIST} ids"));
    }
    let mut sorted = ids.to_vec();
    sorted.sort_unstable();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(format!("{name} must not contain duplicate ids"));
    }
    if ids.contains(&0) {
        return Err(format!("{name} must not contain id 0"));
    }
    Ok(())
}

/// Lowercase hex SHA-256 (64 chars). Used for hashes a caller supplies about
/// content the module never holds (a whole-source snapshot, an artifact
/// component); passage text hashes are computed by the reducer instead.
pub fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Coordinates locating a passage inside its source version. An empty list
/// is legitimate and means "unknown" — a page or section is never invented.
pub fn validate_coordinates(coordinates: &[String]) -> Result<(), String> {
    const KINDS: [&str; 6] = ["page", "section", "chars", "table", "record", "line"];
    if coordinates.len() > MAX_TAGS {
        return Err(format!("coordinates allow at most {MAX_TAGS} entries"));
    }
    for coordinate in coordinates {
        let well_formed = coordinate
            .split_once(':')
            .is_some_and(|(kind, rest)| KINDS.contains(&kind) && !rest.trim().is_empty());
        if !well_formed || coordinate.len() > MAX_TAG_LEN {
            return Err(format!(
                "coordinate '{coordinate}' must be '<{}>:<locator>' and at most {MAX_TAG_LEN} bytes",
                KINDS.join("|")
            ));
        }
    }
    Ok(())
}

/// Whether a record in `(ref_org, ref_company)` may reference a source owned
/// by `(source_org, source_company)` with the given `scope`. A `company`
/// scoped source is visible to its own company only; `organization` scope
/// extends to sibling companies of the same organization. No scope crosses an
/// organization boundary.
pub fn reference_in_scope(
    source_org: u64,
    source_company: u64,
    source_scope: &str,
    ref_org: u64,
    ref_company: u64,
) -> bool {
    if source_org != ref_org {
        return false;
    }
    match source_scope {
        "organization" => true,
        "company" => source_company == ref_company,
        _ => false,
    }
}

/// Severity of a dependency edge. Only ever escalates: an edge that was
/// invalidated cannot be quietly downgraded by a later, milder change.
pub const DEPENDENCY_STATES: [&str; 3] = ["valid", "needs_review", "invalid"];

pub fn dependency_rank(state: &str) -> Option<u8> {
    DEPENDENCY_STATES
        .iter()
        .position(|candidate| *candidate == state)
        .map(|idx| idx as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspection_states_are_ordered() {
        assert!(inspection_rank("unverified_recollection") < inspection_rank("user_reported"));
        assert!(inspection_rank("user_reported") < inspection_rank("inspected"));
        assert_eq!(inspection_rank("bogus"), None);
    }

    #[test]
    fn coordinates_allow_unknown_and_reject_malformed() {
        assert!(validate_coordinates(&[]).is_ok());
        assert!(validate_coordinates(&["page:12".into(), "section:3.2".into()]).is_ok());
        assert!(validate_coordinates(&["page:".into()]).is_err());
        assert!(validate_coordinates(&["paragraph:4".into()]).is_err());
        assert!(validate_coordinates(&["no-colon".into()]).is_err());
    }

    #[test]
    fn id_lists_reject_duplicates_and_zero() {
        assert!(validate_id_list("ids", &[1, 2, 3]).is_ok());
        assert!(validate_id_list("ids", &[1, 2, 1]).is_err());
        assert!(validate_id_list("ids", &[0]).is_err());
        assert!(validate_id_list("ids", &vec![1; MAX_ID_LIST + 1]).is_err());
    }

    #[test]
    fn sha256_hex_shape() {
        assert!(is_sha256_hex(&"a".repeat(64)));
        assert!(!is_sha256_hex(&"A".repeat(64)));
        assert!(!is_sha256_hex("abc"));
    }

    #[test]
    fn scope_never_crosses_organizations() {
        assert!(reference_in_scope(1, 10, "company", 1, 10));
        assert!(!reference_in_scope(1, 10, "company", 1, 11));
        assert!(reference_in_scope(1, 10, "organization", 1, 11));
        assert!(!reference_in_scope(1, 10, "organization", 2, 10));
        assert!(!reference_in_scope(1, 10, "unknown", 1, 10));
    }

    #[test]
    fn dependency_states_only_rank_known_values() {
        assert!(dependency_rank("valid") < dependency_rank("needs_review"));
        assert!(dependency_rank("needs_review") < dependency_rank("invalid"));
        assert_eq!(dependency_rank("bogus"), None);
    }
}

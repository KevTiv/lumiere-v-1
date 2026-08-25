pub struct RetrievalOutcome<T> {
    pub value: T,
    pub degraded: bool,
}

/// Semantic retrieval is derived infrastructure. A dependency failure must
/// produce an empty grounded result, never unverified payload content or an
/// aborted canonical agent session.
pub fn optional_retrieval<T: Default, E>(result: Result<T, E>) -> RetrievalOutcome<T> {
    match result {
        Ok(value) => RetrievalOutcome {
            value,
            degraded: false,
        },
        Err(_) => RetrievalOutcome {
            value: T::default(),
            degraded: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_dependency_failures_return_empty_degraded_output() {
        for dependency in ["embedder", "qdrant", "authoritative resolver"] {
            let outcome = optional_retrieval::<Vec<String>, _>(Err(dependency));
            assert!(outcome.degraded, "{dependency}");
            assert!(outcome.value.is_empty(), "{dependency}");
        }
    }

    #[test]
    fn successful_retrieval_preserves_grounded_values() {
        let outcome = optional_retrieval::<Vec<_>, &str>(Ok(vec!["authorized"]));
        assert!(!outcome.degraded);
        assert_eq!(outcome.value, vec!["authorized"]);
    }
}

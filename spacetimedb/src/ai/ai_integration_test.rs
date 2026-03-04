/// AI Module Integration Tests
///
/// These tests verify the complete AI workflow including:
/// - AI agent configuration
/// - AI team member creation
/// - AI insight generation
/// - Document processing workflow
/// - Search embedding management

#[cfg(test)]
mod tests {
    use spacetimedb::test_helpers::*;
    use spacetimedb::{Identity, Timestamp};

    use crate::ai::agents::*;
    use crate::ai::intelligence::*;
    use crate::types::{InsightSeverity, JobStatus};

    // Mock identity for testing
    fn mock_identity() -> Identity {
        Identity::from_hex("0123456789abcdef0123456789abcdef").unwrap()
    }

    // Mock timestamp for testing
    fn mock_timestamp() -> Timestamp {
        Timestamp::from_unix(1710000000)
    }

    #[test]
    fn test_ai_agent_lifecycle() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create AI agent
        let result = create_ai_agent(
            &ctx,
            Some(1),
            "Test Agent".to_string(),
            "claude-sonnet-4-6".to_string(),
            "Anthropic".to_string(),
            0.7,
            4096,
            Some("You are a helpful assistant".to_string()),
            Some(1000.0),
            60,
            0.1,
        );

        assert!(result.is_ok(), "AI agent creation should succeed");

        // Verify agent was created
        let agents = ctx.db.ai_agent().iter().collect::<Vec<_>>();
        assert_eq!(agents.len(), 1, "Should have one AI agent");

        let agent = &agents[0];
        assert_eq!(agent.name, "Test Agent");
        assert_eq!(agent.model, "claude-sonnet-4-6");
        assert_eq!(agent.temperature, 0.7);
        assert!(agent.is_active);
    }

    #[test]
    fn test_ai_insight_workflow() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create AI agent first
        create_ai_agent(
            &ctx,
            Some(1),
            "Insight Agent".to_string(),
            "gpt-4o".to_string(),
            "OpenAI".to_string(),
            0.5,
            8192,
            None,
            Some(500.0),
            30,
            0.2,
        ).unwrap();

        // Get agent ID
        let agents = ctx.db.ai_agent().iter().collect::<Vec<_>>();
        let agent_id = agents[0].id;

        // Create AI insight
        let result = create_ai_insight(
            &ctx,
            Some(1),
            InsightSeverity::High,
            "Low Inventory Alert".to_string(),
            "Product XYZ is running low on stock".to_string(),
            vec!["Order more stock".to_string()],
            "inventory".to_string(),
            Some(123),
            0.95,
            Some(agent_id),
            vec!["inventory".to_string(), "urgent".to_string()],
        );

        assert!(result.is_ok(), "AI insight creation should succeed");

        // Verify insight was created
        let insights = ctx.db.ai_insight().iter().collect::<Vec<_>>();
        assert_eq!(insights.len(), 1, "Should have one AI insight");

        let insight = &insights[0];
        assert_eq!(insight.title, "Low Inventory Alert");
        assert_eq!(insight.severity, InsightSeverity::High);
        assert_eq!(insight.confidence, 0.95);
        assert!(!insight.is_acknowledged);

        // Acknowledge the insight
        let ack_result = acknowledge_insight(
            &ctx,
            Some(1),
            insight.id,
            Some("Ordered more stock".to_string()),
        );

        assert!(ack_result.is_ok(), "Acknowledging insight should succeed");

        // Verify insight was acknowledged
        let updated_insight = ctx.db.ai_insight().id().find(&insight.id).unwrap();
        assert!(updated_insight.is_acknowledged);
        assert_eq!(updated_insight.action_taken, Some("Ordered more stock".to_string()));
    }

    #[test]
    fn test_document_processing_workflow() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create document processing job
        let result = create_document_processing_job(
            &ctx,
            Some(1),
            "Invoice".to_string(),
            "OCR".to_string(),
            None,
            Some(r#"{"document_url": "https://example.com/invoice.pdf"}"#.to_string()),
        );

        assert!(result.is_ok(), "Document processing job creation should succeed");

        // Verify job was created
        let jobs = ctx.db.ai_document_processing_job().iter().collect::<Vec<_>>();
        assert_eq!(jobs.len(), 1, "Should have one processing job");

        let job = &jobs[0];
        assert_eq!(job.document_type, "Invoice");
        assert_eq!(job.job_type, "OCR");
        assert_eq!(job.status, JobStatus::Pending);
        assert!(job.input_data.is_some());

        // Complete the job
        let complete_result = complete_document_processing_job(
            &ctx,
            Some(1),
            job.id,
            Some(r#"{"amount": 1000.0, "vendor": "Acme Corp"}"#.to_string()),
            Some(0.98),
            Some("claude-sonnet-4-6".to_string()),
            Some(1000),
            Some(0.50),
            None,
        );

        assert!(complete_result.is_ok(), "Completing job should succeed");

        // Verify job was completed
        let updated_job = ctx.db.ai_document_processing_job().id().find(&job.id).unwrap();
        assert_eq!(updated_job.status, JobStatus::Completed);
        assert!(updated_job.extracted_data.is_some());
        assert_eq!(updated_job.confidence_score, Some(0.98));
        assert_eq!(updated_job.tokens_used, Some(1000));
        assert_eq!(updated_job.cost, Some(0.50));

        // Approve the job
        let approve_result = approve_document_processing_job(
            &ctx,
            Some(1),
            job.id,
        );

        assert!(approve_result.is_ok(), "Approving job should succeed");

        // Verify job was approved
        let approved_job = ctx.db.ai_document_processing_job().id().find(&job.id).unwrap();
        assert!(approved_job.is_approved);
        assert!(approved_job.reviewed_by.is_some());
        assert!(approved_job.reviewed_at.is_some());
    }

    #[test]
    fn test_search_embedding_management() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create a sample embedding vector
        let embedding: Vec<f32> = vec![
            0.1, 0.2, 0.3, 0.4, 0.5,  // Sample embedding values
            0.6, 0.7, 0.8, 0.9, 1.0,
        ];

        // Upsert embedding
        let result = upsert_search_embedding(
            &ctx,
            Some(1),
            "product".to_string(),
            123,
            "High-quality widget".to_string(),
            embedding.clone(),
            Some("abc123".to_string()),
        );

        assert!(result.is_ok(), "Upserting embedding should succeed");

        // Verify embedding was created
        let embeddings = ctx.db.search_embedding().iter().collect::<Vec<_>>();
        assert_eq!(embeddings.len(), 1, "Should have one embedding");

        let stored_embedding = &embeddings[0];
        assert_eq!(stored_embedding.content_type, "product");
        assert_eq!(stored_embedding.content_id, 123);
        assert_eq!(stored_embedding.text, "High-quality widget");
        assert_eq!(stored_embedding.embedding, embedding);
        assert_eq!(stored_embedding.embedding_hash, Some("abc123".to_string()));

        // Update the same embedding
        let updated_embedding = vec![
            0.2, 0.3, 0.4, 0.5, 0.6,  // Updated embedding values
            0.7, 0.8, 0.9, 1.0, 1.1,
        ];

        let update_result = upsert_search_embedding(
            &ctx,
            Some(1),
            "product".to_string(),
            123,
            "Updated high-quality widget".to_string(),
            updated_embedding.clone(),
            Some("def456".to_string()),
        );

        assert!(update_result.is_ok(), "Updating embedding should succeed");

        // Verify embedding was updated
        let updated_stored = ctx.db.search_embedding().iter().collect::<Vec<_>>();
        assert_eq!(updated_stored.len(), 1, "Should still have one embedding");

        let final_embedding = &updated_stored[0];
        assert_eq!(final_embedding.text, "Updated high-quality widget");
        assert_eq!(final_embedding.embedding, updated_embedding);
        assert_eq!(final_embedding.embedding_hash, Some("def456".to_string()));
    }

    #[test]
    fn test_ai_team_member_creation() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create AI agent first
        create_ai_agent(
            &ctx,
            Some(1),
            "Team Agent".to_string(),
            "gpt-4o".to_string(),
            "OpenAI".to_string(),
            0.7,
            8192,
            None,
            Some(1000.0),
            60,
            0.1,
        ).unwrap();

        // Get agent ID
        let agents = ctx.db.ai_agent().iter().collect::<Vec<_>>();
        let agent_id = agents[0].id;

        // Create AI team member
        let result = create_ai_team_member(
            &ctx,
            Some(1),
            "Inventory Analyst".to_string(),
            agent_id,
            "Analyst".to_string(),
            "Formal".to_string(),
            Some("Hello, I'm your inventory analyst".to_string()),
            Some("Detail-oriented and analytical".to_string()),
        );

        assert!(result.is_ok(), "AI team member creation should succeed");

        // Verify team member was created
        let members = ctx.db.ai_team_member().iter().collect::<Vec<_>>();
        assert_eq!(members.len(), 1, "Should have one team member");

        let member = &members[0];
        assert_eq!(member.name, "Inventory Analyst");
        assert_eq!(member.role, "Analyst");
        assert_eq!(member.ai_agent_id, agent_id);
        assert!(member.is_active);
    }

    #[test]
    fn test_permission_checks() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Try to create AI agent without permission
        let result = create_ai_agent(
            &ctx,
            Some(999), // Non-existent company
            "Unauthorized Agent".to_string(),
            "gpt-4o".to_string(),
            "OpenAI".to_string(),
            0.7,
            8192,
            None,
            Some(1000.0),
            60,
            0.1,
        );

        assert!(result.is_err(), "Should fail due to permission check");
        assert!(result.unwrap_err().contains("Permission denied"));
    }
}


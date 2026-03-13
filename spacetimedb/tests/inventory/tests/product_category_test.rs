/// Product Category Module Tests
///
/// These tests verify the complete product category workflow including:
/// - Category creation with hierarchy
/// - Category updates with circular reference detection
/// - Soft delete and restore functionality
/// - Permission checks

#[cfg(test)]
mod tests {
    use spacetimedb::test_helpers::*;
    use spacetimedb::{Identity, Timestamp};

    use crate::inventory::product_category::*;
    use crate::inventory::product_category;

    // Mock identity for testing
    fn mock_identity() -> Identity {
        Identity::from_hex("0123456789abcdef0123456789abcdef").unwrap()
    }

    // Mock timestamp for testing
    fn mock_timestamp() -> Timestamp {
        Timestamp::from_unix(1710000000)
    }

    #[test]
    fn test_category_creation() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create root category
        let result = create_product_category(
            &ctx,
            Some(1),
            "Electronics".to_string(),
            None,
            10,
        );

        assert!(result.is_ok(), "Root category creation should succeed");

        // Verify category was created
        let categories = ctx.db.product_category().iter().collect::<Vec<_>>();
        assert_eq!(categories.len(), 1, "Should have one category");

        let category = &categories[0];
        assert_eq!(category.name, "Electronics");
        assert_eq!(category.parent_id, None);
        assert_eq!(category.sequence, 10);
        assert!(category.deleted_at.is_none());
    }

    #[test]
    fn test_category_hierarchy() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create root category
        create_product_category(
            &ctx,
            Some(1),
            "Electronics".to_string(),
            None,
            10,
        ).unwrap();

        let root_cat = ctx.db.product_category().iter().next().unwrap();

        // Create child category
        let result = create_product_category(
            &ctx,
            Some(1),
            "Computers".to_string(),
            Some(root_cat.id),
            20,
        );

        assert!(result.is_ok(), "Child category creation should succeed");

        // Verify hierarchy
        let categories = ctx.db.product_category().iter().collect::<Vec<_>>();
        assert_eq!(categories.len(), 2, "Should have two categories");

        let child_cat = categories.iter()
            .find(|c| c.name == "Computers")
            .expect("Child category should exist");

        assert_eq!(child_cat.parent_id, Some(root_cat.id));
        assert_eq!(child_cat.sequence, 20);
    }

    #[test]
    fn test_category_update() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create category
        create_product_category(
            &ctx,
            Some(1),
            "Original Name".to_string(),
            None,
            10,
        ).unwrap();

        let category = ctx.db.product_category().iter().next().unwrap();

        // Update category
        let result = update_product_category(
            &ctx,
            Some(1),
            category.id,
            Some("Updated Name".to_string()),
            None,
            Some(30),
        );

        assert!(result.is_ok(), "Category update should succeed");

        // Verify update
        let updated_cat = ctx.db.product_category().id().find(&category.id).unwrap();
        assert_eq!(updated_cat.name, "Updated Name");
        assert_eq!(updated_cat.sequence, 30);
    }

    #[test]
    fn test_circular_reference_detection() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create categories: A -> B -> C
        let cat_a = create_product_category(
            &ctx,
            Some(1),
            "Category A".to_string(),
            None,
            10,
        ).unwrap();

        let cat_b = create_product_category(
            &ctx,
            Some(1),
            "Category B".to_string(),
            Some(cat_a.id),
            20,
        ).unwrap();

        let cat_c = create_product_category(
            &ctx,
            Some(1),
            "Category C".to_string(),
            Some(cat_b.id),
            30,
        ).unwrap();

        // Try to create circular reference: C -> A
        let result = update_product_category(
            &ctx,
            Some(1),
            cat_c.id,
            None,
            Some(cat_a.id), // This would create: A -> B -> C -> A
            None,
        );

        assert!(result.is_err(), "Should detect circular reference");
        assert!(result.unwrap_err().contains("Circular reference"));
    }

    #[test]
    fn test_soft_delete_and_restore() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Create category
        create_product_category(
            &ctx,
            Some(1),
            "Test Category".to_string(),
            None,
            10,
        ).unwrap();

        let category = ctx.db.product_category().iter().next().unwrap();

        // Delete category
        let result = delete_product_category(
            &ctx,
            Some(1),
            category.id,
        );

        assert!(result.is_ok(), "Category deletion should succeed");

        // Verify deletion
        let deleted_cat = ctx.db.product_category().id().find(&category.id).unwrap();
        assert!(deleted_cat.deleted_at.is_some());

        // Restore category
        let restore_result = restore_product_category(
            &ctx,
            Some(1),
            category.id,
        );

        assert!(restore_result.is_ok(), "Category restoration should succeed");

        // Verify restoration
        let restored_cat = ctx.db.product_category().id().find(&category.id).unwrap();
        assert!(restored_cat.deleted_at.is_none());
    }

    #[test]
    fn test_permission_checks() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Try to create category without permission
        let result = create_product_category(
            &ctx,
            Some(999), // Non-existent company
            "Unauthorized Category".to_string(),
            None,
            10,
        );

        assert!(result.is_err(), "Should fail due to permission check");
        assert!(result.unwrap_err().contains("Permission denied"));
    }

    #[test]
    fn test_parent_validation() {
        let ctx = setup_reducer_context(mock_identity(), mock_timestamp());

        // Try to create category with non-existent parent
        let result = create_product_category(
            &ctx,
            Some(1),
            "Orphan Category".to_string(),
            Some(999), // Non-existent parent
            10,
        );

        assert!(result.is_err(), "Should fail due to invalid parent");
        assert!(result.unwrap_err().contains("Parent category not found"));
    }
}


use lumiere_finance_review_core::reviews::reconciliation;
use serde_json::json;
#[test]
fn bank_linked_payment_is_never_proposed_for_another_line() {
    let statement = json!({"id":1,"organizationId":9,"companyId":7,"currencyId":3,"date":100,"state":"Open","balanceStart":0,"balanceEnd":10});
    let target = json!({"id":2,"organizationId":9,"statementId":1,"journalCurrencyId":3,"amountResidual":10,"isReconciled":false,"date":100,"paymentIds":[]});
    let linked = json!({"id":3,"organizationId":9,"statementId":1,"journalCurrencyId":3,"amountResidual":0,"isReconciled":true,"date":100,"paymentIds":[4]});
    let payment = json!({"id":4,"organizationId":9,"companyId":7,"currencyId":3,"state":"Posted","amount":10});
    let candidate = json!({"id":5,"organizationId":9,"statementLineId":2,"matchType":"payment","entityId":4,"amount":10});
    let result = reconciliation(
        9,
        7,
        1,
        &[statement],
        &[target, linked],
        &[candidate],
        &[],
        &[payment],
    )
    .unwrap();
    assert_eq!(result["lines"][0]["status"], "unmatched");
    assert_eq!(result["lines"][1]["status"], "already_reconciled");
}

type Row = Record<string, unknown>;

function isActive(plan: Row): boolean {
  return plan.active === true;
}

/** `activate_subscription_plan` (subscription_plan:write) is offered for a plan that is inactive. */
export function canActivatePlan(plan: Row): boolean {
  return !isActive(plan);
}

/**
 * `deactivate_subscription_plan` (subscription_plan:write) rejects a plan that is already inactive;
 * it also unpublishes the plan, which is why the action asks first.
 */
export function canDeactivatePlan(plan: Row): boolean {
  return isActive(plan);
}

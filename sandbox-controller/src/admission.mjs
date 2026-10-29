/** A release of executable code does not grant production runtime admission. */
export const BUILD_ADMISSION = Object.freeze({ productionExecution: false, certificationRequired: true });

export function requireProductionAdmission() {
  if (!BUILD_ADMISSION.productionExecution) {
    const error = new Error('sandbox_production_uncertified');
    error.code = 'sandbox_production_uncertified';
    throw error;
  }
}

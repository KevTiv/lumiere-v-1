/// Manufacturing Module — Bill of Materials, Manufacturing Orders, and Work Centers
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **MrpBom** | Bill of Materials header |
/// | **MrpBomLine** | BOM component lines |
/// | **MrpRoutingWorkcenter** | Routing workcenter operations |
/// | **MrpProduction** | Manufacturing orders |
/// | **MrpWorkorder** | Work order operations |
/// | **MrpWorkcenter** | Work center definitions |
/// | **MrpWorkcenterProductivity** | Work center productivity tracking |
pub mod bill_of_materials;
pub mod manufacturing_orders;
pub mod work_centers;

pub use bill_of_materials::*;
pub use manufacturing_orders::*;
pub use work_centers::*;

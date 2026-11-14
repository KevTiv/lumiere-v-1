//! Pure execution shared by tenant draft tests and the published skill API.

use serde_json::{Map, Value};

pub const EXECUTOR: &str = "json_projection_v1";
pub const MAX_JSON_BYTES: usize = 64_000;
const MAX_FIELDS: usize = 32;

pub struct SkillProjection<'a> {
    fields: &'a Map<String, Value>,
}

impl<'a> SkillProjection<'a> {
    /// Legacy manifests have no executor. Unknown executors fail closed.
    pub fn from_manifest(manifest: &'a Value) -> Result<Option<Self>, &'static str> {
        let Some(executor) = manifest.get("executor") else {
            return Ok(None);
        };
        if executor.as_str() != Some(EXECUTOR) {
            return Err("unsupported skill executor");
        }
        if manifest.get("risk").and_then(Value::as_str) != Some("green")
            || manifest
                .get("permissions")
                .and_then(Value::as_array)
                .map(Vec::len)
                != Some(0)
            || manifest
                .get("resources")
                .and_then(Value::as_array)
                .map(Vec::len)
                != Some(0)
            || manifest.get("output_types") != Some(&serde_json::json!(["application/json"]))
        {
            return Err("projection skills require green risk, JSON output and empty permissions and resources");
        }
        let fields = manifest
            .get("fields")
            .and_then(Value::as_object)
            .filter(|fields| (1..=MAX_FIELDS).contains(&fields.len()))
            .ok_or("projection requires 1 to 32 named output fields")?;
        for (output_name, pointer) in fields {
            if output_name.is_empty()
                || output_name.len() > 80
                || !output_name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                return Err("invalid projection output field name");
            }
            let pointer = pointer
                .as_str()
                .filter(|pointer| pointer.starts_with('/') && pointer.len() <= 256)
                .ok_or("projection selectors must be bounded JSON pointers")?;
            if pointer
                .match_indices('~')
                .any(|(index, _)| !matches!(pointer.as_bytes().get(index + 1), Some(b'0' | b'1')))
            {
                return Err("projection selectors must use valid JSON pointer escaping");
            }
        }
        Ok(Some(Self { fields }))
    }

    pub fn execute(&self, input: &Value) -> Result<Value, &'static str> {
        if !input.is_object() || input.to_string().len() > MAX_JSON_BYTES {
            return Err("projection input must be a JSON object within the size limit");
        }
        let mut output = Map::new();
        for (name, pointer) in self.fields {
            let value = input
                .pointer(pointer.as_str().ok_or("invalid projection selector")?)
                .ok_or("projection input is missing a required value")?;
            output.insert(name.clone(), value.clone());
        }
        let result = Value::Object(output);
        if result.to_string().len() > MAX_JSON_BYTES {
            return Err("projection output exceeds the size limit");
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn version(fields: Value) -> Value {
        json!({
            "executor": EXECUTOR,
            "risk": "green",
            "permissions": [],
            "resources": [],
            "output_types": ["application/json"],
            "fields": fields,
        })
    }

    #[test]
    fn projects_only_fields_from_the_supplied_input() {
        let manifest = version(json!({"sku": "/item/sku", "amount": "/item/net~1amount"}));
        let projection = SkillProjection::from_manifest(&manifest).unwrap().unwrap();
        let input = json!({"item": {"sku": "SW-1", "net/amount": 42, "internal_notes": "hidden"}});
        assert_eq!(
            projection.execute(&input).unwrap(),
            json!({"sku": "SW-1", "amount": 42})
        );
        assert!(projection
            .execute(&json!({"item": {"sku": "SW-1"}}))
            .is_err());
    }

    #[test]
    fn rejects_unsupported_executors_and_privileged_projections() {
        let mut manifest = version(json!({"sku": "/sku"}));
        manifest["resources"] = json!(["company_records"]);
        assert!(SkillProjection::from_manifest(&manifest).is_err());
        assert!(SkillProjection::from_manifest(&json!({"executor": "shell"})).is_err());
        assert!(SkillProjection::from_manifest(&version(json!({"sku": "/bad~2key"}))).is_err());
        assert!(SkillProjection::from_manifest(&json!({}))
            .unwrap()
            .is_none());
    }
}

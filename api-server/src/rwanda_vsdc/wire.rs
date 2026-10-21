//! A small typed encoder: decimal and 38-digit counter tokens never pass through f64.
//! Only static keys and validated typed values enter this tree. Text is always JSON escaped.
use super::values::{Counter, Decimal};

pub(super) enum Wire {
    Text(String),
    Unsigned(u128),
    Hundredths(u64),
    Null,
    Object(Vec<(&'static str, Wire)>),
    Array(Vec<Wire>),
}

impl Wire {
    pub(super) fn string(value: &str) -> Self {
        Self::Text(value.to_owned())
    }

    pub(super) fn optional(value: Option<&str>) -> Self {
        value.map_or(Self::Null, Self::string)
    }

    pub(super) fn counter(value: Counter) -> Self {
        Self::Unsigned(value.value())
    }

    pub(super) fn decimal<const P: u32>(value: Decimal<P>) -> Self {
        Self::Hundredths(value.minor_units())
    }

    pub(super) fn integer(value: usize) -> Self {
        Self::Unsigned(value as u128)
    }

    pub(super) fn encode(self) -> Result<Vec<u8>, serde_json::Error> {
        fn write(value: Wire, out: &mut Vec<u8>) -> Result<(), serde_json::Error> {
            match value {
                Wire::Text(s) => serde_json::to_writer(out, &s)?,
                Wire::Unsigned(n) => out.extend_from_slice(n.to_string().as_bytes()),
                Wire::Hundredths(n) => {
                    out.extend_from_slice(format!("{}.{:02}", n / 100, n % 100).as_bytes());
                }
                Wire::Null => out.extend_from_slice(b"null"),
                Wire::Object(fields) => {
                    out.push(b'{');
                    for (i, (key, value)) in fields.into_iter().enumerate() {
                        if i > 0 {
                            out.push(b',');
                        }
                        serde_json::to_writer(&mut *out, key)?;
                        out.push(b':');
                        write(value, out)?;
                    }
                    out.push(b'}');
                }
                Wire::Array(items) => {
                    out.push(b'[');
                    for (i, value) in items.into_iter().enumerate() {
                        if i > 0 {
                            out.push(b',');
                        }
                        write(value, out)?;
                    }
                    out.push(b']');
                }
            }
            Ok(())
        }
        let mut bytes = Vec::new();
        write(self, &mut bytes)?;
        Ok(bytes)
    }
}
